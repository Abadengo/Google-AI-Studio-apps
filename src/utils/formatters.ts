import type {
  CurrencyCode,
  ExchangeRates,
  GoalSaverProfile,
  ProfileId,
  TransactionType,
  UserProfile,
} from '../types/finance';

export const CURRENCY_META: Record<
  CurrencyCode,
  { symbol: string; label: string; decimals: number }
> = {
  AUD: { symbol: 'A$', label: 'Dólar Australiano (AUD)', decimals: 2 },
  USD: { symbol: 'US$', label: 'Dólar Estadounidense (USD)', decimals: 2 },
  EUR: { symbol: '€', label: 'Euro (EUR)', decimals: 2 },
  ARS: { symbol: '$', label: 'Peso Argentino (ARS)', decimals: 0 },
  MXN: { symbol: 'MX$', label: 'Peso Mexicano (MXN)', decimals: 2 },
  CLP: { symbol: 'CLP$', label: 'Peso Chileno (CLP)', decimals: 0 },
};

export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: ExchangeRates
): number {
  if (from === to) return amount;
  const fromInAud = rates[from] || 1;
  const toInAud = rates[to] || 1;
  return (amount * fromInAud) / toInAud;
}

export function formatMoney(
  amount: number,
  currency: CurrencyCode = 'AUD',
  compact = false
): string {
  const meta = CURRENCY_META[currency] || CURRENCY_META.AUD;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (compact && abs >= 1000000) {
    return `${sign}${meta.symbol}${(abs / 1000000).toFixed(2)}M`;
  }
  if (compact && abs >= 10000) {
    return `${sign}${meta.symbol}${(abs / 1000).toFixed(1)}k`;
  }

  const formatted = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  }).format(abs);

  return `${sign}${meta.symbol}${formatted}`;
}

export function formatMonthLabel(monthKey: string, lang: 'es' | 'en' = 'es'): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  const date = new Date(year, month - 1, 1);
  const label = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', {
    month: 'short',
    year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatFullMonthLabel(monthKey: string, lang: 'es' | 'en' = 'es'): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  const date = new Date(year, month - 1, 1);
  const label = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDateShort(isoDate: string, lang: 'es' | 'en' = 'es'): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function getLastNMonths(referenceMonth: string, count: number): string[] {
  const [y, m] = referenceMonth.split('-').map(Number);
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    result.push(`${yyyy}-${mm}`);
  }
  return result;
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthKey(): string {
  return getTodayISO().slice(0, 7);
}

export interface GoalSaverMonthPoint {
  month: number;
  label: string;
  startingBalance: number;
  contribution: number;
  interestEarned: number;
  endingBalance: number;
  totalContributed: number;
  totalInterest: number;
}

export function simulateGoalSaver(params: {
  initialBalance: number;
  monthlyContribution: number;
  baseRateAnnual: number;
  bonusRateAnnual: number;
  months: number;
  includeBonus: boolean;
  lang?: 'es' | 'en';
}): GoalSaverMonthPoint[] {
  const {
    initialBalance,
    monthlyContribution,
    baseRateAnnual,
    bonusRateAnnual,
    months,
    includeBonus,
    lang = 'es',
  } = params;

  const effectiveAnnualRate =
    (baseRateAnnual + (includeBonus && monthlyContribution > 0 ? bonusRateAnnual : 0)) / 100;
  const monthlyRate = effectiveAnnualRate / 12;

  let balance = initialBalance;
  let totalContributed = initialBalance;
  let totalInterest = 0;

  const points: GoalSaverMonthPoint[] = [];

  for (let i = 1; i <= months; i++) {
    const startingBalance = balance;
    const balanceWithContribution = startingBalance + monthlyContribution;
    const interestEarned = balanceWithContribution * monthlyRate;
    const endingBalance = balanceWithContribution + interestEarned;

    totalContributed += monthlyContribution;
    totalInterest += interestEarned;
    balance = endingBalance;

    points.push({
      month: i,
      label: `${lang === 'en' ? 'Month' : 'Mes'} ${i}`,
      startingBalance,
      contribution: monthlyContribution,
      interestEarned,
      endingBalance,
      totalContributed,
      totalInterest,
    });
  }

  return points;
}

export interface AnnualCompoundYearPoint {
  year: number;
  label: string;
  startingBalance: number;
  yearlyContributions: number;
  yearlyInterest: number;
  endingBalance: number;
  totalContributed: number;
  totalInterest: number;
  profileBalances: Record<string, number>;
}

export function simulateAnnualCompoundSavings(params: {
  entries: Array<{ id: string; initial: number; monthly: number }>;
  monthlyRatePct: number;
  years: number;
  lang?: 'es' | 'en';
}): AnnualCompoundYearPoint[] {
  const { entries, monthlyRatePct, years, lang = 'es' } = params;

  const monthlyRate = Math.max(0, monthlyRatePct) / 100;
  const balances: Record<string, number> = {};
  let totalContributed = 0;

  for (const entry of entries) {
    const init = Math.max(0, entry.initial);
    balances[entry.id] = init;
    totalContributed += init;
  }

  let totalInterest = 0;
  const points: AnnualCompoundYearPoint[] = [];

  for (let y = 1; y <= years; y++) {
    const startingBalance = Object.values(balances).reduce((s, v) => s + v, 0);
    let yearlyContributions = 0;
    let yearlyInterest = 0;

    for (let m = 1; m <= 12; m++) {
      for (const entry of entries) {
        const monthly = Math.max(0, entry.monthly);
        const withContrib = balances[entry.id] + monthly;
        const interest = withContrib * monthlyRate;
        balances[entry.id] = withContrib + interest;
        yearlyContributions += monthly;
        yearlyInterest += interest;
      }
    }

    totalContributed += yearlyContributions;
    totalInterest += yearlyInterest;
    const endingBalance = Object.values(balances).reduce((s, v) => s + v, 0);

    points.push({
      year: y,
      label: `${lang === 'en' ? 'Year' : 'Año'} ${y}`,
      startingBalance,
      yearlyContributions,
      yearlyInterest,
      endingBalance,
      totalContributed,
      totalInterest,
      profileBalances: { ...balances },
    });
  }

  return points;
}

export type DividendPayoutFrequency = 'monthly' | 'quarterly' | 'annual';

export interface DividendCapitalYearPoint {
  year: number;
  label: string;
  capitalWithoutDividends: number;
  dividendsThisYear: number;
  dividendsAccumulated: number;
  dividendGrowthDelta: number;
  profileCapitals: Record<string, number>;
  totalCapital: number;
}

export function simulateDividendCapitalGrowth(params: {
  entries: Array<{ id: string; initial: number; monthly: number; yieldPct: number }>;
  annualPriceGrowthPct: number;
  reinvestDividends: boolean;
  payoutFrequency: DividendPayoutFrequency;
  years: number;
  lang?: 'es' | 'en';
}): DividendCapitalYearPoint[] {
  const {
    entries,
    annualPriceGrowthPct,
    reinvestDividends,
    payoutFrequency,
    years,
    lang = 'es',
  } = params;

  const monthlyPriceRate = Math.max(0, annualPriceGrowthPct) / 100 / 12;
  const payoutPeriodMonths =
    payoutFrequency === 'monthly' ? 1 : payoutFrequency === 'quarterly' ? 3 : 12;

  const stockValues: Record<string, number> = {};
  const noDivValues: Record<string, number> = {};
  const cashDivs: Record<string, number> = {};

  for (const entry of entries) {
    const init = Math.max(0, entry.initial);
    stockValues[entry.id] = init;
    noDivValues[entry.id] = init;
    cashDivs[entry.id] = 0;
  }

  let totalDividendsAccumulated = 0;
  const points: DividendCapitalYearPoint[] = [];

  for (let y = 1; y <= years; y++) {
    let dividendsThisYear = 0;

    for (let m = 1; m <= 12; m++) {
      for (const entry of entries) {
        const monthly = Math.max(0, entry.monthly);
        stockValues[entry.id] += monthly;
        noDivValues[entry.id] += monthly;

        stockValues[entry.id] *= 1 + monthlyPriceRate;
        noDivValues[entry.id] *= 1 + monthlyPriceRate;

        if (m % payoutPeriodMonths === 0) {
          const periodFraction = payoutPeriodMonths / 12;
          const annualYield = Math.max(0, entry.yieldPct) / 100;
          const div = stockValues[entry.id] * annualYield * periodFraction;

          dividendsThisYear += div;
          totalDividendsAccumulated += div;

          if (reinvestDividends) {
            stockValues[entry.id] += div;
          } else {
            cashDivs[entry.id] += div;
          }
        }
      }
    }

    const profileCapitals: Record<string, number> = {};
    let totalCapital = 0;
    let capitalWithoutDividends = 0;

    for (const entry of entries) {
      const cap = stockValues[entry.id] + cashDivs[entry.id];
      profileCapitals[entry.id] = cap;
      totalCapital += cap;
      capitalWithoutDividends += noDivValues[entry.id];
    }

    points.push({
      year: y,
      label: `${lang === 'en' ? 'Year' : 'Año'} ${y}`,
      capitalWithoutDividends,
      dividendsThisYear,
      dividendsAccumulated: totalDividendsAccumulated,
      dividendGrowthDelta: Math.max(0, totalCapital - capitalWithoutDividends),
      profileCapitals,
      totalCapital,
    });
  }

  return points;
}

export interface MoomooProjectionYearPoint {
  year: number;
  label: string;
  totalContributed: number;
  capitalGain: number;
  dividendsAccumulated: number;
  totalValue: number;
  annualDividendIncome: number;
}

export function simulateMoomooGrowth(params: {
  initialCapital: number;
  monthlyContribution: number;
  annualPriceGrowthPct: number;
  annualDividendYieldPct: number;
  reinvestDividends: boolean;
  years: number;
  lang?: 'es' | 'en';
}): MoomooProjectionYearPoint[] {
  const {
    initialCapital,
    monthlyContribution,
    annualPriceGrowthPct,
    annualDividendYieldPct,
    reinvestDividends,
    years,
    lang = 'es',
  } = params;

  const monthlyGrowth = annualPriceGrowthPct / 100 / 12;
  const monthlyDivRate = annualDividendYieldPct / 100 / 12;

  let portfolioValue = initialCapital;
  let totalContributed = initialCapital;
  let dividendsAccumulated = 0;
  let cashDividendsOutside = 0;

  const points: MoomooProjectionYearPoint[] = [];

  for (let y = 1; y <= years; y++) {
    let yearDividendSum = 0;
    for (let m = 1; m <= 12; m++) {
      portfolioValue += monthlyContribution;
      totalContributed += monthlyContribution;

      // Price appreciation
      portfolioValue = portfolioValue * (1 + monthlyGrowth);

      // Dividend generated this month
      const monthlyDividend = portfolioValue * monthlyDivRate;
      yearDividendSum += monthlyDividend;
      dividendsAccumulated += monthlyDividend;

      if (reinvestDividends) {
        portfolioValue += monthlyDividend;
      } else {
        cashDividendsOutside += monthlyDividend;
      }
    }

    const totalWealth = portfolioValue + cashDividendsOutside;
    const capitalGain = Math.max(0, totalWealth - totalContributed - dividendsAccumulated);

    points.push({
      year: y,
      label: `${lang === 'en' ? 'Year' : 'Año'} ${y}`,
      totalContributed,
      capitalGain,
      dividendsAccumulated,
      totalValue: totalWealth,
      annualDividendIncome: yearDividendSum,
    });
  }

  return points;
}

// ==========================================
// CSV / STATEMENT PARSING & AUTO-DETECTION
// ==========================================

export type CsvPreset = 'auto' | 'commbank' | 'goalsaver' | 'revolut' | 'moomoo' | 'generic';

export interface ParsedCsvData {
  headers: string[];
  rows: string[][];
  detectedPreset: Exclude<CsvPreset, 'auto'>;
  detectedClosingBalance?: { amount: number; currency: CurrencyCode };
}

export function parseCsvText(rawText: string): ParsedCsvData {
  const cleanText = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { headers: [], rows: [], detectedPreset: 'generic' };
  }

  // Detect delimiter (comma vs semicolon) from first line
  const firstLine = cleanText.split(/\r?\n/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const parsedRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        parsedRows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      parsedRows.push(currentRow);
    }
  }

  if (parsedRows.length === 0) {
    return { headers: [], rows: [], detectedPreset: 'generic' };
  }

  // CommBank sometimes exports headerless CSVs: DD/MM/YYYY,-45.20,"WOOLWORTHS 1234",+1200.00
  const firstRow = parsedRows[0];
  const looksHeaderlessCommbank =
    firstRow.length >= 3 &&
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(firstRow[0]) &&
    !Number.isNaN(Number(firstRow[1].replace(/[$,+]/g, '')));

  if (looksHeaderlessCommbank) {
    const headers = ['Date', 'Amount', 'Description', 'Balance'].slice(0, firstRow.length);
    const hasGoalSaverTerms = parsedRows.some((r) =>
      r.join(' ').toLowerCase().includes('goalsaver') || r.join(' ').toLowerCase().includes('bonus interest')
    );
    const lastBalRaw = headers.length >= 4 ? parsedRows[parsedRows.length - 1][3] : undefined;
    const lastBal = lastBalRaw ? parseNumericAmount(lastBalRaw) : NaN;
    return {
      headers,
      rows: parsedRows,
      detectedPreset: hasGoalSaverTerms ? 'goalsaver' : 'commbank',
      detectedClosingBalance:
        Number.isFinite(lastBal) && lastBal > 0 ? { amount: lastBal, currency: 'AUD' } : undefined,
    };
  }

  const headers = firstRow;
  const rows = parsedRows.slice(1);
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const allBodyLower = rows.map((r) => r.join(' ').toLowerCase()).join(' ');

  let detectedPreset: Exclude<CsvPreset, 'auto'> = 'generic';
  if (
    lowerHeaders.some((h) => h.includes('started date') || h.includes('completed date')) &&
    lowerHeaders.some((h) => h.includes('currency'))
  ) {
    detectedPreset = 'revolut';
  } else if (
    lowerHeaders.some((h) => h.includes('symbol') || h.includes('ticker') || h.includes('code')) &&
    lowerHeaders.some(
      (h) =>
        h.includes('side') ||
        h.includes('direction') ||
        h.includes('price') ||
        h.includes('qty') ||
        h.includes('quantity')
    )
  ) {
    detectedPreset = 'moomoo';
  } else if (
    allBodyLower.includes('goalsaver') ||
    (allBodyLower.includes('bonus interest') && allBodyLower.includes('interest'))
  ) {
    detectedPreset = 'goalsaver';
  } else if (
    lowerHeaders.includes('date') &&
    lowerHeaders.includes('amount') &&
    lowerHeaders.includes('description') &&
    lowerHeaders.includes('balance')
  ) {
    detectedPreset = 'commbank';
  }

  let detectedClosingBalance: { amount: number; currency: CurrencyCode } | undefined;
  const balIdx = lowerHeaders.findIndex((h) => h === 'balance' || h === 'saldo');
  if (balIdx >= 0 && rows.length > 0) {
    const candidate = parseNumericAmount(rows[rows.length - 1][balIdx] || '');
    if (Number.isFinite(candidate) && candidate > 0) {
      detectedClosingBalance = { amount: candidate, currency: 'AUD' };
    }
  }

  return { headers, rows, detectedPreset, detectedClosingBalance };
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  ene: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  set: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  diciembre: 12,
};

export function normalizeDateToISO(raw: string, fallbackYear?: number): string {
  const cleanedRaw = raw.replace(/\s+/g, ' ').trim();
  if (!cleanedRaw) return getTodayISO();

  const firstToken = cleanedRaw.split(' ')[0];

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(firstToken)) {
    const [y, m, d] = firstToken.split(/[-/]/);
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY (CommBank standard)
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(firstToken)) {
    const [p1, p2, y] = firstToken.split(/[-/]/).map(Number);
    if (p2 > 12) {
      return `${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
    }
    return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
  }

  // DD/MM/YY or DD-MM-YY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2}$/.test(firstToken)) {
    const [p1, p2, yy] = firstToken.split(/[-/]/).map(Number);
    const fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
    if (p2 > 12) {
      return `${fullYear}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
    }
    return `${fullYear}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
  }

  // DD MMM YYYY or DD-MMM-YYYY or DD de MMM YYYY or DD MMM (e.g. "05 Oct 2025", "14 Oct")
  const dmyMatch = cleanedRaw.match(
    /^(\d{1,2})[\s\-/.]+(?:de\s+)?([a-záéíóúñ]+)\.?[\s\-/.,]*(?:de\s+)?(\d{2,4})?$/i
  );
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const monthKey = dmyMatch[2].toLowerCase().replace('.', '');
    const monthNum = MONTH_NAME_MAP[monthKey];
    if (monthNum && day >= 1 && day <= 31) {
      let year = fallbackYear || new Date().getFullYear();
      if (dmyMatch[3]) {
        const yRaw = Number(dmyMatch[3]);
        year = dmyMatch[3].length === 2 ? 2000 + yRaw : yRaw;
      }
      return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // MMM DD, YYYY (e.g. "Oct 05, 2025")
  const mdyMatch = cleanedRaw.match(/^([a-záéíóúñ]+)\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (mdyMatch) {
    const monthKey = mdyMatch[1].toLowerCase().replace('.', '');
    const monthNum = MONTH_NAME_MAP[monthKey];
    const day = Number(mdyMatch[2]);
    if (monthNum && day >= 1 && day <= 31) {
      const yRaw = Number(mdyMatch[3]);
      const year = mdyMatch[3].length === 2 ? 2000 + yRaw : yRaw;
      return `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(cleanedRaw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return getTodayISO();
}

export function parseNumericAmount(raw: string): number {
  if (!raw) return 0;
  // Normalise unicode minus signs / non-breaking spaces that some bank exports use.
  const working = raw.replace(/[−‒–—]/g, '-').replace(/ /g, ' ').trim();
  const isParenNegative = /^\(.*\)$/.test(working);
  const isDr = /\bDR\b/i.test(working);
  const isTrailingMinus = /\d\s*-$/.test(working);
  let cleaned = working.replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return 0;
  const isNegative = cleaned.startsWith('-') || isTrailingMinus;
  cleaned = cleaned.replace(/-/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return 0;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators present: the last one is the decimal separator.
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.'); // 1.234,56
    } else {
      cleaned = cleaned.replace(/,/g, ''); // 1,234.56
    }
  } else if (lastComma >= 0) {
    // Only commas: "1,234" / "12,345,678" are thousands, "12,50" is a decimal comma.
    const decimals = cleaned.length - lastComma - 1;
    const isThousands =
      commaCount > 1 || (decimals === 3 && !/^0,/.test(cleaned));
    cleaned = isThousands ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (dotCount > 1) {
    // "1.234.567" → thousands separators only.
    cleaned = cleaned.replace(/\./g, '');
  }

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  if (isNegative || ((isParenNegative || isDr) && n > 0)) return -Math.abs(n);
  return n;
}

function hasKeyword(desc: string, keywords: string[]): boolean {
  return keywords.some((kw) => {
    const escaped = kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(desc);
  });
}

export function guessCategoryId(description: string, type: TransactionType): string {
  if (type === 'transfer') return 'cat_transfer';
  const desc = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (type === 'income') {
    if (hasKeyword(desc, ['dividend', 'dividends', 'dividendo', 'dividendos', 'div', 'distribution', 'moomoo', 'etf'])) {
      return 'cat_dividendos';
    }
    if (hasKeyword(desc, ['interest', 'interes', 'intereses', 'goalsaver', 'bonus interest'])) {
      return 'cat_intereses';
    }
    if (hasKeyword(desc, ['salary', 'payroll', 'sueldo', 'salario', 'nomina', 'wages'])) {
      return 'cat_sueldo';
    }
    return 'cat_otros_ingresos';
  }

  if (hasKeyword(desc, ['uber eats', 'doordash', 'menulog', 'cafe', 'coffee', 'restaurant', 'restaurante', 'mcdonalds', 'mcdonald', 'kfc', 'sushi', 'pizza', 'bar', 'pub', 'bakery'])) {
    return 'cat_restaurantes';
  }
  if (hasKeyword(desc, ['woolworths', 'coles', 'aldi', 'iga', 'supermarket', 'supermercado', 'grocery', 'groceries', 'market', 'harris farm', 'costco'])) {
    return 'cat_supermercado';
  }
  if (hasKeyword(desc, ['rent', 'rental', 'alquiler', 'arriendo', 'mortgage', 'hipoteca', 'strata', 'real estate'])) {
    return 'cat_vivienda';
  }
  if (hasKeyword(desc, ['uber', 'didi', 'opal', 'myki', 'petrol', 'fuel', 'bp', 'shell', 'ampol', '7-eleven fuel', 'train', 'transport', 'transporte', 'parking', 'toll', 'linkt'])) {
    return 'cat_transporte';
  }
  if (hasKeyword(desc, ['agl', 'origin energy', 'energyaustralia', 'telstra', 'optus', 'vodafone', 'tpg', 'aussie broadband', 'internet', 'electricity', 'electric', 'water', 'gas', 'luz'])) {
    return 'cat_servicios';
  }
  if (hasKeyword(desc, ['netflix', 'spotify', 'apple.com', 'apple', 'icloud', 'amazon prime', 'prime video', 'youtube', 'disney', 'stan', 'binge', 'gym', 'gimnasio', 'chatgpt', 'openai'])) {
    return 'cat_suscripciones';
  }
  if (hasKeyword(desc, ['chemist', 'pharmacy', 'farmacia', 'priceline', 'bupa', 'medibank', 'hcf', 'nib', 'dental', 'dentist', 'clinic', 'doctor', 'medical', 'hospital'])) {
    return 'cat_salud';
  }
  if (hasKeyword(desc, ['kmart', 'target', 'big w', 'uniqlo', 'zara', 'amazon', 'ikea', 'bunnings', 'jb hi-fi', 'jb hi fi', 'officeworks', 'myer', 'david jones'])) {
    return 'cat_compras';
  }
  if (hasKeyword(desc, ['cinema', 'cine', 'hoyts', 'event cinemas', 'ticket', 'ticketek', 'flight', 'qantas', 'jetstar', 'virgin australia', 'airbnb', 'booking.com', 'hotel'])) {
    return 'cat_ocio';
  }

  return 'cat_otros_gastos';
}

export function getSampleCsvContent(kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo'): string {
  const today = getTodayISO();
  const [y, m] = today.split('-');

  if (kind === 'commbank') {
    return [
      'Date,Amount,Description,Balance',
      `01/${m}/${y},4250.00,"SALARY DEPOSIT EMPLOYER PTY LTD",6850.00`,
      `03/${m}/${y},-1850.00,"RENT PAYMENT SYDNEY REALTY",5000.00`,
      `05/${m}/${y},-142.35,"WOOLWORTHS METRO 1042",4857.65`,
      `08/${m}/${y},-98.00,"AGL ELECTRICITY BILL",4759.65`,
      `10/${m}/${y},-500.00,"TRANSFER TO REVOLUT",4259.65`,
    ].join('\n');
  }

  if (kind === 'goalsaver') {
    return [
      'Date,Amount,Description,Balance',
      `01/${m}/${y},700.00,"TRANSFER FROM COMMBANK SAVINGS GOALSAVER",19100.00`,
      `15/${m}/${y},8.42,"CREDIT INTEREST BASE GOALSAVER",19108.42`,
      `15/${m}/${y},72.18,"BONUS INTEREST GOALSAVER",19180.60`,
    ].join('\n');
  }

  if (kind === 'revolut') {
    return [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      `CARD_PAYMENT,Current,${y}-${m}-04 09:15:00,${y}-${m}-04 09:16:00,Coles Supermarkets,-86.40,0.00,AUD,COMPLETED,913.60`,
      `CARD_PAYMENT,Current,${y}-${m}-06 13:20:00,${y}-${m}-06 13:21:00,Single O Coffee,-14.50,0.00,AUD,COMPLETED,899.10`,
      `CARD_PAYMENT,Current,${y}-${m}-09 19:45:00,${y}-${m}-09 19:46:00,Uber Trip Sydney,-28.90,0.00,AUD,COMPLETED,870.20`,
      `CARD_PAYMENT,Current,${y}-${m}-11 20:10:00,${y}-${m}-11 20:11:00,Sushi Train Bondi,-64.00,0.00,AUD,COMPLETED,806.20`,
    ].join('\n');
  }

  return [
    'Date,Symbol,Name,Side,Qty,Price,Total Amount,Currency,Type',
    `${y}-${m}-02,VOO,Vanguard S&P 500 ETF,BUY,2,510.00,1020.00,USD,ETF`,
    `${y}-${m}-05,SCHD,Schwab US Dividend Equity ETF,BUY,5,28.40,142.00,USD,ETF`,
    `${y}-${m}-07,VAS,Vanguard Australian Shares ETF,DIVIDEND,15,0.85,12.75,AUD,ETF`,
    `${y}-${m}-12,NDQ,Betashares Nasdaq 100 ETF,BUY,3,44.20,132.60,AUD,ETF`,
  ].join('\n');
}

export function getProfileLabel(owner: ProfileId, profiles?: UserProfile[]): string {
  const found = profiles?.find((p) => p.id === owner);
  if (found) return found.name;
  if (owner === 'abdiel') return 'Abdiel';
  if (owner === 'lara') return 'Lara';
  return owner;
}

export function getGoalSaverForProfile(
  goalSavers: Record<string, GoalSaverProfile>,
  profile: Pick<UserProfile, 'id' | 'name'>
): GoalSaverProfile {
  return (
    goalSavers[profile.id] || {
      owner: profile.id,
      accountName: `CommBank GoalSaver · ${profile.name}`,
      currentBalance: 0,
      monthlyContribution: 500,
      baseRateAnnual: 0.45,
      bonusRateAnnual: 4.45,
      currency: 'AUD',
    }
  );
}

/**
 * Live balance of every account = initial balance + income − expenses ± transfers,
 * converting each movement into the account's own currency.
 * Transfers with an empty accountId are inflows from an unknown own account (imported statements).
 */
export function computeAccountBalances(
  accounts: Array<{ id: string; currency: CurrencyCode; initialBalance: number }>,
  transactions: Array<{
    type: TransactionType;
    amount: number;
    currency: CurrencyCode;
    accountId: string;
    toAccountId?: string;
  }>,
  rates: ExchangeRates
): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const balances = new Map<string, number>();
  for (const acc of accounts) balances.set(acc.id, Number(acc.initialBalance) || 0);

  const apply = (accountId: string | undefined, amount: number, currency: CurrencyCode, sign: 1 | -1) => {
    if (!accountId) return;
    const acc = byId.get(accountId);
    if (!acc) return;
    const val = convertCurrency(amount, currency, acc.currency, rates);
    balances.set(acc.id, (balances.get(acc.id) || 0) + sign * val);
  };

  for (const tx of transactions) {
    if (tx.type === 'income') apply(tx.accountId, tx.amount, tx.currency, 1);
    else if (tx.type === 'expense') apply(tx.accountId, tx.amount, tx.currency, -1);
    else if (tx.type === 'transfer') {
      apply(tx.accountId, tx.amount, tx.currency, -1);
      apply(tx.toAccountId, tx.amount, tx.currency, 1);
    }
  }
  return balances;
}

/** Download a Blob as a file. Revokes the object URL after the click has been processed. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}
