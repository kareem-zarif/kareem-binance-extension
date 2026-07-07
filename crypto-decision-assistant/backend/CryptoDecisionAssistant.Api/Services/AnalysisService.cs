using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;

namespace CryptoDecisionAssistant.Api.Services;

public interface IAnalysisService
{
    Task<SignalDto> GetSignalAsync(string symbol, bool holdsAsset, CancellationToken cancellationToken);
    Task<ComparisonDto> CompareAsync(CancellationToken cancellationToken);
}

public sealed class AnalysisService(
    IMarketSnapshotService snapshots,
    ITechnicalAnalysisService technical,
    INewsSentimentService news) : IAnalysisService
{
    private const string Disclaimer = "الدخول ماركت مخاطرة أعلى من Limit. الإشارة للتعليم والمساعدة وليست توصية مالية مؤكدة.";

    public async Task<SignalDto> GetSignalAsync(string symbol, bool holdsAsset, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        var currentTask = EvaluateAsync(symbol, holdsAsset, cancellationToken);
        var otherTask = EvaluateAsync(symbol == "BTCUSDT" ? "ETHUSDT" : "BTCUSDT", false, cancellationToken);
        await Task.WhenAll(currentTask, otherTask);
        var current = await currentTask;
        var other = await otherTask;
        var comparison = current.Score == other.Score
            ? "لا يوجد فرق واضح بين BTC وETH الآن."
            : current.Score > other.Score
                ? $"{Short(symbol)} يبدو أهدأ للمبتدئ الآن من {Short(other.Symbol)} حسب النتيجة الحالية."
                : $"{Short(other.Symbol)} يبدو أفضل للمبتدئ الآن من {Short(symbol)} حسب النتيجة الحالية.";
        return ToDto(current, comparison);
    }

    public async Task<ComparisonDto> CompareAsync(CancellationToken cancellationToken)
    {
        var btcTask = EvaluateAsync("BTCUSDT", false, cancellationToken);
        var ethTask = EvaluateAsync("ETHUSDT", false, cancellationToken);
        await Task.WhenAll(btcTask, ethTask);
        return Compare(await btcTask, await ethTask);
    }

    internal static ComparisonDto Compare(Evaluation btc, Evaluation eth)
    {
        return CompareScores(btc.Score, eth.Score, AtrPercent(btc), AtrPercent(eth));
    }

    public static ComparisonDto CompareScores(int btcScore, int ethScore, decimal btcAtrPercent, decimal ethAtrPercent)
    {
        var difference = Math.Abs(btcScore - ethScore);
        var better = difference < 5 ? "NONE" : btcScore > ethScore ? "BTC" : "ETH";
        var faster = btcAtrPercent >= ethAtrPercent ? "BTC" : "ETH";
        var reasons = new List<string>
        {
            $"نتيجة BTC الحالية {btcScore} من 100، ونتيجة ETH الحالية {ethScore} من 100.",
            $"{faster} أسرع في التقلب حاليًا حسب ATR، لذلك يحتاج حذرًا أكبر."
        };
        var recommendation = better == "NONE"
            ? "الفارق غير كافٍ لاختيار واضح. الأفضل الانتظار أو استخدام Limit صغير بعد مراجعة الأسباب."
            : $"{better} أفضل نسبيًا للمبتدئ الآن، لكن النتيجة للمساعدة وليست ضمانًا للربح.";
        return new ComparisonDto(better, faster, btcScore, ethScore, reasons, recommendation);
    }

    public static DecisionSignal MapSignal(int score, RiskLevel risk, bool takeProfitWatch = false)
    {
        if (takeProfitWatch) return DecisionSignal.TAKE_PROFIT_WATCH;
        if (score >= 75 && risk != RiskLevel.HIGH) return DecisionSignal.MARKET_NOW;
        if (score >= 60) return DecisionSignal.LIMIT_ONLY;
        if (score >= 45) return DecisionSignal.WAIT;
        return DecisionSignal.AVOID;
    }

    public static DecisionSignal ApplyEntrySafetyRules(
        DecisionSignal signal, bool highRsi, bool nearWeeklyHigh, bool strongTrendAndVolume)
    {
        if (signal != DecisionSignal.MARKET_NOW) return signal;
        if (highRsi || (nearWeeklyHigh && !strongTrendAndVolume)) return DecisionSignal.LIMIT_ONLY;
        return signal;
    }

    private async Task<Evaluation> EvaluateAsync(string symbol, bool holdsAsset, CancellationToken cancellationToken)
    {
        var snapshotTask = snapshots.GetAsync(symbol, cancellationToken);
        var technicalTask = technical.AnalyzeAsync(symbol, cancellationToken);
        var newsTask = news.AnalyzeAsync(symbol, cancellationToken);
        await Task.WhenAll(snapshotTask, technicalTask, newsTask);
        var snapshot = await snapshotTask;
        var indicators = await technicalTask;
        var sentiment = await newsTask;
        var score = 50;
        var reasons = new List<string>();
        var warnings = new List<string> { Disclaimer };

        if ((snapshot.DistanceFromWeekLowPercent <= 5 || snapshot.DistanceFromMonthLowPercent <= 7) && indicators.Rsi4h >= 30)
        { score += 10; reasons.Add("السعر قريب من قاع أسبوعي أو شهري وRSI لا يظهر انهيارًا حاليًا."); }
        if (indicators.Rsi1h is >= 35 and <= 50)
        { score += 8; reasons.Add("RSI على الساعة في منطقة مناسبة للمراقبة بعد تراجع."); }
        if (snapshot.CurrentPrice > indicators.Ema50 && indicators.Ema20 > indicators.Ema50)
        { score += 10; reasons.Add("السعر فوق EMA50 وEMA20 أعلى منه، وهذا يدعم الاتجاه الصاعد."); }
        if (sentiment.Score > 0)
        { var points = sentiment.Score >= 5 ? 10 : 5; score += points; reasons.Add("الأخبار المرصودة تميل للإيجابية."); }
        if (indicators.VolumeRatio >= 1.2m && snapshot.Change24hPercent > 0)
        { score += 8; reasons.Add("الحجم يرتفع مع تحرك السعر للأعلى."); }

        if (snapshot.DistanceFromYearHighPercent <= 3)
        { score -= 20; warnings.Add("السعر قريب جدًا من أعلى السنة؛ مطاردة السعر مخاطرتها مرتفعة."); }
        else if (snapshot.DistanceFromWeekHighPercent <= 3 || snapshot.DistanceFromMonthHighPercent <= 5)
        { score -= 10; warnings.Add("السعر قريب من قمة أسبوعية أو شهرية."); }
        if (indicators.Rsi1h > 70 || indicators.Rsi4h > 70)
        { score -= 15; warnings.Add("RSI أعلى من 70 وقد يكون السعر في تشبع شرائي."); }
        if (snapshot.CurrentPrice < indicators.Ema50 && indicators.Ema20 < indicators.Ema50)
        { score -= 10; warnings.Add("السعر تحت EMA50 والترند ضعيف."); }
        if (sentiment.Score < 0)
        { var penalty = sentiment.Score <= -5 ? 15 : 5; score -= penalty; warnings.Add("الأخبار المرصودة تميل للسلبية."); }
        var atrPercent = snapshot.CurrentPrice == 0 ? 0 : indicators.Atr14 / snapshot.CurrentPrice * 100;
        if (atrPercent >= 5)
        { score -= 10; warnings.Add("التقلب الحالي مرتفع حسب ATR."); }
        if (indicators.StrongRedCandleWithVolume)
        { score -= 10; warnings.Add("هناك شمعة هابطة قوية مع حجم مرتفع."); }

        score = Math.Clamp(score, 0, 100);
        var risk = atrPercent >= 5 || score < 35 ? RiskLevel.HIGH : atrPercent >= 2.5m ? RiskLevel.MEDIUM : RiskLevel.LOW;
        var highRsi = indicators.Rsi1h > 70 || indicators.Rsi4h > 70;
        var takeProfit = holdsAsset && (snapshot.DistanceFromMonthHighPercent <= 3 || snapshot.DistanceFromYearHighPercent <= 3) && highRsi;
        var strongTrendAndVolume = indicators.Trend == "UPTREND" && indicators.VolumeRatio >= 1.5m
            && snapshot.Change24hPercent > 0 && snapshot.CurrentPrice > indicators.Ema20;
        var signal = ApplyEntrySafetyRules(MapSignal(score, risk, takeProfit), highRsi,
            snapshot.DistanceFromWeekHighPercent <= 3, strongTrendAndVolume);
        if (highRsi && !warnings.Any(x => x.Contains("RSI أعلى", StringComparison.Ordinal)))
            warnings.Add("RSI أعلى من 70؛ لا نسمح بإشارة دخول Market في هذه الحالة.");
        return new Evaluation(symbol, score, risk, signal, snapshot, indicators, sentiment, reasons, warnings);
    }

    private static SignalDto ToDto(Evaluation x, string comparison)
    {
        var order = x.Signal switch
        {
            DecisionSignal.MARKET_NOW => SuggestedOrderType.MARKET,
            DecisionSignal.LIMIT_ONLY => SuggestedOrderType.LIMIT,
            _ => SuggestedOrderType.NO_ACTION
        };
        var low = Math.Round(x.Indicators.Support * .995m, 2);
        var high = Math.Round(x.Indicators.Support * 1.005m, 2);
        var priceContext = x.Snapshot.DistanceFromWeekHighPercent <= 3
            ? "السعر الحالي قريب من أعلى سعر في الأسبوع، فالدخول Market الآن مخاطره أعلى."
            : x.Snapshot.DistanceFromMonthLowPercent <= 7
                ? "السعر بعيد عن أعلى الشهر وقريب من دعم، ويمكن أن يكون Limit صغير أهدأ."
                : "السعر في منتصف نطاقاته الأخيرة؛ راقب الدعم والمقاومة قبل القرار.";
        var technicalContext = x.Indicators.Trend == "DOWNTREND"
            ? "السعر تحت EMA50 والترند ضعيف، الأفضل الانتظار."
            : $"الاتجاه الحالي {TrendArabic(x.Indicators.Trend)}، وRSI الساعة {x.Indicators.Rsi1h:0.##}.";
        return new SignalDto(x.Symbol, x.Signal, x.Score, x.Risk, order,
            order == SuggestedOrderType.LIMIT ? $"منطقة متابعة تقريبية بين {low:N2} و{high:N2} قرب الدعم، وليست أمر شراء." : "لا توجد منطقة Limit مقترحة مع الإشارة الحالية.",
            x.Reasons.Count > 0 ? x.Reasons : ["لا توجد أفضلية فنية قوية وواضحة الآن."], x.Warnings,
            priceContext, $"مزاج الأخبار: {x.Sentiment.LabelArabic} (النتيجة {x.Sentiment.Score}).", technicalContext, comparison);
    }

    private static decimal AtrPercent(Evaluation x) => x.Snapshot.CurrentPrice == 0 ? 0 : x.Indicators.Atr14 / x.Snapshot.CurrentPrice * 100;
    private static string Short(string symbol) => symbol.StartsWith("BTC", StringComparison.Ordinal) ? "BTC" : "ETH";
    private static string TrendArabic(string trend) => trend switch { "UPTREND" => "صاعد", "DOWNTREND" => "هابط", _ => "جانبي" };

    internal sealed record Evaluation(string Symbol, int Score, RiskLevel Risk, DecisionSignal Signal,
        MarketSnapshotDto Snapshot, TechnicalIndicatorDto Indicators, NewsSentimentDto Sentiment,
        List<string> Reasons, List<string> Warnings);
}
