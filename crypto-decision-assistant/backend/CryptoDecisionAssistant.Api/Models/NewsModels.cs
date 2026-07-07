namespace CryptoDecisionAssistant.Api.Models;

public sealed record NewsItemDto(
    string Title,
    string Source,
    DateTimeOffset PublishedAt,
    IReadOnlyList<string> DetectedKeywords,
    int Sentiment,
    string Category,
    int Importance,
    int SourcePriority);

public sealed record NewsSentimentDto(
    string Symbol,
    int Score,
    string LabelArabic,
    IReadOnlyList<NewsItemDto> Items);

public sealed class RssProviderOptions
{
    public const string SectionName = "News";
    public List<RssSourceOptions> Providers { get; set; } = [];
}

public sealed class RssSourceOptions
{
    public string Name { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public int Priority { get; set; } = 50;
}
