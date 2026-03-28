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
    public sealed class RabbitMqExecutorService : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly string _queue;
        private readonly string _retryQueue;
        private readonly string _deadQueue;
        private readonly string _runQueue;
        private readonly int _maxRetries;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<RabbitMqExecutorService> _logger;

        public RabbitMqExecutorService(
            IConnection connection,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<RabbitMqExecutorService> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _scopeFactory = scopeFactory;
            _logger = logger;
            _queue = configuration["RabbitMQ:Queue"] ?? "submissions";
            _retryQueue = _queue + ".retry";
            _deadQueue = _queue + ".dead";
            _runQueue = configuration["RabbitMQ:RunQueue"] ?? "runs";
            _maxRetries = configuration.GetValue<int?>("RabbitMQ:MaxRetries") ?? 3;

            var retryDelaySeconds = configuration.GetValue<int?>("RabbitMQ:RetryDelaySeconds") ?? 5;

            DeclareQueueWithRetry(_channel, _queue, retryDelaySeconds);
            DeclareQueueWithRetry(_channel, _runQueue, retryDelaySeconds);
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

            _logger.LogInformation("RabbitMqExecutorService started, queue = {Queue}", _queue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("RabbitMqExecutorService stopping");
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            var text = Encoding.UTF8.GetString(ea.Body.ToArray());

            if (!Guid.TryParse(text, out var submissionId))
            {
                _logger.LogWarning("Received invalid message (not GUID): {Message}", text);
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                return;
            }

            using var scope = _scopeFactory.CreateScope();

            var repo = scope.ServiceProvider.GetRequiredService<ISubmissionRepository>();
            var artifactRepo = scope.ServiceProvider.GetRequiredService<IArtifactRepository>();
            var hasher = scope.ServiceProvider.GetRequiredService<IArtifactHasher>();
            var compilePublisher = scope.ServiceProvider.GetRequiredService<ICompileQueuePublisher>();
            var runPublisher = scope.ServiceProvider.GetRequiredService<IRunQueuePublisher>();
            var uow = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var status = scope.ServiceProvider.GetRequiredService<ISubmissionStatusStore>();
            Submission? submission = null;

            try
            {
                submission = await repo.GetAsync(submissionId, CancellationToken.None);
                if (submission is null)
                {
                    await status.SetAsync(submissionId,
                        new SubmissionStatus("Failed", null, "Submission not found"));
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var hash = hasher.ComputeHash(submission.Code);
                var algoTracingHash = hasher.CurrentAlgoTracingHash;
                submission.ArtifactHash = hash;

                var artifact = await artifactRepo.GetAsync(hash, CancellationToken.None);
                var now = DateTimeOffset.UtcNow;

                if (artifact is null)
                {
                    artifact = new Artifact
                    {
                        Hash = hash,
                        Status = "Compiling",
                        StorageKey = null,
                        AlgoTracingHash = algoTracingHash,
                        BuildError = null,
                        CreatedAt = now,
                        UpdatedAt = now
                    };

                    await artifactRepo.AddAsync(artifact, CancellationToken.None);

                    submission.Status = "Compiling";
                    submission.Error = null;
                    await uow.SaveChangesAsync(CancellationToken.None);

                    await status.SetAsync(submissionId, new SubmissionStatus("Compiling", 0));

                    await compilePublisher.PublishAsync(
                        new CompileJobMessage(submission.Id, submission.Code, hash),
                        CancellationToken.None);
                }
                else if (artifact.Status == "Ready")
                {
                    if (string.IsNullOrWhiteSpace(artifact.AlgoTracingHash) && !string.IsNullOrWhiteSpace(algoTracingHash))
                    {
                        artifact.AlgoTracingHash = algoTracingHash;
                    }
                    if (!string.IsNullOrWhiteSpace(artifact.StorageKey))
                    {
                        submission.Status = "Running";
                        submission.Error = null;
                        await uow.SaveChangesAsync(CancellationToken.None);

                        await status.SetAsync(submissionId, new SubmissionStatus("Running", 0));

                        await runPublisher.PublishAsync(
                            new RunJobMessage(submission.Id, null, submission.Input, artifact.StorageKey),
                            CancellationToken.None);
                    }
                    else
                    {
                        artifact.Status = "Compiling";
                        artifact.StorageKey = null;
                        artifact.UpdatedAt = now;

                        submission.Status = "Compiling";
                        submission.Error = null;
                        await uow.SaveChangesAsync(CancellationToken.None);

                        await status.SetAsync(submissionId, new SubmissionStatus("Compiling", 0));

                        await compilePublisher.PublishAsync(
                            new CompileJobMessage(submission.Id, submission.Code, hash),
                            CancellationToken.None);
                    }
                }
                else if (artifact.Status == "Failed")
                {
                    submission.Status = "Failed";
                    submission.Error = string.IsNullOrWhiteSpace(artifact.BuildError)
                        ? "Build failed"
                        : artifact.BuildError;
                    await uow.SaveChangesAsync(CancellationToken.None);

                    await status.SetAsync(submissionId,
                        new SubmissionStatus("Failed", null, submission.Error));
                }
                else
                {
                    submission.Status = "Compiling";
                    submission.Error = null;
                    await uow.SaveChangesAsync(CancellationToken.None);

                    await status.SetAsync(submissionId, new SubmissionStatus("Compiling", 0));
                }

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while processing submission {SubmissionId}", submissionId);

                var retryCount = GetRetryCount(ea.BasicProperties?.Headers);
                var nextRetry = retryCount + 1;

                if (nextRetry <= _maxRetries)
                {
                    await status.SetAsync(submissionId,
                        new SubmissionStatus("Retrying", null, ex.Message));

                    if (submission is not null)
                    {
                        submission.Status = "Retrying";
                        submission.Error = ex.Message;
                        await uow.SaveChangesAsync(CancellationToken.None);
                    }

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
                    await status.SetAsync(submissionId,
                        new SubmissionStatus("Failed", null, ex.Message));

                    if (submission is not null)
                    {
                        submission.Status = "Failed";
                        submission.Error = ex.Message;
                        await uow.SaveChangesAsync(CancellationToken.None);
                    }

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
