# ❤️ Heartbeat система в AlgoPlatform

## Обзор

**Heartbeat** — это система мониторинга **прогресса** выполнения задач. Фоновые сервисы (Compiler, Runner) периодически отправляют "пульс" о том, что они еще живы и работают.

---

## 🎯 Зачем это нужно?

1. **Показать фронтенду прогресс**: пользователь видит, что код компилируется/выполняется
2. **Обновить Redis**: даже если итоговый результат еще не готов
3. **Обнаружить "зависшие" задачи**: если heartbeat не приходит больше N минут → task timeout
4. **Живое состояние**: клиент может polling'ить статус без задержек

---

## 🏗️ Архитектура Heartbeat

```
┌─────────────────────────────────────┐
│  RabbitMqRunWorker                  │
│  (выполняет код в Docker)           │
│                                      │
│  StartHeartbeatAsync()              │
│  └─> PeriodicTimer (каждые Xсек)   │
│      └─> PublishHeartbeatAsync()    │
│          └─> Publish в очередь      │
└─────────────┬───────────────────────┘
              │
              │ RabbitMQ очередь
              │ "run-heartbeats"
              ▼
┌─────────────────────────────────────┐
│  RabbitMqHeartbeatService           │
│  (Hosted Service в API)             │
│                                      │
│  Слушает "run-heartbeats"           │
│  └─> OnReceivedAsync()              │
│      └─> Обновляет Redis            │
│      └─> Обновляет БД (если нужно)  │
└─────────────┬───────────────────────┘
              │
              ▼
        ┌──────────────┐
        │ Redis        │
        │ (быстрый     │
        │  статус)     │
        └──────────────┘
              │
              │ GET /api/submissions/{id}/status
              ▼
        Фронтенд (Polling)
```

---

## 📤 Как работает отправка Heartbeat

### Для Runner (выполнение кода)

```csharp
// RabbitMqRunWorker.cs

private async Task StartHeartbeatAsync(Guid submissionId, CancellationToken ct)
{
    try
    {
        // Первый heartbeat сразу
        await PublishHeartbeatAsync(submissionId);

        // Периодический timer
        using var timer = new PeriodicTimer(_heartbeatInterval);  //例: 5 сек
        while (await timer.WaitForNextTickAsync(ct))
        {
            await PublishHeartbeatAsync(submissionId);
        }
    }
    catch (OperationCanceledException)
    {
        // Нормальное завершение или отмена
    }
}

private async Task PublishHeartbeatAsync(Guid submissionId)
{
    var msg = new SubmissionHeartbeatMessage(
        submissionId,
        "Running",      // текущее состояние
        0,              // прогресс (0%)
        "Running");     // человеческое сообщение

    var body = JsonSerializer.SerializeToUtf8Bytes(msg);
    var props = new BasicProperties { Persistent = false };  // не сохраняем

    await _heartbeatChannel.BasicPublishAsync(
        exchange: "",
        routingKey: _heartbeatQueue,        // "run-heartbeats"
        mandatory: false,
        basicProperties: props,
        body: body);
}
```

### Для Compiler (компиляция кода)

```csharp
// RabbitMqCompileWorker.cs

private async Task PublishCompilingHeartbeatAsync(Guid submissionId)
{
    try
    {
        var heartbeat = new SubmissionHeartbeatMessage(
            submissionId,
            "Compiling",    // статус: компиляция
            0,              // прогресс
            "Compiling");

        var body = JsonSerializer.SerializeToUtf8Bytes(heartbeat);
        var props = new BasicProperties { Persistent = false };

        await _heartbeatChannel.BasicPublishAsync(
            exchange: "",
            routingKey: _heartbeatQueue,
            mandatory: false,
            basicProperties: props,
            body: body);
    }
    catch (Exception ex)
    {
        _logger.LogWarning(ex, "Failed to publish compile heartbeat");
    }
}
```

---

## 📥 Как работает получение Heartbeat

### RabbitMqHeartbeatService (в API)

```csharp
public sealed class RabbitMqHeartbeatService : BackgroundService
{
    private readonly IChannel _channel;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _queue = "run-heartbeats";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Слушаем до 10 heartbeat'ов одновременно
        await _channel.BasicQosAsync(0, 10, false, stoppingToken);

        var consumer = new AsyncEventingBasicConsumer(_channel);
        consumer.ReceivedAsync += OnReceivedAsync;

        // Начинаем слушать очередь
        await _channel.BasicConsumeAsync(
            queue: _queue,
            autoAck: false,
            consumer: consumer);

        _logger.LogInformation("RabbitMqHeartbeatService started");

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("RabbitMqHeartbeatService stopping");
        }
    }

    private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
    {
        try
        {
            // 1️⃣ Десериализуем heartbeat сообщение
            var msg = JsonSerializer.Deserialize<SubmissionHeartbeatMessage>(
                ea.Body.ToArray());

            if (msg is null || msg.SubmissionId == Guid.Empty)
            {
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                return;
            }

            using var scope = _scopeFactory.CreateScope();
            var statusStore = scope.ServiceProvider
                .GetRequiredService<ISubmissionStatusStore>();

            // 2️⃣ Получаем текущий статус
            var current = await statusStore.GetAsync(msg.SubmissionId);

            // 3️⃣ Если уже завершено → не обновляем
            if (current is not null
                && (string.Equals(current.State, "Completed", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(current.State, "Failed", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(current.State, "Cancelled", StringComparison.OrdinalIgnoreCase)))
            {
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                return;
            }

            // 4️⃣ Обновляем статус в Redis (быстро!)
            await statusStore.SetAsync(
                msg.SubmissionId,
                new SubmissionStatus(msg.State, msg.Progress, msg.Message));

            // 5️⃣ Если нужно → сохраняем в БД
            if (IsPersistentProgressState(msg.State))
            {
                var repo = scope.ServiceProvider
                    .GetRequiredService<ISubmissionRepository>();
                var uow = scope.ServiceProvider
                    .GetRequiredService<IUnitOfWork>();
                var submission = await repo.GetAsync(msg.SubmissionId);

                if (submission is not null && !IsFinalState(submission.Status))
                {
                    submission.Status = msg.State;
                    submission.Error = msg.Message;
                    await uow.SaveChangesAsync();
                }
            }

            // 6️⃣ Подтверждаем обработку (ACK)
            await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Heartbeat processing error");
            // Не подтверждаем → сообщение вернется в очередь
        }
    }
}
```

---

## 📊 Таблица состояний Heartbeat

| Состояние | Откуда | Прогресс | Описание |
|-----------|--------|----------|---------|
| `Compiling` | Compiler | 0% | Код компилируется |
| `Running` | Runner | 0-100% | Код выполняется |
| `Completed` | Runner | 100% | Успешно завершено |
| `Failed` | Compiler/Runner | 100% | Ошибка компиляции или выполнения |
| `Cancelled` | API | 100% | Отменено пользователем |

---

## ⏰ Жизненный цикл Heartbeat

```
Runner начинает работу
         │
         ▼
    StartHeartbeat()
         │
         ├─> PublishHeartbeat() ──┐
         │   (State: "Running")    │
         │                         │
         │   PeriodicTimer ────┐   │
         │   (каждые ~5 сек)   │   │
         │                     │   │
         │       Timer Tick    │   │
         │       ──────────────┼───┤
         │                     │   │
         │       PublishHeartbeat()┤
         │       ──────────────┤   │
         │                     │   │
         └─────────────────────┘   │
         │                         │
    Код завершился                 │
         │                         │
         ▼                         ▼
    StopHeartbeat()       RabbitMqHeartbeatService
    OperationCancelled           │
                                 ├─> OnReceivedAsync()
                                 ├─> Обновить Redis
                                 ├─> Обновить БД
                                 ├─> ACK сообщение
                                 └─> (готово)
```

---

## 🔄 Интеграция с Polling

### Фронтенд

```javascript
// frontend (js/runner/runner.js)

function startStatusPolling(submissionId) {
    const pollInterval = setInterval(() => {
        fetch(`/api/submissions/${submissionId}/status`)
            .then(r => r.json())
            .then(status => {
                console.log(`Status: ${status.State}, Progress: ${status.Progress}%`);
                
                if (isTerminalState(status.State)) {
                    clearInterval(pollInterval);
                    fetchFullResult(submissionId);
                }
            });
    }, 1000);  // каждую секунду
}
```

### Бэкенд API

```csharp
// AlgoPlatform\Controllers\SubmissionsController.cs

[HttpGet("{id:guid}/status")]
public async Task<IActionResult> GetStatus([FromRoute] Guid id, CancellationToken ct)
{
    // 1. Быстро получаем из Redis
    var s = await _statusStore.GetAsync(id);
    
    if (s is null)
    {
        // 2. Fallback на БД если нет в кэше
        var fallback = await BuildStatusFromDbAsync(id, ct);
        return fallback is null ? NotFound() : Ok(fallback);
    }

    // 3. Проверяем timeout
    if (IsStale(s, DateTimeOffset.UtcNow))
    {
        var timedOut = await MarkTimedOutAsync(id, s.State, ct);
        return Ok(timedOut);
    }

    // 4. Возвращаем актуальный статус
    return Ok(s);
}
```

---

## 📋 Сообщение Heartbeat

```csharp
public record SubmissionHeartbeatMessage(
    Guid SubmissionId,      // ID submission'а
    string State,           // "Compiling", "Running", "Completed", etc
    int Progress,           // 0-100
    string Message);        // человеческое описание
```

---

## 🛑 Обработка ошибок в Heartbeat

### Если сообщение не обработано

```
PublishHeartbeat() в Runner
         │
         ▼
    RabbitMQ очередь
         │
         ▼
    RabbitMqHeartbeatService.OnReceived()
         │
    ❌ Исключение!
         │
         ▼
    Не вызываем BasicAck()
         │
         ▼
    Сообщение возвращается в очередь
         │
         ▼
    Переобработка (Retry)
```

### Если heartbeat не приходит

```
Runner завис или упал
         │
         ▼
    Heartbeat не публикуется ~5 минут
         │
         ▼
    Controller.IsStale() возвращает true
         │
         ▼
    Status = "TimedOut" (или "Failed")
         │
         ▼
    Фронтенд показывает ошибку
```

---

## 📡 Поток данных Heartbeat

```
1️⃣  Runner (в Worker процессе)
    PeriodicTimer → PublishHeartbeatAsync()
         │
         ▼
2️⃣  RabbitMQ (очередь "run-heartbeats")
    Хранит сообщения
         │
         ▼
3️⃣  RabbitMqHeartbeatService (в API)
    Слушает и обрабатывает
         │
         ├─> Обновляет Redis
         │   (Key: submission:{id})
         │
         └─> Обновляет PostgreSQL
             (если нужно)
         │
         ▼
4️⃣  Redis (быстрый кэш)
    {
      State: "Running",
      Progress: 0,
      UpdatedAt: "2024-01-15T10:30:00Z"
    }
         │
         ▼
5️⃣  Фронтенд
    GET /api/submissions/{id}/status
    → Получает из Redis (очень быстро!)
    → Показывает "Выполняется..."
```

---

## ⚙️ Конфигурация Heartbeat

### В DependencyInjection или Program.cs

```csharp
// Регистрация RabbitMqHeartbeatService
services.AddHostedService<RabbitMqHeartbeatService>();
```

### RabbitMQ конфигурация (appsettings.json)

```json
{
  "RabbitMQ": {
    "HeartbeatQueue": "run-heartbeats",
    "HeartbeatInterval": 5000          // milliseconds (5 сек)
  }
}
```

### Redis TTL

```csharp
// RedisSubmissionStatusStore.cs
// TTL heartbeat статуса в Redis:
// Успешное завершение: 1 час
// Ошибка: 30 минут
// Текущий процесс: остается пока не завершится
```

---

## 🎯 Примеры использования

### Пример 1: Компиляция кода

```
t=0s   → Compile heartbeat: State="Compiling", Progress=0%
t=1s   → Status: "Compiling" (из Redis)
t=2s   → Compile heartbeat: State="Compiling", Progress=0%
t=3s   → Status: "Compiling" (из Redis)
...
t=30s  → Результат: Status="Compiled", можно запускать
```

### Пример 2: Выполнение алгоритма

```
t=0s   → Run heartbeat: State="Running", Progress=0%
t=2s   → Heartbeat: State="Running", Progress=0%
t=4s   → Heartbeat: State="Running", Progress=0%
...
t=15s  → Результат: State="Completed", Progress=100%
        Output: "1 1 3 4 5" (отсортированный массив)
```

### Пример 3: Timeout

```
t=0s   → Run heartbeat: State="Running", Progress=0%
t=5s   → Heartbeat: State="Running", Progress=0%
...
t=300s (5 минут) → Нет heartbeat'ов!
                    IsStale() = true
                    → Status: "TimedOut"
                    → Error: "Task execution timeout"
```

---

## 🔍 Отладка Heartbeat

### Проверить очередь RabbitMQ

```bash
# Посмотреть сообщения в очереди
rabbitmqctl list_queues name messages consumers

# Ожидаемый вывод:
# Listing queues ...
# run-heartbeats    25     1
```

### Проверить Redis

```bash
redis-cli GET submission:{id}
# Выведет JSON с текущим статусом
```

### Логи API

```
RabbitMqHeartbeatService started, queue = run-heartbeats
OnReceivedAsync: submissionId=123..., State=Running, Progress=0
Updated Redis: submission:123... → Running
```

---

## 📊 Диаграмма временной шкалы

```
Время    API        Compiler      RabbitMQ      Redis         Фронтенд
────────────────────────────────────────────────────────────────────────
0s       ────────────────────────────────────────────────────────────
         POST /submissions
         ├─> Create in DB
         ├─> Publish to RabbitMQ
         └─> Return 202 Accepted
                        │
                        ├─> Compile heartbeat
                        └─> "run-heartbeats"
                                          │
                                          ├─> Update
                                          │   Redis
                                          │   │
1s       GET /status ────────────────────────────> (Redis HIT)
         ← Compiling (0%)
                                                    ├─> Show progress
2s                                                │
3s                      Compile job    ────────────────────────────
                        finishes
                        │
                        ├─> Publish to "runs"
5s       GET /status ────────────────────────────> (Redis)
         ← Running (0%)
                                                    ├─> Show "Running..."
10s      GET /status ───────────────────> (Redis)
         ← Running (0%)
15s                   Run job
                      finishes
                      │
                      ├─> Update DB
                      └─> Publish result
20s      GET /status                       ────> (Redis or DB)
         ← Completed (100%)
                                          └──> Output: "1 1 3 4 5"
                                                    │
                                                    └─> Show results
```

---

## 🎓 Резюме

| Аспект | Описание |
|--------|---------|
| **Что** | Периодическая отправка статуса выполнения |
| **Кто** | Compiler & Runner отправляют, API получает |
| **Когда** | Каждые 5 сек (или как настроено) |
| **Где** | RabbitMQ очередь "run-heartbeats" |
| **Почему** | Показать прогресс, обновить кэш, обнаружить timeout |
| **Как** | PeriodicTimer + PublishAsync в RabbitMQ |

Heartbeat — это **средство связи** между фоновыми workers и API для отслеживания статуса в реальном времени! 💓

