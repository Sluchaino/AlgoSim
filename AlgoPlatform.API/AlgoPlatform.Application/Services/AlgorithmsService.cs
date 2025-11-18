using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Domain.Models;
using MediatR;
namespace AlgoPlatform.Application.Services
{
    public class AlgorithmsService : IAlgorithmsService
    {
        private readonly IAlgorithmsRepository _algorithmsRepository;
        public AlgorithmsService(IAlgorithmsRepository algorithmsRepository)
        {
            _algorithmsRepository = algorithmsRepository;
        }

        public async Task<Algorithm?> GetAlgorithmByIdAsync(int id)
        {
            return await _algorithmsRepository.GetAlgorithmByIdAsync(id);
        }

        public async Task<IReadOnlyList<string>> GetAllAlgorithmsNamesAsync()
        {
            return await _algorithmsRepository.GetAllAlgorithmsNamesAsync();
        }
    }
}
