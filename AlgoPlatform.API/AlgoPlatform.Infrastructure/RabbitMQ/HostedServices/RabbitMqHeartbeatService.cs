using System.Text.Json;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts.Runner;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace AlgoPlatform.Infrastructure.RabbitMQ.HostedServices
{
    public sealed class RabbitMqHeartbeatService : BackgroundService
    {
        private readonly IChannel _channel;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<RabbitMqHeartbeatService> _logger;
        private readonly string _queue;

        public RabbitMqHeartbeatService(
            IConnection connection,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<RabbitMqHeartbeatService> logger)
        {
            _channel = connection.CreateChannelAsync().GetAwaiter().GetResult();
            _scopeFactory = scopeFactory;
            _logger = logger;
            _queue = configuration["RabbitMQ:HeartbeatQueue"] ?? "run-heartbeats";

            _channel.QueueDeclareAsync(
                queue: _queue,
                durable: true,
                exclusive: false,
                autoDelete: false,
                arguments: null
            ).GetAwaiter().GetResult();
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await _channel.BasicQosAsync(0, 10, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += OnReceivedAsync;

            await _channel.BasicConsumeAsync(
                queue: _queue,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _logger.LogInformation("RabbitMqHeartbeatService started, queue = {Queue}", _queue);

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
                var msg = JsonSerializer.Deserialize<SubmissionHeartbeatMessage>(ea.Body.ToArray());
                if (msg is null || msg.SubmissionId == Guid.Empty)
                {
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                using var scope = _scopeFactory.CreateScope();
                var statusStore = scope.ServiceProvider.GetRequiredService<ISubmissionStatusStore>();
                var current = await statusStore.GetAsync(msg.SubmissionId);

                if (current is not null
                    && (string.Equals(current.State, "Completed", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(current.State, "Failed", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(current.State, "Cancelled", StringComparison.OrdinalIgnoreCase)))
                {
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                await statusStore.SetAsync(
                    msg.SubmissionId,
                    new SubmissionStatus(msg.State, msg.Progress, msg.Message));

                if (IsPersistentProgressState(msg.State))
                {
                    var repo = scope.ServiceProvider.GetRequiredService<ISubmissionRepository>();
                    var uow = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                    var submission = await repo.GetAsync(msg.SubmissionId, CancellationToken.None);

                    if (submission is not null
                        && !IsFinalState(submission.Status)
                        && !string.Equals(submission.Status, msg.State, StringComparison.OrdinalIgnoreCase))
                    {
                        submission.Status = msg.State;
                        await uow.SaveChangesAsync(CancellationToken.None);
                    }
                }

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat processing failed");
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
        }

        private static bool IsPersistentProgressState(string? state) =>
            string.Equals(state, "Compiling", StringComparison.OrdinalIgnoreCase)
            || string.Equals(state, "Running", StringComparison.OrdinalIgnoreCase);

        private static bool IsFinalState(string? state) =>
            string.Equals(state, "Completed", StringComparison.OrdinalIgnoreCase)
            || string.Equals(state, "Failed", StringComparison.OrdinalIgnoreCase)
            || string.Equals(state, "Cancelled", StringComparison.OrdinalIgnoreCase);
    }
}
