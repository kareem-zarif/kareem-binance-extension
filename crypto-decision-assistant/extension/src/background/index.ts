import * as signalR from '@microsoft/signalr';
import { getComparison, getSymbolState } from '../shared/api';
import { defaultSettings, signalLabels, type Settings, type Signal, type SymbolCode, type SymbolState } from '../shared/types';

const STATE_KEY = 'marketState';
const SETTINGS_KEY = 'settings';
let hub: signalR.HubConnection | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const nestedRoot = import.meta.url.includes('/crypto-decision-assistant/extension/dist/');
const assetPath = (name: string) => nestedRoot ? `crypto-decision-assistant/extension/dist/assets/${name}` : `assets/${name}`;

async function settings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as (Partial<Settings> & { refreshMinutes?: number }) | undefined;
  const refreshSeconds = stored?.refreshSeconds ?? Math.max(5, (stored?.refreshMinutes ?? 0.25) * 60);
  return { ...defaultSettings, ...stored, refreshSeconds: Math.max(5, Math.min(300, refreshSeconds)), heldSymbols: stored?.heldSymbols ?? [] };
}

function scheduleRefresh(config: Settings) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshAll();
    scheduleRefresh(await settings());
  }, config.refreshSeconds * 1000);
  chrome.alarms.create('refresh-market', { periodInMinutes: Math.max(0.5, config.refreshSeconds / 60) });
}

async function notify(id: string, title: string, message: string, strong: boolean) {
  const config = await settings();
  const notificationId = await chrome.notifications.create(id, {
    type: 'basic', iconUrl: assetPath('icon.png'), title, message, priority: strong ? 2 : 0
  });
  if (config.soundEnabled && (!config.soundOnlyForStrongSignals || strong)) {
    const tabs = await chrome.tabs.query({ url: 'https://www.binance.com/en/trade/*' });
    const soundUrl = chrome.runtime.getURL(assetPath('alert.wav'));
    await Promise.allSettled(tabs.map(tab => tab.id ? chrome.tabs.sendMessage(tab.id, { type: 'PLAY_SOUND', soundUrl }) : Promise.resolve()));
  }
  return notificationId;
}

function effectiveThreshold(config: Settings) {
  return Math.max(0, Math.min(100, config.notificationConfidence +
    (config.riskMode === 'Conservative' ? 10 : config.riskMode === 'Aggressive' ? -10 : 0)));
}

async function refreshAll() {
  const config = await settings();
  const previous = ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] ?? {}) as Partial<Record<SymbolCode, SymbolState>>;
  const next = { ...previous };
  await Promise.all(config.symbols.map(async symbol => {
    try {
      const state = await getSymbolState(config.apiBaseUrl, symbol, config.heldSymbols.includes(symbol));
      next[symbol] = state;
      const oldSignal = previous[symbol]?.analysis.signal;
      if (oldSignal && oldSignal !== state.analysis.signal) await signalNotification(symbol, oldSignal, state.analysis.signal, state.analysis.confidence, config);
      await rangeNotifications(state, previous[symbol], config);
      await customPriceAlerts(state, config);
    } catch (error) {
      console.warn(`Refresh failed for ${symbol}`, error);
    }
  }));
  await chrome.storage.local.set({ [STATE_KEY]: next });
  await broadcast({ type: 'STATE_UPDATE', state: next });
}

async function signalNotification(symbol: SymbolCode, oldSignal: Signal, current: Signal, confidence: number, config: Settings) {
  const strong = confidence >= effectiveThreshold(config) || current === 'AVOID' || current === 'TAKE_PROFIT_WATCH';
  await notify(`signal-${symbol}`, config.language === 'ar' ? `${symbol}: تغيرت الإشارة` : `${symbol}: Signal changed`,
    `${signalLabels[config.language][current]} — ${config.language === 'ar' ? 'درجة القرار' : 'decision score'} ${confidence}/100`, strong);
}

async function rangeNotifications(current: SymbolState, previous: SymbolState | undefined, config: Settings) {
  if (current.analysis.confidence < effectiveThreshold(config)) return;
  const ranges = [
    [config.language === 'ar' ? 'قاع الأسبوع' : 'weekly low', current.snapshot.distanceFromWeekLowPercent, previous?.snapshot.distanceFromWeekLowPercent],
    [config.language === 'ar' ? 'قمة الأسبوع' : 'weekly high', current.snapshot.distanceFromWeekHighPercent, previous?.snapshot.distanceFromWeekHighPercent],
    [config.language === 'ar' ? 'قاع الشهر' : 'monthly low', current.snapshot.distanceFromMonthLowPercent, previous?.snapshot.distanceFromMonthLowPercent],
    [config.language === 'ar' ? 'قمة الشهر' : 'monthly high', current.snapshot.distanceFromMonthHighPercent, previous?.snapshot.distanceFromMonthHighPercent],
    [config.language === 'ar' ? 'قاع السنة' : 'yearly low', current.snapshot.distanceFromYearLowPercent, previous?.snapshot.distanceFromYearLowPercent],
    [config.language === 'ar' ? 'قمة السنة' : 'yearly high', current.snapshot.distanceFromYearHighPercent, previous?.snapshot.distanceFromYearHighPercent]
  ] as const;
  for (const [label, distance, oldDistance] of ranges) {
    if (distance <= 1 && (oldDistance === undefined || oldDistance > 1))
      await notify(`range-${current.snapshot.symbol}-${label}`, current.snapshot.symbol, config.language === 'ar' ? `السعر أصبح قريبًا من ${label} (${distance.toFixed(2)}%).` : `Price is now close to the ${label} (${distance.toFixed(2)}%).`, false);
  }
}

async function customPriceAlerts(state: SymbolState, config: Settings) {
  let changed = false;
  for (const alert of config.priceAlerts.filter(x => x.symbol === state.snapshot.symbol && !x.triggered)) {
    const hit = alert.condition === 'above' ? state.snapshot.currentPrice >= alert.price : state.snapshot.currentPrice <= alert.price;
    if (!hit) continue;
    alert.triggered = true; changed = true;
    const currentPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(state.snapshot.currentPrice);
    await notify(`price-${alert.id}`, config.language === 'ar' ? `${alert.symbol}: وصل السعر` : `${alert.symbol}: Price alert`, config.language === 'ar' ? `السعر ${currentPrice} حقق التنبيه.` : `Price ${currentPrice} reached your configured level.`, true);
  }
  if (changed) await chrome.storage.local.set({ [SETTINGS_KEY]: config });
}

async function broadcast(message: unknown) {
  const tabs = await chrome.tabs.query({ url: 'https://www.binance.com/en/trade/*' });
  await Promise.allSettled(tabs.map(tab => tab.id ? chrome.tabs.sendMessage(tab.id, message) : Promise.resolve()));
}

async function connectHub() {
  const config = await settings();
  if (hub) await hub.stop();
  hub = new signalR.HubConnectionBuilder().withUrl(`${config.apiBaseUrl}/hubs/market`, {
    transport: signalR.HttpTransportType.LongPolling
  }).withAutomaticReconnect().build();
  hub.on('priceUpdate', async ({ symbol, price }: { symbol: SymbolCode; price: number }) => {
    await broadcast({ type: 'LIVE_PRICE', symbol, price });
    await chrome.runtime.sendMessage({ type: 'LIVE_PRICE', symbol, price }).catch(() => undefined);
  });
  hub.on('signalChanged', refreshAll);
  hub.on('alertTriggered', (alert: { symbol: string; price: number }) =>
    notify(`backend-alert-${alert.symbol}`, `${alert.symbol}: تنبيه سعر`, `وصل السعر إلى ${alert.price}.`, true));
  try {
    await hub.start();
    for (const symbol of config.symbols) await hub.invoke('Subscribe', symbol);
  } catch (error) { console.warn('SignalR connection unavailable; polling remains active.', error); }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(SETTINGS_KEY);
  if (!existing[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: defaultSettings });
  scheduleRefresh(await settings());
  await refreshAll();
  await connectHub();
});
chrome.runtime.onStartup.addListener(() => { void refreshAll(); void connectHub(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'refresh-market') void refreshAll(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) {
    void settings().then(scheduleRefresh);
    void connectHub(); void refreshAll();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REFRESH') { refreshAll().then(() => sendResponse({ ok: true })); return true; }
  if (message.type === 'GET_STATE') {
    Promise.all([chrome.storage.local.get(STATE_KEY), settings()]).then(([stored, config]) =>
      sendResponse({ state: stored[STATE_KEY] ?? {}, settings: config })); return true;
  }
  if (message.type === 'COMPARE') {
    settings().then(x => getComparison(x.apiBaseUrl)).then(sendResponse).catch(error => sendResponse({ error: String(error) })); return true;
  }
  if (message.type === 'ORDER_FILLED_VISIBLE') {
    settings().then(config => notify(`filled-${message.symbol}-${Date.now()}`,
      config.language === 'ar' ? `${message.symbol}: حالة Filled ظاهرة` : `${message.symbol}: Filled status visible`,
      config.language === 'ar' ? 'تعرض Binance أن الطلب Filled. راجع تفاصيل الطلب للتأكد.' : 'Binance visibly reports the order as Filled. Review the order details to confirm.', true))
      .then(() => sendResponse({ ok: true })); return true;
  }
  if (message.type === 'TEST_NOTIFICATION') {
    settings().then(config => notify(`test-${Date.now()}`,
      config.language === 'ar' ? 'اختبار الإشعارات' : 'Notification test',
      config.language === 'ar' ? 'الإشعارات تعمل. يجب أن تسمع الصوت إذا كانت صفحة Binance مفتوحة.' : 'Notifications are working. Sound plays when a Binance trade tab is open.', true))
      .then(notificationId => sendResponse({ ok: true, notificationId }))
      .catch(error => sendResponse({ ok: false, error: String(error) })); return true;
  }
  return false;
});

void connectHub();
void settings().then(scheduleRefresh);
