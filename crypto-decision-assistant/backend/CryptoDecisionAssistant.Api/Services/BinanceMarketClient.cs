using System.Globalization;
using System.Text.Json;
using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;
using Microsoft.Extensions.Caching.Memory;

namespace CryptoDecisionAssistant.Api.Services;

public interface IMarketDataClient
{
    Task<Ticker> GetTickerAsync(string symbol, CancellationToken cancellationToken);
    Task<IReadOnlyList<Kline>> GetKlinesAsync(string symbol, string interval, int limit, CancellationToken cancellationToken);
    Task<IReadOnlyList<Kline>> GetAllDailyKlinesAsync(string symbol, CancellationToken cancellationToken);
}

public sealed class BinanceMarketClient(HttpClient httpClient, IMemoryCache cache) : IMarketDataClient
{
    public async Task<Ticker> GetTickerAsync(string symbol, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        var key = $"ticker:{symbol}";
        if (cache.TryGetValue<Ticker>(key, out var cached)) return cached!;

        using var response = await httpClient.GetAsync($"api/v3/ticker/24hr?symbol={symbol}", cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        var root = json.RootElement;
        var ticker = new Ticker(
            Parse(root.GetProperty("lastPrice").GetString()),
            Parse(root.GetProperty("priceChangePercent").GetString()),
            Parse(root.GetProperty("quoteVolume").GetString()));
        cache.Set(key, ticker, TimeSpan.FromSeconds(5));
        return ticker;
    }

    public async Task<IReadOnlyList<Kline>> GetKlinesAsync(string symbol, string interval, int limit, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        if (interval is not ("15m" or "1h" or "4h" or "1d")) throw new ArgumentException("Unsupported interval.");
        limit = Math.Clamp(limit, 1, 1000);
        var key = $"klines:{symbol}:{interval}:{limit}";
        if (cache.TryGetValue<IReadOnlyList<Kline>>(key, out var cached)) return cached!;

        using var response = await httpClient.GetAsync($"api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}", cancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
        var result = ParseKlines(json.RootElement);
        var cacheDuration = interval == "1d" && limit == 1 ? TimeSpan.FromSeconds(2)
            : interval == "1d" ? TimeSpan.FromMinutes(10) : TimeSpan.FromMinutes(1);
        cache.Set(key, result, cacheDuration);
        return result;
    }

    public async Task<IReadOnlyList<Kline>> GetAllDailyKlinesAsync(string symbol, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        var key = $"klines:{symbol}:1d:all";
        if (cache.TryGetValue<IReadOnlyList<Kline>>(key, out var cached)) return cached!;

        var result = new List<Kline>();
        var cursor = DateTimeOffset.Parse("2010-01-01T00:00:00Z", CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        while (true)
        {
            using var response = await httpClient.GetAsync($"api/v3/klines?symbol={symbol}&interval=1d&limit=1000&startTime={cursor}", cancellationToken);
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
            var page = ParseKlines(json.RootElement);
            if (page.Length == 0) break;
            result.AddRange(page);
            if (page.Length < 1000) break;
            cursor = new DateTimeOffset(page[^1].OpenTimeUtc.AddDays(1)).ToUnixTimeMilliseconds();
        }

        cache.Set(key, result, TimeSpan.FromHours(12));
        return result;
    }

    private static Kline[] ParseKlines(JsonElement element) => element.EnumerateArray().Select(x => new Kline(
        DateTimeOffset.FromUnixTimeMilliseconds(x[0].GetInt64()).UtcDateTime,
        Parse(x[1].GetString()), Parse(x[2].GetString()), Parse(x[3].GetString()),
        Parse(x[4].GetString()), Parse(x[5].GetString()))).ToArray();

    private static decimal Parse(string? value) => decimal.Parse(value ?? "0", CultureInfo.InvariantCulture);
}
