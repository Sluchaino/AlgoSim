

namespace AlgoPlatform.Domain.Models
{
    public class Submission
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = null!;
        public string Code { get; set; } = null!;
        public string Input { get; set; } = null!;
        public string Output { get; set; } = null!;
    }
}
