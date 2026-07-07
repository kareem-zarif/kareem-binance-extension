export type SymbolCode = 'BTCUSDT' | 'ETHUSDT';
export type Signal = 'MARKET_NOW' | 'LIMIT_ONLY' | 'WAIT' | 'AVOID' | 'TAKE_PROFIT_WATCH';
export const analysisTimeframes = ['1H', '4H', '1D', '1W', '1M'] as const;
export type AnalysisTimeframe = typeof analysisTimeframes[number];

export function normalizeAnalysisTimeframe(value: unknown): AnalysisTimeframe {
  return analysisTimeframes.includes(value as AnalysisTimeframe) ? value as AnalysisTimeframe : '4H';
}

export interface MarketSnapshot {
  symbol: SymbolCode; currentPrice: number; change24hPercent: number; volume24h: number;
  dayLow: number; dayHigh: number; weekLow: number; weekHigh: number; monthLow: number; monthHigh: number; yearLow: number; yearHigh: number;
  allTimeLow: number; allTimeHigh: number;
  distanceFromWeekLowPercent: number; distanceFromWeekHighPercent: number;
  distanceFromMonthLowPercent: number; distanceFromMonthHighPercent: number;
  distanceFromYearLowPercent: number; distanceFromYearHighPercent: number; lastUpdatedUtc: string;
}

export interface SignalResult {
  symbol: SymbolCode; signal: Signal; decisionScore: number; confidence: number; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedOrderType: 'MARKET' | 'LIMIT' | 'NO_ACTION'; suggestedLimitZoneTextArabic: string;
  analysisTimeframe: string; currentPrice: number; ema20: number; ema50: number;
  reasonsArabic: string[]; warningsArabic: string[]; priceContextArabic: string;
  newsContextArabic: string; technicalContextArabic: string; btcVsEthComparisonArabic?: string;
  scoreBreakdown: DecisionScoreBreakdown;
  expectedDirections: ExpectedDirection[];
  probabilityDisclaimerArabic: string;
}

export interface DecisionScoreBreakdown {
  technicalScore: number; newsScore: number; macroScore: number; historicalScore: number; riskScore: number;
}

export interface ExpectedDirection {
  window: string; bullishPercent: number; bearishPercent: number; rationaleArabic: string;
}

export interface Comparison {
  betterForBeginnerNow: 'BTC' | 'ETH' | 'NONE'; fasterVolatility: 'BTC' | 'ETH';
  btcScore: number; ethScore: number; reasonsArabic: string[]; recommendationArabic: string;
}

export interface NewsItem { title: string; source: string; publishedAt: string; detectedKeywords: string[]; sentiment: number; category: string; importance: number; sourcePriority: number; }
export interface NewsSentiment { symbol: SymbolCode; score: number; labelArabic: string; items: NewsItem[]; }
export interface SymbolState { snapshot: MarketSnapshot; analysis: SignalResult; news: NewsSentiment; }
export interface PriceAlert { id: string; symbol: SymbolCode; condition: 'above' | 'below' | 'equal'; price: number; triggered?: boolean; }
export interface Settings {
  settingsSchemaVersion: number;
  apiBaseUrl: string; symbols: SymbolCode[]; refreshSeconds: number; heldSymbols: SymbolCode[];
  analysisTimeframe: AnalysisTimeframe;
  riskMode: 'Conservative' | 'Balanced' | 'Aggressive'; soundEnabled: boolean;
  soundOnlyForStrongSignals: boolean; notificationConfidence: number; priceAlerts: PriceAlert[];
  language: 'en' | 'ar';
}

export const MIN_REFRESH_SECONDS = 5;
export const MAX_REFRESH_SECONDS = 45;
export const normalizeRefreshSeconds = (value: unknown, fallback = 15) => {
  const parsed = Number(value);
  return Math.max(MIN_REFRESH_SECONDS, Math.min(MAX_REFRESH_SECONDS, Number.isFinite(parsed) ? parsed : fallback));
};

export const defaultSettings: Settings = {
  settingsSchemaVersion: 2,
  apiBaseUrl: 'http://localhost:5187', symbols: ['BTCUSDT', 'ETHUSDT'], refreshSeconds: 15, heldSymbols: [],
  analysisTimeframe: '4H',
  riskMode: 'Balanced', soundEnabled: true, soundOnlyForStrongSignals: false,
  notificationConfidence: 70, priceAlerts: [], language: 'en'
};

export const signalLabels: Record<'en' | 'ar', Record<Signal, string>> = {
  en: { MARKET_NOW: 'Market entry possible', LIMIT_ONLY: 'Limit only', WAIT: 'Wait', AVOID: 'Avoid entry', TAKE_PROFIT_WATCH: 'Watch take profit' },
  ar: { MARKET_NOW: 'ادخل ماركت الآن؟', LIMIT_ONLY: 'الأفضل Limit', WAIT: 'استنى', AVOID: 'تجنب الدخول الآن', TAKE_PROFIT_WATCH: 'راقب جني أرباح' }
};

export const riskLabels = {
  en: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' },
  ar: { LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع' }
} as const;

export const incompleteWarningArabic = 'البيانات غير مكتملة، لا تعتمد على الإشارة الآن.';
export const incompleteWarningEnglish = 'Data is incomplete. Do not rely on this signal now.';
