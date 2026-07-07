using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;
using CryptoDecisionAssistant.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace CryptoDecisionAssistant.Api.Controllers;

[ApiController, Route("api/news")]
public sealed class NewsController(INewsSentimentService news) : ControllerBase
{
    [HttpGet("sentiment")]
    public Task<NewsSentimentDto> Sentiment([FromQuery] string symbol, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        return news.AnalyzeAsync(symbol, cancellationToken);
    }
}
