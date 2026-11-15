import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { CurrencyCode } from '../types/finance';
import {
  CURRENCY_META,
  getTodayISO,
  normalizeDateToISO,
  parseNumericAmount,
  type CsvPreset,
} from './formatters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfCell {
  text: string;
  x: number;
  rightX: number;
}

interface PdfVisualLine {
  page: number;
  y: number;
  cells: PdfCell[];
  fullText: string;
}

export interface ParsedPdfStatement {
  headers: string[];
  rows: string[][];
  detectedPreset: Exclude<CsvPreset, 'auto'>;
  detectedCurrency?: CurrencyCode;
  detectedClosingBalance?: { amount: number; currency: CurrencyCode };
  pageCount: number;
  extractedLineCount: number;
  rawPreviewLines: string[];
  fullText: string;
}

const DATE_FRAGMENT_REGEX =
  /(?:\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Ene|Abr|Ago|Set|Dic)[a-z.]*(?:\s+\d{2,4})?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z.]*\s+\d{1,2},?\s+\d{2,4}\b)/i;

const MONEY_TOKEN_REGEX =
  /(?:[-+]?\s*(?:A\$|US\$|MX\$|CLP\$|\$|€|AUD|USD|EUR|ARS|MXN|CLP)?\s*\(?[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})\)?(?:\s*(?:CR|DR|AUD|USD|EUR|ARS|MXN|CLP))?)/gi;

const NOISE_LINE_PATTERNS = [
  /^opening balance\b/i,
  /^closing balance\b/i,
  /^balance brought forward\b/i,
  /^balance carried forward\b/i,
  /^saldo anterior\b/i,
  /^saldo inicial\b/i,
  /^saldo final\b/i,
  /^page \d+ of \d+/i,
  /^página \d+ de \d+/i,
  /^statement period\b/i,
  /^account number\b/i,
  /^bsb\b/i,
  /^iban\b/i,
  /^total\s+(?:debits|credits|money out|money in|withdrawals|deposits)/i,
  /^continued on next page/i,
];

function isNoiseLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4) return true;
  return NOISE_LINE_PATTERNS.some((rx) => rx.test(trimmed));
}

function detectCurrencyFromText(text: string): CurrencyCode | undefined {
  const upper = text.toUpperCase();
  // Pick the currency mentioned most often (a USD broker statement that mentions AUD once is still USD).
  const patterns: Array<[CurrencyCode, RegExp]> = [
    ['AUD', /\bAUD\b|A\$/g],
    ['USD', /\bUSD\b|US\$/g],
    ['EUR', /\bEUR\b|€/g],
    ['MXN', /\bMXN\b|MX\$/g],
    ['CLP', /\bCLP\b|CLP\$/g],
    ['ARS', /\bARS\b/g],
  ];
  let best: CurrencyCode | undefined;
  let bestCount = 0;
  for (const [code, rx] of patterns) {
    const count = (upper.match(rx) || []).length;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function shiftYear(iso: string, delta: number): string {
  return `${Number(iso.slice(0, 4)) + delta}${iso.slice(4)}`;
}

/**
 * Statements often print dates without a year ("14 Dec"), so the parser has to guess it.
 * Fix the two typical mistakes: dates that land in the future (Dec rows of a Dec→Jan statement
 * dated with the newer year) and a backwards jump of more than 6 months in an ascending list
 * (Jan rows dated with the older year).
 */
function fixInferredYears(rows: string[][], dateCol = 0): string[][] {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const limit = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
    tomorrow.getDate()
  ).padStart(2, '0')}`;
  const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  let prev: string | null = null;
  return rows.map((row) => {
    let d = row[dateCol];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return row;
    if (prev && monthIndex(d) - monthIndex(prev) < -6) {
      const bumped = shiftYear(d, 1);
      if (bumped <= limit) d = bumped;
    }
    if (d > limit) d = shiftYear(d, -1);
    prev = d;
    if (d === row[dateCol]) return row;
    const next = [...row];
    next[dateCol] = d;
    return next;
  });
}

function detectStatementYear(lines: PdfVisualLine[]): number {
  const headText = lines
    .slice(0, 40)
    .map((l) => l.fullText)
    .join(' ');
  const yearMatches = headText.match(/\b(20[2-3]\d)\b/g);
  if (yearMatches && yearMatches.length > 0) {
    return Number(yearMatches[yearMatches.length - 1]);
  }
  return new Date().getFullYear();
}

function detectPresetFromPdfText(fullText: string): Exclude<CsvPreset, 'auto'> {
  const lower = fullText.toLowerCase();
  if (
    lower.includes('moomoo') ||
    lower.includes('futu') ||
    ((lower.includes('symbol') || lower.includes('ticker')) &&
      (lower.includes('qty') || lower.includes('shares') || lower.includes('dividend')))
  ) {
    return 'moomoo';
  }
  if (
    lower.includes('goalsaver') ||
    lower.includes('goal saver') ||
    (lower.includes('bonus interest') && lower.includes('commbank'))
  ) {
    return 'goalsaver';
  }
  if (
    lower.includes('commbank') ||
    lower.includes('commonwealth bank') ||
    lower.includes('netbank') ||
    lower.includes('smart access') ||
    lower.includes('complete access')
  ) {
    return 'commbank';
  }
  if (lower.includes('revolut') || (lower.includes('money out') && lower.includes('money in'))) {
    return 'revolut';
  }
  return 'generic';
}

function extractClosingBalance(
  lines: PdfVisualLine[],
  defaultCurrency: CurrencyCode
): { amount: number; currency: CurrencyCode } | undefined {
  for (const line of lines) {
    const lower = line.fullText.toLowerCase();
    if (
      lower.includes('closing balance') ||
      lower.includes('ending balance') ||
      lower.includes('balance at end') ||
      lower.includes('saldo final') ||
      lower.includes('saldo al cierre') ||
      lower.includes('total net asset value') ||
      lower.includes('ending equity')
    ) {
      const nums = extractMoneyTokens(line.fullText);
      if (nums.length > 0) {
        const val = Math.abs(nums[nums.length - 1].value);
        if (val > 0) {
          return {
            amount: val,
            currency: detectCurrencyFromText(line.fullText) || defaultCurrency,
          };
        }
      }
    }
  }
  return undefined;
}

interface ExtractedMoneyToken {
  raw: string;
  value: number;
  hasExplicitSign: boolean;
  isCreditWord: boolean;
  isDebitWord: boolean;
  currency?: CurrencyCode;
  index: number;
}

function extractMoneyTokens(text: string): ExtractedMoneyToken[] {
  const results: ExtractedMoneyToken[] = [];
  const regex = new RegExp(MONEY_TOKEN_REGEX.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0].trim();
    // Avoid matching plain years like 2025 or account numbers without decimals unless prefixed with currency
    const hasDecimal = /[.,]\d{2}\b/.test(raw);
    const hasCurrencyMarker = /(?:\$|€|AUD|USD|EUR|ARS|MXN|CLP|CR|DR)/i.test(raw);
    if (!hasDecimal && !hasCurrencyMarker) continue;
    // Skip dates like 12.10.2025
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(raw)) continue;

    const val = parseNumericAmount(raw);
    if (!Number.isFinite(val)) continue;

    const isCreditWord = /\bCR\b/i.test(raw) || raw.includes('+');
    const isDebitWord = /\bDR\b/i.test(raw) || raw.includes('-') || /^\(.*\)$/.test(raw);
    const hasExplicitSign = isCreditWord || isDebitWord;

    results.push({
      raw,
      value: isDebitWord && val > 0 ? -val : val,
      hasExplicitSign,
      isCreditWord,
      isDebitWord,
      currency: detectCurrencyFromText(raw),
      index: match.index,
    });
  }

  return results;
}

async function extractVisualLinesFromPdf(data: ArrayBuffer): Promise<{
  lines: PdfVisualLine[];
  pageCount: number;
}> {
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const allLines: PdfVisualLine[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    interface RawItem {
      str: string;
      x: number;
      y: number;
      width: number;
      fontSize: number;
    }

    const items: RawItem[] = [];
    for (const item of textContent.items) {
      if (!('str' in item) || typeof item.str !== 'string') continue;
      const trimmed = item.str.replace(/\s+/g, ' ').trim();
      if (!trimmed) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const fontSize = Math.abs(item.transform[0] || item.height || 10);
      items.push({
        str: trimmed,
        x,
        y,
        width: item.width || trimmed.length * (fontSize * 0.5),
        fontSize,
      });
    }

    // Sort top-to-bottom (y descending), then left-to-right (x ascending)
    items.sort((a, b) => {
      if (Math.abs(b.y - a.y) > 3.5) return b.y - a.y;
      return a.x - b.x;
    });

    // Cluster into rows
    const rowBuckets: RawItem[][] = [];
    for (const item of items) {
      const lastRow = rowBuckets[rowBuckets.length - 1];
      if (!lastRow || Math.abs(lastRow[0].y - item.y) > 3.5) {
        rowBuckets.push([item]);
      } else {
        lastRow.push(item);
      }
    }

    for (const row of rowBuckets) {
      row.sort((a, b) => a.x - b.x);

      // Group close horizontal spans into visual cells
      const cells: PdfCell[] = [];
      for (const item of row) {
        const prev = cells[cells.length - 1];
        const gap = prev ? item.x - prev.rightX : Infinity;
        const threshold = Math.max(8, item.fontSize * 0.75);
        if (prev && gap <= threshold) {
          prev.text = `${prev.text} ${item.str}`.trim();
          prev.rightX = Math.max(prev.rightX, item.x + item.width);
        } else {
          cells.push({
            text: item.str,
            x: item.x,
            rightX: item.x + item.width,
          });
        }
      }

      const fullText = cells.map((c) => c.text).join('  ').trim();
      if (fullText) {
        allLines.push({
          page: pageNum,
          y: row[0].y,
          cells,
          fullText,
        });
      }
    }
  }

  return { lines: allLines, pageCount: pdf.numPages };
}

interface ColumnZones {
  dateX?: number;
  descX?: number;
  debitX?: number;
  creditX?: number;
  amountX?: number;
  balanceX?: number;
  tickerX?: number;
  nameX?: number;
  sideX?: number;
  qtyX?: number;
  priceX?: number;
  currencyX?: number;
}

function detectColumnHeaderZones(line: PdfVisualLine): ColumnZones | null {
  const zones: ColumnZones = {};
  let matches = 0;

  for (const cell of line.cells) {
    const t = cell.text.toLowerCase();
    const center = (cell.x + cell.rightX) / 2;

    if (/\b(date|fecha|time)\b/.test(t) && zones.dateX === undefined) {
      zones.dateX = center;
      matches++;
    } else if (
      /\b(description|particulars|details|transaction|merchant|concepto|detalle|narrative)\b/.test(t) &&
      zones.descX === undefined
    ) {
      zones.descX = center;
      matches++;
    } else if (
      /\b(debit|money out|withdrawal|withdrawals|outflow|paid out|debits|cargo)\b/.test(t) &&
      zones.debitX === undefined
    ) {
      zones.debitX = center;
      matches++;
    } else if (
      /\b(credit|money in|deposit|deposits|inflow|paid in|credits|abono)\b/.test(t) &&
      zones.creditX === undefined
    ) {
      zones.creditX = center;
      matches++;
    } else if (/\b(amount|total amount|monto|importe|value|net amount)\b/.test(t) && zones.amountX === undefined) {
      zones.amountX = center;
      matches++;
    } else if (/\b(balance|saldo)\b/.test(t) && zones.balanceX === undefined) {
      zones.balanceX = center;
      matches++;
    } else if (/\b(symbol|ticker|code)\b/.test(t) && zones.tickerX === undefined) {
      zones.tickerX = center;
      matches++;
    } else if (/\b(name|security|stock|asset|etf)\b/.test(t) && zones.nameX === undefined) {
      zones.nameX = center;
      matches++;
    } else if (/\b(side|direction|action|operaci[oó]n|type)\b/.test(t) && zones.sideX === undefined) {
      zones.sideX = center;
      matches++;
    } else if (/\b(qty|quantity|shares|units|cantidad)\b/.test(t) && zones.qtyX === undefined) {
      zones.qtyX = center;
      matches++;
    } else if (/\b(price|avg cost|market price|precio)\b/.test(t) && zones.priceX === undefined) {
      zones.priceX = center;
      matches++;
    } else if (/\b(currency|ccy|moneda)\b/.test(t) && zones.currencyX === undefined) {
      zones.currencyX = center;
      matches++;
    }
  }

  const hasBankCols =
    zones.dateX !== undefined &&
    (zones.amountX !== undefined || zones.debitX !== undefined || zones.creditX !== undefined);
  const hasMoomooCols =
    zones.tickerX !== undefined && (zones.qtyX !== undefined || zones.amountX !== undefined || zones.priceX !== undefined);

  return matches >= 3 && (hasBankCols || hasMoomooCols) ? zones : null;
}

const NON_TICKER_WORDS = new Set([
  'AUD',
  'USD',
  'EUR',
  'MXN',
  'ARS',
  'CLP',
  'ETF',
  'PDF',
  'CSV',
  'BSB',
  'PTY',
  'LTD',
  'INC',
  'ABN',
  'BUY',
  'SELL',
  'COMPRA',
  'VENTA',
  'DIVIDEND',
  'DIVIDENDO',
  'CASH',
  'FEE',
  'TAX',
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'SEPT',
  'OCT',
  'NOV',
  'DEC',
  'ENE',
  'ABR',
  'AGO',
  'SET',
  'DIC',
  'DATE',
  'SYMBOL',
  'SIDE',
  'QTY',
  'PRICE',
  'TOTAL',
]);

function tryParseMoomooLines(
  lines: PdfVisualLine[],
  statementYear: number,
  defaultCurrency: CurrencyCode
): { headers: string[]; rows: string[][] } | null {
  const headers = ['Date', 'Symbol', 'Name', 'Side', 'Qty', 'Price', 'Total Amount', 'Currency', 'Type'];
  const rows: string[][] = [];

  for (const line of lines) {
    if (isNoiseLine(line.fullText)) continue;
    const text = line.fullText;

    // Look for Moomoo action keywords or ticker symbols (e.g., VOO, VAS, AAPL, SCHD, IVV, NDQ, VAS.AX)
    const sideMatch = text.match(/\b(BUY|SELL|COMPRA|VENTA|DIVIDEND|DIVIDENDO|CASH DIVIDEND)\b/i);
    const strippedForTicker = text
      .replace(DATE_FRAGMENT_REGEX, ' ')
      .replace(/\b(BUY|SELL|COMPRA|VENTA|DIVIDEND|DIVIDENDO|CASH DIVIDEND)\b/gi, ' ');
    const tickerCandidates = strippedForTicker.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,3})?\b/g) || [];
    const ticker = tickerCandidates.find((cand) => !NON_TICKER_WORDS.has(cand.toUpperCase()));

    const dateMatch = text.match(DATE_FRAGMENT_REGEX);
    const moneyTokens = extractMoneyTokens(text);

    // Case 1: Trade or Dividend line with ticker + action/amount
    if (ticker && (sideMatch || (dateMatch && moneyTokens.length >= 1))) {

      const dateIso = dateMatch ? normalizeDateToISO(dateMatch[0], statementYear) : getTodayISO();
      let side = 'BUY';
      if (sideMatch) {
        const s = sideMatch[1].toUpperCase();
        if (s.includes('DIV')) side = 'DIVIDEND';
        else if (s.includes('SELL') || s.includes('VENTA')) side = 'SELL';
        else side = 'BUY';
      }

      let qty = 0;
      let price = 0;
      let totalAmount = 0;

      if (moneyTokens.length >= 2) {
        price = Math.abs(moneyTokens[0].value);
        totalAmount = Math.abs(moneyTokens[moneyTokens.length - 1].value);
      } else if (moneyTokens.length === 1) {
        totalAmount = Math.abs(moneyTokens[0].value);
      }

      // Extract standalone numeric candidates excluding date and monetary tokens
      const afterSideText =
        sideMatch && sideMatch.index !== undefined
          ? text.slice(sideMatch.index + sideMatch[0].length)
          : text;
      const cleanForQty = (src: string) =>
        src
          .replace(DATE_FRAGMENT_REGEX, ' ')
          .replace(MONEY_TOKEN_REGEX, ' ')
          .match(/\b\d+(?:\.\d{1,4})?\b/g)
          ?.map(Number)
          .filter((n) => Number.isFinite(n) && n > 0 && n < 100000 && n !== statementYear) || [];

      const postSideCandidates = cleanForQty(afterSideText);
      const allQtyCandidates = postSideCandidates.length > 0 ? postSideCandidates : cleanForQty(text);

      if (price > 0 && totalAmount > 0) {
        const exactMatch = allQtyCandidates.find(
          (cand) => Math.abs(cand * price - totalAmount) < Math.max(0.5, totalAmount * 0.02)
        );
        if (exactMatch !== undefined) {
          qty = exactMatch;
        }
      }
      if (qty === 0 && allQtyCandidates.length > 0) {
        qty = allQtyCandidates[0];
      }
      if (qty === 0 && price > 0 && totalAmount > 0) {
        qty = Number((totalAmount / price).toFixed(4));
      }
      if (price === 0 && qty > 0 && totalAmount > 0) {
        price = Number((totalAmount / qty).toFixed(2));
      }
      if (totalAmount === 0 && qty > 0 && price > 0) {
        totalAmount = Number((qty * price).toFixed(2));
      }

      if (totalAmount <= 0) continue;

      const curr = detectCurrencyFromText(text) || defaultCurrency;
      const assetType = text.toUpperCase().includes('ETF') || ['VOO', 'VAS', 'IVV', 'NDQ', 'SCHD', 'VGS', 'QQQ', 'SPY'].includes(ticker)
        ? 'ETF'
        : 'Acción';

      // Extract clean asset name
      const cleanName = text
        .replace(DATE_FRAGMENT_REGEX, '')
        .replace(MONEY_TOKEN_REGEX, '')
        .replace(/\b(BUY|SELL|COMPRA|VENTA|DIVIDEND|DIVIDENDO|CASH DIVIDEND)\b/gi, '')
        .replace(new RegExp(`\\b${ticker.replace('.', '\\.')}\\b`), '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);

      rows.push([
        dateIso,
        ticker,
        cleanName || ticker,
        side,
        String(qty || 1),
        String(price || totalAmount),
        String(totalAmount),
        curr,
        assetType,
      ]);
    }
  }

  if (rows.length > 0) {
    return { headers, rows };
  }
  return null;
}

function tryParseBankColumnGuided(
  lines: PdfVisualLine[],
  statementYear: number,
  defaultCurrency: CurrencyCode
): { headers: string[]; rows: string[][]; lastBalance?: number } | null {
  let activeZones: ColumnZones | null = null;

  interface ExtractedBankRow {
    date: string;
    description: string;
    amount: number | null;
    currency: CurrencyCode;
    balance?: number;
  }

  const records: ExtractedBankRow[] = [];

  for (const line of lines) {
    const maybeHeader = detectColumnHeaderZones(line);
    if (maybeHeader) {
      activeZones = maybeHeader;
      continue;
    }

    if (!activeZones || isNoiseLine(line.fullText)) continue;

    // Try finding a date cell near dateX or at start of line
    let dateStr = '';
    for (const cell of line.cells) {
      const m = cell.text.match(DATE_FRAGMENT_REGEX);
      if (m) {
        dateStr = normalizeDateToISO(m[0], statementYear);
        break;
      }
    }

    if (!dateStr) {
      // Check if continuation description line
      const tokens = extractMoneyTokens(line.fullText);
      if (records.length > 0 && tokens.length === 0 && line.fullText.length <= 75) {
        const last = records[records.length - 1];
        last.description = `${last.description} ${line.fullText}`.replace(/\s+/g, ' ').trim();
      }
      continue;
    }

    const descParts: string[] = [];
    let debitVal: number | null = null;
    let creditVal: number | null = null;
    let singleAmtVal: number | null = null;
    let balanceVal: number | undefined;
    let rowCurrency: CurrencyCode = detectCurrencyFromText(line.fullText) || defaultCurrency;

    const colEntries: Array<{ key: keyof ColumnZones; x: number }> = (
      Object.entries(activeZones) as Array<[keyof ColumnZones, number | undefined]>
    )
      .filter((entry): entry is [keyof ColumnZones, number] => entry[1] !== undefined)
      .map(([key, x]) => ({ key, x }));

    for (const cell of line.cells) {
      // Remove date fragment from cell if date+desc merged
      const cellNoDate = cell.text.replace(DATE_FRAGMENT_REGEX, '').trim();
      if (!cellNoDate) continue;

      const center = (cell.x + cell.rightX) / 2;
      let nearestKey: keyof ColumnZones = 'descX';
      let bestDist = Infinity;
      for (const c of colEntries) {
        const dist = Math.abs(center - c.x);
        if (dist < bestDist) {
          bestDist = dist;
          nearestKey = c.key;
        }
      }

      const cellMoney = extractMoneyTokens(cellNoDate);
      if (nearestKey === 'debitX' && cellMoney.length > 0) {
        debitVal = Math.abs(cellMoney[0].value);
      } else if (nearestKey === 'creditX' && cellMoney.length > 0) {
        creditVal = Math.abs(cellMoney[0].value);
      } else if (nearestKey === 'balanceX' && cellMoney.length > 0) {
        balanceVal = cellMoney[cellMoney.length - 1].value;
      } else if (nearestKey === 'amountX' && cellMoney.length > 0) {
        singleAmtVal = cellMoney[0].value;
      } else if (nearestKey === 'currencyX') {
        const cand = cellNoDate.toUpperCase().trim() as CurrencyCode;
        if (cand in CURRENCY_META) rowCurrency = cand;
      } else if (nearestKey === 'descX' || nearestKey === 'dateX') {
        // Strip trailing amounts if column merged
        const cleanedDesc = cellNoDate.replace(MONEY_TOKEN_REGEX, '').trim();
        if (cleanedDesc) descParts.push(cleanedDesc);
      }
    }

    let finalAmount: number | null = null;
    if (debitVal !== null && debitVal > 0) finalAmount = -debitVal;
    else if (creditVal !== null && creditVal > 0) finalAmount = creditVal;
    else if (singleAmtVal !== null && singleAmtVal !== 0) finalAmount = singleAmtVal;

    // Fallback: if column mapping missed the amount, inspect tokens on the line
    if (finalAmount === null) {
      const tokens = extractMoneyTokens(line.fullText);
      if (tokens.length >= 2) {
        finalAmount = tokens[0].value;
        balanceVal = tokens[tokens.length - 1].value;
      } else if (tokens.length === 1) {
        finalAmount = tokens[0].value;
      }
    }

    if (finalAmount !== null && finalAmount !== 0) {
      records.push({
        date: dateStr,
        description: descParts.join(' ').replace(/\s+/g, ' ').trim() || 'Movimiento PDF',
        amount: finalAmount,
        currency: rowCurrency,
        balance: balanceVal,
      });
    }
  }

  if (records.length === 0) return null;

  // Reconcile sign using running balances if signs weren't explicit
  for (let i = 1; i < records.length; i++) {
    const prevBal = records[i - 1].balance;
    const currBal = records[i].balance;
    const amt = records[i].amount;
    if (prevBal !== undefined && currBal !== undefined && amt !== null) {
      const absAmt = Math.abs(amt);
      if (Math.abs(prevBal + absAmt - currBal) < 0.05) {
        records[i].amount = absAmt;
      } else if (Math.abs(prevBal - absAmt - currBal) < 0.05) {
        records[i].amount = -absAmt;
      }
    }
  }

  let lastBal: number | undefined;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].balance !== undefined) {
      lastBal = records[i].balance;
      break;
    }
  }
  return {
    headers: ['Date', 'Amount', 'Description', 'Currency', 'Balance'],
    rows: records.map((r) => [
      r.date,
      (r.amount || 0).toFixed(2),
      r.description,
      r.currency,
      r.balance !== undefined ? r.balance.toFixed(2) : '',
    ]),
    lastBalance: lastBal,
  };
}

function tryParsePatternFallback(
  lines: PdfVisualLine[],
  statementYear: number,
  defaultCurrency: CurrencyCode
): { headers: string[]; rows: string[][]; lastBalance?: number } {
  interface PatternRow {
    date: string;
    description: string;
    rawToken: ExtractedMoneyToken;
    amount: number;
    currency: CurrencyCode;
    balance?: number;
  }

  const rows: PatternRow[] = [];

  for (const line of lines) {
    if (isNoiseLine(line.fullText)) continue;

    const dateMatch = line.fullText.match(DATE_FRAGMENT_REGEX);
    const tokens = extractMoneyTokens(line.fullText);

    if (!dateMatch) {
      // Continuation line with extra merchant info
      if (rows.length > 0 && tokens.length === 0 && line.fullText.length <= 75) {
        rows[rows.length - 1].description = `${rows[rows.length - 1].description} ${line.fullText}`
          .replace(/\s+/g, ' ')
          .trim();
      }
      continue;
    }

    if (tokens.length === 0) continue;

    const dateIso = normalizeDateToISO(dateMatch[0], statementYear);
    const txToken = tokens[0];
    const balanceToken = tokens.length >= 2 ? tokens[tokens.length - 1] : undefined;

    // Clean description by removing date and money tokens
    let desc = line.fullText
      .replace(dateMatch[0], '')
      .replace(MONEY_TOKEN_REGEX, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!desc) desc = 'Movimiento importado PDF';

    // Determine sign when PDF lacks explicit +/-
    let amount = txToken.value;
    if (!txToken.hasExplicitSign && amount > 0) {
      const lowerDesc = desc.toLowerCase();
      const looksIncome =
        /\b(salary|payroll|deposit|credit|interest|bonus|refund|dividend|wages|sueldo|abono|depósito|interés|reembolso)\b/i.test(
          lowerDesc
        );
      amount = looksIncome ? Math.abs(amount) : -Math.abs(amount);
    }

    rows.push({
      date: dateIso,
      description: desc,
      rawToken: txToken,
      amount,
      currency: txToken.currency || detectCurrencyFromText(line.fullText) || defaultCurrency,
      balance: balanceToken ? Math.abs(balanceToken.value) : undefined,
    });
  }

  // Reconcile signs mathematically against running balance when available
  for (let i = 1; i < rows.length; i++) {
    const prevBal = rows[i - 1].balance;
    const currBal = rows[i].balance;
    if (prevBal !== undefined && currBal !== undefined && !rows[i].rawToken.hasExplicitSign) {
      const absAmt = Math.abs(rows[i].amount);
      if (Math.abs(prevBal + absAmt - currBal) < 0.05) {
        rows[i].amount = absAmt;
      } else if (Math.abs(prevBal - absAmt - currBal) < 0.05) {
        rows[i].amount = -absAmt;
      }
    }
  }

  let lastBal: number | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].balance !== undefined) {
      lastBal = rows[i].balance;
      break;
    }
  }
  return {
    headers: ['Date', 'Amount', 'Description', 'Currency', 'Balance'],
    rows: rows.map((r) => [
      r.date,
      r.amount.toFixed(2),
      r.description,
      r.currency,
      r.balance !== undefined ? r.balance.toFixed(2) : '',
    ]),
    lastBalance: lastBal,
  };
}

export async function parsePdfStatement(
  arrayBuffer: ArrayBuffer,
  preferredPreset: CsvPreset = 'auto'
): Promise<ParsedPdfStatement> {
  const { lines, pageCount } = await extractVisualLinesFromPdf(arrayBuffer);

  if (lines.length === 0) {
    throw new Error(
      'No se encontró texto legible en el PDF. Es posible que el archivo sea un escaneo como imagen. Descarga el PDF digital oficial o el archivo CSV desde tu banco.'
    );
  }

  const fullText = lines.map((l) => l.fullText).join('\n');
  const detectedPreset =
    preferredPreset === 'auto' ? detectPresetFromPdfText(fullText) : preferredPreset;
  const statementYear = detectStatementYear(lines);
  const detectedCurrency = detectCurrencyFromText(fullText) || 'AUD';
  const summaryClosingBalance = extractClosingBalance(lines, detectedCurrency);

  // 1. Moomoo broker statements
  if (detectedPreset === 'moomoo') {
    const moomooRes = tryParseMoomooLines(lines, statementYear, detectedCurrency);
    if (moomooRes && moomooRes.rows.length > 0) {
      return {
        headers: moomooRes.headers,
        rows: fixInferredYears(moomooRes.rows),
        detectedPreset: 'moomoo',
        detectedCurrency,
        detectedClosingBalance: summaryClosingBalance,
        pageCount,
        extractedLineCount: lines.length,
        rawPreviewLines: lines.slice(0, 20).map((l) => l.fullText),
        fullText,
      };
    }
  }

  // 2. Column-header guided bank extraction
  const columnRes = tryParseBankColumnGuided(lines, statementYear, detectedCurrency);
  if (columnRes && columnRes.rows.length > 0) {
    return {
      headers: columnRes.headers,
      rows: fixInferredYears(columnRes.rows),
      detectedPreset,
      detectedCurrency,
      detectedClosingBalance:
        summaryClosingBalance ||
        (columnRes.lastBalance
          ? { amount: columnRes.lastBalance, currency: detectedCurrency }
          : undefined),
      pageCount,
      extractedLineCount: lines.length,
      rawPreviewLines: lines.slice(0, 20).map((l) => l.fullText),
      fullText,
    };
  }

  // 3. Pattern fallback extraction
  const fallbackRes = tryParsePatternFallback(lines, statementYear, detectedCurrency);
  return {
    headers: fallbackRes.headers,
    rows: fixInferredYears(fallbackRes.rows),
    detectedPreset,
    detectedCurrency,
    detectedClosingBalance:
      summaryClosingBalance ||
      (fallbackRes.lastBalance
        ? { amount: fallbackRes.lastBalance, currency: detectedCurrency }
        : undefined),
    pageCount,
    extractedLineCount: lines.length,
    rawPreviewLines: lines.slice(0, 20).map((l) => l.fullText),
    fullText,
  };
}

// ==========================================
// REAL SAMPLE PDF STATEMENT GENERATOR (100% LOCAL)
// ==========================================

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function buildSinglePagePdfBytes(title: string, subtitle: string, tableLines: string[]): Uint8Array {
  const ops: string[] = [];
  ops.push('BT');
  ops.push('/F1 14 Tf');
  ops.push('48 760 Td');
  ops.push(`(${escapePdfText(title)}) Tj`);
  ops.push('/F1 9 Tf');
  ops.push('0 -18 Td');
  ops.push(`(${escapePdfText(subtitle)}) Tj`);
  ops.push('0 -24 Td');

  for (const line of tableLines) {
    ops.push(`(${escapePdfText(line)}) Tj`);
    ops.push('0 -16 Td');
  }
  ops.push('ET');

  const streamContent = ops.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export function generateSamplePdfStatementBytes(
  kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo',
  ownerHint: string = '',
  holderDisplayName?: string
): Uint8Array {
  const today = getTodayISO();
  const [y, m] = today.split('-');
  const holderName = holderDisplayName || ownerHint || 'Titular de ejemplo';

  if (kind === 'commbank') {
    return buildSinglePagePdfBytes(
      'Commonwealth Bank - Smart Access Statement (AUD)',
      `Account Holder: ${holderName}  |  Period: 01/${m}/${y} - 28/${m}/${y}  |  BSB: 062-000`,
      [
        'Date         Description                         Amount        Balance',
        `01/${m}/${y}   SALARY DEPOSIT EMPLOYER PTY LTD    +$4,250.00     $6,850.00 CR`,
        `03/${m}/${y}   RENT PAYMENT SYDNEY REALTY         -$1,850.00     $5,000.00 CR`,
        `05/${m}/${y}   WOOLWORTHS METRO 1042               -$142.35      $4,857.65 CR`,
        `08/${m}/${y}   AGL ELECTRICITY BILL                 -$98.00      $4,759.65 CR`,
        `10/${m}/${y}   TRANSFER TO REVOLUT                 -$500.00      $4,259.65 CR`,
        `Closing Balance: $4,259.65 AUD`,
      ]
    );
  }

  if (kind === 'goalsaver') {
    return buildSinglePagePdfBytes(
      'Commonwealth Bank - GoalSaver Statement (AUD)',
      `Account Holder: ${holderName}  |  Period: 01/${m}/${y} - 28/${m}/${y}  |  GoalSaver`,
      [
        'Date         Description                         Amount        Balance',
        `01/${m}/${y}   TRANSFER FROM COMMBANK GOALSAVER   +$700.00     $19,100.00 CR`,
        `15/${m}/${y}   CREDIT INTEREST BASE GOALSAVER       +$8.42     $19,108.42 CR`,
        `15/${m}/${y}   BONUS INTEREST GOALSAVER            +$72.18     $19,180.60 CR`,
        `Closing Balance: $19,180.60 AUD`,
      ]
    );
  }

  if (kind === 'revolut') {
    return buildSinglePagePdfBytes(
      'Revolut Australia - Account Statement (AUD)',
      `Account Holder: ${holderName}  |  Period: ${y}-${m}-01 to ${y}-${m}-28  |  Currency: AUD`,
      [
        'Date         Description                         Amount        Balance',
        `${y}-${m}-04   Coles Supermarkets                 -A$86.40      A$913.60`,
        `${y}-${m}-06   Single O Coffee                    -A$14.50      A$899.10`,
        `${y}-${m}-09   Uber Trip Sydney                   -A$28.90      A$870.20`,
        `${y}-${m}-11   Sushi Train Bondi                  -A$64.00      A$806.20`,
        `Closing Balance: A$806.20 AUD`,
      ]
    );
  }

  return buildSinglePagePdfBytes(
    'Moomoo AU / US - Monthly Account Statement',
    `Account Holder: ${holderName}  |  Period: ${y}-${m}-01 to ${y}-${m}-28  |  Trades & Dividends`,
    [
      'Date         Symbol  Description                      Side      Qty   Price     Total',
      `${y}-${m}-02   VOO     Vanguard S&P 500 ETF             BUY       2     $510.00   $1,020.00 USD`,
      `${y}-${m}-05   SCHD    Schwab US Dividend Equity ETF    BUY       5     $28.40    $142.00 USD`,
      `${y}-${m}-07   VAS     Vanguard Australian Shares ETF   DIVIDEND  15    $0.85     $12.75 AUD`,
      `${y}-${m}-12   NDQ     Betashares Nasdaq 100 ETF        BUY       3     $44.20    $132.60 AUD`,
    ]
  );
}
