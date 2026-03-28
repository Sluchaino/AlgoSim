using AlgoPlatform.Application;
using AlgoPlatform.Health;
using AlgoPlatform.Infrastructure;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using AlgoPlatform.Options;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

builder.Services.Configure<SubmissionStatusTimeouts>(
    builder.Configuration.GetSection("SubmissionStatus"));

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddSwaggerGen();

builder.Services.AddCors(options =>
{
    options.AddPolicy("DevCors", p =>
        p.AllowAnyOrigin()
         .AllowAnyHeader()
         .AllowAnyMethod());
});

builder.Services.AddHealthChecks()
    .AddCheck<DbHealthCheck>("db")
    .AddCheck<RedisHealthCheck>("redis")
    .AddCheck<RabbitMqHealthCheck>("rabbitmq");

var app = builder.Build();

var logger = app.Services.GetRequiredService<ILogger<Program>>();
var attempts = 0;
var maxAttempts = 10;

if (!app.Environment.IsEnvironment("Test"))
{
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
}
else
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AlgoPlatformDbContext>();
    await db.Database.EnsureCreatedAsync();
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
    app.UseCors("DevCors");
}

app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");

app.Run();


public partial class Program { }



