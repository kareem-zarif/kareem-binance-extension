import './popup.css';
import { comparisonText, contextsFor, decisionGuidance, newsCategoryLabel, newsSentimentLabel, reasonsFor, scoreLegend, type Language } from '../shared/i18n';
import { riskLabels, signalLabels, type Comparison, type Settings, type SymbolCode, type SymbolState } from '../shared/types';

const cards = document.querySelector('#cards') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
let language: Language = 'en';
let currentState: Partial<Record<SymbolCode, SymbolState>> = {};

document.querySelector('#settings')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#compare')!.addEventListener('click', async () => {
  const box = document.querySelector('#comparison') as HTMLElement; box.textContent = language === 'ar' ? 'جاري المقارنة...' : 'Comparing...';
  const result = await chrome.runtime.sendMessage({ type: 'COMPARE' }) as Comparison & { error?: string };
  box.textContent = result.error ? (language === 'ar' ? 'تعذر تحميل المقارنة.' : 'Could not load the comparison.') : comparisonText(result, language);
});
document.querySelector('#languageToggle')!.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const config = response.settings as Settings;
  config.language = language === 'en' ? 'ar' : 'en';
  await chrome.storage.local.set({ settings: config });
  language = config.language; applyStaticText(); renderCards();
});
chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'LIVE_PRICE' || !currentState[message.symbol as SymbolCode]) return;
  const symbol = message.symbol as SymbolCode;
  const snapshot = currentState[symbol]!.snapshot;
  const livePrice = Number(message.price);
  if (!Number.isFinite(livePrice)) return;
  snapshot.currentPrice = livePrice;
  snapshot.dayLow = snapshot.dayLow > 0 ? Math.min(snapshot.dayLow, livePrice) : livePrice;
  snapshot.dayHigh = Math.max(snapshot.dayHigh, livePrice);
  updateLiveCard(symbol, snapshot);
});

async function load() {
  let response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  await chrome.runtime.sendMessage({ type: 'REFRESH' }).catch(() => undefined);
  response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const state = response.state as Partial<Record<SymbolCode, SymbolState>>;
  currentState = state;
  language = (response.settings as Settings).language ?? 'en';
  applyStaticText();
  status.hidden = Object.keys(state).length > 0;
  status.textContent = Object.keys(state).length ? '' : language === 'ar' ? 'تعذر الاتصال بالخادم. تأكد أنه يعمل من الإعدادات.' : 'Cannot reach the backend. Check the server URL in Settings.';
  renderCards();
}

function renderCards() {
  cards.innerHTML = (['BTCUSDT', 'ETHUSDT'] as SymbolCode[]).map(symbol => currentState[symbol] ? card(currentState[symbol]!, language) : '').join('');
  cards.querySelectorAll<HTMLButtonElement>('[data-reasons]').forEach(button => button.addEventListener('click', () => {
    document.querySelector<HTMLElement>(`#${button.dataset.reasons}`)?.toggleAttribute('hidden');
  }));
}

function card(state: SymbolState, lang: Language) {
  const s = state.snapshot, a = state.analysis;
  const id = `reasons-${s.symbol}`;
  const labels = lang === 'ar'
    ? { confidence: 'الثقة', risk: 'المخاطرة', timeframe: 'الإطار الزمني', currentPrice: 'السعر الحالي', day: 'اليوم UTC', week: 'الأسبوع', month: 'الشهر', year: 'السنة', all: 'منذ الإدراج', min: 'أقل', max: 'أعلى', why: 'ليه؟', updated: 'آخر تحديث' }
    : { confidence: 'Decision score', risk: 'Risk', timeframe: 'Timeframe', currentPrice: 'Current price', day: 'Today UTC', week: 'Week', month: 'Month', year: 'Year', all: 'Since listing', min: 'Min', max: 'Max', why: 'Why?', updated: 'Last updated' };
  const contexts = contextsFor(state, lang);
  return `<article><div class="card-head"><h2>${s.symbol.replace('USDT', '/USDT')}</h2><b><bdi id="${s.symbol}-price">${money(s.currentPrice)}</bdi></b></div>
    <span class="badge ${a.signal}">${signalLabels[lang][a.signal]}</span>
    <p class="decision"><b>${escapeHtml(decisionGuidance(state, lang))}</b></p>
    <div class="metrics"><span>${labels.confidence} <b>${a.confidence}%</b></span><span>${labels.risk} <b>${riskLabels[lang][a.riskLevel]}</b></span></div>
    <div class="technical-metrics"><span>${labels.timeframe} <b>${escapeHtml(a.analysisTimeframe || '—')}</b></span><span>${labels.currentPrice} <bdi id="${s.symbol}-technical-price">${money(s.currentPrice)}</bdi></span><span>EMA20 <bdi>${money(a.ema20)}</bdi></span><span>EMA50 <bdi>${money(a.ema50)}</bdi></span></div>
    <div class="ranges"><span>${labels.day}: ${labels.min} <bdi id="${s.symbol}-day-low">${money(s.dayLow)}</bdi> · ${labels.max} <bdi id="${s.symbol}-day-high">${money(s.dayHigh)}</bdi></span><span>${labels.week}: ${labels.min} <bdi>${money(s.weekLow)}</bdi> · ${labels.max} <bdi>${money(s.weekHigh)}</bdi></span><span>${labels.month}: ${labels.min} <bdi>${money(s.monthLow)}</bdi> · ${labels.max} <bdi>${money(s.monthHigh)}</bdi></span><span>${labels.year}: ${labels.min} <bdi>${money(s.yearLow)}</bdi> · ${labels.max} <bdi>${money(s.yearHigh)}</bdi></span><span>${labels.all}: ${labels.min} <bdi>${money(s.allTimeLow)}</bdi> · ${labels.max} <bdi>${money(s.allTimeHigh)}</bdi></span></div>
    <small>${labels.updated}: ${updated(s.lastUpdatedUtc, lang)}</small>
    <button data-reasons="${id}">${labels.why}</button><div id="${id}" hidden><ul>${reasonsFor(a, lang).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p>${escapeHtml(contexts[0])}</p>
    <h3>${lang === 'ar' ? 'ماذا وجد فحص الأخبار؟' : 'What did the news scan find?'}</h3><p>${newsSentimentLabel(state.news?.score ?? 0, lang)} (${state.news?.score ?? 0})</p>${newsItems(state, lang)}</div>
    <small class="score-legend">${scoreLegend(lang)}</small></article>`;
}
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0); }
function updateLiveCard(symbol: SymbolCode, snapshot: SymbolState['snapshot']) {
  const price = document.querySelector(`#${symbol}-price`); if (price) price.textContent = money(snapshot.currentPrice);
  const technicalPrice = document.querySelector(`#${symbol}-technical-price`); if (technicalPrice) technicalPrice.textContent = money(snapshot.currentPrice);
  const low = document.querySelector(`#${symbol}-day-low`); if (low) low.textContent = money(snapshot.dayLow);
  const high = document.querySelector(`#${symbol}-day-high`); if (high) high.textContent = money(snapshot.dayHigh);
}
function updated(value: string, lang: Language) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'medium' }).format(date); }
function escapeHtml(value: string) { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; }
function newsItems(state: SymbolState, lang: Language) {
  const items = state.news?.items ?? [];
  if (!items.length) return `<p>${lang === 'ar' ? 'لم يجد مزود RSS أخبارًا حديثة مطابقة.' : 'The configured RSS feed found no recent matching headlines.'}</p>`;
  return `<ul>${items.slice(0, 5).map(item => `<li>${escapeHtml(item.title)} <small>${escapeHtml(item.source)} · ${newsCategoryLabel(item.category, lang)} · ${newsSentimentLabel(item.sentiment, lang)}</small></li>`).join('')}</ul>`;
}

function applyStaticText() {
  document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelector('h1')!.textContent = language === 'ar' ? 'مساعد قرار التداول' : 'Crypto Decision Assistant';
  document.querySelector('#compare')!.textContent = language === 'ar' ? 'مقارنة BTC و ETH' : 'Compare BTC vs ETH';
  document.querySelector('footer')!.textContent = language === 'ar' ? 'هذا مساعد تعليمي وليس توصية مالية. القرار النهائي مسؤوليتك.' : 'Educational assistant only—not financial advice. The final decision is yours.';
  document.querySelector('#languageToggle')!.textContent = language === 'ar' ? 'EN' : 'العربية';
}

void load();
