using CryptoDecisionAssistant.Api.Data;
using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CryptoDecisionAssistant.Api.Controllers;

[ApiController, Route("api/alerts")]
public sealed class AlertsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<PriceAlert>> List(CancellationToken cancellationToken) =>
        db.PriceAlerts.OrderByDescending(x => x.CreatedUtc).ToListAsync(cancellationToken);

    [HttpPost]
    public async Task<ActionResult<PriceAlert>> Create(CreateAlertRequest request, CancellationToken cancellationToken)
    {
        var symbol = Symbols.NormalizeAndValidate(request.Symbol);
        var condition = request.Condition.Trim().ToLowerInvariant();
        if (condition is not ("above" or "below")) return BadRequest("Condition must be above or below.");
        if (request.Price <= 0) return BadRequest("Price must be greater than zero.");
        var alert = new PriceAlert { Symbol = symbol, Condition = condition, Price = request.Price };
        db.Add(alert);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(List), alert);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var alert = await db.PriceAlerts.FindAsync([id], cancellationToken);
        if (alert is null) return NotFound();
        db.Remove(alert);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    public sealed record CreateAlertRequest(string Symbol, string Condition, decimal Price);
}
