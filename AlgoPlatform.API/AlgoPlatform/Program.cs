using AlgoPlatform.Application;
using AlgoPlatform.Infrastructure;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddSwaggerGen();

var app = builder.Build();

var logger = app.Services.GetRequiredService<ILogger<Program>>();
var attempts = 0;
var maxAttempts = 10;

while (true)
{
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AlgoPlatformDbContext>();
        await db.Database.MigrateAsync();
        break; // успех
    }
    catch (Exception ex)
    {
        attempts++;
        logger.LogWarning(ex, "DB not ready yet (attempt {Attempt}/{Max}).", attempts, maxAttempts);
        if (attempts >= maxAttempts) throw;
        await Task.Delay(TimeSpan.FromSeconds(3));
    }
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
