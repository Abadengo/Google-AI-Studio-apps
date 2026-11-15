import {
  CURRENT_DATA_VERSION,
  type Account,
  type AccountKind,
  type Budget,
  type Category,
  type CurrencyCode,
  type ExchangeRates,
  type FinanceState,
  type FixedExpense,
  type InvestmentHolding,
  type LegacyAccountKind,
  type SavingsInterestConfig,
  type Transaction,
  type UserProfile,
} from '../types/finance';
import {
  createInitialFinanceState,
  DEFAULT_PROFILES,
  DEFAULT_SAVINGS_BASE_RATE,
  DEFAULT_SAVINGS_BONUS_RATE,
} from './defaultState';

/*
 * DATA MIGRATIONS
 * ---------------
 * The app state is stored in localStorage (key 'finanzas_hogar_abdiel_lara_v1', never renamed) and in
 * .json backups. Every stored object carries `version`. When the structure changes:
 *   1. bump CURRENT_DATA_VERSION in types/finance.ts
 *   2. add a `migrateVxToVy` step below and register it in MIGRATIONS
 * Steps must be pure and must never drop transactions, accounts, budgets, holdings or fixed expenses.
 */

type RawState = Record<string, unknown> & { version?: number };

export const ACCOUNT_KINDS: AccountKind[] = [
  'transaccional',
  'ahorro',
  'inversion',
  'tarjeta_credito',
  'efectivo',
  'otra',
];

const LEGACY_KIND_MAP: Record<LegacyAccountKind, { kind: AccountKind; institution: string }> = {
  commbank: { kind: 'transaccional', institution: 'CommBank' },
  goalsaver: { kind: 'ahorro', institution: 'CommBank' },
  revolut: { kind: 'transaccional', institution: 'Revolut' },
  wise: { kind: 'transaccional', institution: 'Wise' },
  moomoo: { kind: 'inversion', institution: 'Moomoo' },
  cash: { kind: 'efectivo', institution: '' },
  other: { kind: 'otra', institution: '' },
};

/** Maps any (legacy or current) account kind to a v2 kind. Unknown values become 'otra'. */
export function toGenericAccountKind(kind: unknown): AccountKind {
  if (typeof kind === 'string') {
    if ((ACCOUNT_KINDS as string[]).includes(kind)) return kind as AccountKind;
    const legacy = LEGACY_KIND_MAP[kind as LegacyAccountKind];
    if (legacy) return legacy.kind;
  }
  return 'otra';
}

/** Default category names that used to include a brand; renamed only if the user never changed them. */
const BRANDED_DEFAULT_CATEGORY_NAMES: Record<string, { old: string[]; next: string }> = {
  cat_dividendos: { old: ['Dividendos Moomoo', 'Moomoo Dividends'], next: 'Dividendos' },
  cat_intereses: { old: ['Intereses GoalSaver', 'GoalSaver Interest'], next: 'Intereses' },
};

interface LegacyGoalSaver {
  owner?: string;
  accountName?: string;
  currentBalance?: number;
  monthlyContribution?: number;
  baseRateAnnual?: number;
  bonusRateAnnual?: number;
  currency?: CurrencyCode;
}

/**
 * v1 → v2
 *  - Account.kind: bank-specific kinds → generic kinds; the bank goes to `institution`.
 *  - goalSavers (one per profile) → savingsConfigs (one per savings account, linked by accountId).
 *  - moomooHoldings → investments, linked to the owner's investment account when there is one.
 *  - Default categories "Dividendos Moomoo" / "Intereses GoalSaver" → "Dividendos" / "Intereses" (same ids).
 */
export function migrateV1toV2(raw: RawState): RawState {
  const legacyAccounts = Array.isArray(raw.accounts) ? (raw.accounts as Array<Record<string, unknown>>) : [];

  const accounts = legacyAccounts.map((a) => {
    const legacyKind = String(a.kind ?? '');
    const legacy = LEGACY_KIND_MAP[legacyKind as LegacyAccountKind];
    const existingInstitution = typeof a.institution === 'string' ? a.institution.trim() : '';
    return {
      ...a,
      kind: toGenericAccountKind(legacyKind),
      institution: existingInstitution || legacy?.institution || undefined,
    };
  });

  // goalSavers → savingsConfigs
  const profiles = Array.isArray(raw.profiles) ? (raw.profiles as UserProfile[]) : [];
  const goalSavers =
    raw.goalSavers && typeof raw.goalSavers === 'object'
      ? (raw.goalSavers as Record<string, LegacyGoalSaver>)
      : {};
  const savingsConfigs: SavingsInterestConfig[] = [];
  for (const [ownerKey, gs] of Object.entries(goalSavers)) {
    if (!gs || typeof gs !== 'object') continue;
    const owner = gs.owner || ownerKey;
    const linked =
      legacyAccounts.find((a) => a.owner === owner && a.kind === 'goalsaver') ||
      legacyAccounts.find((a) => a.owner === owner && a.kind === 'ahorro');
    const balance = Number(gs.currentBalance) || 0;
    const contribution = Number(gs.monthlyContribution) || 0;
    const base = Number.isFinite(Number(gs.baseRateAnnual)) ? Number(gs.baseRateAnnual) : DEFAULT_SAVINGS_BASE_RATE;
    const bonus = Number.isFinite(Number(gs.bonusRateAnnual)) ? Number(gs.bonusRateAnnual) : DEFAULT_SAVINGS_BONUS_RATE;
    // v1 created an untouched default entry for every profile; skip those when no savings account exists.
    const isUntouchedDefault = balance === 0 && contribution === 500 && base === 0.45 && bonus === 4.45;
    if (!linked && isUntouchedDefault) continue;
    const profileName = profiles.find((p) => p.id === owner)?.name || owner;
    savingsConfigs.push({
      id: `sav_${owner}`,
      owner,
      accountId: linked ? String(linked.id) : undefined,
      // Keep exactly the balance the user had in v1 (it may come from a statement sync).
      useAccountBalance: false,
      name: linked ? String(linked.name || '') || `Fondo de ahorro · ${profileName}` : `Fondo de ahorro · ${profileName}`,
      currentBalance: balance,
      monthlyContribution: contribution,
      baseRateAnnual: base,
      bonusRateAnnual: bonus,
      currency: gs.currency || (linked?.currency as CurrencyCode) || 'AUD',
    });
  }

  // moomooHoldings → investments
  const legacyHoldings = Array.isArray(raw.moomooHoldings)
    ? (raw.moomooHoldings as Array<Record<string, unknown>>)
    : [];
  const investments = legacyHoldings.map((h) => {
    const ownerInvestmentAccounts = legacyAccounts.filter((a) => a.owner === h.owner && a.kind === 'moomoo');
    const linked =
      ownerInvestmentAccounts.find((a) => a.currency === h.currency) || ownerInvestmentAccounts[0];
    return { ...h, accountId: h.accountId ?? (linked ? String(linked.id) : undefined) };
  });

  // Categories with branded default names
  const categories = Array.isArray(raw.categories)
    ? (raw.categories as Category[]).map((c) => {
        const rule = BRANDED_DEFAULT_CATEGORY_NAMES[c.id];
        return rule && rule.old.includes(c.name) ? { ...c, name: rule.next } : c;
      })
    : raw.categories;

  const next: RawState = {
    ...raw,
    version: 2,
    accounts,
    categories,
    savingsConfigs,
    investments,
  };
  delete next.goalSavers;
  delete next.moomooHoldings;
  return next;
}

const MIGRATIONS: Record<number, (raw: RawState) => RawState> = {
  1: migrateV1toV2,
};

/** Runs every pending migration step, in order. Data without `version` is treated as v1. */
export function migrateRawState(input: unknown): RawState {
  let raw: RawState = input && typeof input === 'object' ? { ...(input as RawState) } : {};
  let version = Number(raw.version) || 1;
  while (version < CURRENT_DATA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`Falta la migración de datos v${version} → v${version + 1}`);
    raw = step(raw);
    version += 1;
    raw.version = version;
  }
  return raw;
}

const VALID_CURRENCIES = new Set<CurrencyCode>(['AUD', 'USD', 'EUR', 'ARS', 'MXN', 'CLP']);

function sanitizeRates(raw: unknown, fallback: ExchangeRates): ExchangeRates {
  const out: ExchangeRates = { ...fallback };
  if (raw && typeof raw === 'object') {
    for (const code of Object.keys(fallback) as CurrencyCode[]) {
      const v = Number((raw as Record<string, unknown>)[code]);
      if (Number.isFinite(v) && v > 0) out[code] = v;
    }
  }
  out.AUD = 1;
  return out;
}

function validCurrency(c: unknown, fallback: CurrencyCode = 'AUD'): CurrencyCode {
  return typeof c === 'string' && VALID_CURRENCIES.has(c as CurrencyCode) ? (c as CurrencyCode) : fallback;
}

/**
 * Migrates (if needed) and normalises any persisted / restored JSON into a valid FinanceState,
 * filling missing pieces and dropping only malformed rows so a damaged backup can't crash the app.
 */
export function normalizeState(input: unknown): FinanceState {
  const parsed = migrateRawState(input) as Partial<FinanceState>;
  const fallback = createInitialFinanceState(false);

  const profiles: UserProfile[] =
    Array.isArray(parsed.profiles) && parsed.profiles.length > 0
      ? parsed.profiles
          .filter((p) => p && typeof p.id === 'string')
          .map((p, idx) => ({
            id: p.id,
            name: p.name || p.id,
            email: p.email || '',
            role: p.role || '',
            phone: p.phone || '',
            country: p.country || '',
            notes: p.notes || '',
            color: p.color || (idx % 2 === 0 ? '#022E5B' : '#499BED'),
          }))
      : DEFAULT_PROFILES;

  const accounts: Account[] = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
    .filter((a) => a && typeof a.id === 'string')
    .map((a) => ({
      ...a,
      kind: toGenericAccountKind(a.kind),
      institution: typeof a.institution === 'string' && a.institution.trim() ? a.institution.trim() : undefined,
      currency: validCurrency(a.currency),
      initialBalance: Number(a.initialBalance) || 0,
    }));

  const transactions: Transaction[] = (Array.isArray(parsed.transactions) ? parsed.transactions : [])
    .filter(
      (t): t is Transaction =>
        Boolean(t) && typeof t.id === 'string' && typeof t.date === 'string' && Number.isFinite(Number(t.amount))
    )
    .map((t) => ({
      ...t,
      amount: Math.abs(Number(t.amount)),
      currency: validCurrency(t.currency),
      description: String(t.description ?? ''),
      accountId: t.accountId ?? '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const savingsConfigs: SavingsInterestConfig[] = (Array.isArray(parsed.savingsConfigs) ? parsed.savingsConfigs : [])
    .filter((c) => c && typeof c.id === 'string')
    .map((c) => ({
      ...c,
      accountId: c.accountId && accounts.some((a) => a.id === c.accountId) ? c.accountId : undefined,
      useAccountBalance: Boolean(c.useAccountBalance && c.accountId && accounts.some((a) => a.id === c.accountId)),
      name: String(c.name || 'Fondo de ahorro'),
      currentBalance: Number(c.currentBalance) || 0,
      monthlyContribution: Number(c.monthlyContribution) || 0,
      baseRateAnnual: Number(c.baseRateAnnual) || 0,
      bonusRateAnnual: Number(c.bonusRateAnnual) || 0,
      currency: validCurrency(c.currency),
    }));

  const investments: InvestmentHolding[] = (Array.isArray(parsed.investments) ? parsed.investments : [])
    .filter((h) => h && typeof h.id === 'string')
    .map((h) => ({
      ...h,
      accountId: h.accountId && accounts.some((a) => a.id === h.accountId) ? h.accountId : undefined,
      shares: Number(h.shares) || 0,
      avgCostPerShare: Number(h.avgCostPerShare) || 0,
      currentPricePerShare: Number(h.currentPricePerShare) || 0,
      dividendYieldAnnual: Number(h.dividendYieldAnnual) || 0,
      currency: validCurrency(h.currency),
    }));

  return {
    version: CURRENT_DATA_VERSION,
    displayCurrency: validCurrency(parsed.displayCurrency),
    exchangeRates: sanitizeRates(parsed.exchangeRates, fallback.exchangeRates),
    exchangeRatesUpdatedAt: typeof parsed.exchangeRatesUpdatedAt === 'string' ? parsed.exchangeRatesUpdatedAt : undefined,
    profiles,
    accounts,
    categories:
      Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : fallback.categories,
    transactions,
    budgets: Array.isArray(parsed.budgets) ? (parsed.budgets as Budget[]) : fallback.budgets,
    savingsConfigs,
    investments,
    fixedExpenses: Array.isArray(parsed.fixedExpenses) ? (parsed.fixedExpenses as FixedExpense[]) : [],
    fixedExpensePaidByMonth:
      parsed.fixedExpensePaidByMonth && typeof parsed.fixedExpensePaidByMonth === 'object'
        ? parsed.fixedExpensePaidByMonth
        : {},
    lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : undefined,
    isSampleData: Boolean(parsed.isSampleData),
  };
}
