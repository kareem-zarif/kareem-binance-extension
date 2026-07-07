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
        decimal? ema100 = closes.Length >= 100 ? CalculateEma(closes, 100) : null;
        decimal? ema200 = closes.Length >= 200 ? CalculateEma(closes, 200) : null;
        var macd = CalculateMacd(closes);
        var bollinger = CalculateBollinger(closes, 20);
        var latest = analysisCandles[^1];
        var averageVolume = analysisCandles.TakeLast(21).SkipLast(1).Average(x => x.Volume);
        var volumeRatio = averageVolume == 0 ? 0 : latest.Volume / averageVolume;
        var recent = analysisCandles.TakeLast(30).ToArray();
        var trend = ema20 > ema50 && latest.Close > ema50 ? "UPTREND"
            : ema20 < ema50 && latest.Close < ema50 ? "DOWNTREND" : "SIDEWAYS";

        return new TechnicalIndicatorDto(
            CalculateRsi(h1.Select(x => x.Close), 14), CalculateRsi(closes, 14),
            timeframe, ema20, ema50, ema100, ema200, macd.Line, macd.Signal, macd.Histogram,
            CalculateAdx(analysisCandles, 14), bollinger.Upper, bollinger.Middle, bollinger.Lower,
            CalculateVwap(analysisCandles.TakeLast(50)), CalculateObv(analysisCandles),
            CalculateAtr(analysisCandles, 14), Math.Round(volumeRatio, 2), trend,
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

    public static (decimal Line, decimal Signal, decimal Histogram) CalculateMacd(IEnumerable<decimal> values)
    {
        var prices = values.ToArray();
        if (prices.Length < 35) throw new ArgumentException("Not enough values for MACD.");
        var ema12 = EmaSeries(prices, 12);
        var ema26 = EmaSeries(prices, 26);
        var macd = ema26.Select((value, index) => ema12[index + ema12.Length - ema26.Length] - value).ToArray();
        var signal = EmaSeries(macd, 9)[^1];
        var line = macd[^1];
        return (Math.Round(line, 8), Math.Round(signal, 8), Math.Round(line - signal, 8));
    }

    public static (decimal Upper, decimal Middle, decimal Lower) CalculateBollinger(IEnumerable<decimal> values, int period)
    {
        var prices = values.TakeLast(period).ToArray();
        if (prices.Length < period) throw new ArgumentException("Not enough values for Bollinger Bands.");
        var middle = prices.Average();
        var variance = prices.Average(x => Math.Pow((double)(x - middle), 2));
        var deviation = (decimal)Math.Sqrt(variance);
        return (Math.Round(middle + deviation * 2, 8), Math.Round(middle, 8), Math.Round(middle - deviation * 2, 8));
    }

    public static decimal CalculateVwap(IEnumerable<Kline> candles)
    {
        var window = candles.ToArray();
        var volume = window.Sum(x => x.Volume);
        if (volume == 0) return 0;
        var value = window.Sum(x => ((x.High + x.Low + x.Close) / 3) * x.Volume) / volume;
        return Math.Round(value, 8);
    }

    public static decimal CalculateObv(IReadOnlyList<Kline> candles)
    {
        if (candles.Count < 2) return 0;
        decimal obv = 0;
        for (var i = 1; i < candles.Count; i++)
            obv += candles[i].Close > candles[i - 1].Close ? candles[i].Volume
                : candles[i].Close < candles[i - 1].Close ? -candles[i].Volume : 0;
        return Math.Round(obv, 2);
    }

    public static decimal CalculateAdx(IReadOnlyList<Kline> candles, int period)
    {
        if (candles.Count <= period * 2) throw new ArgumentException("Not enough candles for ADX.");
        var plusDm = new List<decimal>();
        var minusDm = new List<decimal>();
        var trueRanges = new List<decimal>();
        for (var i = 1; i < candles.Count; i++)
        {
            var upMove = candles[i].High - candles[i - 1].High;
            var downMove = candles[i - 1].Low - candles[i].Low;
            plusDm.Add(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDm.Add(downMove > upMove && downMove > 0 ? downMove : 0);
            trueRanges.Add(Math.Max(candles[i].High - candles[i].Low,
                Math.Max(Math.Abs(candles[i].High - candles[i - 1].Close), Math.Abs(candles[i].Low - candles[i - 1].Close))));
        }

        var dxValues = new List<decimal>();
        for (var i = period; i < trueRanges.Count; i++)
        {
            var tr = trueRanges.Skip(i - period).Take(period).Sum();
            if (tr == 0) continue;
            var plusDi = 100 * plusDm.Skip(i - period).Take(period).Sum() / tr;
            var minusDi = 100 * minusDm.Skip(i - period).Take(period).Sum() / tr;
            var denominator = plusDi + minusDi;
            if (denominator == 0) continue;
            dxValues.Add(100 * Math.Abs(plusDi - minusDi) / denominator);
        }

        return dxValues.Count == 0 ? 0 : Math.Round(dxValues.TakeLast(period).Average(), 2);
    }

    private static decimal[] EmaSeries(IReadOnlyList<decimal> prices, int period)
    {
        if (prices.Count < period) throw new ArgumentException("Not enough values for EMA.");
        var values = new List<decimal>();
        var ema = prices.Take(period).Average();
        values.Add(ema);
        var multiplier = 2m / (period + 1);
        foreach (var price in prices.Skip(period))
        {
            ema = (price - ema) * multiplier + ema;
            values.Add(ema);
        }
        return values.ToArray();
    }
}
