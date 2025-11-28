using AlgoPlatform.Application.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using System.Text;

namespace AlgoPlatform.Infrastructure.RabbitMQ.HostedServices
{
    public sealed class RabbitMqExecutorService : BackgroundService
    {
        private readonly IChannel _ch;
        private readonly string _queue;
        private readonly ISubmissionRepository _repo;
        private readonly IUnitOfWork _uow;
        private readonly ISubmissionStatusStore _status;
        private readonly ICodeRunner _runner;
        private readonly ILogger<RabbitMqExecutorService> _log;

        public RabbitMqExecutorService(
            IChannel ch,
            IConfiguration cfg,
            ISubmissionRepository repo,
            IUnitOfWork uow,
            ISubmissionStatusStore status,
            ICodeRunner runner,
            ILogger<RabbitMqExecutorService> log)
        {
            _ch = ch;
            _queue = cfg["RabbitMQ:Queue"] ?? "submissions";
            _repo = repo;
            _uow = uow;
            _status = status;
            _runner = runner;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Prefetch 1
            await _ch.BasicQosAsync(0, 1, false, stoppingToken);

            var consumer = new AsyncEventingBasicConsumer(_ch);
            consumer.ReceivedAsync += OnReceivedAsync;

            await _ch.BasicConsumeAsync(
                queue: _queue,
                autoAck: false,
                consumer: consumer,
                cancellationToken: stoppingToken);

            _log.LogInformation("Consuming RabbitMQ queue '{Queue}'", _queue);

            try
            {
                await Task.Delay(Timeout.Infinite, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // нормальная отмена
            }
        }

        private async Task OnReceivedAsync(object sender, BasicDeliverEventArgs ea)
        {
            var body = ea.Body.ToArray();
            var text = Encoding.UTF8.GetString(body);

            if (!Guid.TryParse(text, out var id))
            {
                _log.LogWarning("Bad message (not a GUID): {Text}", text);
                await _ch.BasicAckAsync(ea.DeliveryTag, multiple: false);
                return;
            }

            try
            {
                await _status.SetAsync(id, new SubmissionStatus("Running", 0));

                var sub = await _repo.GetAsync(id, CancellationToken.None);
                if (sub is null)
                {
                    await _status.SetAsync(id, new SubmissionStatus("Failed", null, "Submission not found"));
                    await _ch.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var (exit, stdout, stderr) = await _runner.RunAsync(sub.Code, sub.Input, CancellationToken.None);

                // TODO: сохранить stdout/stderr/exit в БД через _repo/_uow
                // await _uow.SaveChangesAsync(CancellationToken.None);

                await _status.SetAsync(
                    id,
                    new SubmissionStatus(exit == 0 ? "Completed" : "Failed", 100,
                        exit == 0 ? "OK" : "Non-zero exit"));

                await _ch.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Execution failed for {SubmissionId}", id);
                await _status.SetAsync(id, new SubmissionStatus("Failed", null, ex.Message));

                // В dev можно ack, в prod — рассмотреть Nack + DLX/DLQ
                await _ch.BasicAckAsync(ea.DeliveryTag, multiple: false);
                // либо: await _ch.BasicNackAsync(ea.DeliveryTag, multiple: false, requeue: true);
            }
        }
    }
}