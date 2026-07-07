using CryptoDecisionAssistant.Api.Data;
using CryptoDecisionAssistant.Api.Hubs;
using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(options =>
    options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSignalR();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddMemoryCache();
builder.Services.Configure<RssProviderOptions>(builder.Configuration.GetSection(RssProviderOptions.SectionName));
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=crypto-decision-assistant.db"));
builder.Services.AddHttpClient<IMarketDataClient, BinanceMarketClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Binance:RestBaseUrl"] ?? "https://api.binance.com/");
    client.Timeout = TimeSpan.FromSeconds(15);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("CryptoDecisionAssistant/1.0");
});
builder.Services.AddHttpClient("News", client =>
{
    client.Timeout = TimeSpan.FromSeconds(10);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("CryptoDecisionAssistant/1.0");
});
builder.Services.AddScoped<IMarketSnapshotService, MarketSnapshotService>();
builder.Services.AddScoped<ITechnicalAnalysisService, TechnicalAnalysisService>();
builder.Services.AddScoped<INewsProvider, RssNewsProvider>();
builder.Services.AddScoped<INewsSentimentService, NewsSentimentService>();
builder.Services.AddScoped<IAnalysisService, AnalysisService>();
builder.Services.AddHostedService<MarketRealtimeWorker>();
builder.Services.AddHostedService<SignalChangeWorker>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .SetIsOriginAllowed(origin => origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)
        || origin.StartsWith("http://localhost:", StringComparison.OrdinalIgnoreCase))
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();
app.UseExceptionHandler();
app.UseCors();
app.MapControllers();
app.MapHub<MarketHub>("/hubs/market");

await using (var scope = app.Services.CreateAsyncScope())
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreatedAsync();

app.Run();

public partial class Program;
