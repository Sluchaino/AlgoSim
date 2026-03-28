using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AlgoPlatformDbContext))]
    [Migration("20260315184500_AddSubmissionStatus")]
    public partial class AddSubmissionStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Submissions",
                type: "text",
                nullable: false,
                defaultValue: "Queued");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Status",
                table: "Submissions");
        }
    }
}
