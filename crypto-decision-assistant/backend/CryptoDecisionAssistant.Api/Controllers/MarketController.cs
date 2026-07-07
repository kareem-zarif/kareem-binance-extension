using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace CryptoDecisionAssistant.Api.Controllers;

[ApiController, Route("api/market")]
public sealed class MarketController(IMarketSnapshotService snapshots) : ControllerBase
{
    [HttpGet("snapshot")]
    public Task<MarketSnapshotDto> Snapshot([FromQuery] string symbol, CancellationToken cancellationToken) =>
        snapshots.GetAsync(symbol, cancellationToken);
}
