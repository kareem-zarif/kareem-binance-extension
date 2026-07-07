using CryptoDecisionAssistant.Api.Services;

namespace CryptoDecisionAssistant.Tests;

public sealed class NewsSentimentTests
{
    [Theory]
    [InlineData("Bitcoin ETF record inflow approval", 2)]
    [InlineData("Ethereum adoption continues", 1)]
    [InlineData("Bitcoin market update", 0)]
    [InlineData("Ethereum faces lawsuit risk", -1)]
    [InlineData("Exchange hack triggers crash", -2)]
    [InlineData("Federal Reserve signals rate cut", 1)]
    [InlineData("Federal Reserve signals rate hike", -1)]
    public void KeywordScoring_ReturnsExpectedWeight(string title, int expected) =>
        Assert.Equal(expected, NewsSentimentService.ScoreText(title));
}
