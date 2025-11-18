using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    /// <inheritdoc />
    public partial class InitialAlgorithms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "algorithms",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_algorithms", x => x.id);
                });

            migrationBuilder.InsertData(
                table: "algorithms",
                columns: new[] { "id", "description", "name" },
                values: new object[,]
                {
                    { 1, "Простой сортировочный алгоритм O(n^2).", "Bubble sort" },
                    { 2, "Сортировка выбором, O(n^2).", "Selection sort" },
                    { 3, "Сортировка вставками, O(n^2).", "Insertion sort" },
                    { 4, "Сортировка слиянием, O(n log n).", "Merge sort" },
                    { 5, "Быстрая сортировка, O(n log n) в среднем.", "Quick sort" },
                    { 6, "Поиск в глубину в графе.", "DFS" },
                    { 7, "Поиск в ширину в графе.", "BFS" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "algorithms");
        }
    }
}
