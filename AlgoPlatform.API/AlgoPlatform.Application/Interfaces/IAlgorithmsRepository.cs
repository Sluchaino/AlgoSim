using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Interfaces
{
    public interface IAlgorithmsRepository
    {
        public Task<IEnumerable<string>> GetAllAlgorithmsNamesAsync();
    }
}
