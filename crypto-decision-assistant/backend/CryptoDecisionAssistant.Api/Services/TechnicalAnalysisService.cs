using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;

namespace CryptoDecisionAssistant.Api.Services;

public interface ITechnicalAnalysisService
{
    Task<TechnicalIndicatorDto> AnalyzeAsync(string symbol, string timeframe, CancellationToken cancellationToken);
}

public sealed class TechnicalAnalysisService(IMarketDataClient market) : ITechnicalAnalysisService
{
    public async Task<TechnicalIndicatorDto> AnalyzeAsync(string symbol, string timeframe, CancellationToken cancellationToken)
    {
        timeframe = AnalysisTimeframes.NormalizeAndValidate(timeframe);
        var analysisInterval = AnalysisTimeframes.ToBinanceInterval(timeframe);
        var h1Task = market.GetKlinesAsync(symbol, "1h", 250, cancellationToken);
        var analysisTask = analysisInterval == "1h"
            ? h1Task
            : market.GetKlinesAsync(symbol, analysisInterval, 250, cancellationToken);
        await Task.WhenAll(h1Task, analysisTask);
        var h1 = (await h1Task).ToArray();
        var analysisCandles = (await analysisTask).ToArray();
        var closes = analysisCandles.Select(x => x.Close).ToArray();
        var ema20 = CalculateEma(closes, 20);
        var ema50 = CalculateEma(closes, 50);
        decimal? ema200 = closes.Length >= 200 ? CalculateEma(closes, 200) : null;
        var latest = analysisCandles[^1];
        var averageVolume = analysisCandles.TakeLast(21).SkipLast(1).Average(x => x.Volume);
        var volumeRatio = averageVolume == 0 ? 0 : latest.Volume / averageVolume;
        var recent = analysisCandles.TakeLast(30).ToArray();
        var trend = ema20 > ema50 && latest.Close > ema50 ? "UPTREND"
            : ema20 < ema50 && latest.Close < ema50 ? "DOWNTREND" : "SIDEWAYS";

        return new TechnicalIndicatorDto(
            CalculateRsi(h1.Select(x => x.Close), 14), CalculateRsi(closes, 14),
            timeframe, ema20, ema50, ema200, CalculateAtr(analysisCandles, 14), Math.Round(volumeRatio, 2), trend,
            recent.Min(x => x.Low), recent.Max(x => x.High),
            latest.Close < latest.Open && volumeRatio >= 1.5m && (latest.Open - latest.Close) / latest.Open >= .02m);
    }

    public static decimal CalculateRsi(IEnumerable<decimal> values, int period = 14)
    {
        var prices = values.ToArray();
        if (prices.Length <= period) throw new ArgumentException("Not enough values for RSI.");
        var changes = prices.Zip(prices.Skip(1), (previous, current) => current - previous).ToArray();
        decimal gain = changes.Take(period).Where(x => x > 0).Sum() / period;
        decimal loss = -changes.Take(period).Where(x => x < 0).Sum() / period;
        foreach (var change in changes.Skip(period))
        {
            gain = (gain * (period - 1) + Math.Max(change, 0)) / period;
            loss = (loss * (period - 1) + Math.Max(-change, 0)) / period;
        }
        if (loss == 0) return gain == 0 ? 50 : 100;
        return Math.Round(100 - (100 / (1 + gain / loss)), 2);
    }

    public static decimal CalculateEma(IEnumerable<decimal> values, int period)
    {
        var prices = values.ToArray();
        if (prices.Length < period) throw new ArgumentException("Not enough values for EMA.");
        var ema = prices.Take(period).Average();
        var multiplier = 2m / (period + 1);
        foreach (var price in prices.Skip(period)) ema = (price - ema) * multiplier + ema;
        return Math.Round(ema, 8);
    }

    public static decimal CalculateAtr(IReadOnlyList<Kline> candles, int period)
    {
        if (candles.Count <= period) throw new ArgumentException("Not enough candles for ATR.");
        var ranges = candles.Skip(1).Select((x, index) =>
            Math.Max(x.High - x.Low, Math.Max(Math.Abs(x.High - candles[index].Close), Math.Abs(x.Low - candles[index].Close)))).ToArray();
        var atr = ranges.Take(period).Average();
        foreach (var range in ranges.Skip(period)) atr = (atr * (period - 1) + range) / period;
        return Math.Round(atr, 8);
    }
}
