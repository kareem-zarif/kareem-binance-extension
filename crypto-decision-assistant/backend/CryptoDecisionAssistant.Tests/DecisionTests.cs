using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using CryptoDecisionAssistant.Api.Infrastructure;

namespace CryptoDecisionAssistant.Tests;

public sealed class DecisionTests
{
    [Theory]
    [InlineData("1h", "1H", "1h")]
    [InlineData("4H", "4H", "4h")]
    [InlineData("1d", "1D", "1d")]
    [InlineData("1w", "1W", "1w")]
    [InlineData("1m", "1M", "1M")]
    public void TimeframeMapping_UsesSupportedBinanceIntervals(string input, string expected, string interval)
    {
        Assert.Equal(expected, AnalysisTimeframes.NormalizeAndValidate(input));
        Assert.Equal(interval, AnalysisTimeframes.ToBinanceInterval(input));
    }

    [Fact]
    public void TimeframeMapping_RejectsUnsupportedValues() =>
        Assert.Throws<ArgumentException>(() => AnalysisTimeframes.NormalizeAndValidate("15M"));

    [Theory]
    [InlineData(75, RiskLevel.LOW, DecisionSignal.MARKET_NOW)]
    [InlineData(80, RiskLevel.HIGH, DecisionSignal.LIMIT_ONLY)]
    [InlineData(60, RiskLevel.MEDIUM, DecisionSignal.LIMIT_ONLY)]
    [InlineData(45, RiskLevel.LOW, DecisionSignal.WAIT)]
    [InlineData(44, RiskLevel.LOW, DecisionSignal.AVOID)]
    public void SignalMapping_UsesScoreAndRisk(int score, RiskLevel risk, DecisionSignal expected) =>
        Assert.Equal(expected, AnalysisService.MapSignal(score, risk));

    [Theory]
    [InlineData(35, 1, RiskLevel.HIGH)]
    [InlineData(44, 1, RiskLevel.HIGH)]
    [InlineData(45, 1, RiskLevel.MEDIUM)]
    [InlineData(59, 1, RiskLevel.MEDIUM)]
    [InlineData(60, 1, RiskLevel.LOW)]
    [InlineData(80, 2.5, RiskLevel.MEDIUM)]
    [InlineData(80, 5, RiskLevel.HIGH)]
    public void RiskEstimation_UsesDecisionScoreAndAtr(int score, double atrPercent, RiskLevel expected) =>
        Assert.Equal(expected, AnalysisService.EstimateRiskLevel(score, (decimal)atrPercent));

    [Fact]
    public void TakeProfitWatch_OverridesNormalMapping() =>
        Assert.Equal(DecisionSignal.TAKE_PROFIT_WATCH, AnalysisService.MapSignal(80, RiskLevel.LOW, true));

    [Fact]
    public void Comparison_SelectsHigherScoreAndFasterAtr()
    {
        var result = AnalysisService.CompareScores(72, 61, 2m, 4m);
        Assert.Equal("BTC", result.BetterForBeginnerNow);
        Assert.Equal("ETH", result.FasterVolatility);
    }

    [Fact]
    public void Comparison_ReturnsNoneWhenScoresAreClose()
    {
        Assert.Equal("NONE", AnalysisService.CompareScores(66, 63, 2m, 2.5m).BetterForBeginnerNow);
    }

    [Fact]
    public void HighRsi_BlocksMarketNow()
    {
        Assert.Equal(DecisionSignal.LIMIT_ONLY,
            AnalysisService.ApplyEntrySafetyRules(DecisionSignal.MARKET_NOW, true, false, true));
    }

    [Theory]
    [InlineData(false, DecisionSignal.LIMIT_ONLY)]
    [InlineData(true, DecisionSignal.MARKET_NOW)]
    public void WeeklyHigh_RequiresStrongTrendAndVolume(bool strongConfirmation, DecisionSignal expected)
    {
        Assert.Equal(expected,
            AnalysisService.ApplyEntrySafetyRules(DecisionSignal.MARKET_NOW, false, true, strongConfirmation));
    }

    [Fact]
    public void FinalDecisionScore_PenalizesHighRiskScore()
    {
        var lowRisk = new DecisionScoreBreakdownDto(80, 60, 50, 60, 20);
        var highRisk = lowRisk with { RiskScore = 80 };

        Assert.True(AnalysisService.FinalDecisionScore(lowRisk) > AnalysisService.FinalDecisionScore(highRisk));
    }

    [Fact]
    public void ExpectedDirections_ReturnsProbabilisticWindows()
    {
        var indicators = new TechnicalIndicatorDto(45, 52, "4H", 100, 95, 90, 85, 2, 1, 1, 28, 110, 100, 90, 98, 1000, 3, 1.4m, "UPTREND", 92, 108, false);
        var sentiment = new NewsSentimentDto("BTCUSDT", 4, "إيجابي", []);

        var windows = AnalysisService.ExpectedDirections(70, new DecisionScoreBreakdownDto(75, 70, 55, 60, 30), indicators, sentiment);

        Assert.Equal(["4H", "24H", "7D"], windows.Select(x => x.Window));
        Assert.All(windows, x => Assert.Equal(100, x.BullishPercent + x.BearishPercent));
    }
}
