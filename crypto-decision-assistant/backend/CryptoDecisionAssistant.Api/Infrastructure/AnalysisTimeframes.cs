namespace CryptoDecisionAssistant.Api.Infrastructure;

public static class AnalysisTimeframes
{
    public const string Default = "4H";
    public static readonly string[] Supported = ["1H", "4H", "1D", "1W", "1M"];

    public static string NormalizeAndValidate(string? timeframe)
    {
        var normalized = timeframe?.Trim().ToUpperInvariant();
        if (normalized is null || !Supported.Contains(normalized, StringComparer.Ordinal))
            throw new ArgumentException("Supported timeframes are 1H, 4H, 1D, 1W, and 1M.", nameof(timeframe));
        return normalized;
    }

    public static string ToBinanceInterval(string timeframe) => NormalizeAndValidate(timeframe) switch
    {
        "1M" => "1M",
        var value => value.ToLowerInvariant()
    };
}
