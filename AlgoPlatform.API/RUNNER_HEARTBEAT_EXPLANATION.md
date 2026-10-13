# 💓 Зачем Heartbeat нужен Runner'у?

## Короткий ответ

**Heartbeat необходим Runner'у чтобы информировать API о том, что код ещё выполняется**, пока контейнер работает в Docker. Без heartbeat'а фронтенд не будет знать, что происходит между запуском кода и его завершением.

---

## 🎯 Основные причины

### 1️⃣ **Информировать клиента о прогрессе**

Когда пользователь запускает код:

```
API                    Runner                   Frontend
 │                      │                          │
 │ ──> Publish RunJob ──> Docker container         │
 │                      │ запускается              │
 │                      │ код выполняется...       │
 │                      │ (может быть 10 секунд!)  │
 │                      │                          │ GET /status?
 │                      │ <── Heartbeat ────────>  │
 │                      │                          │ "Running"
 │                      │ (еще 5 сек выполнения)   │
 │                      │                          │ GET /status?
 │                      │ <── Heartbeat ────────>  │ "Running"
 │                      │                          │
 │                      │ Завершено!               │
 │                      │ <── Result ────────────> GET /status?
 │                      │                          │ "Completed"
 │                      │                          │
```

**Без heartbeat:**
```
Get /status? → "TimedOut" или "Failed" (хотя на самом деле работает!)
```

**С heartbeat:**
```
GET /status? → "Running" (актуальный статус)
```

---

### 2️⃣ **Обновлять Redis кэш**

```csharp
// Runner отправляет heartbeat каждые N секунд
PeriodicTimer → PublishHeartbeat()
   ↓
RabbitMqHeartbeatService получает
   ↓
Обновляет Redis:
   Key: submission:{id}
   Value: {State: "Running", Progress: 0}
   ↓
Фронтенд получает свежий статус из Redis (очень быстро!)
```

**Без heartbeat:** Redis никогда не обновляется во время выполнения.

---

### 3️⃣ **Защита от timeout'а**

```csharp
// В SubmissionsController.cs
if (IsStale(s, DateTimeOffset.UtcNow))
{
    // Если статус не обновлялся > N минут
    // → помечаем как TimedOut
    return MarkTimedOutAsync(...);
}
```

**Сценарий без heartbeat:**
```
t=0s   → Start execution
t=5s   → GET /status → "RunQueued" (из БД)
t=30s  → GET /status → "TimedOut" ❌ (хотя код еще выполняется!)
         (потому что в Redis/БД нет обновления)
```

**С heartbeat:**
```
t=0s   → Start execution
t=5s   → Heartbeat → Redis обновлен → GET /status → "Running" ✅
t=10s  → Heartbeat → Redis обновлен → GET /status → "Running" ✅
t=30s  → Heartbeat → Redis обновлен → GET /status → "Running" ✅
t=45s  → Результат → GET /status → "Completed" ✅
```

---

## 🔄 Как это работает в коде

### В RabbitMqRunWorker

```csharp
// Строка 129-130: Runner получил задачу на выполнение
using var heartbeatCts = new CancellationTokenSource();
var heartbeatTask = StartHeartbeatAsync(job.SubmissionId, heartbeatCts.Token);

// Строка 131-132: Запускаем сам код
using var runCts = new CancellationTokenSource();
_activeRuns[job.SubmissionId] = runCts;

// Строка 138-160: Docker контейнер выполняется
(exitCode, stdout, stderr, durationMs, timedOut) =
    await _runner.RunAsync(job.Code, job.Input, null, null, runCts.Token);

// Строка 195-196: После завершения кода
heartbeatCts.Cancel();      // Останавливаем heartbeat
await heartbeatTask;        // Дожидаемся его завершения
```

### Жизненный цикл Heartbeat

```
StartHeartbeatAsync(submissionId, heartbeatCts.Token)
         │
         ├─> PublishHeartbeatAsync()   (первый пульс сразу)
         │
         ├─> PeriodicTimer(_heartbeatInterval)
         │
         ├─> while (await timer.WaitForNextTickAsync(ct))
         │   {
         │       PublishHeartbeatAsync()  (каждые ~5 сек)
         │   }
         │
         └─> catch (OperationCanceledException)
             {
                 // heartbeatCts.Cancel() вызвал -> выход
             }
```

---

## 📊 Диаграмма: с heartbeat и без

### ❌ БЕЗ heartbeat

```
Timeline          Runner            Redis/DB          Frontend
─────────────────────────────────────────────────────────────
0s    │ Run job   │ Start Docker  │                    │
      │ ───────→  │               │                    │
5s    │           │ Код работает  │                    │ GET /status
      │           │               │                    │ ← "RunQueued" (старый статус!)
      │           │ (5 сек прош.)  │                    │
10s   │           │ Код работает  │                    │ GET /status
      │           │               │                    │ ← "TimedOut" ❌ (неправильно!)
      │           │ (10 сек)      │                    │
15s   │           │ Завершено!    │                    │ GET /status
      │ Result    │ ─────────────→ │ Обновлен          │ ← "Running" (слишком поздно!)
      │ ←─────────│                 │                    │
```

**Проблемы:**
- ❌ Неправильный статус
- ❌ Пользователь видит "TimedOut" хотя код работает
- ❌ Невозможно отследить прогресс

---

### ✅ С heartbeat

```
Timeline          Runner              Redis/DB          Frontend
───────────────────────────────────────────────────────────────
0s    │ Run job   │ Start Docker    │                    │
      │ ───────→  │                 │                    │
      │           │ heartbeat_task  │                    │
      │           │ ───────┐        │                    │
      │           │         ├──────→ Publish HB          │
2s    │           │         │        ←─ Update Redis     │ GET /status
      │           │         │        │ {State: Running}  │ ← "Running" ✅
      │           │ Код работает    │                    │
5s    │           │         │        │                    │ GET /status
      │           │         ├──────→ Publish HB          │ ← "Running" ✅
      │           │         │        ←─ Update Redis     │
      │           │ (5 сек)        │                    │
10s   │           │         │        │                    │ GET /status
      │           │         ├──────→ Publish HB          │ ← "Running" ✅
      │           │ (10 сек)       │ {State: Running}    │
15s   │ Result    │ Завершено!      │                    │
      │ ←─────────│ ────────────────→ Update Result      │ GET /status
      │           │                 │ {State: Completed} │ ← "Completed" ✅
      │           │ heartbeatCts    │                    │
      │           │ .Cancel()       │                    │
      │           │ heartbeat_task  │                    │
      │           │ ←─ Stop         │                    │
```

**Преимущества:**
- ✅ Актуальный статус каждые 5 секунд
- ✅ Пользователь видит "Running"
- ✅ Защита от timeout'а
- ✅ Живой фидбэк

---

## 🧠 Логика в Runner коде

### Шаг 1: Запуск heartbeat

```csharp
// Сразу при получении RunJob сообщения
using var heartbeatCts = new CancellationTokenSource();
var heartbeatTask = StartHeartbeatAsync(job.SubmissionId, heartbeatCts.Token);
```

**Что это делает:**
- Создает отдельную задачу (Task) для heartbeat'а
- Эта задача работает параллельно с выполнением кода

### Шаг 2: Выполнение кода

```csharp
// Основной поток (Main thread)
(exitCode, stdout, stderr, durationMs, timedOut) =
    await _runner.RunAsync(job.Code, job.Input, null, null, runCts.Token);

// Heartbeat поток (Background thread) — работает одновременно!
PeriodicTimer → PublishHeartbeat() → RabbitMQ
```

### Шаг 3: Остановка heartbeat

```csharp
finally
{
    // После завершения кода (успешно или с ошибкой)
    heartbeatCts.Cancel();      // Сигнал: прекратить heartbeat
    await heartbeatTask;        // Дожидаемся его завершения
}
```

---

## 📋 Таблица: когда нужен heartbeat

| Сценарий | Время выполнения | Нужен ли heartbeat? | Почему |
|----------|------------------|-------------------|--------|
| Быстрый скрипт | 1 сек | ✅ Да | Даже если быстро, нужно обновить Redis сразу |
| Алгоритм сортировки | 5-10 сек | ✅ Да | КРИТИЧНО! Иначе timeout после 1 минуты |
| Сложный граф | 30-60 сек | ✅ Да | БЕЗ heartbeat пользователь видит "TimedOut" |
| Бесконечный цикл | ∞ | ✅ Да | Heartbeat помогает обнаружить зависание |

---

## 🚨 Что произойдет БЕЗ heartbeat

### Сценарий: Пользователь запускает сортировку 30 000 элементов

**Time -> Event -> Frontend UI**

```
0s     Run job
       → "RunQueued" (0%)

5s     GET /status
       ← "RunQueued" (из БД)
       → User sees: "Queued..."

10s    GET /status
       ← "RunQueued" (все еще из БД, 0%)
       → User sees: "Queued..." 😕

30s    GET /status
       ← "RunQueued" (из БД)
       → User sees: "Queued..." (еще ничего не изменилось!)

60s    GET /status
       ← Проверяем IsStale()
       ← Последний update был 60 сек назад
       ← ❌ "TimedOut" ❌ ← НЕПРАВИЛЬНО!
       → User sees: "ERROR: Task timed out" 😡
       
       (но в Docker код ЕЩЕ РАБОТАЕТ!)

65s    Result приходит
       ← "Completed" ✅
       → User уже закрыл браузер...
```

### С heartbeat все правильно

```
0s     Run job
       → "RunQueued" (0%)

5s     GET /status
       ← "Running" (из Redis, обновлено heartbeat'ом)
       → User sees: "Running..." ✅

10s    GET /status
       ← "Running" (из Redis, свежий heartbeat)
       → User sees: "Running..." ✅

30s    GET /status
       ← "Running" (из Redis, свежий heartbeat)
       → User sees: "Running... please wait" ✅

60s    GET /status
       ← "Running" (из Redis, свежий heartbeat)
       ← IsStale() = false (был обновлен 5 сек назад)
       → User sees: "Running... please wait" ✅

65s    Result приходит
       → "Completed" ✅
       → Output: "Sorted array: [1, 2, 3, ...]" ✅
       → User sees result
```

---

## 🔄 Параллелизм в Runner

```csharp
// Два параллельных потока:

// Поток 1: Основной (Main Worker)
OnReceivedAsync()
    ↓
_runner.RunAsync()  ← Долгая операция (5-60 сек)
    ↓
Результат

// Поток 2: Heartbeat (Background)
StartHeartbeatAsync()
    ↓
PeriodicTimer
    ↓
PublishHeartbeat() → PublishHeartbeat() → PublishHeartbeat() ...
(каждые 5 сек)

// Оба потока работают одновременно!
```

---

## 🎓 Итог: 5 причин использовать Heartbeat в Runner

| № | Причина | Пример |
|---|---------|--------|
| 1 | **Живой статус** | GET /status → "Running" вместо "Queued" |
| 2 | **Обновление кэша** | Redis обновляется каждые 5 сек |
| 3 | **Защита timeout'а** | Не будет "TimedOut" во время выполнения |
| 4 | **Обратная связь** | User видит прогресс вместо зависания |
| 5 | **Обнаружение зависания** | Если heartbeat не приходит → сервис упал |

---

## 📝 Аналогия из реальной жизни

```
Heartbeat в Runner = Пульс пациента во время операции

Без heartbeat:
  Доктор начинает операцию → исчезает на 30 минут
  → Родственники не знают что происходит
  → Через 5 минут: "Операция заняла дольше ожидаемого!"
  → Родственники паникуют: "Что-то пошло не так!??" 😱
  → Через 30 минут: "Операция успешна!" 
  → Но родственники уже вызвали скорую... 🚑

С heartbeat (монитор пульса):
  Доктор начинает операцию
  → Монитор показывает пульс каждые 5 сек: "Всё ещё живой ✓"
  → Родственники видят: "Пульс 90 уд/мин, давление 120/80"
  → Операция идет нормально → родственники спокойны ✅
  → Через 30 минут: "Операция успешна!" 
  → Родственники ожидали этого 👍
```

Также и с Runner:
- **Без heartbeat**: Фронтенд не видит, что код работает → может подумать что зависло
- **С heartbeat**: API постоянно получает "Я еще работаю!" → правильно информирует фронтенд

---

## 🔧 Технические детали

### Heartbeat Channel

```csharp
// Отдельный RabbitMQ channel для heartbeat'ов
private readonly IChannel _heartbeatChannel;

// Причина: не загружать основной channel очередями heartbeat'ов
// Heartbeat'ы не-persistent, быстрые, много их идет
```

### Heartbeat Queue

```csharp
_heartbeatQueue = configuration["RabbitMQ:HeartbeatQueue"] ?? "run-heartbeats";

// Свойства:
// - Durable: true (сохраняется при перезагрузке)
// - Exclusive: false (доступна всем)
// - AutoDelete: false (не удаляется)
```

### Отправка с низким приоритетом

```csharp
var props = new BasicProperties { Persistent = false };
// ↑ Heartbeat не сохраняется на диск
// Экономим ресурсы, т.к. это только информационное сообщение
```

---

## 🎯 Заключение

**Heartbeat в Runner нужен для того, чтобы API и фронтенд ЗНАЛИ, что код ещё выполняется.**

Без heartbeat'а:
- ❌ Статус не обновляется
- ❌ Redis становится стари
- ❌ Пользователь видит неправильную информацию
- ❌ Может произойти ложный timeout

С heartbeat'ом:
- ✅ Статус обновляется каждые 5 сек
- ✅ Redis всегда свежий
- ✅ Пользователь видит правильный прогресс
- ✅ Защита от false timeout'а

