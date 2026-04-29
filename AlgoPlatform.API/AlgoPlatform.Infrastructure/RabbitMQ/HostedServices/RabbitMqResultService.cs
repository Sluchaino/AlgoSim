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
    public sealed class RabbitMqResultService : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly string _queue;
        private readonly string _retryQueue;
        private readonly string _deadQueue;
        private readonly int _maxRetries;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<RabbitMqResultService> _logger;

        public RabbitMqResultService(
            IConnection connection,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<RabbitMqResultService> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _scopeFactory = scopeFactory;
            _logger = logger;
            _queue = configuration["RabbitMQ:ResultQueue"] ?? "run-results";
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

            _logger.LogInformation("RabbitMqResultService started, queue = {Queue}", _queue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("RabbitMqResultService stopping");
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            RunResultMessage? result = null;
            Submission? submission = null;

            try
            {
                result = JsonSerializer.Deserialize<RunResultMessage>(ea.Body.ToArray());
                if (result is null || result.SubmissionId == Guid.Empty)
                {
                    _logger.LogWarning("Received invalid result message");
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                using var scope = _scopeFactory.CreateScope();
                var repo = scope.ServiceProvider.GetRequiredService<ISubmissionRepository>();
                var uow = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                var status = scope.ServiceProvider.GetRequiredService<ISubmissionStatusStore>();

                submission = await repo.GetAsync(result.SubmissionId, CancellationToken.None);
                if (submission is null)
                {
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                if (string.Equals(submission.Status, "Cancelled", StringComparison.OrdinalIgnoreCase))
                {
                    await status.SetAsync(
                        result.SubmissionId,
                        new SubmissionStatus("Cancelled", 100, submission.Error ?? "Cancelled by user"));
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var finalStatus = (result.ExitCode == 0 && !result.TimedOut) ? "Completed" : "Failed";
                submission.Output = result.Stdout ?? string.Empty;
                submission.Status = finalStatus;
                submission.ExitCode = result.ExitCode;
                submission.DurationMs = result.DurationMs;
                submission.Error = string.IsNullOrWhiteSpace(result.Stderr)
                    ? (result.TimedOut ? "Timed out" : null)
                    : result.Stderr;

                await uow.SaveChangesAsync(CancellationToken.None);

                await status.SetAsync(result.SubmissionId,
                    new SubmissionStatus(
                        finalStatus,
                        100,
                        finalStatus == "Completed" ? "OK" : (result.TimedOut ? "Timed out" : "Non-zero exit code")));

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                var submissionId = result?.SubmissionId ?? Guid.Empty;
                _logger.LogError(ex, "Error while processing result for submission {SubmissionId}", submissionId);

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
        }    }
}

