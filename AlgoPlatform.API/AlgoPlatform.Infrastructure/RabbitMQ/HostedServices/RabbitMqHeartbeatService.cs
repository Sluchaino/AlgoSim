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
                        || string.Equals(current.State, "Failed", StringComparison.OrdinalIgnoreCase)))
                {
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                await statusStore.SetAsync(
                    msg.SubmissionId,
                    new SubmissionStatus(msg.State, msg.Progress, msg.Message));

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Heartbeat processing failed");
                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
        }
    }
}
