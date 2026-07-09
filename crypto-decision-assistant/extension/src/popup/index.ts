import './popup.css';
import { newsCategoryLabel, newsSentimentLabel, type Language } from '../shared/i18n';
import { type Settings, type SymbolCode, type SymbolState } from '../shared/types';

const cards = document.querySelector('#cards') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;
let language: Language = 'en';
let currentState: Partial<Record<SymbolCode, SymbolState>> = {};

document.querySelector('#settings')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#languageToggle')!.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const config = response.settings as Settings;
  config.language = language === 'en' ? 'ar' : 'en';
  await chrome.storage.local.set({ settings: config });
  language = config.language; applyStaticText(); renderCards();
});
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'STATE_UPDATE' && message.state) {
    currentState = message.state as Partial<Record<SymbolCode, SymbolState>>;
    status.hidden = Object.keys(currentState).length > 0;
    renderCards();
    return;
  }
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
}

function card(state: SymbolState, lang: Language) {
  const s = state.snapshot, a = state.analysis;
  const change = s.change24hPercent;
  const labels = lang === 'ar'
    ? { change24h: 'تغير 24 ساعة', volume24h: 'حجم 24 ساعة', timeframe: 'الإطار الزمني', currentPrice: 'السعر الحالي', day: 'اليوم UTC', week: 'الأسبوع', month: 'الشهر', year: 'السنة', all: 'منذ الإدراج', updated: 'آخر تحديث' }
    : { change24h: '24h change', volume24h: '24h volume', timeframe: 'Timeframe', currentPrice: 'Current price', day: 'Today UTC', week: 'Week', month: 'Month', year: 'Year', all: 'Since listing', updated: 'Last updated' };
  return `<article><div class="card-head"><h2>${s.symbol.replace('USDT', '/USDT')}</h2><b><bdi id="${s.symbol}-price">${money(s.currentPrice)}</bdi></b></div>
    <div class="technical-metrics"><span>${labels.change24h} <b class="${change >= 0 ? 'up' : 'down'}">${formatPercent(change)}</b></span><span>${labels.volume24h} <b><bdi>${formatVolume(s.volume24h)}</bdi></b></span><span>${labels.timeframe} <b>${escapeHtml(a.analysisTimeframe || '—')}</b></span><span>${labels.currentPrice} <bdi id="${s.symbol}-technical-price">${money(s.currentPrice)}</bdi></span><span>EMA20 <bdi>${money(a.ema20)}</bdi></span><span>EMA50 <bdi>${money(a.ema50)}</bdi></span></div>
    <div class="ranges">${rangeSlider(labels.day, s.dayLow, s.dayHigh, s.currentPrice, lang, `${s.symbol}-day`)}${rangeSlider(labels.week, s.weekLow, s.weekHigh, s.currentPrice, lang)}${rangeSlider(labels.month, s.monthLow, s.monthHigh, s.currentPrice, lang)}${rangeSlider(labels.year, s.yearLow, s.yearHigh, s.currentPrice, lang)}${rangeSlider(labels.all, s.allTimeLow, s.allTimeHigh, s.currentPrice, lang)}</div>
    <small>${labels.updated}: ${updated(s.lastUpdatedUtc, lang)}</small>
    <h3>${lang === 'ar' ? 'ماذا وجد فحص الأخبار؟' : 'What did the news scan find?'}</h3><p>${newsSentimentLabel(state.news?.score ?? 0, lang)} (${state.news?.score ?? 0})</p>${newsItems(state, lang)}</article>`;
}
function rangeSlider(label: string, low: number, high: number, price: number, lang: Language, key?: string) {
  const lowId = key ? ` id="${key}-low"` : '';
  const highId = key ? ` id="${key}-high"` : '';
  const priceId = key ? ` id="${key}-price-label"` : '';
  const markerId = key ? ` id="${key}-marker"` : '';
  const min = lang === 'ar' ? 'أقل' : 'Min', max = lang === 'ar' ? 'أعلى' : 'Max';
  return `<div class="range"><div class="range-top"><b>${label}</b></div><div class="range-scale"><span class="range-min">${min} <bdi${lowId}>${money(low)}</bdi></span><span class="range-price"><bdi${priceId}>${money(price)}</bdi></span><span class="range-max">${max} <bdi${highId}>${money(high)}</bdi></span></div><div class="range-bar"><i class="range-marker"${markerId} style="inset-inline-start:${markerPosition(price, low, high)}%"></i></div></div>`;
}
function markerPosition(price: number, low: number, high: number) {
  if (!(high > low)) return 50;
  return Math.max(0, Math.min(100, (price - low) / (high - low) * 100));
}
function formatPercent(value: number) { const v = Number(value) || 0; return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function formatVolume(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value) || 0); }
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0); }
function updateLiveCard(symbol: SymbolCode, snapshot: SymbolState['snapshot']) {
  const price = document.querySelector(`#${symbol}-price`); if (price) price.textContent = money(snapshot.currentPrice);
  const technicalPrice = document.querySelector(`#${symbol}-technical-price`); if (technicalPrice) technicalPrice.textContent = money(snapshot.currentPrice);
  const low = document.querySelector(`#${symbol}-day-low`); if (low) low.textContent = money(snapshot.dayLow);
  const high = document.querySelector(`#${symbol}-day-high`); if (high) high.textContent = money(snapshot.dayHigh);
  const priceLabel = document.querySelector(`#${symbol}-day-price-label`); if (priceLabel) priceLabel.textContent = money(snapshot.currentPrice);
  const marker = document.querySelector(`#${symbol}-day-marker`) as HTMLElement | null;
  if (marker) marker.style.insetInlineStart = `${markerPosition(snapshot.currentPrice, snapshot.dayLow, snapshot.dayHigh)}%`;
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
  document.querySelector('footer')!.textContent = language === 'ar' ? 'هذا مساعد تعليمي وليس توصية مالية. القرار النهائي مسؤوليتك.' : 'Educational assistant only—not financial advice. The final decision is yours.';
  document.querySelector('#languageToggle')!.textContent = language === 'ar' ? 'EN' : 'العربية';
}

void load();
