using CryptoDecisionAssistant.Api.Services;

namespace CryptoDecisionAssistant.Tests;

public sealed class TechnicalAnalysisTests
{
    [Fact]
    public void Rsi_ReturnsOneHundred_ForConsistentlyRisingPrices()
    {
        var prices = Enumerable.Range(1, 30).Select(x => (decimal)x);
        Assert.Equal(100m, TechnicalAnalysisService.CalculateRsi(prices));
    }

    [Fact]
    public void Rsi_ReturnsFifty_ForFlatPrices()
    {
        Assert.Equal(50m, TechnicalAnalysisService.CalculateRsi(Enumerable.Repeat(100m, 30)));
    }

    [Fact]
    public void Ema_UsesInitialSimpleAverageAndThenSmooths()
    {
        var ema = TechnicalAnalysisService.CalculateEma(new decimal[] { 1, 2, 3, 4, 5 }, 3);
        Assert.Equal(4m, ema);
    }
}
