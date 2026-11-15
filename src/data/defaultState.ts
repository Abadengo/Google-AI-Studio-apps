import {
  CURRENT_DATA_VERSION,
  type Account,
  type Budget,
  type Category,
  type FinanceState,
  type FixedExpense,
  type InvestmentHolding,
  type ProfileId,
  type SavingsInterestConfig,
  type Transaction,
  type UserProfile,
} from '../types/finance';

// Everything in this file is generic EXAMPLE data shown on first launch.
// Real profiles, accounts and institutions are created and edited from the app.

export const PROFILE_COLOR_PALETTE = [
  '#022E5B',
  '#499BED',
  '#0D9488',
  '#7C3AED',
  '#EA580C',
  '#DB2777',
  '#16A34A',
];

export const DEFAULT_PROFILES: UserProfile[] = [
  { id: 'perfil_a', name: 'Persona A', role: 'Titular', email: '', phone: '', country: '', notes: '', color: '#022E5B' },
  { id: 'perfil_b', name: 'Persona B', role: 'Co-titular', email: '', phone: '', country: '', notes: '', color: '#499BED' },
];

export const DEFAULT_SAVINGS_BASE_RATE = 0.5;
export const DEFAULT_SAVINGS_BONUS_RATE = 4;

export function createSavingsConfig(params: {
  owner: ProfileId;
  name: string;
  accountId?: string;
  currency?: SavingsInterestConfig['currency'];
  currentBalance?: number;
  monthlyContribution?: number;
}): SavingsInterestConfig {
  return {
    id: `sav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    owner: params.owner,
    accountId: params.accountId,
    useAccountBalance: Boolean(params.accountId),
    name: params.name,
    currentBalance: params.currentBalance ?? 0,
    monthlyContribution: params.monthlyContribution ?? 0,
    baseRateAnnual: DEFAULT_SAVINGS_BASE_RATE,
    bonusRateAnnual: DEFAULT_SAVINGS_BONUS_RATE,
    currency: params.currency ?? 'AUD',
  };
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat_vivienda', name: 'Vivienda y Alquiler', type: 'expense', color: '#0F172A' },
  { id: 'cat_supermercado', name: 'Supermercado', type: 'expense', color: '#0D9488' },
  { id: 'cat_restaurantes', name: 'Restaurantes y Café', type: 'expense', color: '#EA580C' },
  { id: 'cat_transporte', name: 'Transporte', type: 'expense', color: '#2563EB' },
  { id: 'cat_servicios', name: 'Servicios (Luz/Gas/Net)', type: 'expense', color: '#7C3AED' },
  { id: 'cat_salud', name: 'Salud y Farmacia', type: 'expense', color: '#16A34A' },
  { id: 'cat_suscripciones', name: 'Suscripciones', type: 'expense', color: '#DB2777' },
  { id: 'cat_compras', name: 'Compras y Hogar', type: 'expense', color: '#CA8A04' },
  { id: 'cat_ocio', name: 'Ocio y Viajes', type: 'expense', color: '#0891B2' },
  { id: 'cat_otros_gastos', name: 'Otros Gastos', type: 'expense', color: '#64748B' },
  { id: 'cat_sueldo', name: 'Sueldo', type: 'income', color: '#15803D' },
  { id: 'cat_dividendos', name: 'Dividendos', type: 'income', color: '#0284C7' },
  { id: 'cat_intereses', name: 'Intereses', type: 'income', color: '#059669' },
  { id: 'cat_otros_ingresos', name: 'Otros Ingresos', type: 'income', color: '#4F46E5' },
  { id: 'cat_transfer', name: 'Transferencia Interna', type: 'both', color: '#94A3B8' },
];

const A = 'perfil_a';
const B = 'perfil_b';

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'acc_a_sueldo', name: 'Cuenta sueldo', owner: A, kind: 'transaccional', currency: 'AUD', initialBalance: 2500, notes: 'Donde entra el sueldo' },
  { id: 'acc_a_ahorro', name: 'Fondo de ahorro', owner: A, kind: 'ahorro', currency: 'AUD', initialBalance: 12000, notes: 'Ahorro con interés' },
  { id: 'acc_a_diario', name: 'Gastos diarios', owner: A, kind: 'transaccional', currency: 'AUD', initialBalance: 600 },
  { id: 'acc_a_inversion', name: 'Inversiones', owner: A, kind: 'inversion', currency: 'USD', initialBalance: 300 },
  { id: 'acc_b_sueldo', name: 'Cuenta sueldo', owner: B, kind: 'transaccional', currency: 'AUD', initialBalance: 2200, notes: 'Donde entra el sueldo' },
  { id: 'acc_b_ahorro', name: 'Fondo de ahorro', owner: B, kind: 'ahorro', currency: 'AUD', initialBalance: 9000, notes: 'Ahorro con interés' },
  { id: 'acc_b_tarjeta', name: 'Tarjeta de crédito', owner: B, kind: 'tarjeta_credito', currency: 'AUD', initialBalance: 0 },
  { id: 'acc_b_efectivo', name: 'Efectivo', owner: B, kind: 'efectivo', currency: 'AUD', initialBalance: 150 },
];

export const DEFAULT_SAVINGS_CONFIGS: SavingsInterestConfig[] = [
  { id: 'sav_a', owner: A, accountId: 'acc_a_ahorro', useAccountBalance: true, name: 'Fondo de ahorro', currentBalance: 0, monthlyContribution: 500, baseRateAnnual: DEFAULT_SAVINGS_BASE_RATE, bonusRateAnnual: DEFAULT_SAVINGS_BONUS_RATE, currency: 'AUD' },
  { id: 'sav_b', owner: B, accountId: 'acc_b_ahorro', useAccountBalance: true, name: 'Fondo de ahorro', currentBalance: 0, monthlyContribution: 400, baseRateAnnual: DEFAULT_SAVINGS_BASE_RATE, bonusRateAnnual: DEFAULT_SAVINGS_BONUS_RATE, currency: 'AUD' },
];

export const DEFAULT_BUDGETS: Budget[] = [
  { id: 'bud_vivienda', categoryId: 'cat_vivienda', owner: 'all', monthlyLimit: 2000, currency: 'AUD' },
  { id: 'bud_super', categoryId: 'cat_supermercado', owner: 'all', monthlyLimit: 800, currency: 'AUD' },
  { id: 'bud_rest', categoryId: 'cat_restaurantes', owner: 'all', monthlyLimit: 300, currency: 'AUD' },
  { id: 'bud_transp', categoryId: 'cat_transporte', owner: 'all', monthlyLimit: 250, currency: 'AUD' },
  { id: 'bud_serv', categoryId: 'cat_servicios', owner: 'all', monthlyLimit: 300, currency: 'AUD' },
  { id: 'bud_susc', categoryId: 'cat_suscripciones', owner: 'all', monthlyLimit: 100, currency: 'AUD' },
  { id: 'bud_compras', categoryId: 'cat_compras', owner: 'all', monthlyLimit: 250, currency: 'AUD' },
  { id: 'bud_ocio', categoryId: 'cat_ocio', owner: 'all', monthlyLimit: 300, currency: 'AUD' },
];

export const DEFAULT_INVESTMENTS: InvestmentHolding[] = [
  { id: 'inv_1', owner: A, accountId: 'acc_a_inversion', ticker: 'VOO', name: 'Vanguard S&P 500 ETF', assetType: 'ETF', shares: 8, avgCostPerShare: 450, currentPricePerShare: 520, dividendYieldAnnual: 1.3, currency: 'USD' },
  { id: 'inv_2', owner: A, accountId: 'acc_a_inversion', ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', assetType: 'ETF', shares: 60, avgCostPerShare: 26, currentPricePerShare: 28.5, dividendYieldAnnual: 3.5, currency: 'USD' },
  { id: 'inv_3', owner: B, ticker: 'VAS', name: 'Vanguard Australian Shares ETF', assetType: 'ETF', shares: 30, avgCostPerShare: 92, currentPricePerShare: 101, dividendYieldAnnual: 3.6, currency: 'AUD' },
  { id: 'inv_4', owner: B, ticker: 'AAPL', name: 'Apple Inc.', assetType: 'Acción', shares: 10, avgCostPerShare: 185, currentPricePerShare: 225, dividendYieldAnnual: 0.45, currency: 'USD' },
];

function monthOffsetDate(monthsAgo: number, day: number): string {
  const now = new Date();
  // Never generate example movements in the future.
  const maxDay = monthsAgo === 0 ? Math.max(1, now.getDate()) : 28;
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, Math.min(day, maxDay));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildSampleTransactions(): Transaction[] {
  const list: Transaction[] = [];
  let idx = 1;
  const push = (
    monthsAgo: number,
    day: number,
    owner: ProfileId,
    type: Transaction['type'],
    amount: number,
    currency: 'AUD' | 'USD',
    categoryId: string,
    accountId: string,
    description: string,
    toAccountId?: string
  ) => {
    list.push({
      id: `tx_sample_${idx++}`,
      owner,
      type,
      date: monthOffsetDate(monthsAgo, day),
      amount: Number(amount.toFixed(2)),
      currency,
      categoryId,
      accountId,
      toAccountId,
      description,
      source: 'manual',
    });
  };

  for (let m = 5; m >= 0; m--) {
    push(m, 1, A, 'income', 4200, 'AUD', 'cat_sueldo', 'acc_a_sueldo', 'Sueldo mensual');
    push(m, 1, B, 'income', 3800, 'AUD', 'cat_sueldo', 'acc_b_sueldo', 'Sueldo mensual');
    push(m, 2, A, 'transfer', 500, 'AUD', 'cat_transfer', 'acc_a_sueldo', 'Aporte a fondo de ahorro', 'acc_a_ahorro');
    push(m, 2, B, 'transfer', 400, 'AUD', 'cat_transfer', 'acc_b_sueldo', 'Aporte a fondo de ahorro', 'acc_b_ahorro');
    push(m, 2, A, 'transfer', 600, 'AUD', 'cat_transfer', 'acc_a_sueldo', 'Fondos para gastos diarios', 'acc_a_diario');
    push(m, 28, A, 'income', 45 + (5 - m) * 2, 'AUD', 'cat_intereses', 'acc_a_ahorro', 'Interés de la cuenta de ahorro');
    push(m, 28, B, 'income', 34 + (5 - m) * 2, 'AUD', 'cat_intereses', 'acc_b_ahorro', 'Interés de la cuenta de ahorro');
    push(m, 3, A, 'expense', 1000, 'AUD', 'cat_vivienda', 'acc_a_sueldo', 'Alquiler (50%)');
    push(m, 3, B, 'expense', 1000, 'AUD', 'cat_vivienda', 'acc_b_sueldo', 'Alquiler (50%)');
    push(m, 7, A, 'expense', 130 + (m % 2) * 20, 'AUD', 'cat_servicios', 'acc_a_sueldo', 'Electricidad y gas');
    push(m, 9, B, 'expense', 80, 'AUD', 'cat_servicios', 'acc_b_sueldo', 'Internet');
    push(m, 4, A, 'expense', 160 + m * 5, 'AUD', 'cat_supermercado', 'acc_a_diario', 'Supermercado semanal');
    push(m, 11, B, 'expense', 180 + (m % 3) * 15, 'AUD', 'cat_supermercado', 'acc_b_tarjeta', 'Supermercado y verdulería');
    push(m, 18, A, 'expense', 190, 'AUD', 'cat_supermercado', 'acc_a_diario', 'Mercado');
    push(m, 6, A, 'expense', 70, 'AUD', 'cat_restaurantes', 'acc_a_diario', 'Cena');
    push(m, 14, B, 'expense', m === 0 ? 260 : 90, 'AUD', 'cat_restaurantes', 'acc_b_tarjeta', m === 0 ? 'Cena de cumpleaños' : 'Brunch');
    push(m, 8, A, 'expense', 85, 'AUD', 'cat_transporte', 'acc_a_diario', 'Transporte público');
    push(m, 15, B, 'expense', 100, 'AUD', 'cat_transporte', 'acc_b_tarjeta', 'Combustible');
    push(m, 10, A, 'expense', 25, 'AUD', 'cat_suscripciones', 'acc_a_diario', 'Streaming');
    push(m, 12, B, 'expense', 50, 'AUD', 'cat_suscripciones', 'acc_b_tarjeta', 'Gimnasio');
    push(m, 16, B, 'expense', m === 1 ? 350 : 120, 'AUD', 'cat_compras', 'acc_b_tarjeta', 'Artículos del hogar');
    push(m, 19, A, 'expense', 60, 'AUD', 'cat_salud', 'acc_a_diario', 'Farmacia');
    push(m, 22, B, 'expense', m === 2 ? 400 : 110, 'AUD', 'cat_ocio', 'acc_b_tarjeta', m === 2 ? 'Escapada de fin de semana' : 'Cine y salidas');
    push(m, 25, B, 'transfer', 600, 'AUD', 'cat_transfer', 'acc_b_sueldo', 'Pago tarjeta de crédito', 'acc_b_tarjeta');
    if (m === 0 || m === 3) {
      push(m, 15, A, 'income', 55, 'USD', 'cat_dividendos', 'acc_a_inversion', 'Dividendos ETF');
    }
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export const DEFAULT_FIXED_EXPENSES: FixedExpense[] = [
  { id: 'fix_1', name: 'Alquiler (50%)', owner: A, amount: 1000, currency: 'AUD', categoryId: 'cat_vivienda', accountId: 'acc_a_sueldo', dueDay: 3 },
  { id: 'fix_2', name: 'Alquiler (50%)', owner: B, amount: 1000, currency: 'AUD', categoryId: 'cat_vivienda', accountId: 'acc_b_sueldo', dueDay: 3 },
  { id: 'fix_3', name: 'Electricidad y gas', owner: A, amount: 130, currency: 'AUD', categoryId: 'cat_servicios', accountId: 'acc_a_sueldo', dueDay: 7 },
  { id: 'fix_4', name: 'Internet', owner: B, amount: 80, currency: 'AUD', categoryId: 'cat_servicios', accountId: 'acc_b_sueldo', dueDay: 9 },
  { id: 'fix_5', name: 'Streaming', owner: A, amount: 25, currency: 'AUD', categoryId: 'cat_suscripciones', accountId: 'acc_a_diario', dueDay: 10 },
  { id: 'fix_6', name: 'Gimnasio', owner: B, amount: 50, currency: 'AUD', categoryId: 'cat_suscripciones', accountId: 'acc_b_tarjeta', dueDay: 12 },
];

function getSamplePaidMap(): Record<string, Record<string, boolean>> {
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { [mk]: { fix_1: true, fix_2: true, fix_3: true, fix_4: false, fix_5: false, fix_6: false } };
}

export const DEFAULT_EXCHANGE_RATES = {
  AUD: 1,
  USD: 1.54,
  EUR: 1.66,
  ARS: 0.0012,
  MXN: 0.083,
  CLP: 0.0016,
};

/**
 * withSamples = true → example household to explore the app.
 * withSamples = false → empty structure (keeps default categories and budgets only).
 */
export function createInitialFinanceState(withSamples = true): FinanceState {
  return {
    version: CURRENT_DATA_VERSION,
    displayCurrency: 'AUD',
    exchangeRates: { ...DEFAULT_EXCHANGE_RATES },
    exchangeRatesUpdatedAt: undefined,
    profiles: DEFAULT_PROFILES,
    accounts: withSamples ? DEFAULT_ACCOUNTS : [],
    categories: DEFAULT_CATEGORIES,
    transactions: withSamples ? buildSampleTransactions() : [],
    budgets: DEFAULT_BUDGETS,
    savingsConfigs: withSamples ? DEFAULT_SAVINGS_CONFIGS : [],
    investments: withSamples ? DEFAULT_INVESTMENTS : [],
    fixedExpenses: withSamples ? DEFAULT_FIXED_EXPENSES : [],
    fixedExpensePaidByMonth: withSamples ? getSamplePaidMap() : {},
    lastBackupAt: undefined,
    isSampleData: withSamples,
  };
}
