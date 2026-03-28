using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoTracing
{
    public static class AlgoRunner
    {
        public static void Run(string name, TrackedList a, ITracer t, Action<TrackedList> algorithm)
        {
            t?.Step(new { kind = "algo", name });
            t?.EmitArray(a.ToArray());
            algorithm(a);
        }
    }
}
