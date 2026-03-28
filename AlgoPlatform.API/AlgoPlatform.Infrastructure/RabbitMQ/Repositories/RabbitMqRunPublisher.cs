using System.Text.Json;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts.Runner;
using RabbitMQ.Client;

namespace AlgoPlatform.Infrastructure.RabbitMQ.Repositories
{
    public sealed class RabbitMqRunPublisher : IRunQueuePublisher
    {
        private readonly IChannel _ch;
        private readonly string _queue;

        public RabbitMqRunPublisher(IChannel ch, string queue)
        {
            _ch = ch;
            _queue = queue;
        }

        public async Task PublishAsync(RunJobMessage job, CancellationToken ct = default)
        {
            var body = JsonSerializer.SerializeToUtf8Bytes(job);
            var props = new BasicProperties { Persistent = true };

            await _ch.BasicPublishAsync(
                exchange: "",
                routingKey: _queue,
                mandatory: false,
                basicProperties: props,
                body: body,
                cancellationToken: ct);
        }
    }
}
