using AlgoPlatform.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL
{
    public class AlgoPlatformDbContext : DbContext
    {
        public AlgoPlatformDbContext(DbContextOptions<AlgoPlatformDbContext> options)
            : base(options)
        {
        }

        // лучше сразу инициализировать, чтобы не ругался на null
        public DbSet<Algorithm> Algorithms { get; set; } = null!;
        public DbSet<Submission> Submissions { get; set; } = null!;
        public DbSet<Artifact> Artifacts { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<Algorithm>(entity =>
            {
                entity.ToTable("algorithms");

                entity.HasKey(a => a.Id);

                entity.Property(a => a.Id)
                      .HasColumnName("id")
                      .ValueGeneratedOnAdd(); // автоинкремент

                entity.Property(a => a.Name)
                      .HasColumnName("name")
                      .IsRequired()
                      .HasMaxLength(200);

                entity.Property(a => a.Description)
                      .HasColumnName("description")
                      .HasMaxLength(2000);

                // сидинг 7 алгоритмов
                entity.HasData(
                    new Algorithm { Id = 1, Name = "Bubble sort", Description = "Простой сортировочный алгоритм O(n^2)." },
                    new Algorithm { Id = 2, Name = "Selection sort", Description = "Сортировка выбором, O(n^2)." },
                    new Algorithm { Id = 3, Name = "Insertion sort", Description = "Сортировка вставками, O(n^2)." },
                    new Algorithm { Id = 4, Name = "Merge sort", Description = "Сортировка слиянием, O(n log n)." },
                    new Algorithm { Id = 5, Name = "Quick sort", Description = "Быстрая сортировка, O(n log n) в среднем." },
                    new Algorithm { Id = 6, Name = "DFS", Description = "Поиск в глубину в графе." },
                    new Algorithm { Id = 7, Name = "BFS", Description = "Поиск в ширину в графе." }
                );
            });

            modelBuilder.Entity<Artifact>(entity =>
            {
                entity.ToTable("artifacts");
                entity.HasKey(a => a.Hash);

                entity.Property(a => a.Hash)
                      .HasColumnName("hash")
                      .IsRequired();

                entity.Property(a => a.Status)
                      .HasColumnName("status")
                      .IsRequired()
                      .HasMaxLength(32);

                entity.Property(a => a.StorageKey)
                      .HasColumnName("storage_key");

                entity.Property(a => a.AlgoTracingHash)
                      .HasColumnName("algo_tracing_hash")
                      .HasMaxLength(128);

                entity.Property(a => a.BuildError)
                      .HasColumnName("build_error");

                entity.Property(a => a.CreatedAt)
                      .HasColumnName("created_at")
                      .IsRequired();

                entity.Property(a => a.UpdatedAt)
                      .HasColumnName("updated_at")
                      .IsRequired();
            });
        }
    }
}
