import * as signalR from '@microsoft/signalr';
import { getComparison, getSymbolState } from '../shared/api';
import { defaultSettings, normalizeAnalysisTimeframe, normalizeRefreshSeconds, signalLabels, type Settings, type Signal, type SymbolCode, type SymbolState } from '../shared/types';

const STATE_KEY = 'marketState';
const SETTINGS_KEY = 'settings';
const ANCHOR_KEY = 'priceMoveAnchors';
let hub: signalR.HubConnection | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const nestedRoot = import.meta.url.includes('/crypto-decision-assistant/extension/dist/');
const extensionPath = (path: string) => nestedRoot ? `crypto-decision-assistant/extension/dist/${path}` : path;
const assetPath = (name: string) => extensionPath(`assets/${name}`);
let creatingOffscreenDocument: Promise<void> | undefined;

async function settings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as (Partial<Settings> & { refreshMinutes?: number }) | undefined;
  const refreshSeconds = stored?.refreshSeconds ?? (stored?.refreshMinutes ?? 0.25) * 60;
  const legacySoundSettings = stored?.settingsSchemaVersion !== defaultSettings.settingsSchemaVersion;
  const activePriceAlerts = (stored?.priceAlerts ?? defaultSettings.priceAlerts).filter(alert => !alert.triggered);
  const config = { ...defaultSettings, ...stored, settingsSchemaVersion: defaultSettings.settingsSchemaVersion,
    refreshSeconds: normalizeRefreshSeconds(refreshSeconds), heldSymbols: stored?.heldSymbols ?? [],
    analysisTimeframe: normalizeAnalysisTimeframe(stored?.analysisTimeframe),
    soundOnlyForStrongSignals: legacySoundSettings ? false : stored?.soundOnlyForStrongSignals ?? false,
    priceMoveAlertPercent: Math.max(0, Number(stored?.priceMoveAlertPercent) || 0),
    priceAlerts: activePriceAlerts };
  if ((stored?.priceAlerts?.length ?? 0) !== activePriceAlerts.length)
    await chrome.storage.local.set({ [SETTINGS_KEY]: config });
  return config;
}

function scheduleRefresh(config: Settings) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshAll();
    scheduleRefresh(await settings());
  }, config.refreshSeconds * 1000);
  chrome.alarms.create('refresh-market', { periodInMinutes: Math.max(0.5, config.refreshSeconds / 60) });
}

async function notify(id: string, title: string, message: string, strong: boolean, sound = false) {
  const config = await settings();
  const notificationId = await chrome.notifications.create(id, {
    type: 'basic', iconUrl: chrome.runtime.getURL(assetPath('icon.png')), title, message, priority: strong ? 2 : 0
  });
  // Sound is best-effort: a failed offscreen playback must never break alert
  // handling (e.g. removing a triggered price alert) or the refresh chain.
  if (sound && config.soundEnabled && (!config.soundOnlyForStrongSignals || strong))
    await playNotificationSound().catch(error => console.warn('Notification sound failed.', error));
  return notificationId;
}

async function playNotificationSound() {
  const offscreenUrl = chrome.runtime.getURL(extensionPath('offscreen.html'));
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [offscreenUrl]
  });
  if (!existing.length) {
    creatingOffscreenDocument ??= chrome.offscreen.createDocument({
      url: extensionPath('offscreen.html'),
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Play enabled notification sounds.'
    }).finally(() => { creatingOffscreenDocument = undefined; });
    await creatingOffscreenDocument;
  }
  const response = await chrome.runtime.sendMessage({
    type: 'PLAY_NOTIFICATION_SOUND', soundUrl: chrome.runtime.getURL(assetPath('alert.wav'))
  });
  if (!response?.ok) throw new Error(response?.error ?? 'Notification sound could not be played.');
}

function effectiveThreshold(config: Settings) {
  return Math.max(0, Math.min(100, config.notificationConfidence +
    (config.riskMode === 'Conservative' ? 10 : config.riskMode === 'Aggressive' ? -10 : 0)));
}

async function safely(run: () => Promise<unknown>) {
  try { await run(); } catch (error) { console.warn('Notification step failed.', error); }
}

async function refreshAll() {
  const config = await settings();
  const previous = ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] ?? {}) as Partial<Record<SymbolCode, SymbolState>>;
  const anchors = ((await chrome.storage.local.get(ANCHOR_KEY))[ANCHOR_KEY] ?? {}) as Partial<Record<SymbolCode, number>>;
  const next = { ...previous };
  const nextAnchors: Partial<Record<SymbolCode, number>> = { ...anchors };
  await Promise.all(config.symbols.map(async symbol => {
    try {
      const state = await getSymbolState(config.apiBaseUrl, symbol, config.heldSymbols.includes(symbol), config.analysisTimeframe);
      next[symbol] = state;
      // Each notification runs in isolation: a failure in one (e.g. a signal or
      // range notification) must never skip the user's custom price alerts.
      const oldSignal = previous[symbol]?.analysis.signal;
      if (oldSignal && oldSignal !== state.analysis.signal)
        await safely(() => signalNotification(symbol, oldSignal, state.analysis.signal, state.analysis.decisionScore, config));
      await safely(() => rangeNotifications(state, previous[symbol], config));
      await safely(() => priceMoveNotification(state, config, anchors[symbol], value => { nextAnchors[symbol] = value; }));
      await safely(() => customPriceAlerts(state, config));
    } catch (error) {
      console.warn(`Refresh failed for ${symbol}`, error);
    }
  }));
  await chrome.storage.local.set({ [STATE_KEY]: next, [ANCHOR_KEY]: nextAnchors });
  await broadcast({ type: 'STATE_UPDATE', state: next });
  // Also reach the popup (broadcast only targets Binance tabs); ignored if closed.
  await chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: next }).catch(() => undefined);
}

async function signalNotification(symbol: SymbolCode, oldSignal: Signal, current: Signal, confidence: number, config: Settings) {
  const strong = confidence >= effectiveThreshold(config) || current === 'AVOID' || current === 'TAKE_PROFIT_WATCH';
  await notify(`signal-${symbol}`, config.language === 'ar' ? `${symbol}: تغيرت الإشارة` : `${symbol}: Signal changed`,
    `${signalLabels[config.language][current]} — ${config.language === 'ar' ? 'درجة القرار' : 'decision score'} ${confidence}/100`, strong);
}

async function rangeNotifications(current: SymbolState, previous: SymbolState | undefined, config: Settings) {
  if (current.analysis.decisionScore < effectiveThreshold(config)) return;
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

async function priceMoveNotification(state: SymbolState, config: Settings, anchor: number | undefined, setAnchor: (value: number) => void) {
  const price = state.snapshot.currentPrice;
  if (!(price > 0)) return;
  const threshold = config.priceMoveAlertPercent;
  if (!(threshold > 0) || anchor === undefined || !(anchor > 0)) { setAnchor(price); return; }
  const movePercent = (price - anchor) / anchor * 100;
  if (Math.abs(movePercent) < threshold) return;
  const up = movePercent >= 0;
  const symbol = state.snapshot.symbol;
  const priceText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  await notify(`move-${symbol}-${Date.now()}`,
    config.language === 'ar' ? `${symbol}: تحرك السعر` : `${symbol}: Price move`,
    config.language === 'ar'
      ? `${up ? 'ارتفع' : 'انخفض'} السعر ${Math.abs(movePercent).toFixed(2)}% إلى ${priceText}.`
      : `Price ${up ? 'rose' : 'fell'} ${Math.abs(movePercent).toFixed(2)}% to ${priceText}.`,
    true, true);
  setAnchor(price);
}

async function customPriceAlerts(state: SymbolState, config: Settings) {
  let changed = false;
  for (const alert of config.priceAlerts.filter(x => x.symbol === state.snapshot.symbol && !x.triggered)) {
    const price = state.snapshot.currentPrice;
    const hit = alert.condition === 'above' ? price >= alert.price : price <= alert.price;
    if (!hit) continue;
    const currentPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(state.snapshot.currentPrice);
    await notify(`price-${alert.id}`, config.language === 'ar' ? `${alert.symbol}: وصل السعر` : `${alert.symbol}: Price alert`, config.language === 'ar' ? `السعر ${currentPrice} حقق التنبيه.` : `Price ${currentPrice} reached your configured level.`, true, true);
    config.priceAlerts = config.priceAlerts.filter(x => x.id !== alert.id);
    changed = true;
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
    notify(`backend-alert-${alert.symbol}`, `${alert.symbol}: تنبيه سعر`, `وصل السعر إلى ${alert.price}.`, true, true));
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
// Await inside the alarm listener so the MV3 service worker stays alive until
// the refresh (and any notification it fires) completes; a bare `void` lets
// Chrome suspend the worker mid-fetch, which silently drops price alerts.
chrome.alarms.onAlarm.addListener(async alarm => { if (alarm.name === 'refresh-market') await refreshAll(); });
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
    settings().then(x => getComparison(x.apiBaseUrl, x.analysisTimeframe)).then(sendResponse).catch(error => sendResponse({ error: String(error) })); return true;
  }
  if (message.type === 'ORDER_FILLED_VISIBLE') {
    settings().then(config => notify(`filled-${message.symbol}-${Date.now()}`,
      config.language === 'ar' ? `${message.symbol}: حالة Filled ظاهرة` : `${message.symbol}: Filled status visible`,
      config.language === 'ar' ? 'تعرض Binance أن الطلب Filled. راجع تفاصيل الطلب للتأكد.' : 'Binance visibly reports the order as Filled. Review the order details to confirm.', true, true))
      .then(() => sendResponse({ ok: true })); return true;
  }
  if (message.type === 'TEST_NOTIFICATION') {
    settings().then(config => notify(`test-${Date.now()}`,
      config.language === 'ar' ? 'اختبار الإشعارات' : 'Notification test',
      config.language === 'ar' ? 'تم اختبار الإشعار والصوت.' : 'Notification and sound test completed.', true, true))
      .then(notificationId => sendResponse({ ok: true, notificationId }))
      .catch(error => sendResponse({ ok: false, error: String(error) })); return true;
  }
  return false;
});

void connectHub();
void settings().then(scheduleRefresh);
