(function () {
  const insertion =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void InsertionSort(TrackedList a, ITracer t)
  {
    for (int i = 1; i < a.Count; i++)
    {
      int key = a[i];
      int j = i - 1;

      while (j >= 0 && a[j] > key)
      {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = key;
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = new TrackedList(raw, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    InsertionSort(a, t);

  }
}`;

  const controlledInsertion =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void InsertionSort(int[] a, ITracer t)
  {
    for (int i = 1; i < a.Length; i++)
    {
      int j = i;
      while (j > 0)
      {
        t.Read(j - 1);
        t.Read(j);
        t.Compare(j - 1, j);
        if (a[j - 1] > a[j])
        {
          t.Swap(j - 1, j);
          (a[j - 1], a[j]) = (a[j], a[j - 1]);
          j--;
        }
        else
        {
          break;
        }
      }
      for (int k = 0; k <= i; k++)
      {
        TracingExtensions.MarkSorted(t, k);
      }
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] a = ReadValues(out target);

    TracingExtensions.EmitArray(t, a);
    InsertionSort(a, t);

  }
}`;

  const selection =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void SelectionSort(TrackedList a, ITracer t)
  {
    for (int i = 0; i < a.Count - 1; i++)
    {
      int min = i;
      for (int j = i + 1; j < a.Count; j++)
      {
        if (a[j] < a[min]) min = j;
      }
      if (min != i)
      {
        int tmp = a[i];
        a[i] = a[min];
        a[min] = tmp;
      }
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = new TrackedList(raw, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    SelectionSort(a, t);

  }
}`;

  const controlledSelection =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void SelectionSort(int[] a, ITracer t)
  {
    for (int i = 0; i < a.Length - 1; i++)
    {
      int min = i;
      TracingExtensions.MarkMin(t, min);
      for (int j = i + 1; j < a.Length; j++)
      {
        t.Read(j);
        t.Compare(j, min);
        if (a[j] < a[min])
        {
          TracingExtensions.ClearMarks(t, "min");
          min = j;
          TracingExtensions.MarkMin(t, min);
        }
      }
      if (min != i)
      {
        t.Swap(i, min);
        (a[i], a[min]) = (a[min], a[i]);
      }
      TracingExtensions.ClearMarks(t, "min");
      TracingExtensions.MarkSorted(t, i);
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] a = ReadValues(out target);

    TracingExtensions.EmitArray(t, a);
    SelectionSort(a, t);

  }
}`;

  const quick =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void QuickSort(TrackedList a, int left, int right, ITracer t)
  {
    if (left < right)
    {
      int pivotIndex = PartitionHoare(a, left, right);
      QuickSort(a, left, pivotIndex, t);
      QuickSort(a, pivotIndex + 1, right, t);
    }
  }

  static int PartitionHoare(TrackedList a, int left, int right)
  {
    int pivot = a[(left + right) / 2];

    int i = left - 1;
    int j = right + 1;

    while (true)
    {
      do { i++; } while (a[i] < pivot);
      do { j--; } while (a[j] > pivot);

      if (i >= j)
        return j;

      a.Swap(i, j);
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = new TrackedList(raw, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    QuickSort(a, 0, a.Count - 1, t);

  }
}`;

  const controlledQuick =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void QuickSort(int[] a, int left, int right, ITracer t)
  {
    if (left > right) return;
    if (left == right)
    {
      TracingExtensions.MarkSorted(t, left);
      return;
    }

    TracingExtensions.Range(t, "partition", left, right, "active");

    int pivotIndex = (left + right) / 2;
    int pivot = a[pivotIndex];
    t.Step(new { kind = "pivotChosen", index = pivotIndex, value = pivot, left, right });
    TracingExtensions.MarkPivot(t, pivotIndex);

    int i = left;
    int j = right;
    TracingExtensions.Ptr(t, "i", i, "left");
    TracingExtensions.Ptr(t, "j", j, "right");

    while (i <= j)
    {
      while (i <= right)
      {
        t.Read(i);
        t.Compare(i, pivotIndex);
        if (a[i] < pivot)
        {
          i++;
          TracingExtensions.Ptr(t, "i", i, "left");
          continue;
        }
        break;
      }

      while (j >= left)
      {
        t.Read(j);
        t.Compare(j, pivotIndex);
        if (a[j] > pivot)
        {
          j--;
          TracingExtensions.Ptr(t, "j", j, "right");
          continue;
        }
        break;
      }

      if (i <= j)
      {
        if (i != j)
        {
          t.Swap(i, j);
          (a[i], a[j]) = (a[j], a[i]);

          if (i == pivotIndex) pivotIndex = j;
          else if (j == pivotIndex) pivotIndex = i;
          t.Step(new { kind = "pivotChosen", index = pivotIndex, value = pivot, left, right });
          TracingExtensions.MarkPivot(t, pivotIndex);
        }

        i++;
        j--;
        TracingExtensions.Ptr(t, "i", i, "left");
        TracingExtensions.Ptr(t, "j", j, "right");
      }
    }

    TracingExtensions.ClearPtr(t, "i");
    TracingExtensions.ClearPtr(t, "j");
    TracingExtensions.ClearRange(t, "partition");

    if (left < j) QuickSort(a, left, j, t);
    if (i < right) QuickSort(a, i, right, t);
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] a = ReadValues(out target);

    TracingExtensions.EmitArray(t, a);
    QuickSort(a, 0, a.Length - 1, t);

  }
}`;

  const binary =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static int BinarySearch(TrackedList a, int target, ITracer t)
  {
    int l = 0, r = a.Count - 1;
    while (l <= r)
    {
      int m = (l + r) / 2;
      if (a[m] == target) return m;
      if (a[m] < target) l = m + 1;
      else r = m - 1;
    }
    return -1;
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = new TrackedList(raw, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    TracingExtensions.BeginBinarySearch(t, a.Count, target);
    BinarySearch(a, target, t);
    TracingExtensions.EndBinarySearch(t);

  }
}`;

  const controlledBinary =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static int BinarySearch(int[] a, int target, ITracer t)
  {
    int l = 0, r = a.Length - 1;
    while (l <= r)
    {
      TracingExtensions.Range(t, "window", l, r, "active");
      int m = (l + r) / 2;
      TracingExtensions.Ptr(t, "mid", m, "mid");
      t.Read(m);

      if (a[m] == target)
      {
        TracingExtensions.MarkKey(t, m);
        TracingExtensions.ClearRange(t, "window");
        TracingExtensions.ClearPtr(t, "mid");
        return m;
      }

      if (a[m] < target) l = m + 1;
      else r = m - 1;
    }

    TracingExtensions.ClearRange(t, "window");
    TracingExtensions.ClearPtr(t, "mid");
    t.Step(new { kind = "notFound" });
    return -1;
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] a = ReadValues(out target);
    TracingExtensions.EmitArray(t, a);

    BinarySearch(a, target, t);
  }
}`;

  const blank =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program
{
  static void Algorithm(TrackedList a, ITracer t)
  {
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = new TrackedList(raw, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    Algorithm(a, t);

  }
}`;

  const demo =
`using System;
using AlgoTracing;

class Program
{
  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    var a = new TrackedList(new[] { 5, 1, 4 }, t);

    TracingExtensions.EmitArray(t, a.ToArray());
    t.Compare(0, 1);
    a.Swap(0, 1);
    a[2] = 9;
    TracingExtensions.MarkKey(t, 1);
    TracingExtensions.Range(t, "window", 0, 1, "active");
    TracingExtensions.ClearRange(t, "window");

  }
}`;

  const bfs =
`using System;
using System.Collections.Generic;
using AlgoTracing;

class Program
{
  static bool Bfs(TrackedAdjacencyList adj, int start, int end, out List<int> path)
  {
    int V = adj.Count;
    path = new List<int>();

    if (start < 0 || start >= V || end < 0 || end >= V)
      return false;

    if (start == end)
    {
      path.Add(start);
      return true;
    }

    var visited = new TrackedVisited(V, adj);
    var parent = new int[V];
    for (int i = 0; i < V; i++) parent[i] = -1;

    var q = new TrackedQueue(adj);
    visited[start] = true;
    q.Enqueue(start);

    while (q.Count > 0)
    {
      int curr = q.Dequeue();
      if (curr == end) break;
      foreach (int x in adj[curr])
      {
        if (!visited[x])
        {
          visited[x] = true;
          parent[x] = curr;
          q.Enqueue(x);
        }
      }
    }

    if (!visited[end])
      return false;

    for (int cur = end; cur != -1; cur = parent[cur])
      path.Add(cur);
    path.Reverse();
    return true;
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    var input = Console.In.ReadToEnd();
    int start, end;
    string startLabel, endLabel;
    var adj = GraphInput.Parse(input, t, out start, out end, out startLabel, out endLabel);
    adj.GraphInit(startLabel, endLabel);

    List<int> path;
    var found = Bfs(adj, start, end, out path);
    if (!found)
    {
      adj.NotFound();
      return;
    }

    adj.Path(path);
  }
}`;

  const dfs =
`using System;
using System.Collections.Generic;
using AlgoTracing;

class Program
{
  static bool Dfs(TrackedAdjacencyList adj, int start, int end, out List<int> path)
  {
    int V = adj.Count;
    path = new List<int>();

    if (start < 0 || start >= V || end < 0 || end >= V)
      return false;

    if (start == end)
    {
      path.Add(start);
      return true;
    }

    var visited = new TrackedVisited(V, adj);
    var parent = new int[V];
    for (int i = 0; i < V; i++) parent[i] = -1;

    var stack = new TrackedStack(adj);
    visited[start] = true;
    stack.Push(start);

    while (stack.Count > 0)
    {
      int v = stack.Pop();
      if (v == end) break;
      foreach (int n in adj[v])
      {
        if (!visited[n])
        {
          visited[n] = true;
          parent[n] = v;
          stack.Push(n);
        }
      }
    }

    if (!visited[end])
      return false;

    for (int cur = end; cur != -1; cur = parent[cur])
      path.Add(cur);
    path.Reverse();
    return true;
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    var input = Console.In.ReadToEnd();
    int start, end;
    string startLabel, endLabel;
    var adj = GraphInput.Parse(input, t, out start, out end, out startLabel, out endLabel);
    adj.GraphInit(startLabel, endLabel);

    List<int> path;
    var found = Dfs(adj, start, end, out path);
    if (!found)
    {
      adj.NotFound();
      return;
    }

    adj.Path(path);
  }
}`;

  const sandboxArray =
`using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using AlgoTracing;

class Program
{
  // Меняйте только эту функцию: здесь находится алгоритм для массива.
  // Здесь используется обычный int[] a.
  // ITracer t нужен для ручных пометок: ключ, минимум, pivot, диапазон, указатели.
  static void Algorithm(int[] a, ITracer t)
  {
    TracingExtensions.EmitArray(t, a.ToArray());

    for (int i = 0; i < a.Length; i++)
    {
      t.Read(i);
    }
  }

  static int[] ReadValues(out int target)
  {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try
    {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array)
      {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    }
    catch { }
    return Array.Empty<int>();
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    int target;
    int[] raw = ReadValues(out target);
    var a = raw;

    Algorithm(a, t);
  }
}`;

  const sandboxGraph =
`using System;
using System.Collections.Generic;
using AlgoTracing;

class Program
{
  // Меняйте только эту функцию: здесь находится алгоритм для графа.
  // start и end нужно проверить до обращения к массивам visited/parent.
  static bool Algorithm(TrackedAdjacencyList adj, int start, int end, out List<int> path)
  {
    int V = adj.Count;
    path = new List<int>();

    if (start < 0 || start >= V || end < 0 || end >= V)
      return false;

    if (start == end)
    {
      path.Add(start);
      return true;
    }

    var visited = new TrackedVisited(V, adj);
    var parent = new int[V];
    for (int i = 0; i < V; i++) parent[i] = -1;

    var q = new TrackedQueue(adj);
    visited[start] = true;
    q.Enqueue(start);

    while (q.Count > 0)
    {
      int current = q.Dequeue();
      if (current == end) break;

      foreach (int next in adj[current])
      {
        if (!visited[next])
        {
          visited[next] = true;
          parent[next] = current;
          q.Enqueue(next);
        }
      }
    }

    if (!visited[end])
      return false;

    for (int cur = end; cur != -1; cur = parent[cur])
      path.Add(cur);
    path.Reverse();
    return true;
  }

  static void Main()
  {
    ITracer t = new JsonConsoleTracer();
    var input = Console.In.ReadToEnd();
    int start, end;
    string startLabel, endLabel;
    var adj = GraphInput.Parse(input, t, out start, out end, out startLabel, out endLabel);
    adj.GraphInit(startLabel, endLabel);

    List<int> path;
    bool found = Algorithm(adj, start, end, out path);
    if (!found)
    {
      adj.NotFound();
      return;
    }

    adj.Path(path);
  }
}`;

  window.TEMPLATES = {
    onlyFunction: insertion,
    blank,
    insertion,
    selection,
    quick,
    binary,
    bfs,
    dfs,
    sandbox_array: sandboxArray,
    sandbox_graph: sandboxGraph,
    demo,
    controlled: controlledQuick,
    controlled_insertion: controlledInsertion,
    controlled_selection: controlledSelection,
    controlled_quick: controlledQuick,
    controlled_binary: controlledBinary,
    controlled_bfs: bfs,
    controlled_dfs: dfs
  };
})();

