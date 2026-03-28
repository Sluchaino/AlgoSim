using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace AlgoPlatform.Tests.Integration
{
    public sealed class SubmissionsEndpointsTests : IClassFixture<TestWebApplicationFactory>
    {
        private readonly HttpClient _client;

        public SubmissionsEndpointsTests(TestWebApplicationFactory factory)
        {
            _client = factory.CreateClient();
        }

        [Fact]
        public async Task GetAlgorithms_ReturnsSeededList()
        {
            var res = await _client.GetAsync("/api/algorithms");
            res.EnsureSuccessStatusCode();

            var json = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var array = root.ValueKind == JsonValueKind.Array
                ? root.EnumerateArray()
                : root.GetProperty("value").EnumerateArray();

            var names = array
                .Select(x => x.GetString())
                .Where(x => x is not null)
                .ToList();

            Assert.Contains("Selection sort", names);
            Assert.Contains("DFS", names);
        }

        [Fact]
        public async Task CreateSubmission_And_GetResult_DoesNotExposeCode()
        {
            var payload = new
            {
                name = "test",
                code = "using System; class Program { static void Main() { Console.WriteLine(1); } }",
                input = "1,2,3"
            };

            var create = await _client.PostAsJsonAsync("/api/submissions", payload);
            Assert.Equal(System.Net.HttpStatusCode.Accepted, create.StatusCode);

            using var createDoc = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
            var id = createDoc.RootElement.GetProperty("id").GetGuid();

            var result = await _client.GetAsync($"/api/submissions/{id}");
            result.EnsureSuccessStatusCode();

            using var resultDoc = JsonDocument.Parse(await result.Content.ReadAsStringAsync());
            var root = resultDoc.RootElement;

            Assert.False(root.TryGetProperty("code", out _));
            Assert.True(root.TryGetProperty("status", out _));
        }
    }
}
