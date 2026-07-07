# Crypto Decision Assistant

English-first, Arabic-capable decision support for beginners who view BTC/USDT and ETH/USDT on Binance Spot. It combines public Binance market data, configurable RSS headlines, technical indicators, and simple scoring to explain whether conditions currently favor `MARKET_NOW`, `LIMIT_ONLY`, `WAIT`, `AVOID`, or `TAKE_PROFIT_WATCH`.

> This is educational software, not financial advice. It does not guarantee profit, place orders, click Binance controls, collect account data, or request Binance API keys. The final decision remains the user's responsibility.

## Structure

```text
crypto-decision-assistant/
├── backend/
│   ├── CryptoDecisionAssistant.Api/     ASP.NET Core API, SignalR, EF Core/SQLite
│   └── CryptoDecisionAssistant.Tests/   calculation and scoring tests
└── extension/                           Chrome Manifest V3, TypeScript, Vite
```

## Run the backend

Requirements: .NET 10 SDK.

```powershell
cd crypto-decision-assistant/backend/CryptoDecisionAssistant.Api
dotnet run
```

The development profile listens at `http://localhost:5187`. On first start, EF Core creates the local SQLite database used for persisted price alerts. The data access layer is isolated behind `AppDbContext`, so a later SQL Server provider can replace SQLite without changing business services.

Available API routes:

- `GET /api/market/snapshot?symbol=BTCUSDT`
- `GET /api/analysis/signal?symbol=BTCUSDT`
- `GET /api/analysis/signal?symbol=BTCUSDT&holdsAsset=true` enables the optional take-profit watch check
- `GET /api/analysis/compare`
- `GET /api/news/sentiment?symbol=BTCUSDT`
- `GET|POST|DELETE /api/alerts`
- SignalR hub: `/hubs/market`

Only `BTCUSDT` and `ETHUSDT` are accepted. The live worker consumes Binance's public combined ticker stream and publishes `priceUpdate`, `signalChanged`, and `alertTriggered` events. REST requests use the public Binance klines and 24-hour ticker APIs.

## Configure news RSS providers

Edit `backend/CryptoDecisionAssistant.Api/appsettings.json`:

```json
"News": {
  "Providers": [
    { "Name": "My RSS source", "Url": "https://example.com/feed.xml", "Enabled": true }
  ]
}
```

Provider URLs are configuration only; no feed is hardcoded in business logic. `INewsProvider` keeps retrieval replaceable, while the MVP sentiment service scores relevant headlines with keyword heuristics. A failed feed is skipped and does not fabricate news or analysis.

The default verified feeds are Federal Reserve press releases, SEC press releases, CoinDesk, The Block, TradingView, Ethereum Foundation, and Glassnode Insights. Headlines are categorized and ranked in this order of market impact: US macro/rates/inflation/jobs, ETF flows, hacks/security, regulation, Binance operations, Ethereum upgrades, then general crypto. Reuters, Binance Announcements, and CoinGecko/CoinMarketCap remain disabled configuration slots because no stable public RSS endpoint was verified; add a licensed or official URL when available.

The popup and Binance overlay show the latest matching RSS headlines under **What did the news scan find?** RSS results are cached for five minutes so a seconds-based market refresh does not repeatedly hit news providers.

## Build and load the extension

Requirements: Node.js and npm.

```powershell
cd crypto-decision-assistant/extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this exact generated directory:

```text
D:\downloadsFromEdge\kareem_binannce\crypto-decision-assistant\extension\dist
```

Do not select the repository root or the unbuilt `extension` source directory. Chrome needs the generated `dist/manifest.json` and bundled scripts.

Start the backend before opening the popup. If its URL changes, update **عنوان الخادم** on the extension settings page and rebuild the manifest host permissions if the origin itself changes.

The overlay is injected only on:

- `https://www.binance.com/en/trade/BTC_USDT*`
- `https://www.binance.com/en/trade/ETH_USDT*`

It is draggable, collapsible, dark-mode compatible, and deliberately does not interact with Binance order controls. Preferences, notification thresholds, and custom alerts live in `chrome.storage.local`.

English is the default interface language. Use the **العربية** button in the popup or the Language setting to switch the popup, overlay, settings, and notifications to Arabic.

The refresh setting is in seconds (5–300). An active Binance tab requests analysis at that interval; SignalR uses long polling for service-worker reliability and polling remains a fallback. Mark BTC or ETH under **Assets I currently hold** to enable the conditional take-profit/sell-watch signal.

Each card includes today's UTC low/high, 7-day, 30-day, 365-day, and complete Binance listing-history low/high. Complete history is loaded through paged public daily candles and cached for 12 hours. Today's candle is cached for only two seconds, while SignalR price updates immediately extend the displayed daily high or low whenever the live price breaks either boundary.

The displayed percentage is a decision score, not a probability of profit: 75–100 permits a possible-buy setup only after risk gates pass, 60–74 means limit-only and no market buy, 45–59 means wait, and below 45 means avoid. The risk label represents entry risk rather than volatility alone: an avoid score is high risk, a wait score is at least medium risk, and ATR volatility can raise either classification. The app explains the contributing technical, range, volume, volatility, and RSS-news factors.

## Alerts and order-status limitation

The background worker combines SignalR updates with periodic polling. Chrome notifications cover signal changes, configured price levels, and proximity to weekly/monthly/yearly extremes. Use **Test notification + sound** in Settings to verify browser notification delivery; sound is played through an open Binance trade tab.

The Binance page watcher reports a generic warning when the visible **Open Orders** count changes. It sends an execution notification with sound only when a newly rendered Binance order row visibly contains `Filled` and the relevant symbol. DOM-based detection remains best-effort; reliable execution notifications require Binance's native notifications or authenticated private account APIs, which are intentionally excluded from this MVP for safety.

## Validation

```powershell
dotnet test CryptoDecisionAssistant.slnx --configuration Release
cd extension
npm run typecheck
npm run build
```

Tests cover RSI, EMA, high/low distance, signal mapping, take-profit mapping, BTC/ETH comparison, and news keyword sentiment.
