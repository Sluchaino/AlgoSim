namespace AlgoPlatform.Infrastructure.Storage
{
    public sealed class S3Options
    {
        public string? Endpoint { get; set; }
        public string? Bucket { get; set; }
        public string? Region { get; set; }
        public string? AccessKey { get; set; }
        public string? SecretKey { get; set; }
        public bool UsePathStyle { get; set; }
    }
}
