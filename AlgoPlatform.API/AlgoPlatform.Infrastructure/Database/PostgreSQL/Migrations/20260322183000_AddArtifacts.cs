using System;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Migrations
{
    [DbContext(typeof(AlgoPlatformDbContext))]
    [Migration("20260322183000_AddArtifacts")]
    public partial class AddArtifacts : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "artifacts",
                columns: table => new
                {
                    hash = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    storage_key = table.Column<string>(type: "text", nullable: true),
                    algo_tracing_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    build_error = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_artifacts", x => x.hash);
                });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "artifacts");
        }
    }
}
