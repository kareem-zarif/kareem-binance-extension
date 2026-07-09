import { fallbackSourceNoteArabic } from './i18n';
import { incompleteWarningArabic, type AnalysisTimeframe, type Comparison, type MarketSnapshot, type NewsSentiment, type Signal, type SignalResult, type SymbolCode, type SymbolState } from './types';

// Public Binance market-data hosts, tried in order. If one link fails (network,
// geo-block, rate limit) the next is used, so the panel keeps working even when
// the local backend is unreachable. These endpoints are public and need no key.
const PUBLIC_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api-gcp.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com'
];

interface Ticker24hr { lastPrice: string; priceChangePercent: string; volume: string; highPrice: string; lowPrice: string; }
type Kline = [number, string, string, string, string, string, ...unknown[]];

async function publicGet<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (const host of PUBLIC_HOSTS) {
    try {
      const response = await fetch(`${host}${path}`);
      if (!response.ok) throw new Error(`Public market API ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All public market hosts failed: ${String(lastError)}`);
}

const intervalFor = (timeframe: AnalysisTimeframe) =>
  ({ '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w', '1M': '1M' } as const)[timeframe] ?? '4h';

const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const highsOf = (klines: Kline[], count: number) => klines.slice(-count).map(candle => num(candle[2]));
const lowsOf = (klines: Kline[], count: number) => klines.slice(-count).map(candle => num(candle[3]));
const maxOf = (values: number[]) => values.length ? Math.max(...values) : 0;
const minOf = (values: number[]) => { const positive = values.filter(v => v > 0); return positive.length ? Math.min(...positive) : 0; };
const distanceHigh = (price: number, high: number) => high > 0 ? (high - price) / high * 100 : 0;
const distanceLow = (price: number, low: number) => low > 0 ? (price - low) / low * 100 : 0;
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i++) current = values[i] * k + current * (1 - k);
  return current;
}

function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function buildSnapshot(symbol: SymbolCode, timeframe: AnalysisTimeframe) {
  const [ticker, daily, weekly, timeframeKlines] = await Promise.all([
    publicGet<Ticker24hr>(`/api/v3/ticker/24hr?symbol=${symbol}`),
    publicGet<Kline[]>(`/api/v3/klines?symbol=${symbol}&interval=1d&limit=365`),
    publicGet<Kline[]>(`/api/v3/klines?symbol=${symbol}&interval=1w&limit=1000`),
    publicGet<Kline[]>(`/api/v3/klines?symbol=${symbol}&interval=${intervalFor(timeframe)}&limit=200`)
  ]);

  const price = num(ticker.lastPrice);
  const weekHigh = maxOf(highsOf(daily, 7)), weekLow = minOf(lowsOf(daily, 7));
  const monthHigh = maxOf(highsOf(daily, 30)), monthLow = minOf(lowsOf(daily, 30));
  const yearHigh = maxOf(highsOf(daily, 365)), yearLow = minOf(lowsOf(daily, 365));
  const allTimeHigh = maxOf(weekly.map(candle => num(candle[2])));
  const allTimeLow = minOf(weekly.map(candle => num(candle[3])));

  const snapshot: MarketSnapshot = {
    symbol, currentPrice: price, change24hPercent: num(ticker.priceChangePercent), volume24h: num(ticker.volume),
    dayLow: num(ticker.lowPrice), dayHigh: num(ticker.highPrice),
    weekLow, weekHigh, monthLow, monthHigh, yearLow, yearHigh, allTimeLow, allTimeHigh,
    distanceFromWeekLowPercent: distanceLow(price, weekLow), distanceFromWeekHighPercent: distanceHigh(price, weekHigh),
    distanceFromMonthLowPercent: distanceLow(price, monthLow), distanceFromMonthHighPercent: distanceHigh(price, monthHigh),
    distanceFromYearLowPercent: distanceLow(price, yearLow), distanceFromYearHighPercent: distanceHigh(price, yearHigh),
    lastUpdatedUtc: new Date().toISOString()
  };
  const closes = timeframeKlines.map(candle => num(candle[4]));
  return { snapshot, closes };
}

function buildAnalysis(snapshot: MarketSnapshot, closes: number[], symbol: SymbolCode, holdsAsset: boolean, timeframe: AnalysisTimeframe): SignalResult {
  const price = snapshot.currentPrice;
  const ema20 = ema(closes, 20), ema50 = ema(closes, 50);
  const rsiValue = rsi(closes, 14);
  const nearYearHigh = snapshot.distanceFromYearHighPercent <= 3 && snapshot.yearHigh > 0;
  const nearWeekLow = snapshot.distanceFromWeekLowPercent <= 3 && snapshot.weekLow > 0;

  let score = 50;
  score += price > ema20 ? 8 : -8;
  score += ema20 > ema50 && ema50 > 0 ? 10 : -10;
  if (rsiValue < 30) score += 10; else if (rsiValue > 70) score -= 15; else if (rsiValue >= 45 && rsiValue <= 60) score += 5;
  if (nearYearHigh) score -= 12;
  if (nearWeekLow) score += 6;
  const decisionScore = clamp(score);

  const riskLevel: SignalResult['riskLevel'] = nearYearHigh || rsiValue > 75 || (ema50 > 0 && price < ema50)
    ? 'HIGH' : price > ema20 && ema20 > ema50 && rsiValue >= 40 && rsiValue <= 65 ? 'LOW' : 'MEDIUM';

  const signal: Signal = holdsAsset && (nearYearHigh || rsiValue >= 72) ? 'TAKE_PROFIT_WATCH'
    : decisionScore >= 75 && riskLevel !== 'HIGH' ? 'MARKET_NOW'
    : decisionScore >= 60 ? 'LIMIT_ONLY'
    : decisionScore >= 45 ? 'WAIT' : 'AVOID';
  const suggestedOrderType: SignalResult['suggestedOrderType'] =
    signal === 'MARKET_NOW' ? 'MARKET' : signal === 'LIMIT_ONLY' ? 'LIMIT' : 'NO_ACTION';

  const reasonsArabic: string[] = [];
  if (ema50 > 0 && price > ema50) reasonsArabic.push('السعر فوق EMA50 ويدعم الاتجاه الصاعد.');
  if (nearWeekLow) reasonsArabic.push('السعر قريب من قاع أسبوعي دون انهيار في RSI.');
  if (rsiValue >= 40 && rsiValue <= 60) reasonsArabic.push('RSI على الساعة في منطقة مراقبة معقولة.');
  if (!reasonsArabic.length) reasonsArabic.push('لا توجد أفضلية فنية واضحة الآن.');

  const warningsArabic: string[] = [fallbackSourceNoteArabic];
  if (nearYearHigh) warningsArabic.push('السعر قريب جدًا من أعلى السنة، ومطاردته مخاطرة عالية.');
  if (rsiValue > 70) warningsArabic.push('RSI أعلى من 70، ودخول الماركت محظور بسبب مخاطر التشبع الشرائي.');
  if (ema50 > 0 && price < ema50) warningsArabic.push('السعر تحت EMA50 والاتجاه ضعيف.');

  return {
    symbol, signal, decisionScore, confidence: clamp(decisionScore - 8), riskLevel, suggestedOrderType,
    suggestedLimitZoneTextArabic: 'راقب أمرًا محددًا صغيرًا قرب الدعم فقط بعد مراجعة المخاطر.',
    analysisTimeframe: timeframe, currentPrice: price, ema20, ema50,
    reasonsArabic, warningsArabic,
    priceContextArabic: nearYearHigh ? 'السعر قرب أعلى السنة؛ الدخول الآن مخاطرة مرتفعة.' : nearWeekLow ? 'السعر قرب دعم أسبوعي؛ أمر محدد صغير قد يكون أهدأ.' : 'السعر بين حدود المدى الأخيرة؛ راجع الدعم والمقاومة قبل التصرف.',
    technicalContextArabic: `الاتجاه وEMA وRSI محسوبة محليًا من بيانات Binance العامة. RSI حالي ≈ ${Math.round(rsiValue)}.`,
    newsContextArabic: 'مسح الأخبار غير متاح في الوضع الاحتياطي؛ لم تُدرج الأخبار في هذه الدرجة.',
    scoreBreakdown: {
      technicalScore: clamp(50 + (price > ema20 ? 12 : -12) + (ema20 > ema50 ? 12 : -12) + (rsiValue >= 45 && rsiValue <= 60 ? 6 : 0)),
      newsScore: 50, macroScore: 50,
      historicalScore: clamp(100 - snapshot.distanceFromYearHighPercent),
      riskScore: clamp(nearYearHigh ? 80 : rsiValue > 70 ? 70 : ema50 > 0 && price < ema50 ? 65 : 40)
    },
    expectedDirections: [],
    probabilityDisclaimerArabic: 'الأرقام تقديرات مبنية على بيانات عامة، وليست تنبؤًا أو نصيحة مالية.'
  };
}

const emptyNews = (symbol: SymbolCode): NewsSentiment => ({ symbol, score: 0, labelArabic: 'محايد', items: [] });

export async function getPublicSymbolState(symbol: SymbolCode, holdsAsset = false, timeframe: AnalysisTimeframe = '4H'): Promise<SymbolState> {
  const { snapshot, closes } = await buildSnapshot(symbol, timeframe);
  const analysis = buildAnalysis(snapshot, closes, symbol, holdsAsset, timeframe);
  if (!closes.length && !analysis.warningsArabic.includes(incompleteWarningArabic)) analysis.warningsArabic.unshift(incompleteWarningArabic);
  return { snapshot, analysis, news: emptyNews(symbol) };
}

export async function getPublicComparison(timeframe: AnalysisTimeframe = '4H'): Promise<Comparison> {
  const [btc, eth] = await Promise.all([
    getPublicSymbolState('BTCUSDT', false, timeframe),
    getPublicSymbolState('ETHUSDT', false, timeframe)
  ]);
  const btcScore = btc.analysis.decisionScore, ethScore = eth.analysis.decisionScore;
  const gap = Math.abs(btcScore - ethScore);
  const betterForBeginnerNow: Comparison['betterForBeginnerNow'] = gap < 6 ? 'NONE' : btcScore > ethScore ? 'BTC' : 'ETH';
  const btcVol = Math.abs(btc.snapshot.change24hPercent), ethVol = Math.abs(eth.snapshot.change24hPercent);
  const fasterVolatility: Comparison['fasterVolatility'] = ethVol >= btcVol ? 'ETH' : 'BTC';
  return {
    betterForBeginnerNow, fasterVolatility, btcScore, ethScore,
    reasonsArabic: [
      `درجة BTC ${btcScore}/100 مقابل ETH ${ethScore}/100 (محسوبة محليًا من بيانات Binance العامة).`,
      `${fasterVolatility} لديه تحرك 24 ساعة أسرع حاليًا.`
    ],
    recommendationArabic: betterForBeginnerNow === 'NONE'
      ? `لا يوجد فائز واضح الآن. ${fasterVolatility} أسرع تقلبًا حاليًا. هذا الوضع احتياطي وليس نصيحة مالية.`
      : `${betterForBeginnerNow} يبدو أفضل نسبيًا للمبتدئ الآن. ${fasterVolatility} أسرع تقلبًا. هذا الوضع احتياطي وليس ضمانًا للربح.`
  };
}
