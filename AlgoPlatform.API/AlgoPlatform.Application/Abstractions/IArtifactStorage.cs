namespace AlgoPlatform.Application.Abstractions
{
    public interface IArtifactStorage
    {
        Task UploadAsync(string key, Stream content, string contentType, CancellationToken ct);
        Task<Stream> DownloadAsync(string key, CancellationToken ct);
        Task<bool> ExistsAsync(string key, CancellationToken ct);
    }
}
