using AlgoPlatform.Application;
using AlgoPlatform.Infrastructure;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddDbContext<AlgoPlatformDbContext>(opt => opt.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services.AddControllers();

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddSwaggerGen();

var app = builder.Build();

try
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AlgoPlatformDbContext>();
    await db.Database.MigrateAsync(); // можно Migrate(), но Async ок в top-level
}
catch (Exception ex)
{
    // необязательно: логирование и фолбэк
    var logger = app.Services.GetRequiredService<ILogger<Program>>();
    logger.LogError(ex, "EF Core миграция не прошла");
    throw; // или решай сам: можно не падать в Dev
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (!app.Environment.IsProduction()) // или по своему признаку
{
    // в Dev можно оставить, если локально запускаешь через https
    app.UseHttpsRedirection();
}

app.UseAuthorization();

app.MapControllers();

app.Run();
