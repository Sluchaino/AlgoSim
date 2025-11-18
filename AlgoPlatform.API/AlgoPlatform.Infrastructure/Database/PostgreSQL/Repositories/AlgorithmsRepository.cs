using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories
{
    public class AlgorithmsRepository : IAlgorithmsRepository
    {
        private readonly AlgoPlatformDbContext _db;
        public AlgorithmsRepository(AlgoPlatformDbContext AlgoPlatformDbContext) 
        {
            _db = AlgoPlatformDbContext;
        }

        public async Task<Algorithm?> GetAlgorithmByIdAsync(int id)
        {
            Algorithm? algorithm = await _db.Algorithms.FindAsync(id);
            return algorithm;
        }

        public async Task<IReadOnlyList<string>> GetAllAlgorithmsNamesAsync()
        {
            List<string> names = await _db.Algorithms.Select(a => a.Name).ToListAsync();
            return names;
        }
    }
}
