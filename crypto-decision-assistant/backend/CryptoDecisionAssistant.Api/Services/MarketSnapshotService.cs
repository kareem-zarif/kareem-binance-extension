using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;

namespace CryptoDecisionAssistant.Api.Services;

public interface IMarketSnapshotService
{
    Task<MarketSnapshotDto> GetAsync(string symbol, CancellationToken cancellationToken);
}

public sealed class MarketSnapshotService(IMarketDataClient market) : IMarketSnapshotService
{
    public async Task<MarketSnapshotDto> GetAsync(string symbol, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        var tickerTask = market.GetTickerAsync(symbol, cancellationToken);
        var currentDayTask = market.GetKlinesAsync(symbol, "1d", 1, cancellationToken);
        var historyTask = market.GetAllDailyKlinesAsync(symbol, cancellationToken);
        await Task.WhenAll(tickerTask, currentDayTask, historyTask);
        var ticker = await tickerTask;
        var currentDay = await currentDayTask;
        var daily = await historyTask;

        var day = Range(currentDay);
        var week = Range(daily.TakeLast(7));
        var month = Range(daily.TakeLast(30));
        var year = Range(daily.TakeLast(365));
        var allTime = Range(daily);
        var price = ticker.Price;
        return new MarketSnapshotDto(symbol, price, ticker.Change24hPercent, ticker.Volume24h,
            day.Low, day.High, week.Low, week.High, month.Low, month.High, year.Low, year.High,
            allTime.Low, allTime.High,
            DistanceFromLow(price, week.Low), DistanceFromHigh(price, week.High),
            DistanceFromLow(price, month.Low), DistanceFromHigh(price, month.High),
            DistanceFromLow(price, year.Low), DistanceFromHigh(price, year.High), DateTime.UtcNow);
    }

    public static decimal DistanceFromLow(decimal price, decimal low) => low == 0 ? 0 : Math.Round((price - low) / low * 100, 2);
    public static decimal DistanceFromHigh(decimal price, decimal high) => high == 0 ? 0 : Math.Round((high - price) / high * 100, 2);

    private static (decimal Low, decimal High) Range(IEnumerable<Kline> candles)
    {
        var values = candles.ToArray();
        if (values.Length == 0) throw new InvalidOperationException("No candle data was returned.");
        return (values.Min(x => x.Low), values.Max(x => x.High));
    }
}
