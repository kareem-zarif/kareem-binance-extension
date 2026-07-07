namespace CryptoDecisionAssistant.Api.Infrastructure;

public static class Symbols
{
    public static readonly string[] Supported = ["BTCUSDT", "ETHUSDT"];

    public static string NormalizeAndValidate(string? symbol)
    {
        var normalized = symbol?.Trim().ToUpperInvariant();
        if (normalized is null || !Supported.Contains(normalized, StringComparer.Ordinal))
            throw new ArgumentException("Supported symbols are BTCUSDT and ETHUSDT.", nameof(symbol));
        return normalized;
    }
}
