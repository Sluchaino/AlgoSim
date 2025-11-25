namespace AlgoPlatform.Application.Interfaces
{
    public interface ISubmissionsService
    {
        Task<Guid> CreateAsync(string name, string code, string input, CancellationToken ct);
    }
}
