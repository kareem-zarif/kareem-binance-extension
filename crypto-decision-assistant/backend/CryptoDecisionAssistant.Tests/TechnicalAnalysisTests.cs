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

    [Fact]
    public void Bollinger_ReturnsMiddleUpperAndLowerBands()
    {
        var bands = TechnicalAnalysisService.CalculateBollinger(Enumerable.Range(1, 20).Select(x => (decimal)x), 20);

        Assert.Equal(10.5m, bands.Middle);
        Assert.True(bands.Upper > bands.Middle);
        Assert.True(bands.Lower < bands.Middle);
    }

    [Fact]
    public void Obv_AddsVolumeOnUpClosesAndSubtractsOnDownCloses()
    {
        var candles = new[]
        {
            new CryptoDecisionAssistant.Api.Models.Kline(DateTime.UtcNow, 1, 1, 1, 10, 5),
            new CryptoDecisionAssistant.Api.Models.Kline(DateTime.UtcNow, 1, 1, 1, 12, 7),
            new CryptoDecisionAssistant.Api.Models.Kline(DateTime.UtcNow, 1, 1, 1, 11, 3)
        };

        Assert.Equal(4m, TechnicalAnalysisService.CalculateObv(candles));
    }
}
