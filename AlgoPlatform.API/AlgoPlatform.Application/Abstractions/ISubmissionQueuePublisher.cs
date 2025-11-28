using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Abstractions
{
    public interface ISubmissionQueuePublisher
    {
        Task PublishAsync(Guid submissionId, CancellationToken ct = default);
    }
}
