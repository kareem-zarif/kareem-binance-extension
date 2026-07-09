import { newsCategoryLabel, newsSentimentLabel, type Language } from '../shared/i18n';
import { normalizeRefreshSeconds, type Settings, type SymbolCode, type SymbolState } from '../shared/types';

const symbolFromUrl = (): SymbolCode | null => location.pathname.includes('BTC_USDT') ? 'BTCUSDT' : location.pathname.includes('ETH_USDT') ? 'ETHUSDT' : null;
const symbol = symbolFromUrl();
if (symbol) void mount(symbol);

async function mount(currentSymbol: SymbolCode) {
  const initial = await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => ({ state: {}, settings: { language: 'en', soundEnabled: true } }));
  const language = ((initial.settings as Settings)?.language ?? 'en') as Language;
  const t = language === 'ar'
    ? { title: 'مساعد قرار التداول', collapse: 'تصغير', loading: 'جاري تحميل التحليل...', refresh: 'تحديث التحليل', compare: 'مقارنة BTC و ETH', mute: 'كتم الصوت', settings: 'الإعدادات', disclaimer: 'هذا مساعد تعليمي وليس توصية مالية. القرار النهائي مسؤوليتك.', order: 'لا ينفذ المساعد أي شراء أو بيع. إشعارات التنفيذ تعتمد فقط على حالة Filled الظاهرة في Binance.' }
    : { title: 'Crypto Decision Assistant', collapse: 'Collapse', loading: 'Loading analysis...', refresh: 'Refresh analysis', compare: 'Compare BTC vs ETH', mute: 'Mute sound', settings: 'Settings', disclaimer: 'Educational assistant only—not financial advice. The final decision is yours.', order: 'This assistant never places orders. Execution alerts require a visible Filled status on Binance.' };
  const host = document.createElement('div');
  host.id = 'crypto-decision-assistant-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${styles}</style><section class="panel" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
    <header><strong>${t.title}</strong><button id="collapse" title="${t.collapse}">−</button></header>
    <main><div id="loading">${t.loading}</div><div id="content" hidden></div>
      <div class="actions"><button id="refresh">${t.refresh}</button><button id="mute">${t.mute}</button><button id="settings">${t.settings}</button></div>
      <small>${t.disclaimer}</small>
      <small class="order-note">${t.order}</small>
    </main></section>`;
  document.documentElement.appendChild(host);
  let displayedState: SymbolState | undefined;
  const showState = (state: SymbolState) => { displayedState = state; render(root, state, language); };
  makeDraggable(root.querySelector('header')!, root.querySelector('.panel')!);

  root.querySelector('#collapse')!.addEventListener('click', () => root.querySelector('main')!.classList.toggle('hidden'));
  root.querySelector('#refresh')!.addEventListener('click', () => { setLoading(root); void chrome.runtime.sendMessage({ type: 'REFRESH' }); });
  root.querySelector('#settings')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
  root.querySelector('#mute')!.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    const config = response.settings as Settings; config.soundEnabled = !config.soundEnabled;
    await chrome.storage.local.set({ settings: config });
    (root.querySelector('#mute') as HTMLButtonElement).textContent = config.soundEnabled ? (language === 'ar' ? 'كتم الصوت' : 'Mute sound') : (language === 'ar' ? 'تشغيل الصوت' : 'Enable sound');
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'STATE_UPDATE' && message.state[currentSymbol]) showState(message.state[currentSymbol]);
    if (message.type === 'LIVE_PRICE' && message.symbol === currentSymbol) {
      const livePrice = Number(message.price);
      if (displayedState && Number.isFinite(livePrice)) {
        const snapshot = displayedState.snapshot;
        snapshot.currentPrice = livePrice;
        snapshot.dayLow = snapshot.dayLow > 0 ? Math.min(snapshot.dayLow, livePrice) : livePrice;
        snapshot.dayHigh = Math.max(snapshot.dayHigh, livePrice);
        updateLiveDay(root, snapshot);
      }
    }
    if (message.type === 'PLAY_SOUND') void new Audio(message.soundUrl).play().catch(() => undefined);
  });
  if (initial.state[currentSymbol]) showState(initial.state[currentSymbol]);
  void chrome.runtime.sendMessage({ type: 'REFRESH' });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void chrome.runtime.sendMessage({ type: 'REFRESH' });
  }, normalizeRefreshSeconds((initial.settings as Settings)?.refreshSeconds) * 1000);
  void chrome.runtime.sendMessage({ type: 'GET_STATE' }).then(response => {
    if (response.state[currentSymbol]) showState(response.state[currentSymbol]);
    else void chrome.runtime.sendMessage({ type: 'REFRESH' });
  });
  watchOrderStatus(root, currentSymbol, language);
}

function render(root: ShadowRoot, state: SymbolState, language: Language) {
  (root.querySelector('#loading') as HTMLElement).hidden = true;
  const content = root.querySelector('#content') as HTMLElement; content.hidden = false;
  const s = state.snapshot, a = state.analysis;
  const change = s.change24hPercent;
  const labels = language === 'ar'
    ? { change24h: 'تغير 24 ساعة', volume24h: 'حجم 24 ساعة', timeframe: 'الإطار الزمني', currentPrice: 'السعر الحالي', day: 'اليوم UTC', week: 'الأسبوع', month: 'الشهر', year: 'السنة', all: 'منذ الإدراج', updated: 'آخر تحديث' }
    : { change24h: '24h change', volume24h: '24h volume', timeframe: 'Timeframe', currentPrice: 'Current price', day: 'Today UTC', week: 'Week', month: 'Month', year: 'Year', all: 'Since listing', updated: 'Last updated' };
  content.innerHTML = `<div class="top"><span>${s.symbol.replace('USDT', '/USDT')}</span><b id="live-price"><bdi>${formatPrice(s.currentPrice)}</bdi></b>
    <span class="change ${change >= 0 ? 'up' : 'down'}">${formatPercent(change)}</span></div>
    <div class="grid technical-grid"><label>${labels.change24h} <b class="${change >= 0 ? 'up' : 'down'}">${formatPercent(change)}</b></label><label>${labels.volume24h} <b><bdi>${formatVolume(s.volume24h)}</bdi></b></label><label>${labels.timeframe} <b>${escapeHtml(a.analysisTimeframe || '—')}</b></label><label>${labels.currentPrice} <b id="technical-live-price"><bdi>${formatPrice(s.currentPrice)}</bdi></b></label><label>EMA20 <b><bdi>${formatPrice(a.ema20)}</bdi></b></label><label>EMA50 <b><bdi>${formatPrice(a.ema50)}</bdi></b></label></div>
    ${range(labels.day, s.dayLow, s.dayHigh, distanceLow(s.currentPrice, s.dayLow), distanceHigh(s.currentPrice, s.dayHigh), s.currentPrice, language, 'day')}
    ${range(labels.week, s.weekLow, s.weekHigh, s.distanceFromWeekLowPercent, s.distanceFromWeekHighPercent, s.currentPrice, language)}
    ${range(labels.month, s.monthLow, s.monthHigh, s.distanceFromMonthLowPercent, s.distanceFromMonthHighPercent, s.currentPrice, language)}
    ${range(labels.year, s.yearLow, s.yearHigh, s.distanceFromYearLowPercent, s.distanceFromYearHighPercent, s.currentPrice, language)}
    ${range(labels.all, s.allTimeLow, s.allTimeHigh, distanceLow(s.currentPrice, s.allTimeLow), distanceHigh(s.currentPrice, s.allTimeHigh), s.currentPrice, language)}
    <small>${labels.updated}: ${formatUpdated(s.lastUpdatedUtc, language)}</small>
    <details><summary>${language === 'ar' ? 'ماذا وجد فحص الأخبار؟' : 'What did the news scan find?'}</summary><p>${newsSentimentLabel(state.news?.score ?? 0, language)} (${state.news?.score ?? 0})</p>${newsList(state, language)}</details>`;
}

function range(label: string, low: number, high: number, lowDistance: number, highDistance: number, price: number, language: Language, key?: string) {
  const lowId = key ? ` id="${key}-low"` : '';
  const highId = key ? ` id="${key}-high"` : '';
  const markerId = key ? ` id="${key}-marker"` : '';
  const lowLabel = language === 'ar' ? 'أقل' : 'Low', highLabel = language === 'ar' ? 'أعلى' : 'High';
  const priceId = key ? ` id="${key}-price-label"` : '';
  const bar = `<div class="range-bar" title="${lowLabel} ${formatPrice(low)} · ${highLabel} ${formatPrice(high)}"><i class="range-marker"${markerId} style="inset-inline-start:${markerPosition(price, low, high)}%"></i></div>`;
  return `<div class="range"><b>${label}</b><div class="range-scale"><span>${lowLabel}: <bdi${lowId}>${formatPrice(low)} (${lowDistance.toFixed(1)}%)</bdi></span><span class="range-price"><bdi${priceId}>${formatPrice(price)}</bdi></span><span>${highLabel}: <bdi${highId}>${formatPrice(high)} (${highDistance.toFixed(1)}%)</bdi></span></div>${bar}</div>`;
}
function markerPosition(price: number, low: number, high: number) {
  if (!(high > low)) return 50;
  return Math.max(0, Math.min(100, (price - low) / (high - low) * 100));
}
function setLoading(root: ShadowRoot) { (root.querySelector('#loading') as HTMLElement).hidden = false; }
function formatPrice(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0); }
function distanceLow(price: number, low: number) { return low > 0 ? (price - low) / low * 100 : 0; }
function distanceHigh(price: number, high: number) { return high > 0 ? (high - price) / high * 100 : 0; }
function updateLiveDay(root: ShadowRoot, snapshot: SymbolState['snapshot']) {
  const price = root.querySelector('#live-price'); if (price) price.innerHTML = `<bdi>${formatPrice(snapshot.currentPrice)}</bdi>`;
  const technicalPrice = root.querySelector('#technical-live-price'); if (technicalPrice) technicalPrice.innerHTML = `<bdi>${formatPrice(snapshot.currentPrice)}</bdi>`;
  const priceLabel = root.querySelector('#day-price-label'); if (priceLabel) priceLabel.textContent = formatPrice(snapshot.currentPrice);
  const low = root.querySelector('#day-low'); if (low) low.textContent = `${formatPrice(snapshot.dayLow)} (${distanceLow(snapshot.currentPrice, snapshot.dayLow).toFixed(1)}%)`;
  const high = root.querySelector('#day-high'); if (high) high.textContent = `${formatPrice(snapshot.dayHigh)} (${distanceHigh(snapshot.currentPrice, snapshot.dayHigh).toFixed(1)}%)`;
  const marker = root.querySelector('#day-marker') as HTMLElement | null;
  if (marker) marker.style.insetInlineStart = `${markerPosition(snapshot.currentPrice, snapshot.dayLow, snapshot.dayHigh)}%`;
}
function formatUpdated(value: string, language: Language) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'medium' }).format(date); }
function formatPercent(value: number) { const v = Number(value) || 0; return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function formatVolume(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value) || 0); }
function escapeHtml(value: string) { const element = document.createElement('span'); element.textContent = value; return element.innerHTML; }
function newsList(state: SymbolState, language: Language) {
  const items = state.news?.items ?? [];
  if (!items.length) return `<p>${language === 'ar' ? 'لم يجد مزود RSS أخبارًا حديثة مطابقة.' : 'No recent matching RSS headlines were found.'}</p>`;
  return `<ul>${items.slice(0, 5).map(item => `<li>${escapeHtml(item.title)} <small>${escapeHtml(item.source)} · ${newsCategoryLabel(item.category, language)} · ${newsSentimentLabel(item.sentiment, language)}</small></li>`).join('')}</ul>`;
}

function makeDraggable(handle: HTMLElement, panel: HTMLElement) {
  let startX = 0, startY = 0, left = 0, top = 0;
  handle.addEventListener('pointerdown', event => {
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;
    startX = event.clientX; startY = event.clientY; const rect = panel.getBoundingClientRect(); left = rect.left; top = rect.top;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    panel.style.left = `${Math.max(0, left + event.clientX - startX)}px`;
    panel.style.top = `${Math.max(0, top + event.clientY - startY)}px`; panel.style.right = 'auto';
  });
}

function watchOrderStatus(root: ShadowRoot, currentSymbol: SymbolCode, language: Language) {
  let previous: string | undefined;
  const notifiedFilled = new Set<string>();
  document.querySelectorAll('div,span,tr').forEach(element => {
    const value = element.textContent?.trim() ?? '';
    if (/\bFilled\b/i.test(value) && value.length < 300) notifiedFilled.add(value);
  });
  const scan = () => {
    const candidates = [...document.querySelectorAll('div,span')].filter(x => /Open Orders/i.test(x.textContent ?? '') && (x.textContent?.length ?? 0) < 80);
    const value = candidates[0]?.textContent?.match(/Open Orders\s*\(?([0-9]+)\)?/i)?.[1];
    if (value !== undefined && previous !== undefined && value !== previous) {
      const note = root.querySelector('.order-note') as HTMLElement;
      note.textContent = language === 'ar' ? 'قد يكون هناك تغيير في الأوامر. راجع Binance للتأكد.' : 'The open-order count may have changed. Check Binance to confirm.'; note.classList.add('warning');
    }
    if (value !== undefined) previous = value;
  };
  new MutationObserver(mutations => {
    scan();
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (value.length < 4 || value.length > 300 || !/\bFilled\b/i.test(value) || !/(BTC|ETH|USDT)/i.test(value) || notifiedFilled.has(value)) continue;
      notifiedFilled.add(value);
      void chrome.runtime.sendMessage({ type: 'ORDER_FILLED_VISIBLE', symbol: currentSymbol, details: value.slice(0, 180) });
      const note = root.querySelector('.order-note') as HTMLElement;
      note.textContent = language === 'ar' ? 'تعرض Binance الحالة Filled. راجع تفاصيل الطلب للتأكد.' : 'Binance visibly reports Filled. Review the order details to confirm.';
      note.classList.add('warning');
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true }); scan();
}

const styles = `:host{all:initial}.panel{position:fixed;z-index:2147483647;right:18px;top:90px;width:400px;max-height:calc(100vh - 110px);overflow:auto;background:#181a20;color:#eaecef;border:1px solid #474d57;border-radius:12px;box-shadow:0 8px 28px #0009;font:13px Arial,sans-serif}.panel header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#202630;cursor:move}.panel header button{font-size:20px}.panel main{padding:12px}.hidden{display:none}.top{display:flex;align-items:center;gap:10px;font-size:15px}.top b{font-size:20px}.change{margin-inline-start:auto;padding:4px 9px;border-radius:10px;font-weight:bold;background:#24272e}.up{color:#0ecb81}.down{color:#f6465d}.badge{margin-right:auto;padding:5px 8px;border-radius:12px;font-weight:bold}.MARKET_NOW{background:#0b6b3a}.LIMIT_ONLY{background:#766800}.WAIT{background:#474d57}.AVOID{background:#a12b2b}.TAKE_PROFIT_WATCH{background:#a64d16}.decision{background:#24272e;border-left:3px solid #f0b90b;padding:8px;border-radius:6px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0}.technical-grid{grid-template-columns:repeat(2,1fr)}.grid label,.range{background:#24272e;border-radius:7px;padding:8px}.grid label{display:flex;flex-direction:column;gap:4px}.score-breakdown{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:10px 0}.score-chip{display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:8px;padding:8px 10px;border:1px solid #ffffff1f}.score-chip small{margin:0;color:#eaecef}.score-chip.technical{background:#0b4f6c}.score-chip.news{background:#0f6848}.score-chip.macro{background:#6747a6}.score-chip.historical{background:#7a4d12}.score-chip.risk{background:#8a2634}.range{margin:6px 0}.range b{display:block;color:#f0b90b}.range-scale{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px}.range-price{text-align:center;color:#f0b90b;font-weight:bold;white-space:nowrap}.range-bar{position:relative;height:6px;margin-top:6px;border-radius:4px;background:#3a4150}.range-marker{position:absolute;top:50%;width:3px;height:13px;border-radius:2px;background:#f0b90b;transform:translate(-50%,-50%);box-shadow:0 0 0 2px #181a20}.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0}button{border:0;border-radius:6px;padding:7px;background:#f0b90b;color:#181a20;cursor:pointer;font-weight:bold}details{border-top:1px solid #363b44;padding:7px 0}summary{cursor:pointer;font-weight:bold}ul{margin:6px 0;padding-right:20px}li{margin:4px 0}p{line-height:1.5}.limit{color:#f0b90b}small{display:block;color:#aeb4be;line-height:1.5;margin-top:8px}.score-legend span{display:block;line-height:1.8}.warning{color:#f6465d}`;
