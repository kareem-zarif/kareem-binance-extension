using CryptoDecisionAssistant.Api.Infrastructure;
using CryptoDecisionAssistant.Api.Models;

namespace CryptoDecisionAssistant.Api.Services;

public interface IAnalysisService
{
    Task<SignalDto> GetSignalAsync(string symbol, bool holdsAsset, string timeframe, CancellationToken cancellationToken);
    Task<ComparisonDto> CompareAsync(string timeframe, CancellationToken cancellationToken);
}

public sealed class AnalysisService(
    IMarketSnapshotService snapshots,
    ITechnicalAnalysisService technical,
    INewsSentimentService news) : IAnalysisService
{
    private const string Disclaimer = "الدخول ماركت مخاطرة أعلى من Limit. الإشارة للتعليم والمساعدة وليست توصية مالية مؤكدة.";
    private const string ProbabilityDisclaimer = "النسب احتمالية مبنية على البيانات المتاحة وليست تنبؤًا مؤكدًا بالمستقبل ولا توصية مالية.";

    public async Task<SignalDto> GetSignalAsync(string symbol, bool holdsAsset, string timeframe, CancellationToken cancellationToken)
    {
        symbol = Symbols.NormalizeAndValidate(symbol);
        timeframe = AnalysisTimeframes.NormalizeAndValidate(timeframe);
        var currentTask = EvaluateAsync(symbol, holdsAsset, timeframe, cancellationToken);
        var otherTask = EvaluateAsync(symbol == "BTCUSDT" ? "ETHUSDT" : "BTCUSDT", false, timeframe, cancellationToken);
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

    public async Task<ComparisonDto> CompareAsync(string timeframe, CancellationToken cancellationToken)
    {
        timeframe = AnalysisTimeframes.NormalizeAndValidate(timeframe);
        var btcTask = EvaluateAsync("BTCUSDT", false, timeframe, cancellationToken);
        var ethTask = EvaluateAsync("ETHUSDT", false, timeframe, cancellationToken);
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

    public static RiskLevel EstimateRiskLevel(int score, decimal atrPercent)
    {
        if (score < 45 || atrPercent >= 5) return RiskLevel.HIGH;
        if (score < 60 || atrPercent >= 2.5m) return RiskLevel.MEDIUM;
        return RiskLevel.LOW;
    }

    public static DecisionSignal ApplyEntrySafetyRules(
        DecisionSignal signal, bool highRsi, bool nearWeeklyHigh, bool strongTrendAndVolume)
    {
        if (signal != DecisionSignal.MARKET_NOW) return signal;
        if (highRsi || (nearWeeklyHigh && !strongTrendAndVolume)) return DecisionSignal.LIMIT_ONLY;
        return signal;
    }

    private async Task<Evaluation> EvaluateAsync(string symbol, bool holdsAsset, string timeframe, CancellationToken cancellationToken)
    {
        var snapshotTask = snapshots.GetAsync(symbol, cancellationToken);
        var technicalTask = technical.AnalyzeAsync(symbol, timeframe, cancellationToken);
        var newsTask = news.AnalyzeAsync(symbol, cancellationToken);
        await Task.WhenAll(snapshotTask, technicalTask, newsTask);
        var snapshot = await snapshotTask;
        var indicators = await technicalTask;
        var sentiment = await newsTask;
        var reasons = new List<string>();
        var warnings = new List<string> { Disclaimer };

        if ((snapshot.DistanceFromWeekLowPercent <= 5 || snapshot.DistanceFromMonthLowPercent <= 7) && indicators.RsiAnalysis >= 30)
        { reasons.Add("السعر قريب من قاع أسبوعي أو شهري وRSI لا يظهر انهيارًا حاليًا."); }
        if (indicators.Rsi1h is >= 35 and <= 50)
        { reasons.Add("RSI على الساعة في منطقة مناسبة للمراقبة بعد تراجع."); }
        if (snapshot.CurrentPrice > indicators.Ema50 && indicators.Ema20 > indicators.Ema50)
        { reasons.Add("السعر فوق EMA50 وEMA20 أعلى منه، وهذا يدعم الاتجاه الصاعد."); }
        if (indicators.MacdHistogram > 0)
        { reasons.Add("MACD إيجابي ويدعم الزخم الحالي."); }
        if (indicators.Adx14 >= 25)
        { reasons.Add("ADX يشير إلى أن قوة الاتجاه أعلى من المعتاد."); }
        if (sentiment.Score > 0)
        { reasons.Add("الأخبار المرصودة تميل للإيجابية."); }
        if (indicators.VolumeRatio >= 1.2m && snapshot.Change24hPercent > 0)
        { reasons.Add("الحجم يرتفع مع تحرك السعر للأعلى."); }

        if (snapshot.DistanceFromYearHighPercent <= 3)
        { warnings.Add("السعر قريب جدًا من أعلى السنة؛ مطاردة السعر مخاطرتها مرتفعة."); }
        else if (snapshot.DistanceFromWeekHighPercent <= 3 || snapshot.DistanceFromMonthHighPercent <= 5)
        { warnings.Add("السعر قريب من قمة أسبوعية أو شهرية."); }
        if (indicators.Rsi1h > 70 || indicators.RsiAnalysis > 70)
        { warnings.Add("RSI أعلى من 70 وقد يكون السعر في تشبع شرائي."); }
        if (snapshot.CurrentPrice < indicators.Ema50 && indicators.Ema20 < indicators.Ema50)
        { warnings.Add("السعر تحت EMA50 والترند ضعيف."); }
        if (indicators.MacdHistogram < 0)
        { warnings.Add("MACD سلبي ويقلل جودة الدخول الحالي."); }
        if (sentiment.Score < 0)
        { warnings.Add("الأخبار المرصودة تميل للسلبية."); }
        var atrPercent = snapshot.CurrentPrice == 0 ? 0 : indicators.Atr14 / snapshot.CurrentPrice * 100;
        if (atrPercent >= 5)
        { warnings.Add("التقلب الحالي مرتفع حسب ATR."); }
        if (indicators.StrongRedCandleWithVolume)
        { warnings.Add("هناك شمعة هابطة قوية مع حجم مرتفع."); }

        var breakdown = BuildScoreBreakdown(snapshot, indicators, sentiment);
        var score = FinalDecisionScore(breakdown);
        var risk = EstimateRiskLevel(score, atrPercent);
        var highRsi = indicators.Rsi1h > 70 || indicators.RsiAnalysis > 70;
        var takeProfit = holdsAsset && (snapshot.DistanceFromMonthHighPercent <= 3 || snapshot.DistanceFromYearHighPercent <= 3) && highRsi;
        var strongTrendAndVolume = indicators.Trend == "UPTREND" && indicators.VolumeRatio >= 1.5m
            && snapshot.Change24hPercent > 0 && snapshot.CurrentPrice > indicators.Ema20;
        var signal = ApplyEntrySafetyRules(MapSignal(score, risk, takeProfit), highRsi,
            snapshot.DistanceFromWeekHighPercent <= 3, strongTrendAndVolume);
        if (highRsi && !warnings.Any(x => x.Contains("RSI أعلى", StringComparison.Ordinal)))
            warnings.Add("RSI أعلى من 70؛ لا نسمح بإشارة دخول Market في هذه الحالة.");
        return new Evaluation(symbol, score, EstimateConfidence(score, risk, indicators, sentiment, reasons, warnings),
            risk, signal, snapshot, indicators, sentiment, breakdown, ExpectedDirections(score, breakdown, indicators, sentiment),
            reasons, warnings);
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
        return new SignalDto(x.Symbol, x.Signal, x.Score, x.Confidence, x.Risk, order,
            x.Indicators.Timeframe, x.Snapshot.CurrentPrice, x.Indicators.Ema20, x.Indicators.Ema50,
            order == SuggestedOrderType.LIMIT ? $"منطقة متابعة تقريبية بين {low:N2} و{high:N2} قرب الدعم، وليست أمر شراء." : "لا توجد منطقة Limit مقترحة مع الإشارة الحالية.",
            x.Reasons.Count > 0 ? x.Reasons : ["لا توجد أفضلية فنية قوية وواضحة الآن."], x.Warnings,
            priceContext, $"مزاج الأخبار: {x.Sentiment.LabelArabic} (النتيجة {x.Sentiment.Score}).", technicalContext, comparison,
            x.Breakdown, x.ExpectedDirections, ProbabilityDisclaimer);
    }

    internal static DecisionScoreBreakdownDto BuildScoreBreakdown(
        MarketSnapshotDto snapshot, TechnicalIndicatorDto indicators, NewsSentimentDto sentiment)
    {
        var technical = 50;
        if (snapshot.CurrentPrice > indicators.Ema20) technical += 8;
        if (snapshot.CurrentPrice > indicators.Ema50 && indicators.Ema20 > indicators.Ema50) technical += 12;
        if (indicators.Ema100 is > 0 && snapshot.CurrentPrice > indicators.Ema100) technical += 4;
        if (indicators.Ema200 is > 0 && snapshot.CurrentPrice > indicators.Ema200) technical += 4;
        if (indicators.RsiAnalysis is >= 35 and <= 60) technical += 8;
        if (indicators.MacdHistogram > 0) technical += 7;
        if (indicators.Adx14 >= 25 && indicators.Trend == "UPTREND") technical += 5;
        if (indicators.VolumeRatio >= 1.2m && snapshot.Change24hPercent > 0) technical += 6;
        if (snapshot.CurrentPrice < indicators.Ema50 && indicators.Ema20 < indicators.Ema50) technical -= 12;
        if (indicators.RsiAnalysis > 70 || indicators.Rsi1h > 70) technical -= 12;
        if (indicators.StrongRedCandleWithVolume) technical -= 10;
        if (indicators.MacdHistogram < 0) technical -= 6;

        var newsScore = ClampScore(50 + sentiment.Score * 5);
        var macroItems = sentiment.Items.Where(x => x.Category is "MACRO" or "REGULATION" or "ETF_FLOWS").ToArray();
        var macroScore = macroItems.Length == 0
            ? 50
            : ClampScore(50 + (int)Math.Round(macroItems.Sum(x => x.Sentiment * x.Importance) * 4m));

        var historical = 50;
        if (snapshot.DistanceFromWeekLowPercent <= 5 || snapshot.DistanceFromMonthLowPercent <= 7) historical += 10;
        if (snapshot.DistanceFromWeekHighPercent <= 3 || snapshot.DistanceFromMonthHighPercent <= 5) historical -= 8;
        if (snapshot.DistanceFromYearHighPercent <= 3) historical -= 14;
        if (indicators.Trend == "UPTREND") historical += 8;
        if (indicators.Trend == "DOWNTREND") historical -= 8;
        if (indicators.VolumeRatio >= 1.2m && snapshot.Change24hPercent > 0) historical += 5;

        var atrPercent = snapshot.CurrentPrice == 0 ? 0 : indicators.Atr14 / snapshot.CurrentPrice * 100;
        var riskScore = 25 + (int)Math.Round(atrPercent * 10);
        if (snapshot.DistanceFromWeekHighPercent <= 3) riskScore += 12;
        if (snapshot.DistanceFromYearHighPercent <= 3) riskScore += 20;
        if (indicators.RsiAnalysis > 70 || indicators.Rsi1h > 70) riskScore += 15;
        if (sentiment.Score <= -5) riskScore += 12;
        else if (sentiment.Score < 0) riskScore += 6;

        return new DecisionScoreBreakdownDto(ClampScore(technical), newsScore, macroScore, ClampScore(historical), ClampScore(riskScore));
    }

    public static int FinalDecisionScore(DecisionScoreBreakdownDto breakdown)
    {
        var score = breakdown.TechnicalScore * .45m
            + breakdown.NewsScore * .20m
            + breakdown.MacroScore * .10m
            + breakdown.HistoricalScore * .15m
            + (100 - breakdown.RiskScore) * .10m;
        return ClampScore((int)Math.Round(score));
    }

    internal static int EstimateConfidence(int score, RiskLevel risk, TechnicalIndicatorDto indicators, NewsSentimentDto sentiment,
        IReadOnlyCollection<string> reasons, IReadOnlyCollection<string> warnings)
    {
        var confidence = 55 + Math.Min(15, reasons.Count * 4);
        confidence += indicators.Adx14 >= 25 ? 6 : 0;
        confidence += Math.Abs(sentiment.Score) >= 5 ? 5 : sentiment.Score != 0 ? 2 : 0;
        confidence += score is >= 65 or < 45 ? 5 : 0;
        confidence -= Math.Max(0, warnings.Count - 1) * 4;
        confidence -= risk == RiskLevel.HIGH ? 10 : risk == RiskLevel.MEDIUM ? 4 : 0;
        return ClampScore(confidence);
    }

    public static IReadOnlyList<ExpectedDirectionDto> ExpectedDirections(
        int score, DecisionScoreBreakdownDto breakdown, TechnicalIndicatorDto indicators, NewsSentimentDto sentiment)
    {
        var trendBoost = indicators.Trend == "UPTREND" ? 6 : indicators.Trend == "DOWNTREND" ? -6 : 0;
        var macdBoost = indicators.MacdHistogram > 0 ? 3 : indicators.MacdHistogram < 0 ? -3 : 0;
        var newsBoost = Math.Clamp(sentiment.Score, -10, 10);
        var fourHours = ClampPercent(50 + (score - 50) * .45m + trendBoost + macdBoost);
        var day = ClampPercent(50 + (score - 50) * .35m + trendBoost + newsBoost * .4m);
        var week = ClampPercent(50 + (breakdown.HistoricalScore - 50) * .25m + (breakdown.MacroScore - 50) * .20m + newsBoost * .5m);
        return
        [
            new("4H", fourHours, 100 - fourHours, "يعتمد على الزخم الفني القريب، MACD، والاتجاه الحالي."),
            new("24H", day, 100 - day, "يمزج الاتجاه الفني مع أثر الأخبار الحالية خلال اليوم."),
            new("7D", week, 100 - week, "يعتمد أكثر على الأخبار/الماكرو والسلوك التاريخي التقريبي، وليس تنبؤًا.")
        ];
    }

    private static int ClampScore(int value) => Math.Clamp(value, 0, 100);
    private static int ClampPercent(decimal value) => Math.Clamp((int)Math.Round(value), 5, 95);
    private static decimal AtrPercent(Evaluation x) => x.Snapshot.CurrentPrice == 0 ? 0 : x.Indicators.Atr14 / x.Snapshot.CurrentPrice * 100;
    private static string Short(string symbol) => symbol.StartsWith("BTC", StringComparison.Ordinal) ? "BTC" : "ETH";
    private static string TrendArabic(string trend) => trend switch { "UPTREND" => "صاعد", "DOWNTREND" => "هابط", _ => "جانبي" };

    internal sealed record Evaluation(string Symbol, int Score, int Confidence, RiskLevel Risk, DecisionSignal Signal,
        MarketSnapshotDto Snapshot, TechnicalIndicatorDto Indicators, NewsSentimentDto Sentiment,
        DecisionScoreBreakdownDto Breakdown, IReadOnlyList<ExpectedDirectionDto> ExpectedDirections,
        List<string> Reasons, List<string> Warnings);
}
