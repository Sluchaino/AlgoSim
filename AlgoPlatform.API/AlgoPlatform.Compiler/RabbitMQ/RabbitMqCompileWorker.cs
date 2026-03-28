using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using AlgoPlatform.Compiler.Execution;
using AlgoPlatform.Compiler.Storage;
using AlgoPlatform.Contracts.Runner;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace AlgoPlatform.Compiler.RabbitMQ
{
    public sealed class RabbitMqCompileWorker : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly DockerCliCodeCompiler _compiler;
        private readonly S3ArtifactStorage _storage;
        private readonly string _compileQueue;
        private readonly string _compileRetryQueue;
        private readonly string _compileDeadQueue;
        private readonly string _resultQueue;
        private readonly int _maxRetries;
        private readonly ILogger<RabbitMqCompileWorker> _logger;

        public RabbitMqCompileWorker(
            IConnection connection,
            DockerCliCodeCompiler compiler,
            S3ArtifactStorage storage,
            IConfiguration configuration,
            ILogger<RabbitMqCompileWorker> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _compiler = compiler;
            _storage = storage;
            _logger = logger;
            _compileQueue = configuration["RabbitMQ:CompileQueue"] ?? "compile";
            _compileRetryQueue = _compileQueue + ".retry";
            _compileDeadQueue = _compileQueue + ".dead";
            _resultQueue = configuration["RabbitMQ:CompileResultQueue"] ?? "compile-results";
            _maxRetries = configuration.GetValue<int?>("RabbitMQ:MaxRetries") ?? 3;

            var retryDelaySeconds = configuration.GetValue<int?>("RabbitMQ:RetryDelaySeconds") ?? 5;

            DeclareQueueWithRetry(_channel, _compileQueue, retryDelaySeconds);
            DeclareQueueWithRetry(_channel, _resultQueue, retryDelaySeconds);
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await _channel.BasicQosAsync(0, 1, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += OnReceivedAsync;

            await _channel.BasicConsumeAsync(
                queue: _compileQueue,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _logger.LogInformation("RabbitMqCompileWorker started, queue = {Queue}", _compileQueue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("RabbitMqCompileWorker stopping");
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            CompileJobMessage? job = null;

            try
            {
                job = JsonSerializer.Deserialize<CompileJobMessage>(ea.Body.ToArray());
                if (job is null || job.SubmissionId == Guid.Empty || string.IsNullOrWhiteSpace(job.ArtifactHash))
                {
                    _logger.LogWarning("Received invalid CompileJob message");
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var (success, artifact, error, durationMs) =
                    await _compiler.CompileAsync(job.Code, CancellationToken.None);

                string? storageKey = null;
                if (success && artifact is not null)
                {
                    storageKey = $"artifacts/{job.ArtifactHash}.tar.gz";
                    using var ms = new MemoryStream(artifact);
                    await _storage.UploadAsync(storageKey, ms, "application/gzip", CancellationToken.None);
                }

                var result = new CompileResultMessage(
                    job.SubmissionId,
                    job.ArtifactHash,
                    success && storageKey is not null,
                    storageKey,
                    success ? null : error,
                    durationMs);

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
            catch (Exception ex)
            {
                var submissionId = job?.SubmissionId ?? Guid.Empty;
                _logger.LogError(ex, "Compiler error for submission {SubmissionId}", submissionId);

                var retryCount = GetRetryCount(ea.BasicProperties?.Headers);
                var nextRetry = retryCount + 1;

                if (nextRetry <= _maxRetries)
                {
                    var props = BuildRetryProperties(nextRetry, ea.BasicProperties);
                    var body = ea.Body.ToArray();

                    await _channel.BasicPublishAsync(
                        exchange: "",
                        routingKey: _compileRetryQueue,
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
                        routingKey: _compileDeadQueue,
                        mandatory: false,
                        basicProperties: props,
                        body: body);

                    if (job is not null && job.SubmissionId != Guid.Empty)
                    {
                        var failed = new CompileResultMessage(
                            job.SubmissionId,
                            job.ArtifactHash,
                            false,
                            null,
                            ex.Message,
                            0);

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
