namespace CryptoDecisionAssistant.Api.Models;

public sealed record Kline(DateTime OpenTimeUtc, decimal Open, decimal High, decimal Low, decimal Close, decimal Volume);

public sealed record Ticker(decimal Price, decimal Change24hPercent, decimal Volume24h);

public sealed record MarketSnapshotDto(
    string Symbol,
    decimal CurrentPrice,
    decimal Change24hPercent,
    decimal Volume24h,
    decimal DayLow,
    decimal DayHigh,
    decimal WeekLow,
    decimal WeekHigh,
    decimal MonthLow,
    decimal MonthHigh,
    decimal YearLow,
    decimal YearHigh,
    decimal AllTimeLow,
    decimal AllTimeHigh,
    decimal DistanceFromWeekLowPercent,
    decimal DistanceFromWeekHighPercent,
    decimal DistanceFromMonthLowPercent,
    decimal DistanceFromMonthHighPercent,
    decimal DistanceFromYearLowPercent,
    decimal DistanceFromYearHighPercent,
    DateTime LastUpdatedUtc);

public sealed record TechnicalIndicatorDto(
    decimal Rsi1h,
    decimal RsiAnalysis,
    string Timeframe,
    decimal Ema20,
    decimal Ema50,
    decimal? Ema200,
    decimal Atr14,
    decimal VolumeRatio,
    string Trend,
    decimal Support,
    decimal Resistance,
    bool StrongRedCandleWithVolume);

public enum DecisionSignal { MARKET_NOW, LIMIT_ONLY, WAIT, AVOID, TAKE_PROFIT_WATCH }
public enum RiskLevel { LOW, MEDIUM, HIGH }
public enum SuggestedOrderType { MARKET, LIMIT, NO_ACTION }

public sealed record SignalDto(
    string Symbol,
    DecisionSignal Signal,
    int Confidence,
    RiskLevel RiskLevel,
    SuggestedOrderType SuggestedOrderType,
    string AnalysisTimeframe,
    decimal CurrentPrice,
    decimal Ema20,
    decimal Ema50,
    string SuggestedLimitZoneTextArabic,
    IReadOnlyList<string> ReasonsArabic,
    IReadOnlyList<string> WarningsArabic,
    string PriceContextArabic,
    string NewsContextArabic,
    string TechnicalContextArabic,
    string? BtcVsEthComparisonArabic);

public sealed record ComparisonDto(
    string BetterForBeginnerNow,
    string FasterVolatility,
    int BtcScore,
    int EthScore,
    IReadOnlyList<string> ReasonsArabic,
    string RecommendationArabic);
