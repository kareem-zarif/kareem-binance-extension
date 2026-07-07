import { incompleteWarningArabic, type AnalysisTimeframe, type Comparison, type MarketSnapshot, type NewsSentiment, type Signal, type SignalResult, type SymbolCode } from './types';

async function get<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getSymbolState(baseUrl: string, symbol: SymbolCode, holdsAsset = false, timeframe: AnalysisTimeframe = '4H') {
  const [snapshotRaw, analysisRaw, newsRaw] = await Promise.all([
    get<Record<string, unknown>>(baseUrl, `/api/market/snapshot?symbol=${symbol}`),
    get<Record<string, unknown>>(baseUrl, `/api/analysis/signal?symbol=${symbol}&holdsAsset=${holdsAsset}&timeframe=${timeframe}`),
    get<Record<string, unknown>>(baseUrl, `/api/news/sentiment?symbol=${symbol}`)
  ]);
  return { snapshot: normalizeSnapshot(snapshotRaw, symbol), analysis: normalizeAnalysis(analysisRaw, symbol), news: normalizeNews(newsRaw, symbol) };
}

export const getComparison = (baseUrl: string, timeframe: AnalysisTimeframe = '4H') =>
  get<Comparison>(baseUrl, `/api/analysis/compare?timeframe=${timeframe}`);

const pick = (raw: Record<string, unknown>, camel: string, pascal: string) => raw[camel] ?? raw[pascal];
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];

function normalizeSnapshot(raw: Record<string, unknown>, fallbackSymbol: SymbolCode): MarketSnapshot {
  const n = (camel: string, pascal: string) => number(pick(raw, camel, pascal));
  return {
    symbol: text(pick(raw, 'symbol', 'Symbol'), fallbackSymbol) as SymbolCode,
    currentPrice: n('currentPrice', 'CurrentPrice'), change24hPercent: n('change24hPercent', 'Change24hPercent'), volume24h: n('volume24h', 'Volume24h'),
    dayLow: n('dayLow', 'DayLow'), dayHigh: n('dayHigh', 'DayHigh'),
    weekLow: n('weekLow', 'WeekLow'), weekHigh: n('weekHigh', 'WeekHigh'), monthLow: n('monthLow', 'MonthLow'), monthHigh: n('monthHigh', 'MonthHigh'),
    yearLow: n('yearLow', 'YearLow'), yearHigh: n('yearHigh', 'YearHigh'), allTimeLow: n('allTimeLow', 'AllTimeLow'), allTimeHigh: n('allTimeHigh', 'AllTimeHigh'),
    distanceFromWeekLowPercent: n('distanceFromWeekLowPercent', 'DistanceFromWeekLowPercent'),
    distanceFromWeekHighPercent: n('distanceFromWeekHighPercent', 'DistanceFromWeekHighPercent'), distanceFromMonthLowPercent: n('distanceFromMonthLowPercent', 'DistanceFromMonthLowPercent'),
    distanceFromMonthHighPercent: n('distanceFromMonthHighPercent', 'DistanceFromMonthHighPercent'), distanceFromYearLowPercent: n('distanceFromYearLowPercent', 'DistanceFromYearLowPercent'),
    distanceFromYearHighPercent: n('distanceFromYearHighPercent', 'DistanceFromYearHighPercent'), lastUpdatedUtc: text(pick(raw, 'lastUpdatedUtc', 'LastUpdatedUtc'), new Date().toISOString())
  };
}

function enumName<T extends string>(value: unknown, allowed: readonly T[], numericOrder: readonly T[]): T | undefined {
  if (typeof value === 'string') {
    const normalized = value.toUpperCase() as T;
    return allowed.includes(normalized) ? normalized : undefined;
  }
  return typeof value === 'number' ? numericOrder[value] : undefined;
}

function mappedSignal(score: number, risk: SignalResult['riskLevel']): Signal {
  if (score >= 75 && risk !== 'HIGH') return 'MARKET_NOW';
  if (score >= 60) return 'LIMIT_ONLY';
  if (score >= 45) return 'WAIT';
  return 'AVOID';
}

function normalizeAnalysis(raw: Record<string, unknown>, fallbackSymbol: SymbolCode): SignalResult {
  const rawSignal = enumName(pick(raw, 'signal', 'Signal'), ['MARKET_NOW', 'LIMIT_ONLY', 'WAIT', 'AVOID', 'TAKE_PROFIT_WATCH'], ['MARKET_NOW', 'LIMIT_ONLY', 'WAIT', 'AVOID', 'TAKE_PROFIT_WATCH']);
  const risk = enumName(pick(raw, 'riskLevel', 'RiskLevel'), ['LOW', 'MEDIUM', 'HIGH'], ['LOW', 'MEDIUM', 'HIGH']);
  const confidenceValue = pick(raw, 'confidence', 'Confidence');
  const confidence = number(confidenceValue, 0);
  const decisionScoreValue = pick(raw, 'decisionScore', 'DecisionScore') ?? confidenceValue;
  const decisionScore = number(decisionScoreValue, confidence);
  const incomplete = !rawSignal || !risk || decisionScoreValue === undefined || !Number.isFinite(Number(decisionScoreValue));
  const signal = incomplete ? 'WAIT' : rawSignal === 'TAKE_PROFIT_WATCH' ? rawSignal : mappedSignal(decisionScore, risk);
  const order = incomplete || signal === 'WAIT' || signal === 'AVOID' || signal === 'TAKE_PROFIT_WATCH' ? 'NO_ACTION' : signal === 'LIMIT_ONLY' ? 'LIMIT' : 'MARKET';
  const warnings = strings(pick(raw, 'warningsArabic', 'WarningsArabic'));
  if (incomplete && !warnings.includes(incompleteWarningArabic)) warnings.unshift(incompleteWarningArabic);
  return {
    symbol: text(pick(raw, 'symbol', 'Symbol'), fallbackSymbol) as SymbolCode,
    signal, decisionScore: Math.max(0, Math.min(100, decisionScore)),
    confidence: Math.max(0, Math.min(100, confidence)), riskLevel: incomplete ? 'HIGH' : risk,
    suggestedOrderType: order,
    analysisTimeframe: text(pick(raw, 'analysisTimeframe', 'AnalysisTimeframe')),
    currentPrice: number(pick(raw, 'currentPrice', 'CurrentPrice')),
    ema20: number(pick(raw, 'ema20', 'Ema20')),
    ema50: number(pick(raw, 'ema50', 'Ema50')),
    suggestedLimitZoneTextArabic: text(pick(raw, 'suggestedLimitZoneTextArabic', 'SuggestedLimitZoneTextArabic')),
    reasonsArabic: strings(pick(raw, 'reasonsArabic', 'ReasonsArabic')),
    warningsArabic: warnings,
    priceContextArabic: text(pick(raw, 'priceContextArabic', 'PriceContextArabic')),
    newsContextArabic: text(pick(raw, 'newsContextArabic', 'NewsContextArabic')),
    technicalContextArabic: text(pick(raw, 'technicalContextArabic', 'TechnicalContextArabic')),
    btcVsEthComparisonArabic: text(pick(raw, 'btcVsEthComparisonArabic', 'BtcVsEthComparisonArabic')) || undefined,
    scoreBreakdown: normalizeBreakdown(pick(raw, 'scoreBreakdown', 'ScoreBreakdown')),
    expectedDirections: normalizeDirections(pick(raw, 'expectedDirections', 'ExpectedDirections')),
    probabilityDisclaimerArabic: text(pick(raw, 'probabilityDisclaimerArabic', 'ProbabilityDisclaimerArabic'))
  };
}

function normalizeBreakdown(value: unknown): SignalResult['scoreBreakdown'] {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    technicalScore: number(pick(raw, 'technicalScore', 'TechnicalScore'), 0),
    newsScore: number(pick(raw, 'newsScore', 'NewsScore'), 0),
    macroScore: number(pick(raw, 'macroScore', 'MacroScore'), 0),
    historicalScore: number(pick(raw, 'historicalScore', 'HistoricalScore'), 0),
    riskScore: number(pick(raw, 'riskScore', 'RiskScore'), 0)
  };
}

function normalizeDirections(value: unknown): SignalResult['expectedDirections'] {
  return Array.isArray(value) ? value.map(item => {
    const raw = item as Record<string, unknown>;
    return {
      window: text(pick(raw, 'window', 'Window')),
      bullishPercent: number(pick(raw, 'bullishPercent', 'BullishPercent')),
      bearishPercent: number(pick(raw, 'bearishPercent', 'BearishPercent')),
      rationaleArabic: text(pick(raw, 'rationaleArabic', 'RationaleArabic'))
    };
  }).filter(item => item.window) : [];
}

function normalizeNews(raw: Record<string, unknown>, fallbackSymbol: SymbolCode): NewsSentiment {
  const rawItems = pick(raw, 'items', 'Items');
  return {
    symbol: text(pick(raw, 'symbol', 'Symbol'), fallbackSymbol) as SymbolCode,
    score: number(pick(raw, 'score', 'Score')),
    labelArabic: text(pick(raw, 'labelArabic', 'LabelArabic')),
    items: Array.isArray(rawItems) ? rawItems.map(value => {
      const item = value as Record<string, unknown>;
      return {
        title: text(pick(item, 'title', 'Title')),
        source: text(pick(item, 'source', 'Source')),
        publishedAt: text(pick(item, 'publishedAt', 'PublishedAt')),
        detectedKeywords: strings(pick(item, 'detectedKeywords', 'DetectedKeywords')),
        sentiment: number(pick(item, 'sentiment', 'Sentiment')),
        category: text(pick(item, 'category', 'Category'), 'GENERAL'),
        importance: number(pick(item, 'importance', 'Importance'), 1),
        sourcePriority: number(pick(item, 'sourcePriority', 'SourcePriority'), 50)
      };
    }).filter(item => item.title) : []
  };
}
