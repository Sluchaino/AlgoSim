using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    [DbContext(typeof(AlgoPlatformDbContext))]
    [Migration("20260315190000_AddSubmissionExecutionFields")]
    public partial class AddSubmissionExecutionFields : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ExitCode",
                table: "Submissions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Error",
                table: "Submissions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "DurationMs",
                table: "Submissions",
                type: "bigint",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ExitCode",
                table: "Submissions");

            migrationBuilder.DropColumn(
                name: "Error",
                table: "Submissions");

            migrationBuilder.DropColumn(
                name: "DurationMs",
                table: "Submissions");
        }
    }
}
