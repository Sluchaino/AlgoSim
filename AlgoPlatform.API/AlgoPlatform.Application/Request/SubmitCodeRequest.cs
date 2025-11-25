using System.ComponentModel.DataAnnotations;

namespace AlgoPlatform.Application.Request
{
    public sealed class SubmitCodeRequest
    {
        [Required, MinLength(1)] public string Name { get; init; } = null!;
        [Required, MinLength(1)] public string Code { get; init; } = null!;
        [MaxLength(256_000)] public string Input { get; init; } = null!;
    }
}
