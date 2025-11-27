

namespace AlgoPlatform.Application.Abstractions
{
    public record SubmissionStatus(string State, int? Progress = null, string? Message = null, DateTimeOffset? UpdatedAt = null);

    public interface ISubmissionStatusStore
    {
        Task SetAsync(Guid id, SubmissionStatus status, TimeSpan? ttl = null);
        Task<SubmissionStatus?> GetAsync(Guid id);
    }
}
