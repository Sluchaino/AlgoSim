using System;

namespace AlgoPlatform.Domain.Models
{
    public sealed class Artifact
    {
        public string Hash { get; set; } = null!;
        public string Status { get; set; } = null!;
        public string? StorageKey { get; set; }
        public string? AlgoTracingHash { get; set; }
        public string? BuildError { get; set; }
        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset UpdatedAt { get; set; }
    }
}
