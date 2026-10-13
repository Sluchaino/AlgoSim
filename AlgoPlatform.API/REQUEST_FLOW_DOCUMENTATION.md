# Полный путь обработки запроса в AlgoPlatform

## Архитектурный обзор

Ваша система использует **асинхронную обработку** с очередями задач RabbitMQ и кэшированием состояния в Redis.

---

## 📊 Диаграмма потока данных

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ФРОНТЕНД (SPA)                                     │
└────────────────┬────────────────────────────────────────────────────────────┘
                 │
                 │ POST /api/submissions (SubmitCodeRequest)
                 │ { name, code, input }
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             АЛГОРИТМ ОБРАБОТКИ ЗАПРОСА                                      │
│                                                                             │
│ 1️⃣  SubmissionsController.Create()                                         │
│    └─> Валидация ModelState                                               │
│    └─> ISubmissionsService.CreateAsync()                                  │
│       └─> Сохранение в БД (PostgreSQL):                                   │
│          - Создание записи Submission с ID                                │
│          - Status = "Queued"                                              │
│          - await _uow.SaveChangesAsync()                                  │
│       └─> Сохранение в Redis (временное состояние):                       │
│          - await _status.SetAsync(id, "Queued")                           │
│       └─> Публикация в очередь RabbitMQ:                                  │
│          - await _queue.PublishAsync(submissionId)                        │
│       └─> Возврат ACCEPTED 202 с URL статуса                             │
│                                                                             │
│ 2️⃣  ФРОНТЕНД начинает POLLING статуса:                                     │
│    GET /api/submissions/{id}/status (каждые N сек)                        │
│    └─> SubmissionsController.GetStatus()                                  │
│       └─> Чтение из Redis (быстро)                                        │
│       └─> Если нет в Redis → fallback из БД                              │
│       └─> Возврат текущего статуса (200 OK)                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                 │
                 │ Асинхронная обработка в BACKGROUND SERVICE
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│          3️⃣  RabbitMqExecutorService (Hosted Service)                       │
│                                                                             │
│  Слушает очередь "submissions" и обрабатывает:                            │
│                                                                             │
│  a) Получает Submission из БД                                             │
│  b) Проверяет статус (Cancelled ?)                                        │
│  c) Вычисляет хэш кода: hasher.ComputeHash(code)                         │
│  d) Ищет Artifact по хэшу:                                                │
│                                                                             │
│     ├─ Artifact НЕ существует:                                            │
│     │  ├─> Создает запись Artifact (Status = "Compiling")                 │
│     │  ├─> Обновляет БД                                                   │
│     │  ├─> Status submission = "CompileQueued"                            │
│     │  ├─> Публикует в очередь "compile" → RabbitMqCompilerService       │
│     │  └─> Обновляет Redis: Status = "CompileQueued" (0%)                │
│     │                                                                      │
│     ├─ Artifact уже EXISTS (Status = "Ready"):                            │
│     │  ├─> Достает контейнер из Storage (S3/MinIO)                        │
│     │  ├─> Публикует в очередь "runs" → RabbitMqRunnerService            │
│     │  └─> Status = "RunQueued"                                           │
│     │                                                                      │
│     └─ Artifact STATUS = "Failed":                                        │
│        ├─> Copy ошибку в submission.Error                                 │
│        └─> Status = "Failed"                                              │
│                                                                             │
│  ⚠️  При ошибке:                                                           │
│     └─> Retry механизм (max 3 попытки)                                    │
│     └─> На отказе → Dead Letter Queue                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
        │                                   │
        │ Compile Queue                     │ Run Queue
        ▼                                   ▼
┌──────────────────────┐          ┌─────────────────────────┐
│ RabbitMqCompiler     │          │  RabbitMqRunnerService  │
│ Service              │          │  (Worker Service)       │
│                      │          │                         │
│ 1. Компилирует код  │          │ 1. Выполняет container  │
│    (C#, Python...)   │          │    с кодом и input      │
│ 2. Сохраняет        │          │ 2. Собирает output      │
│    контейнер (S3)    │          │ 3. Трейсит шаги        │
│ 3. Обновляет        │          │    алгоритма            │
│    Artifact:         │          │ 4. Обновляет        │
│    - Status="Ready"  │          │    submission.Output   │
│ 4. Публикует        │          │ 5. Сохраняет результат │
│    в "runs"          │          │    в БД                 │
│                      │          │ 6. Обновляет Redis     │
└──────────────────────┘          │    Status = "Ready"     │
                                  └─────────────────────────┘
```

---

## 🔄 Полный жизненный цикл Submission

### Статусы Submission:

1. **Queued** (202 Accepted)
   - Запрос принят, ждет обработки

2. **CompileQueued** (0%)
   - Код отправлен на компиляцию

3. **Compiled** (50%)
   - Код успешно скомпилирован

4. **RunQueued** (50%)
   - Ожидание запуска контейнера

5. **Running** (75%)
   - Контейнер выполняется

6. **Ready** (100%)
   - ✅ Завершено успешно
   - `Output` содержит результат

7. **Failed** (100%)
   - ❌ Ошибка компиляции или выполнения
   - `Error` содержит сообщение об ошибке

8. **Cancelled** (100%)
   - 🛑 Отменено пользователем

---

## 🗄️ Хранилища данных

### PostgreSQL (основная БД)
```sql
-- Submission
CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  name varchar,
  code text,              -- исходный код
  input text,             -- входные данные
  output text,            -- выходные данные (заполняется после Run)
  status varchar,         -- Queued, CompileQueued, Running, Ready, Failed, Cancelled
  exit_code int,          -- код возврата процесса
  error text,             -- сообщение об ошибке
  duration_ms long        -- время выполнения
);

-- Artifact (кэш скомпилированного кода)
CREATE TABLE artifacts (
  hash varchar PRIMARY KEY,      -- SHA256(код)
  status varchar,                -- Compiling, Ready, Failed
  storage_key varchar,           -- путь в S3/MinIO
  algo_tracing_hash varchar,     -- версия трейсера
  build_error text,
  created_at, updated_at
);
```

### Redis (кэш состояния)
```
Key: submission:{id}
Value: {
  State: "Running",
  Progress: 75,  -- процент выполнения
  UpdatedAt: "2024-01-15T10:30:00Z"
}
TTL: (зависит от статуса, обычно ~1 час)
```

### RabbitMQ (очереди задач)
```
Queues:
- submissions         (входящие сабмишены)
- submissions.retry   (переотправка при ошибке)
- submissions.dead    (мертвые письма)
- compile            (задачи на компиляцию)
- runs               (задачи на выполнение)
```

---

## 🔗 Endpoints API

### 1. Создание submission
```http
POST /api/submissions
Content-Type: application/json

{
  "name": "BubbleSort",
  "code": "...",
  "input": "5\n3 1 4 1 5"
}

Response: 202 Accepted
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "statusUrl": "/api/submissions/{id}/status"
}
```

### 2. Получение статуса (polling)
```http
GET /api/submissions/{id}/status

Response: 200 OK
{
  "State": "Running",
  "Progress": 75,
  "UpdatedAt": "2024-01-15T10:30:00Z"
}
```

### 3. Получение полного результата
```http
GET /api/submissions/{id}

Response: 200 OK
{
  "id": "...",
  "name": "BubbleSort",
  "input": "5\n3 1 4 1 5",
  "output": "1 1 3 4 5",
  "status": "Ready",
  "exitCode": 0,
  "error": null,
  "durationMs": 150
}
```

### 4. Отмена выполнения
```http
POST /api/submissions/{id}/cancel

Response: 202 Accepted
{
  "id": "...",
  "status": "Cancelled"
}
```

---

## 🚀 Ключевые компоненты

### ISubmissionsService
- **CreateAsync()**: Сохранение в БД, публикация в очередь
- Реализация: `SubmissionsService`

### ISubmissionStatusStore
- **GetAsync(id)**: Получить статус из Redis
- **SetAsync(id, status)**: Обновить статус в Redis
- Реализация: `RedisSubmissionStatusStore`

### ISubmissionQueuePublisher
- **PublishAsync(submissionId)**: Опубликовать в RabbitMQ очередь "submissions"
- Реализация: `RabbitMqSubmissionPublisher`

### RabbitMqExecutorService (Hosted Service)
- Слушает очередь submissions
- Определяет статус артефакта (нужна компиляция?)
- Публикует в compile или run очереди

### Artifact Caching
- **Компиляция один раз**: код с одинаковым хешом компилируется один раз
- **Переиспользование**: контейнер берется из хранилища S3/MinIO
- Ускоряет повторные запуски

---

## 🎯 Нюансы и особенности

### 1. Асинхронность
- ✅ API сразу возвращает (202 Accepted)
- 🔄 Обработка идет в background
- 📡 Клиент должен polling'ить статус

### 2. Кэширование артефактов
- Если `hash(code)` уже видели → берем из Storage
- Очень ускоряет повторное выполнение
- `AlgoTracingHash` для отслеживания версии трейсера

### 3. Обработка ошибок
- Retry механизм в RabbitMQ (до 3 попыток)
- Dead Letter Queue для неисправимых ошибок
- Timeout для "зависших" задач

### 4. Трейсинг алгоритма
- Во время выполнения собирает шаги алгоритма
- `JsonConsoleTracer` печатает `__STEP__{json}` в stdout
- Фронтенд показывает визуализацию: compare, swap, read, write, mark

### 5. Redis для быстрого статуса
- Первый запрос статуса → Redis (быстро)
- Fallback на БД если нет в кэше
- TTL: статус удаляется через некоторое время

---

## 📋 Примеры состояний

### Успешный путь:
```
Queued → CompileQueued → Running → Ready ✅
```

### С переиспользованием артефакта:
```
Queued → RunQueued → Running → Ready ✅
(компиляция пропускается)
```

### С ошибкой:
```
Queued → CompileQueued → Failed ❌
(код не скомпилировался)
```

### С отменой:
```
Queued → CompileQueued → Cancelled 🛑
(пользователь отменил)
```

---

## 🔧 Конфигурация

### appsettings.json (API)
```json
{
  "SubmissionStatus": {
    "QueuedTimeout": "00:10:00",
    "RunningTimeout": "00:05:00"
  },
  "RabbitMQ": {
    "Queue": "submissions",
    "RunQueue": "runs",
    "MaxRetries": 3,
    "RetryDelaySeconds": 5
  }
}
```

---

## 📊 Производительность

| Операция | Источник | Время |
|----------|----------|-------|
| POST submission | API | ~50ms (сохранение в БД + Redis + RabbitMQ) |
| GET status (Redis hit) | Redis | ~5ms |
| GET status (DB fallback) | PostgreSQL | ~20ms |
| Компиляция C# кода | Docker | ~2-5 сек |
| Выполнение алгоритма | Docker | зависит от кода |
| Всего (первый запуск) | | ~5-10 сек |
| Всего (переиспользование) | | ~1-3 сек |

