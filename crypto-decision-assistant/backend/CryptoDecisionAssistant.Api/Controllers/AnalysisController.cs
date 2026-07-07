using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace CryptoDecisionAssistant.Api.Controllers;

[ApiController, Route("api/analysis")]
public sealed class AnalysisController(IAnalysisService analysis) : ControllerBase
{
    [HttpGet("signal")]
    public Task<SignalDto> Signal([FromQuery] string symbol, [FromQuery] bool holdsAsset = false,
        [FromQuery] string timeframe = AnalysisTimeframes.Default, CancellationToken cancellationToken = default) =>
        analysis.GetSignalAsync(symbol, holdsAsset, timeframe, cancellationToken);

    [HttpGet("compare")]
    public Task<ComparisonDto> Compare([FromQuery] string timeframe = AnalysisTimeframes.Default,
        CancellationToken cancellationToken = default) => analysis.CompareAsync(timeframe, cancellationToken);
}
