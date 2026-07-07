using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using CryptoDecisionAssistant.Api.Data;
using CryptoDecisionAssistant.Api.Hubs;
using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace CryptoDecisionAssistant.Api.Infrastructure;

public sealed class MarketRealtimeWorker(
    IHubContext<MarketHub> hub,
    IServiceScopeFactory scopeFactory,
    ILogger<MarketRealtimeWorker> logger) : BackgroundService
{
    private static readonly Uri StreamUri = new("wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker");
    private readonly Dictionary<string, DateTime> _lastAlertChecks = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ReadStreamAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Binance WebSocket disconnected; retrying");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task ReadStreamAsync(CancellationToken cancellationToken)
    {
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(StreamUri, cancellationToken);
        var buffer = new byte[16 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult received;
            do
            {
                received = await socket.ReceiveAsync(buffer, cancellationToken);
                if (received.MessageType == WebSocketMessageType.Close) return;
                message.Write(buffer, 0, received.Count);
            } while (!received.EndOfMessage);

            using var json = JsonDocument.Parse(message.ToArray());
            var data = json.RootElement.GetProperty("data");
            var symbol = data.GetProperty("s").GetString()!;
            var price = decimal.Parse(data.GetProperty("c").GetString()!, CultureInfo.InvariantCulture);
            var update = new PriceUpdateMessage(symbol, price, DateTime.UtcNow);
            await hub.Clients.Group(symbol).SendAsync("priceUpdate", update, cancellationToken);
            await TriggerAlertsAsync(symbol, price, cancellationToken);
        }
    }

    private async Task TriggerAlertsAsync(string symbol, decimal price, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        if (_lastAlertChecks.TryGetValue(symbol, out var lastCheck) && now - lastCheck < TimeSpan.FromSeconds(1)) return;
        _lastAlertChecks[symbol] = now;
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var alerts = await db.PriceAlerts.Where(x => x.Symbol == symbol && !x.Triggered).ToListAsync(cancellationToken);
        foreach (var alert in alerts.Where(x => x.Condition == "above" ? price >= x.Price : price <= x.Price))
        {
            alert.Triggered = true;
            await hub.Clients.Group(symbol).SendAsync("alertTriggered",
                new AlertTriggeredMessage(alert.Id, symbol, price, alert.Condition), cancellationToken);
        }
        if (alerts.Any(x => x.Triggered)) await db.SaveChangesAsync(cancellationToken);
    }
}

public sealed class SignalChangeWorker(
    IHubContext<MarketHub> hub,
    IServiceScopeFactory scopeFactory,
    ILogger<SignalChangeWorker> logger) : BackgroundService
{
    private readonly Dictionary<string, DecisionSignal> _previous = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            foreach (var symbol in Symbols.Supported)
            {
                try
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var analysis = scope.ServiceProvider.GetRequiredService<IAnalysisService>();
                    var current = await analysis.GetSignalAsync(symbol, false, stoppingToken);
                    if (_previous.TryGetValue(symbol, out var previous) && previous != current.Signal)
                        await hub.Clients.Group(symbol).SendAsync("signalChanged",
                            new SignalChangedMessage(symbol, previous, current.Signal, current.Confidence), stoppingToken);
                    _previous[symbol] = current.Signal;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                { logger.LogWarning(ex, "Could not refresh signal for {Symbol}", symbol); }
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
