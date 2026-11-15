// Shared market-data helpers (used by server.ts and the browser UI).
// Quotes come from Yahoo Finance's public chart endpoint, proxied through /api/market/*.

export interface MarketQuote {
  symbol: string;
  ok: boolean;
  error?: string;
  price: number;
  currency: string;
  name: string;
  /** Sum of dividends paid in the last 12 months divided by current price, in %. */
  dividendYieldPct: number;
  /** Compound annual growth rate of the price over the available history (up to 10y), in %. */
  historicalCagrPct: number | null;
  historyYears: number;
}

export interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        currency?: string;
        longName?: string;
        shortName?: string;
        symbol?: string;
      };
      timestamp?: number[];
      indicators?: { adjclose?: Array<{ adjclose?: Array<number | null> }>; quote?: Array<{ close?: Array<number | null> }> };
      events?: { dividends?: Record<string, { amount: number; date: number }> };
    }>;
    error?: { description?: string } | null;
  };
}

export function parseYahooChart(symbol: string, json: YahooChartResponse): MarketQuote {
  const result = json.chart?.result?.[0];
  const meta = result?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!result || !meta || !Number.isFinite(price) || price <= 0) {
    return {
      symbol,
      ok: false,
      error: json.chart?.error?.description || 'Symbol not found',
      price: 0,
      currency: '',
      name: symbol,
      dividendYieldPct: 0,
      historicalCagrPct: null,
      historyYears: 0,
    };
  }

  const nowSec = Date.now() / 1000;
  const oneYearAgo = nowSec - 365 * 24 * 3600;
  const divs = Object.values(result.events?.dividends || {});
  const lastYearDivs = divs.filter((d) => d.date >= oneYearAgo).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const dividendYieldPct = price > 0 ? (lastYearDivs / price) * 100 : 0;

  // Prefer adjusted closes (they include splits); fall back to raw closes.
  const timestamps = result.timestamp || [];
  const closes =
    result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  let firstIdx = -1;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    if (typeof v === 'number' && v > 0) {
      firstIdx = i;
      break;
    }
  }
  let lastIdx = -1;
  for (let i = closes.length - 1; i >= 0; i--) {
    const v = closes[i];
    if (typeof v === 'number' && v > 0) {
      lastIdx = i;
      break;
    }
  }
  let historicalCagrPct: number | null = null;
  let historyYears = 0;
  if (firstIdx >= 0 && lastIdx > firstIdx && timestamps[firstIdx] && timestamps[lastIdx]) {
    historyYears = (timestamps[lastIdx] - timestamps[firstIdx]) / (365.25 * 24 * 3600);
    const first = closes[firstIdx] as number;
    const last = closes[lastIdx] as number;
    if (historyYears >= 1) {
      // Adjusted closes already include reinvested dividends, so remove the yield to get price-only growth.
      const totalCagr = (Math.pow(last / first, 1 / historyYears) - 1) * 100;
      const usesAdjusted = Boolean(result.indicators?.adjclose?.[0]?.adjclose);
      historicalCagrPct = usesAdjusted ? totalCagr - dividendYieldPct : totalCagr;
    }
  }

  return {
    symbol,
    ok: true,
    price,
    currency: String(meta.currency || '').toUpperCase(),
    name: meta.longName || meta.shortName || symbol,
    dividendYieldPct: Number(dividendYieldPct.toFixed(3)),
    historicalCagrPct: historicalCagrPct === null ? null : Number(historicalCagrPct.toFixed(2)),
    historyYears: Number(historyYears.toFixed(1)),
  };
}


export interface MarketQuotesResponse {
  quotes: MarketQuote[];
  fetchedAt: string;
}

/**
 * Yahoo symbol for a holding. ASX listings (AUD holdings without an exchange suffix) need ".AX".
 */
export function toYahooSymbol(ticker: string, currency: string): string {
  const t = ticker.trim().toUpperCase();
  if (t.includes('.') || t.includes('=') || t.includes('^')) return t;
  if (currency === 'AUD') return `${t}.AX`;
  return t;
}

export async function fetchMarketQuotes(symbols: string[]): Promise<MarketQuotesResponse> {
  const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
  const payload = (await res.json().catch(() => ({}))) as Partial<MarketQuotesResponse> & { error?: string };
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`);
  return { quotes: payload.quotes || [], fetchedAt: payload.fetchedAt || new Date().toISOString() };
}

export async function fetchLiveExchangeRates(): Promise<Record<string, number>> {
  const res = await fetch('/api/market/fx');
  const payload = (await res.json().catch(() => ({}))) as { rates?: Record<string, number>; error?: string };
  if (!res.ok || !payload.rates) throw new Error(payload.error || `Error ${res.status}`);
  return payload.rates;
}
