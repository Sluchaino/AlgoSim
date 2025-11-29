using System.Text;
using AlgoPlatform.Application.Abstractions;
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
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<RabbitMqExecutorService> _logger;

        public RabbitMqExecutorService(
            IChannel channel,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<RabbitMqExecutorService> logger)
        {
            _channel = channel;
            _scopeFactory = scopeFactory;
            _logger = logger;
            _queue = configuration["RabbitMQ:Queue"] ?? "submissions";
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
            var uow = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
            var status = scope.ServiceProvider.GetRequiredService<ISubmissionStatusStore>();
            var runner = scope.ServiceProvider.GetRequiredService<ICodeRunner>();

            try
            {
                await status.SetAsync(submissionId, new SubmissionStatus("Running", 0));

                var submission = await repo.GetAsync(submissionId, CancellationToken.None);
                if (submission is null)
                {
                    await status.SetAsync(submissionId,
                        new SubmissionStatus("Failed", null, "Submission not found"));
                    await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
                    return;
                }

                var (exitCode, stdout, stderr) =
                    await runner.RunAsync(submission.Code, submission.Input, CancellationToken.None);

                // тут сохраняешь логи/результат в БД
                submission.Output = stdout;
                // submission.Error = stderr; submission.ExitCode = exitCode; и т.д.
                await uow.SaveChangesAsync(CancellationToken.None);

                var finalStatus = exitCode == 0 ? "Completed" : "Failed";
                await status.SetAsync(submissionId,
                    new SubmissionStatus(finalStatus, 100, exitCode == 0 ? "OK" : "Non-zero exit code"));

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while processing submission {SubmissionId}", submissionId);

                await status.SetAsync(submissionId,
                    new SubmissionStatus("Failed", null, ex.Message));

                await _channel.BasicAckAsync(ea.DeliveryTag, multiple: false);
            }
        }
    }
}