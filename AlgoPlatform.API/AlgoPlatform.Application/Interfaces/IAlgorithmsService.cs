using AlgoPlatform.Domain.Models;

namespace AlgoPlatform.Application.Interfaces
{
    public interface IAlgorithmsService
    {
        public Task<IReadOnlyList<string>> GetAllAlgorithmsNamesAsync();
        public Task<Algorithm?> GetAlgorithmByIdAsync(int id);
    }
}
