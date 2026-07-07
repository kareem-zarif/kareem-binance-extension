using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace CryptoDecisionAssistant.Api.Controllers;

[ApiController, Route("api/analysis")]
public sealed class AnalysisController(IAnalysisService analysis) : ControllerBase
{
    [HttpGet("signal")]
    public Task<SignalDto> Signal([FromQuery] string symbol, [FromQuery] bool holdsAsset = false, CancellationToken cancellationToken = default) =>
        analysis.GetSignalAsync(symbol, holdsAsset, cancellationToken);

    [HttpGet("compare")]
    public Task<ComparisonDto> Compare(CancellationToken cancellationToken) => analysis.CompareAsync(cancellationToken);
}
