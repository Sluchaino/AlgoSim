using AlgoPlatform.Application.Algorithms.Queries;
using AlgoPlatform.Application.Interfaces;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Algorithms.Handlers
{
    public class GetAlgorithmsListQueryHandler : IRequestHandler<GetAlgorithmsListQuery, IEnumerable<string>>
    {
        private readonly IAlgorithmsRepository _algorithms;
        public GetAlgorithmsListQueryHandler(IAlgorithmsRepository algorithms)
        {
            _algorithms = algorithms;
        }

        Task<IEnumerable<string>> IRequestHandler<GetAlgorithmsListQuery, IEnumerable<string>>.Handle(GetAlgorithmsListQuery request, CancellationToken cancellationToken)
        {
            return _algorithms.GetAllAlgorithmsNamesAsync();
        }
    }
}
