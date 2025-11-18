using AlgoPlatform.Domain.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Abstractions
{
    public interface IAlgorithmsRepository
    {
        public Task<IReadOnlyList<string>> GetAllAlgorithmsNamesAsync();
        public Task<Algorithm?> GetAlgorithmByIdAsync(int id);
    }
}
