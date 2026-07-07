import './options.css';
import { defaultSettings, normalizeAnalysisTimeframe, normalizeRefreshSeconds, type PriceAlert, type Settings, type SymbolCode } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
let config: Settings;
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  const stored = (await chrome.storage.local.get('settings')).settings as (Partial<Settings> & { refreshMinutes?: number }) | undefined;
  const legacySoundSettings = stored?.settingsSchemaVersion !== defaultSettings.settingsSchemaVersion;
  const activePriceAlerts = (stored?.priceAlerts ?? defaultSettings.priceAlerts).filter(alert => !alert.triggered);
  config = { ...defaultSettings, ...stored, settingsSchemaVersion: defaultSettings.settingsSchemaVersion,
    refreshSeconds: normalizeRefreshSeconds(stored?.refreshSeconds ?? (stored?.refreshMinutes ?? 0.25) * 60),
    heldSymbols: stored?.heldSymbols ?? [], analysisTimeframe: normalizeAnalysisTimeframe(stored?.analysisTimeframe),
    soundOnlyForStrongSignals: legacySoundSettings ? false : stored?.soundOnlyForStrongSignals ?? false,
    priceAlerts: activePriceAlerts };
  if ((stored?.priceAlerts?.length ?? 0) !== activePriceAlerts.length)
    await chrome.storage.local.set({ settings: config });
  $<HTMLSelectElement>('language').value = config.language;
  applyLanguage(config.language);
  $<HTMLInputElement>('apiBaseUrl').value = config.apiBaseUrl;
  $<HTMLInputElement>('btc').checked = config.symbols.includes('BTCUSDT');
  $<HTMLInputElement>('eth').checked = config.symbols.includes('ETHUSDT');
  $<HTMLInputElement>('holdBtc').checked = config.heldSymbols.includes('BTCUSDT');
  $<HTMLInputElement>('holdEth').checked = config.heldSymbols.includes('ETHUSDT');
  $<HTMLInputElement>('refreshSeconds').value = String(config.refreshSeconds);
  $<HTMLSelectElement>('analysisTimeframe').value = config.analysisTimeframe;
  $<HTMLSelectElement>('riskMode').value = config.riskMode;
  $<HTMLInputElement>('soundEnabled').checked = config.soundEnabled;
  $<HTMLInputElement>('soundOnlyForStrongSignals').checked = config.soundOnlyForStrongSignals;
  syncSoundTestButton();
  $<HTMLInputElement>('notificationConfidence').value = String(config.notificationConfidence);
  renderAlerts();
}

$<HTMLSelectElement>('language').addEventListener('change', event => {
  applyLanguage((event.target as HTMLSelectElement).value as Settings['language']);
  scheduleAutoSave();
});
$<HTMLInputElement>('soundEnabled').addEventListener('change', syncSoundTestButton);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue || !config) return;
  const updated = changes.settings.newValue as Settings;
  config.priceAlerts = (updated.priceAlerts ?? []).filter(alert => !alert.triggered);
  renderAlerts();
});

$<HTMLFormElement>('form').addEventListener('input', () => scheduleAutoSave());
$<HTMLFormElement>('form').addEventListener('change', () => scheduleAutoSave());

$<HTMLButtonElement>('addAlert').addEventListener('click', async () => {
  const price = Number($<HTMLInputElement>('alertPrice').value);
  if (!Number.isFinite(price) || price <= 0) return;
  config.priceAlerts.push({ id: crypto.randomUUID(), symbol: $<HTMLSelectElement>('alertSymbol').value as SymbolCode,
    condition: $<HTMLSelectElement>('alertCondition').value as PriceAlert['condition'], price });
  $<HTMLInputElement>('alertPrice').value = ''; renderAlerts();
  await saveSettings(config.language === 'ar' ? 'تم حفظ التنبيه تلقائيًا.' : 'Alert auto-saved.');
});

$<HTMLButtonElement>('testNotification').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
  $('saved').textContent = result?.ok
    ? (config.language === 'ar' ? 'تم إرسال إشعار الاختبار.' : 'Test notification sent.')
    : (config.language === 'ar' ? `فشل الإشعار: ${result?.error ?? ''}` : `Notification failed: ${result?.error ?? ''}`);
});

$<HTMLFormElement>('form').addEventListener('submit', async event => {
  event.preventDefault();
  await saveSettings(config.language === 'ar' ? 'تم الحفظ.' : 'Saved.');
});

function readFormSettings(): Settings | undefined {
  const symbols: SymbolCode[] = [];
  const heldSymbols: SymbolCode[] = [];
  if ($<HTMLInputElement>('btc').checked) symbols.push('BTCUSDT');
  if ($<HTMLInputElement>('eth').checked) symbols.push('ETHUSDT');
  if ($<HTMLInputElement>('holdBtc').checked) heldSymbols.push('BTCUSDT');
  if ($<HTMLInputElement>('holdEth').checked) heldSymbols.push('ETHUSDT');
  if (!symbols.length) {
    $('saved').textContent = config.language === 'ar' ? 'اختر عملة واحدة على الأقل.' : 'Select at least one symbol.';
    return undefined;
  }
  return { ...config, apiBaseUrl: $<HTMLInputElement>('apiBaseUrl').value.replace(/\/$/, ''), symbols,
    refreshSeconds: normalizeRefreshSeconds($<HTMLInputElement>('refreshSeconds').value), heldSymbols,
    analysisTimeframe: normalizeAnalysisTimeframe($<HTMLSelectElement>('analysisTimeframe').value),
    riskMode: $<HTMLSelectElement>('riskMode').value as Settings['riskMode'],
    soundEnabled: $<HTMLInputElement>('soundEnabled').checked,
    soundOnlyForStrongSignals: $<HTMLInputElement>('soundOnlyForStrongSignals').checked,
    notificationConfidence: Number($<HTMLInputElement>('notificationConfidence').value),
    language: $<HTMLSelectElement>('language').value as Settings['language'] };
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => void saveSettings(config.language === 'ar' ? 'تم الحفظ تلقائيًا.' : 'Auto-saved.'), 450);
}

async function saveSettings(message: string) {
  const next = readFormSettings();
  if (!next) return;
  config = next;
  await chrome.storage.local.set({ settings: config });
  $('saved').textContent = message; setTimeout(() => $('saved').textContent = '', 1800);
}

function renderAlerts() {
  const host = $('alerts');
  host.innerHTML = config.priceAlerts.map(x => `<div data-id="${x.id}"><span>${x.symbol} ${x.condition === 'above' ? (config.language === 'ar' ? 'أعلى من' : 'above') : (config.language === 'ar' ? 'أقل من' : 'below')} ${formatPrice(x.price)}</span><button type="button">${config.language === 'ar' ? 'حذف' : 'Delete'}</button></div>`).join('');
  host.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', async () => {
    config.priceAlerts = config.priceAlerts.filter(x => x.id !== button.parentElement?.dataset.id); renderAlerts();
    await saveSettings(config.language === 'ar' ? 'تم حذف التنبيه وحفظ الإعدادات.' : 'Alert deleted and settings saved.');
  }));
}

function syncSoundTestButton() {
  $<HTMLButtonElement>('testNotification').disabled = !$<HTMLInputElement>('soundEnabled').checked;
}

function applyLanguage(language: Settings['language']) {
  document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll<HTMLElement>('[data-en][data-ar]').forEach(element => {
    const input = element.querySelector('input,select');
    if (input && element.tagName === 'LABEL') {
      for (const node of [...element.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
      element.insertBefore(document.createTextNode(`${element.dataset[language]} `), input);
    } else element.textContent = element.dataset[language] ?? '';
  });
  const condition = $<HTMLSelectElement>('alertCondition');
  condition.options[0].text = language === 'ar' ? 'أعلى من' : 'Above'; condition.options[1].text = language === 'ar' ? 'أقل من' : 'Below';
  $<HTMLInputElement>('alertPrice').placeholder = language === 'ar' ? 'السعر' : 'Price';
  if (config) { config.language = language; renderAlerts(); }
}
function formatPrice(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }

void load();
