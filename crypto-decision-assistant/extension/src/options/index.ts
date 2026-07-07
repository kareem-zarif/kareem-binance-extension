import './options.css';
import { defaultSettings, type PriceAlert, type Settings, type SymbolCode } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
let config: Settings;

async function load() {
  const stored = (await chrome.storage.local.get('settings')).settings as (Partial<Settings> & { refreshMinutes?: number }) | undefined;
  config = { ...defaultSettings, ...stored, refreshSeconds: stored?.refreshSeconds ?? Math.max(5, (stored?.refreshMinutes ?? 0.25) * 60), heldSymbols: stored?.heldSymbols ?? [] };
  $<HTMLSelectElement>('language').value = config.language;
  applyLanguage(config.language);
  $<HTMLInputElement>('apiBaseUrl').value = config.apiBaseUrl;
  $<HTMLInputElement>('btc').checked = config.symbols.includes('BTCUSDT');
  $<HTMLInputElement>('eth').checked = config.symbols.includes('ETHUSDT');
  $<HTMLInputElement>('holdBtc').checked = config.heldSymbols.includes('BTCUSDT');
  $<HTMLInputElement>('holdEth').checked = config.heldSymbols.includes('ETHUSDT');
  $<HTMLInputElement>('refreshSeconds').value = String(config.refreshSeconds);
  $<HTMLSelectElement>('riskMode').value = config.riskMode;
  $<HTMLInputElement>('soundEnabled').checked = config.soundEnabled;
  $<HTMLInputElement>('soundOnlyForStrongSignals').checked = config.soundOnlyForStrongSignals;
  $<HTMLInputElement>('notificationConfidence').value = String(config.notificationConfidence);
  renderAlerts();
}

$<HTMLSelectElement>('language').addEventListener('change', event => applyLanguage((event.target as HTMLSelectElement).value as Settings['language']));

$<HTMLButtonElement>('addAlert').addEventListener('click', () => {
  const price = Number($<HTMLInputElement>('alertPrice').value);
  if (!Number.isFinite(price) || price <= 0) return;
  config.priceAlerts.push({ id: crypto.randomUUID(), symbol: $<HTMLSelectElement>('alertSymbol').value as SymbolCode,
    condition: $<HTMLSelectElement>('alertCondition').value as PriceAlert['condition'], price });
  $<HTMLInputElement>('alertPrice').value = ''; renderAlerts();
});

$<HTMLButtonElement>('testNotification').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
  $('saved').textContent = result?.ok
    ? (config.language === 'ar' ? 'تم إرسال إشعار الاختبار.' : 'Test notification sent.')
    : (config.language === 'ar' ? `فشل الإشعار: ${result?.error ?? ''}` : `Notification failed: ${result?.error ?? ''}`);
});

$<HTMLFormElement>('form').addEventListener('submit', async event => {
  event.preventDefault();
  const symbols: SymbolCode[] = [];
  const heldSymbols: SymbolCode[] = [];
  if ($<HTMLInputElement>('btc').checked) symbols.push('BTCUSDT');
  if ($<HTMLInputElement>('eth').checked) symbols.push('ETHUSDT');
  if ($<HTMLInputElement>('holdBtc').checked) heldSymbols.push('BTCUSDT');
  if ($<HTMLInputElement>('holdEth').checked) heldSymbols.push('ETHUSDT');
  if (!symbols.length) { $('saved').textContent = config.language === 'ar' ? 'اختر عملة واحدة على الأقل.' : 'Select at least one symbol.'; return; }
  config = { ...config, apiBaseUrl: $<HTMLInputElement>('apiBaseUrl').value.replace(/\/$/, ''), symbols,
    refreshSeconds: Math.max(5, Math.min(300, Number($<HTMLInputElement>('refreshSeconds').value))), heldSymbols,
    riskMode: $<HTMLSelectElement>('riskMode').value as Settings['riskMode'],
    soundEnabled: $<HTMLInputElement>('soundEnabled').checked,
    soundOnlyForStrongSignals: $<HTMLInputElement>('soundOnlyForStrongSignals').checked,
    notificationConfidence: Number($<HTMLInputElement>('notificationConfidence').value),
    language: $<HTMLSelectElement>('language').value as Settings['language'] };
  await chrome.storage.local.set({ settings: config });
  $('saved').textContent = config.language === 'ar' ? 'تم الحفظ.' : 'Saved.'; setTimeout(() => $('saved').textContent = '', 1800);
});

function renderAlerts() {
  const host = $('alerts');
  host.innerHTML = config.priceAlerts.map(x => `<div data-id="${x.id}"><span>${x.symbol} ${x.condition === 'above' ? (config.language === 'ar' ? 'أعلى من' : 'above') : (config.language === 'ar' ? 'أقل من' : 'below')} ${formatPrice(x.price)}${x.triggered ? (config.language === 'ar' ? ' — تم التنبيه' : ' — triggered') : ''}</span><button type="button">${config.language === 'ar' ? 'حذف' : 'Delete'}</button></div>`).join('');
  host.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => {
    config.priceAlerts = config.priceAlerts.filter(x => x.id !== button.parentElement?.dataset.id); renderAlerts();
  }));
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
