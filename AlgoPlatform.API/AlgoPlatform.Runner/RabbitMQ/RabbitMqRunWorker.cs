using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using AlgoPlatform.Contracts.Runner;
using AlgoPlatform.Runner.Execution;
using AlgoPlatform.Runner.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace AlgoPlatform.Runner.RabbitMQ
{
    public sealed class RabbitMqRunWorker : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly IChannel _heartbeatChannel;
        private readonly DockerCliCodeRunner _runner;
        private readonly S3ArtifactStorage _storage;
        private readonly string _runQueue;
        private readonly string _runRetryQueue;
        private readonly string _runDeadQueue;
        private readonly string _resultQueue;
        private readonly string _heartbeatQueue;
        private readonly TimeSpan _heartbeatInterval;
        private readonly int _maxRetries;
        private readonly ILogger<RabbitMqRunWorker> _logger;

        public RabbitMqRunWorker(
            IConnection connection,
            DockerCliCodeRunner runner,
            S3ArtifactStorage storage,
            RunnerOptions runnerOptions,
            IConfiguration configuration,
            ILogger<RabbitMqRunWorker> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _heartbeatChannel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _runner = runner;
            _storage = storage;
            _logger = logger;
            _runQueue = configuration["RabbitMQ:RunQueue"] ?? "runs";
            _runRetryQueue = _runQueue + ".retry";
            _runDeadQueue = _runQueue + ".dead";
            _resultQueue = configuration["RabbitMQ:ResultQueue"] ?? "run-results";
            _heartbeatQueue = configuration["RabbitMQ:HeartbeatQueue"] ?? "run-heartbeats";
            _maxRetries = configuration.GetValue<int?>("RabbitMQ:MaxRetries") ?? 3;
            _heartbeatInterval = TimeSpan.FromSeconds(Math.Max(1, runnerOptions.HeartbeatIntervalSeconds));
            var retryDelaySeconds = configuration.GetValue<int?>("RabbitMQ:RetryDelaySeconds") ?? 5;

            DeclareQueueWithRetry(_channel, _runQueue, retryDelaySeconds);
            DeclareQueueWithRetry(_channel, _resultQueue, retryDelaySeconds);

            _heartbeatChannel.QueueDeclareAsync(
                queue: _heartbeatQueue,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: null
            ).GetAwaiter().GetResult();
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await _channel.BasicQosAsync(0, 1, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += OnReceivedAsync;

            await _channel.BasicConsumeAsync(
                queue: _runQueue,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _logger.LogInformation("RabbitMqRunWorker started, queue = {Queue}", _runQueue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("RabbitMqRunWorker stopping");
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            RunJobMessage? job = null;

            try
            {
                job = JsonSerializer.Deserialize<RunJobMessage>(ea.Body.ToArray());
                if (job is null || job.SubmissionId == Guid.Empty)
                {
                    _logger.LogWarning("Received invalid RunJob message");
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                using var heartbeatCts = new CancellationTokenSource();
                var heartbeatTask = StartHeartbeatAsync(job.SubmissionId, heartbeatCts.Token);

                try
                {
                    int exitCode;
                    string stdout;
                    string stderr;
                    long durationMs;
                    bool timedOut;

                    if (!string.IsNullOrWhiteSpace(job.ArtifactKey))
                    {
                        await using var artifactStream = await _storage.DownloadAsync(job.ArtifactKey, CancellationToken.None);
                        using var ms = new MemoryStream();
                        await artifactStream.CopyToAsync(ms);
                        var bytes = ms.ToArray();

                        (exitCode, stdout, stderr, durationMs, timedOut) =
                            await _runner.RunPrecompiledAsync(bytes, job.Input, null, null, CancellationToken.None);
                    }
                    else if (!string.IsNullOrWhiteSpace(job.Code))
                    {
                        (exitCode, stdout, stderr, durationMs, timedOut) =
                            await _runner.RunAsync(job.Code, job.Input, null, null, CancellationToken.None);
                    }
                    else
                    {
                        throw new InvalidOperationException("Run job has neither code nor artifact key.");
                    }

                    var result = new RunResultMessage(
                        job.SubmissionId,
                        exitCode,
                        stdout ?? string.Empty,
                        stderr ?? string.Empty,
                        durationMs,
                        timedOut);

                    var body = JsonSerializer.SerializeToUtf8Bytes(result);
                    var props = new BasicProperties { Persistent = true };

                    await _channel.BasicPublishAsync(
                        exchange: "",
                        routingKey: _resultQueue,
                        mandatory: false,
                        basicProperties: props,
                        body: body);

                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                }
                finally
                {
                    heartbeatCts.Cancel();
                    await heartbeatTask;
                }
            }
            catch (Exception ex)
            {
                var submissionId = job?.SubmissionId ?? Guid.Empty;
                _logger.LogError(ex, "Runner error for submission {SubmissionId}", submissionId);

                var retryCount = GetRetryCount(ea.BasicProperties?.Headers);
                var nextRetry = retryCount + 1;

                if (nextRetry <= _maxRetries)
                {
                    var props = BuildRetryProperties(nextRetry, ea.BasicProperties);
                    var body = ea.Body.ToArray();

                    await _channel.BasicPublishAsync(
                        exchange: "",
                        routingKey: _runRetryQueue,
                        mandatory: false,
                        basicProperties: props,
                        body: body);
                }
                else
                {
                    var props = BuildRetryProperties(nextRetry, ea.BasicProperties);
                    var body = ea.Body.ToArray();

                    await _channel.BasicPublishAsync(
                        exchange: "",
                        routingKey: _runDeadQueue,
                        mandatory: false,
                        basicProperties: props,
                        body: body);

                    if (job is not null && job.SubmissionId != Guid.Empty)
                    {
                        var failed = new RunResultMessage(
                            job.SubmissionId,
                            -1,
                            string.Empty,
                            ex.Message,
                            0,
                            false);

                        var failBody = JsonSerializer.SerializeToUtf8Bytes(failed);
                        var failProps = new BasicProperties { Persistent = true };

                        await _channel.BasicPublishAsync(
                            exchange: "",
                            routingKey: _resultQueue,
                            mandatory: false,
                            basicProperties: failProps,
                            body: failBody);
                    }
                }

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
        }

        private async Task StartHeartbeatAsync(Guid submissionId, CancellationToken ct)
        {
            try
            {
                await PublishHeartbeatAsync(submissionId);

                using var timer = new PeriodicTimer(_heartbeatInterval);
                while (await timer.WaitForNextTickAsync(ct))
                {
                    await PublishHeartbeatAsync(submissionId);
                }
            }
            catch (OperationCanceledException)
            {
                // expected on completion/cancel
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat error for submission {SubmissionId}", submissionId);
            }
        }

        private async Task PublishHeartbeatAsync(Guid submissionId)
        {
            var msg = new SubmissionHeartbeatMessage(
                submissionId,
                "Running",
                0,
                "Running");

            var body = JsonSerializer.SerializeToUtf8Bytes(msg);
            var props = new BasicProperties { Persistent = false };

            await _heartbeatChannel.BasicPublishAsync(
                exchange: "",
                routingKey: _heartbeatQueue,
                mandatory: false,
                basicProperties: props,
                body: body);
        }

        private static int GetRetryCount(IDictionary<string, object?>? headers)
        {
            if (headers is null) return 0;
            if (!headers.TryGetValue("x-retry", out var value) || value is null) return 0;

            return value switch
            {
                byte[] bytes when int.TryParse(Encoding.UTF8.GetString(bytes), out var i) => i,
                int i => i,
                long l => (int)l,
                string s when int.TryParse(s, out var i) => i,
                _ => 0
            };
        }

        private static BasicProperties BuildRetryProperties(int retryCount, IReadOnlyBasicProperties? source)
        {
            var props = new BasicProperties
            {
                Persistent = true
            };

            if (source?.Headers is not null)
            {
                props.Headers = new Dictionary<string, object?>(source.Headers);
            }
            else
            {
                props.Headers = new Dictionary<string, object?>();
            }

            props.Headers["x-retry"] = retryCount;

            if (!string.IsNullOrWhiteSpace(source?.CorrelationId))
            {
                props.CorrelationId = source.CorrelationId;
            }

            if (!string.IsNullOrWhiteSpace(source?.MessageId))
            {
                props.MessageId = source.MessageId;
            }

            return props;
        }

        private static void DeclareQueueWithRetry(IChannel channel, string baseQueue, int retryDelaySeconds)
        {
            var retryQueue = baseQueue + ".retry";
            var deadQueue = baseQueue + ".dead";

            var mainArgs = new Dictionary<string, object?>
            {
                ["x-dead-letter-exchange"] = "",
                ["x-dead-letter-routing-key"] = deadQueue
            };

            var retryArgs = new Dictionary<string, object?>
            {
                ["x-message-ttl"] = retryDelaySeconds * 1000,
                ["x-dead-letter-exchange"] = "",
                ["x-dead-letter-routing-key"] = baseQueue
            };

            channel.QueueDeclareAsync(
                queue: baseQueue,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: mainArgs
            ).GetAwaiter().GetResult();

            channel.QueueDeclareAsync(
                queue: retryQueue,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: retryArgs
            ).GetAwaiter().GetResult();

            channel.QueueDeclareAsync(
                queue: deadQueue,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: null
            ).GetAwaiter().GetResult();
        }
    }
}
