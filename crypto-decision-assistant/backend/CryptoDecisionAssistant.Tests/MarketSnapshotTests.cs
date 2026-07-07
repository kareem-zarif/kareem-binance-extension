using CryptoDecisionAssistant.Api.Services;

namespace CryptoDecisionAssistant.Tests;

public sealed class MarketSnapshotTests
{
    [Fact]
    public void DistanceFromLow_IsPercentageAboveLow() =>
        Assert.Equal(10m, MarketSnapshotService.DistanceFromLow(110m, 100m));

    [Fact]
    public void DistanceFromHigh_IsPercentageBelowHigh() =>
        Assert.Equal(10m, MarketSnapshotService.DistanceFromHigh(90m, 100m));

    [Fact]
    public async Task Snapshot_UsesDayYearAndCompleteHistoryRanges()
    {
        var service = new MarketSnapshotService(new HistoryMarketClient());
        var result = await service.GetAsync("BTCUSDT", CancellationToken.None);

        Assert.Equal(400m, result.DayLow);
        Assert.Equal(402m, result.DayHigh);
        Assert.Equal(36m, result.YearLow);
        Assert.Equal(1m, result.AllTimeLow);
        Assert.Equal(402m, result.AllTimeHigh);
    }

    private sealed class HistoryMarketClient : IMarketDataClient
    {
        private readonly IReadOnlyList<CryptoDecisionAssistant.Api.Models.Kline> _daily = Enumerable.Range(1, 400)
            .Select(x => new CryptoDecisionAssistant.Api.Models.Kline(DateTime.UtcNow.Date.AddDays(x - 400), x, x + 2, x, x + 1, 100))
            .ToArray();

        public Task<CryptoDecisionAssistant.Api.Models.Ticker> GetTickerAsync(string symbol, CancellationToken cancellationToken) =>
            Task.FromResult(new CryptoDecisionAssistant.Api.Models.Ticker(401m, 1m, 1000m));

        public Task<IReadOnlyList<CryptoDecisionAssistant.Api.Models.Kline>> GetKlinesAsync(string symbol, string interval, int limit, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CryptoDecisionAssistant.Api.Models.Kline>>(_daily.TakeLast(limit).ToArray());

        public Task<IReadOnlyList<CryptoDecisionAssistant.Api.Models.Kline>> GetAllDailyKlinesAsync(string symbol, CancellationToken cancellationToken) =>
            Task.FromResult(_daily);
    }
}
