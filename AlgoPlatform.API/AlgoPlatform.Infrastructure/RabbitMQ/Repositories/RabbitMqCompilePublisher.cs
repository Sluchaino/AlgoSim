using System.Text.Json;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts.Runner;
using RabbitMQ.Client;

namespace AlgoPlatform.Infrastructure.RabbitMQ.Repositories
{
    public sealed class RabbitMqCompilePublisher : ICompileQueuePublisher
    {
        private readonly IChannel _ch;
        private readonly string _queue;

        public RabbitMqCompilePublisher(IChannel ch, string queue)
        {
            _ch = ch;
            _queue = queue;
        }

        public async Task PublishAsync(CompileJobMessage job, CancellationToken ct = default)
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
