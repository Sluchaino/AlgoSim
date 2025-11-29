using AlgoPlatform.Application.Abstractions;
using RabbitMQ.Client;
using System.Text;

namespace AlgoPlatform.Infrastructure.RabbitMQ.Repositories
{
    public sealed class RabbitMqSubmissionPublisher : ISubmissionQueuePublisher
    {
        private readonly IChannel _ch;
        private readonly string _queue;

        public RabbitMqSubmissionPublisher(IChannel ch, string queue)
        {
            _ch = ch;
            _queue = queue;
        }

        public async Task PublishAsync(Guid submissionId, CancellationToken ct = default)
        {
            var body = Encoding.UTF8.GetBytes(submissionId.ToString());

            var props = new BasicProperties
            {
                Persistent = true 
            };

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