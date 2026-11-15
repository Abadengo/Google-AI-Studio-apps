import type { CurrencyCode, ExchangeRates } from '../types/finance';

/*
 * Live exchange rates fetched directly from the browser (no server, no API key).
 * Sources (both free, keyless and CORS-enabled), tried in order:
 *   1. ExchangeRate-API open access  – https://open.er-api.com/v6/latest/USD   (updated daily)
 *   2. fawazahmed0/exchange-api      – jsDelivr CDN, with its Cloudflare mirror as a last resort
 * If every source fails, the caller keeps the current rates: the app never breaks.
 */

const CODES: CurrencyCode[] = ['AUD', 'USD', 'EUR', 'ARS', 'MXN', 'CLP'];
const TIMEOUT_MS = 8000;

/** "How many units of X does 1 USD buy" → the app's convention: "value of 1 unit of X in AUD". */
export function usdQuotesToAudRates(usdTo: Partial<Record<CurrencyCode, number>>): ExchangeRates | null {
  const aud = Number(usdTo.AUD);
  if (!Number.isFinite(aud) || aud <= 0) return null;
  const out = { AUD: 1 } as ExchangeRates;
  for (const code of CODES) {
    if (code === 'AUD') continue;
    const perUsd = code === 'USD' ? 1 : Number(usdTo[code]);
    if (!Number.isFinite(perUsd) || perUsd <= 0) return null;
    out[code] = aud / perUsd;
  }
  // Sanity check against absurd data (1 USD between 0.5 and 5 AUD).
  if (out.USD < 0.5 || out.USD > 5) return null;
  return out;
}

export function parseErApi(json: unknown): ExchangeRates | null {
  const j = json as { result?: string; rates?: Record<string, number> };
  if (!j || j.result !== 'success' || !j.rates) return null;
  return usdQuotesToAudRates(j.rates as Partial<Record<CurrencyCode, number>>);
}

export function parseFawazApi(json: unknown): ExchangeRates | null {
  const j = json as { usd?: Record<string, number> };
  if (!j || !j.usd) return null;
  const upper: Partial<Record<CurrencyCode, number>> = {};
  for (const code of CODES) upper[code] = j.usd[code.toLowerCase()];
  return usdQuotesToAudRates(upper);
}

const SOURCES: Array<{ name: string; url: string; parse: (json: unknown) => ExchangeRates | null }> = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', parse: parseErApi },
  {
    name: 'cdn.jsdelivr.net (exchange-api)',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    parse: parseFawazApi,
  },
  {
    name: 'currency-api.pages.dev',
    url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
    parse: parseFawazApi,
  },
];

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Returns fresh rates (value of 1 unit in AUD) and the source used. Throws only if every source failed. */
export async function fetchLiveExchangeRates(): Promise<{ rates: ExchangeRates; source: string }> {
  const errors: string[] = [];
  for (const source of SOURCES) {
    try {
      const rates = source.parse(await fetchJson(source.url));
      if (rates) return { rates, source: source.name };
      errors.push(`${source.name}: datos incompletos`);
    } catch (err) {
      errors.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Ninguna fuente respondió (${errors.join('; ')})`);
}
