using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    [DbContext(typeof(AlgoPlatformDbContext))]
    [Migration("20260322184500_AddSubmissionArtifactHash")]
    public partial class AddSubmissionArtifactHash : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArtifactHash",
                table: "Submissions",
                type: "text",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ArtifactHash",
                table: "Submissions");
        }
    }
}
