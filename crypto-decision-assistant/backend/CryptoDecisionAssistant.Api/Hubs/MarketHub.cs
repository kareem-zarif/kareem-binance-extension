using Microsoft.AspNetCore.SignalR;

namespace CryptoDecisionAssistant.Api.Hubs;

public sealed class MarketHub : Hub
{
    public Task Subscribe(string symbol) => Groups.AddToGroupAsync(Context.ConnectionId, symbol.ToUpperInvariant());
    public Task Unsubscribe(string symbol) => Groups.RemoveFromGroupAsync(Context.ConnectionId, symbol.ToUpperInvariant());
}
