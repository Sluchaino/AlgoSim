using AlgoPlatform.Domain.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Interfaces
{
    public interface IAlgorithmsService
    {
        public Task<IReadOnlyList<string>> GetAllAlgorithmsNamesAsync();
        public Task<Algorithm?> GetAlgorithmByIdAsync(int id);
    }
}
