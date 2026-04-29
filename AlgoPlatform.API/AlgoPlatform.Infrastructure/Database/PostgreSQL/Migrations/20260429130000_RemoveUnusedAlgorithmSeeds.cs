using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    public partial class RemoveUnusedAlgorithmSeeds : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "algorithms",
                keyColumn: "id",
                keyValue: 1);

            migrationBuilder.DeleteData(
                table: "algorithms",
                keyColumn: "id",
                keyValue: 4);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "algorithms",
                columns: new[] { "id", "description", "name" },
                values: new object[,]
                {
                    { 1, "Простой сортировочный алгоритм O(n^2).", "Bubble sort" },
                    { 4, "Сортировка слиянием, O(n log n).", "Merge sort" }
                });
        }
    }
}
