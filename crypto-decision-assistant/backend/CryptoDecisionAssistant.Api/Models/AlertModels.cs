namespace CryptoDecisionAssistant.Api.Models;

public sealed class PriceAlert
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Symbol { get; set; }
    public required string Condition { get; set; }
    public decimal Price { get; set; }
    public bool Triggered { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public sealed record PriceUpdateMessage(string Symbol, decimal Price, DateTime TimestampUtc);
public sealed record SignalChangedMessage(string Symbol, DecisionSignal Previous, DecisionSignal Current, int Confidence);
public sealed record AlertTriggeredMessage(Guid AlertId, string Symbol, decimal Price, string Condition);
