using System.Xml;
using System.Xml.Linq;
using CryptoDecisionAssistant.Api.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace CryptoDecisionAssistant.Api.Services;

public interface INewsProvider
{
    Task<IReadOnlyList<NewsItemDto>> GetNewsAsync(string symbol, CancellationToken cancellationToken);
}

public interface INewsSentimentService
{
    Task<NewsSentimentDto> AnalyzeAsync(string symbol, CancellationToken cancellationToken);
}

public sealed class RssNewsProvider(
    IHttpClientFactory clients,
    IOptions<RssProviderOptions> options,
    IMemoryCache cache,
    ILogger<RssNewsProvider> logger) : INewsProvider
{
    private static readonly string[] Keywords =
        ["BTC", "Bitcoin", "ETH", "Ethereum", "ETF", "Fed", "Federal Reserve", "FOMC", "SEC", "Binance", "Coinbase", "hack", "exploit", "regulation", "stablecoin", "inflation", "CPI", "jobs", "payrolls", "interest rates", "rate cut", "rate hike", "upgrade", "staking"];

    public async Task<IReadOnlyList<NewsItemDto>> GetNewsAsync(string symbol, CancellationToken cancellationToken)
    {
        var cacheKey = $"rss-news:{symbol}";
        if (cache.TryGetValue<IReadOnlyList<NewsItemDto>>(cacheKey, out var cached)) return cached!;
        var result = new List<NewsItemDto>();
        foreach (var source in options.Value.Providers.Where(x => x.Enabled && Uri.IsWellFormedUriString(x.Url, UriKind.Absolute)))
        {
            try
            {
                using var stream = await clients.CreateClient("News").GetStreamAsync(source.Url, cancellationToken);
                using var reader = XmlReader.Create(stream, new XmlReaderSettings { Async = true, DtdProcessing = DtdProcessing.Prohibit });
                var document = await XDocument.LoadAsync(reader, LoadOptions.None, cancellationToken);
                var entries = document.Descendants().Where(x => x.Name.LocalName is "item" or "entry").Take(30);
                foreach (var item in entries)
                {
                    var title = item.Elements().FirstOrDefault(x => x.Name.LocalName == "title")?.Value.Trim() ?? string.Empty;
                    var detected = Keywords.Where(k => title.Contains(k, StringComparison.OrdinalIgnoreCase)).ToArray();
                    if (detected.Length == 0 || !IsRelevant(symbol, title)) continue;
                    var dateText = item.Elements().FirstOrDefault(x => x.Name.LocalName is "pubDate" or "published" or "updated")?.Value;
                    var published = DateTimeOffset.TryParse(dateText, out var date) ? date : DateTimeOffset.UtcNow;
                    var category = Classify(title);
                    result.Add(new NewsItemDto(title, source.Name, published, detected,
                        NewsSentimentService.ScoreText(title), category, Importance(category), source.Priority));
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Could not read RSS source {Source}", source.Name);
            }
        }
        var items = result.OrderByDescending(x => x.Importance).ThenBy(x => x.SourcePriority)
            .ThenByDescending(x => x.PublishedAt).Take(20).ToArray();
        cache.Set(cacheKey, items, TimeSpan.FromMinutes(5));
        return items;
    }

    private static bool IsRelevant(string symbol, string text)
    {
        var assetRelevant = symbol.StartsWith("BTC", StringComparison.Ordinal)
            ? Has(text, "BTC", "Bitcoin") : Has(text, "ETH", "Ethereum", "staking", "upgrade");
        var marketWide = Has(text, "ETF", "FOMC", "inflation", "CPI", "jobs", "payrolls", "employment report",
            "interest rates", "rate cut", "rate hike", "federal funds", "monetary policy", "economic projections",
            "Binance", "hack", "exploit", "stablecoin", "regulation");
        var cryptoRegulation = Has(text, "SEC") && Has(text, "crypto", "Bitcoin", "Ethereum", "ETF", "stablecoin", "Binance", "Coinbase");
        return assetRelevant || marketWide || cryptoRegulation;
    }

    private static string Classify(string text)
    {
        if (Has(text, "FOMC", "inflation", "CPI", "jobs", "payrolls", "employment report", "interest rates",
            "rate cut", "rate hike", "federal funds", "monetary policy", "economic projections")) return "MACRO";
        if (Has(text, "ETF", "inflow", "outflow")) return "ETF_FLOWS";
        if (Has(text, "hack", "exploit", "bankrupt", "depeg", "USDT", "USDC")) return "SECURITY";
        if (Has(text, "SEC", "regulation", "stablecoin", "law", "lawsuit")) return "REGULATION";
        if (Has(text, "Binance", "listing", "delisting", "withdrawal", "maintenance")) return "BINANCE";
        if (Has(text, "Ethereum", "upgrade", "staking", "fork")) return "ETHEREUM_UPGRADE";
        return "GENERAL";
    }

    private static int Importance(string category) => category switch
    {
        "MACRO" or "ETF_FLOWS" or "SECURITY" => 3,
        "REGULATION" or "BINANCE" or "ETHEREUM_UPGRADE" => 2,
        _ => 1
    };

    private static bool Has(string text, params string[] terms) => terms.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase));
}

public sealed class NewsSentimentService(INewsProvider provider) : INewsSentimentService
{
    private static readonly string[] VeryPositive = ["surge", "soar", "record inflow", "approval", "breakthrough", "large rate cut"];
    private static readonly string[] Positive = ["rise", "gain", "bullish", "adoption", "rally", "inflow", "rate cut", "cooling inflation", "inflation cools"];
    private static readonly string[] VeryNegative = ["hack", "collapse", "fraud", "ban", "exploit", "crash"];
    private static readonly string[] Negative = ["fall", "drop", "bearish", "outflow", "lawsuit", "risk", "crackdown", "rate hike", "hot inflation", "inflation rises"];

    public async Task<NewsSentimentDto> AnalyzeAsync(string symbol, CancellationToken cancellationToken)
    {
        var items = await provider.GetNewsAsync(symbol, cancellationToken);
        var score = Math.Clamp(items.Sum(x => x.Sentiment * x.Importance), -10, 10);
        return new NewsSentimentDto(symbol, score, Label(score), items);
    }

    public static int ScoreText(string text)
    {
        if (VeryNegative.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase))) return -2;
        if (VeryPositive.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase))) return 2;
        if (Negative.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase))) return -1;
        if (Positive.Any(x => text.Contains(x, StringComparison.OrdinalIgnoreCase))) return 1;
        return 0;
    }

    public static string Label(int score) => score switch
    {
        >= 5 => "إيجابي جدًا",
        >= 1 => "إيجابي",
        <= -5 => "سلبي جدًا",
        <= -1 => "سلبي",
        _ => "محايد"
    };
}
