using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts.Runner;
using AlgoPlatform.Domain.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace AlgoPlatform.Infrastructure.RabbitMQ.HostedServices
{
    public sealed class RabbitMqCompileResultService : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly string _queue;
        private readonly string _retryQueue;
        private readonly string _deadQueue;
        private readonly int _maxRetries;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<RabbitMqCompileResultService> _logger;

        public RabbitMqCompileResultService(
            IConnection connection,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<RabbitMqCompileResultService> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _scopeFactory = scopeFactory;
            _logger = logger;
            _queue = configuration["RabbitMQ:CompileResultQueue"] ?? "compile-results";
            _retryQueue = _queue + ".retry";
            _deadQueue = _queue + ".dead";
            _maxRetries = configuration.GetValue<int?>("RabbitMQ:MaxRetries") ?? 3;

            var retryDelaySeconds = configuration.GetValue<int?>("RabbitMQ:RetryDelaySeconds") ?? 5;

            DeclareQueueWithRetry(_channel, _queue, retryDelaySeconds);
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await _channel.BasicQosAsync(0, 1, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += OnReceivedAsync;

            await _channel.BasicConsumeAsync(
                queue: _queue,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _logger.LogInformation("RabbitMqCompileResultService started, queue = {Queue}", _queue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("RabbitMqCompileResultService stopping");
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            CompileResultMessage? result = null;

            try
            {
                result = JsonSerializer.Deserialize<CompileResultMessage>(ea.Body.ToArray());
                if (result is null || string.IsNullOrWhiteSpace(result.ArtifactHash))
                {
                    _logger.LogWarning("Received invalid compile result message");
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var success = result.Success && !string.IsNullOrWhiteSpace(result.StorageKey);
                var error = result.Error;
                if (result.Success && string.IsNullOrWhiteSpace(result.StorageKey))
                {
                    error = "Storage key is missing for successful compile result";
                }

                using var scope = _scopeFactory.CreateScope();
                var artifactRepo = scope.ServiceProvider.GetRequiredService<IArtifactRepository>();
                var submissionRepo = scope.ServiceProvider.GetRequiredService<ISubmissionRepository>();
                var runPublisher = scope.ServiceProvider.GetRequiredService<IRunQueuePublisher>();
                var uow = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                var status = scope.ServiceProvider.GetRequiredService<ISubmissionStatusStore>();

                var now = DateTimeOffset.UtcNow;
                var artifact = await artifactRepo.GetAsync(result.ArtifactHash, CancellationToken.None);
                if (artifact is null)
                {
                    artifact = new Artifact
                    {
                        Hash = result.ArtifactHash,
                        CreatedAt = now
                    };
                    await artifactRepo.AddAsync(artifact, CancellationToken.None);
                }

                var waiting = new List<Submission>();
                waiting.AddRange(await submissionRepo.GetByArtifactHashAsync(
                    result.ArtifactHash,
                    "Compiling",
                    CancellationToken.None));
                waiting.AddRange(await submissionRepo.GetByArtifactHashAsync(
                    result.ArtifactHash,
                    "Queued",
                    CancellationToken.None));

                if (success)
                {
                    artifact.Status = "Ready";
                    artifact.StorageKey = result.StorageKey;
                    artifact.BuildError = null;
                    artifact.UpdatedAt = now;

                    foreach (var submission in waiting.DistinctBy(x => x.Id))
                    {
                        if (string.Equals(submission.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                        {
                            await status.SetAsync(
                                submission.Id,
                                new SubmissionStatus("Cancelled", 100, "Cancelled by user"));
                            continue;
                        }

                        submission.ArtifactHash = result.ArtifactHash;
                        submission.Status = "Running";
                        submission.Error = null;

                        await runPublisher.PublishAsync(
                            new RunJobMessage(submission.Id, null, submission.Input, result.StorageKey),
                            CancellationToken.None);

                        await status.SetAsync(submission.Id, new SubmissionStatus("Running", 0));
                    }
                }
                else
                {
                    var finalError = string.IsNullOrWhiteSpace(error)
                        ? "Compile failed"
                        : error;

                    artifact.Status = "Failed";
                    artifact.BuildError = finalError;
                    artifact.StorageKey = null;
                    artifact.UpdatedAt = now;

                    foreach (var submission in waiting.DistinctBy(x => x.Id))
                    {
                        if (string.Equals(submission.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                        {
                            await status.SetAsync(
                                submission.Id,
                                new SubmissionStatus("Cancelled", 100, "Cancelled by user"));
                            continue;
                        }

                        submission.ArtifactHash = result.ArtifactHash;
                        submission.Status = "Failed";
                        submission.Error = finalError;

                        await status.SetAsync(
                            submission.Id,
                            new SubmissionStatus("Failed", null, finalError));
                    }
                }

                await uow.SaveChangesAsync(CancellationToken.None);

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                var artifactHash = result?.ArtifactHash ?? string.Empty;
                _logger.LogError(ex, "Error while processing compile result for artifact {ArtifactHash}", artifactHash);

                var retryCount = GetRetryCount(ea.BasicProperties?.Headers);
                var nextRetry = retryCount + 1;

                if (nextRetry <= _maxRetries)
                {
                    var props = BuildRetryProperties(nextRetry, ea.BasicProperties);
                    var body = ea.Body.ToArray();

                    await _channel.BasicPublishAsync(
                        exchange: "",
                        routingKey: _retryQueue,
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
                        routingKey: _deadQueue,
                        mandatory: false,
                        basicProperties: props,
                        body: body);
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
