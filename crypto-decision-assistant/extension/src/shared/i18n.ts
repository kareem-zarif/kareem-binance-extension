import { incompleteWarningArabic, incompleteWarningEnglish, type Settings, type SignalResult, type SymbolState } from './types';

export type Language = Settings['language'];

export const fallbackSourceNoteArabic = 'المصدر الاحتياطي: بيانات Binance العامة المباشرة لأن الخادم المحلي غير متاح، والتحليل مبسط ولا يشمل الأخبار.';
export const fallbackSourceNoteEnglish = 'Fallback source: live public Binance data because the local backend is unavailable; this analysis is simplified and excludes news.';

const reasonMap: Array<[string, string]> = [
  ['قريب من قاع', 'Price is near a weekly or monthly low without RSI collapse.'],
  ['RSI على الساعة', 'Hourly RSI is in a reasonable pullback-monitoring zone.'],
  ['فوق EMA50', 'Price is above EMA50 and EMA20 supports the uptrend.'],
  ['الأخبار المرصودة تميل للإيجابية', 'Observed news sentiment is positive.'],
  ['الحجم يرتفع', 'Volume is rising while price moves higher.'],
  ['لا توجد أفضلية', 'There is no strong technical advantage right now.']
];
const warningMap: Array<[string, string]> = [
  [incompleteWarningArabic, incompleteWarningEnglish],
  [fallbackSourceNoteArabic, fallbackSourceNoteEnglish],
  ['الدخول ماركت مخاطرة', 'Market entry carries more risk than a limit order. This is educational assistance, not guaranteed financial advice.'],
  ['قريب جدًا من أعلى السنة', 'Price is very close to the yearly high; chasing it is high risk.'],
  ['قريب من قمة', 'Price is close to a weekly or monthly high.'],
  ['RSI أعلى من 70', 'RSI is above 70. Market entry is blocked due to overbought risk.'],
  ['تحت EMA50', 'Price is below EMA50 and the trend is weak.'],
  ['تميل للسلبية', 'Observed news sentiment is negative.'],
  ['التقلب الحالي مرتفع', 'Current ATR volatility is high.'],
  ['شمعة هابطة قوية', 'A strong red candle appeared with high volume.']
];

function translate(value: string, entries: Array<[string, string]>) {
  return entries.find(([source]) => value.includes(source))?.[1] ?? 'This factor is included in the current risk assessment.';
}

export const reasonsFor = (analysis: SignalResult, language: Language) =>
  language === 'ar' ? analysis.reasonsArabic : analysis.reasonsArabic.map(x => translate(x, reasonMap));
export const warningsFor = (analysis: SignalResult, language: Language) =>
  language === 'ar' ? analysis.warningsArabic : analysis.warningsArabic.map(x => translate(x, warningMap));

export function contextsFor(state: SymbolState, language: Language) {
  if (language === 'ar') return [state.analysis.priceContextArabic, state.analysis.technicalContextArabic, state.analysis.newsContextArabic];
  const s = state.snapshot;
  return [
    s.distanceFromWeekHighPercent <= 3 ? 'Price is within 3% of the weekly high, so market entry needs exceptional trend and volume confirmation.'
      : s.distanceFromMonthLowPercent <= 7 ? 'Price is relatively close to a monthly support area; a small limit order may be calmer.' : 'Price is between recent range extremes; review support and resistance before acting.',
    'Technical trend, RSI, EMA, ATR, and volume are included in the score and safety checks.',
    'News sentiment is included as a supporting factor, never as a standalone entry reason.'
  ];
}

export function comparisonText(comparison: { betterForBeginnerNow: string; fasterVolatility: string; recommendationArabic: string }, language: Language) {
  if (language === 'ar') return comparison.recommendationArabic;
  return comparison.betterForBeginnerNow === 'NONE'
    ? `There is no clear winner right now. ${comparison.fasterVolatility} currently has faster ATR volatility.`
    : `${comparison.betterForBeginnerNow} looks relatively better for a beginner now. ${comparison.fasterVolatility} currently has faster ATR volatility. This is not a profit guarantee.`;
}

export function decisionGuidance(state: SymbolState, language: Language) {
  const score = state.analysis.decisionScore;
  const signal = state.analysis.signal;
  if (language === 'ar') return signal === 'MARKET_NOW'
    ? `إعداد شراء محتمل — درجة القرار ${score}/100. الدخول Market اجتاز شروط الأمان لكنه ليس ضمانًا للربح.`
    : signal === 'LIMIT_ONLY' ? `لا تشترِ Market الآن — درجة القرار ${score}/100. إذا قررت الدخول، راقب Limit صغير فقط.`
      : signal === 'WAIT' ? `انتظر ولا تشترِ الآن — درجة القرار ${score}/100. لا توجد أفضلية كافية.`
        : signal === 'AVOID' ? `تجنب الشراء الآن — درجة القرار ${score}/100 والمخاطر أعلى من الفرصة.`
          : `مراقبة بيع/جني أرباح — درجة القرار ${score}/100. إذا كنت تملك العملة، راجع بيع جزء فقط بعد التحقق.`;
  return signal === 'MARKET_NOW'
    ? `Possible buy setup — decision score ${score}/100. Market entry passed the safety gates, but profit is never guaranteed.`
    : signal === 'LIMIT_ONLY' ? `Do not market-buy now — decision score ${score}/100. If you decide to enter, consider only a small limit order near support.`
      : signal === 'WAIT' ? `Wait; do not buy now — decision score ${score}/100. There is not enough advantage yet.`
        : signal === 'AVOID' ? `Avoid buying now — decision score ${score}/100. Current risk outweighs the setup.`
          : `Sell/take-profit watch — decision score ${score}/100. If you hold the asset, review a partial sale after confirming the data.`;
}

export const scoreLegend = (language: Language) => (language === 'ar'
  ? ['75–100: شراء محتمل إذا اجتاز شروط الأمان', '60–74: Limit فقط، لا تشترِ Market', '45–59: انتظار، لا شراء الآن', 'أقل من 45: تجنب الدخول']
  : ['75–100: possible buy only if safety gates pass', '60–74: limit only; do not market-buy', '45–59: wait; do not buy now', 'Below 45: avoid entry'])
  .map(line => `<span>${line}</span>`).join('');

export const newsSentimentLabel = (score: number, language: Language) => language === 'ar'
  ? score >= 5 ? 'إيجابي جدًا' : score >= 1 ? 'إيجابي' : score <= -5 ? 'سلبي جدًا' : score <= -1 ? 'سلبي' : 'محايد'
  : score >= 5 ? 'Very positive' : score >= 1 ? 'Positive' : score <= -5 ? 'Very negative' : score <= -1 ? 'Negative' : 'Neutral';

export const newsCategoryLabel = (category: string, language: Language) => {
  const labels: Record<string, [string, string]> = {
    MACRO: ['Macro / Fed / inflation', 'الفائدة والتضخم والاقتصاد الأمريكي'],
    ETF_FLOWS: ['ETF flows', 'تدفقات ETF'],
    REGULATION: ['Regulation', 'التنظيم والقوانين'],
    BINANCE: ['Binance operations', 'أخبار Binance'],
    SECURITY: ['Security / hacks', 'اختراقات ومخاطر أمنية'],
    ETHEREUM_UPGRADE: ['Ethereum upgrades', 'تحديثات Ethereum'],
    GENERAL: ['General crypto', 'كريبتو عام']
  };
  return (labels[category] ?? labels.GENERAL)[language === 'ar' ? 1 : 0];
};
