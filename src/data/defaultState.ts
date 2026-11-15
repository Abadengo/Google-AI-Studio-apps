import type {
  Account,
  Budget,
  Category,
  FinanceState,
  FixedExpense,
  GoalSaverProfile,
  MoomooHolding,
  ProfileId,
  Transaction,
  UserProfile,
} from '../types/finance';

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
  {
    id: 'abdiel',
    name: 'Abdiel',
    role: 'Titular principal',
    email: '',
    phone: '',
    country: 'Australia',
    notes: '',
    color: '#022E5B',
  },
  {
    id: 'lara',
    name: 'Lara',
    role: 'Co-titular',
    email: '',
    phone: '',
    country: 'Australia',
    notes: '',
    color: '#499BED',
  },
];

export function createDefaultGoalSaverForProfile(
  profile: Pick<UserProfile, 'id' | 'name'>
): GoalSaverProfile {
  return {
    owner: profile.id,
    accountName: `CommBank GoalSaver · ${profile.name}`,
    currentBalance: 0,
    monthlyContribution: 500,
    baseRateAnnual: 0.45,
    bonusRateAnnual: 4.45,
    currency: 'AUD',
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
  { id: 'cat_dividendos', name: 'Dividendos Moomoo', type: 'income', color: '#0284C7' },
  { id: 'cat_intereses', name: 'Intereses GoalSaver', type: 'income', color: '#059669' },
  { id: 'cat_otros_ingresos', name: 'Otros Ingresos', type: 'income', color: '#4F46E5' },
  { id: 'cat_transfer', name: 'Transferencia Interna', type: 'both', color: '#94A3B8' },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  {
    id: 'acc_abdiel_commbank',
    name: 'CommBank (Sueldo)',
    owner: 'abdiel',
    kind: 'commbank',
    currency: 'AUD',
    initialBalance: 3200,
    notes: 'Cuenta principal donde entra el sueldo',
  },
  {
    id: 'acc_abdiel_goalsaver',
    name: 'CommBank GoalSaver',
    owner: 'abdiel',
    kind: 'goalsaver',
    currency: 'AUD',
    initialBalance: 18500,
    notes: 'Ahorro colchón con interés bonus mensual',
  },
  {
    id: 'acc_abdiel_revolut',
    name: 'Revolut (Gastos diarios)',
    owner: 'abdiel',
    kind: 'revolut',
    currency: 'AUD',
    initialBalance: 850,
    notes: 'Tarjeta diaria y pagos cotidianos',
  },
  {
    id: 'acc_abdiel_moomoo',
    name: 'Moomoo (Inversiones)',
    owner: 'abdiel',
    kind: 'moomoo',
    currency: 'USD',
    initialBalance: 450,
    notes: 'Broker de acciones y ETFs',
  },
  {
    id: 'acc_lara_commbank',
    name: 'CommBank (Sueldo)',
    owner: 'lara',
    kind: 'commbank',
    currency: 'AUD',
    initialBalance: 2950,
    notes: 'Cuenta principal donde entra el sueldo',
  },
  {
    id: 'acc_lara_goalsaver',
    name: 'CommBank GoalSaver',
    owner: 'lara',
    kind: 'goalsaver',
    currency: 'AUD',
    initialBalance: 16200,
    notes: 'Ahorro colchón con interés bonus mensual',
  },
  {
    id: 'acc_lara_revolut',
    name: 'Revolut (Gastos diarios)',
    owner: 'lara',
    kind: 'revolut',
    currency: 'AUD',
    initialBalance: 720,
    notes: 'Tarjeta diaria y pagos cotidianos',
  },
  {
    id: 'acc_lara_moomoo',
    name: 'Moomoo (Inversiones)',
    owner: 'lara',
    kind: 'moomoo',
    currency: 'USD',
    initialBalance: 380,
    notes: 'Broker de acciones y ETFs',
  },
  {
    id: 'acc_abdiel_wise',
    name: 'Wise',
    owner: 'abdiel',
    kind: 'wise',
    currency: 'USD',
    initialBalance: 400,
    notes: 'Transferencias internacionales',
  },
  {
    id: 'acc_lara_efectivo',
    name: 'Efectivo',
    owner: 'lara',
    kind: 'cash',
    currency: 'AUD',
    initialBalance: 180,
    notes: 'Dinero en efectivo',
  },
];

export const DEFAULT_GOALSAVERS: Record<ProfileId, GoalSaverProfile> = {
  abdiel: {
    owner: 'abdiel',
    accountName: 'CommBank GoalSaver · Abdiel',
    currentBalance: 18500,
    monthlyContribution: 800,
    baseRateAnnual: 0.45,
    bonusRateAnnual: 4.45,
    currency: 'AUD',
  },
  lara: {
    owner: 'lara',
    accountName: 'CommBank GoalSaver · Lara',
    currentBalance: 16200,
    monthlyContribution: 700,
    baseRateAnnual: 0.45,
    bonusRateAnnual: 4.45,
    currency: 'AUD',
  },
};

export const DEFAULT_BUDGETS: Budget[] = [
  { id: 'bud_vivienda', categoryId: 'cat_vivienda', owner: 'all', monthlyLimit: 2400, currency: 'AUD' },
  { id: 'bud_super', categoryId: 'cat_supermercado', owner: 'all', monthlyLimit: 900, currency: 'AUD' },
  { id: 'bud_rest', categoryId: 'cat_restaurantes', owner: 'all', monthlyLimit: 350, currency: 'AUD' },
  { id: 'bud_transp', categoryId: 'cat_transporte', owner: 'all', monthlyLimit: 300, currency: 'AUD' },
  { id: 'bud_serv', categoryId: 'cat_servicios', owner: 'all', monthlyLimit: 320, currency: 'AUD' },
  { id: 'bud_susc', categoryId: 'cat_suscripciones', owner: 'all', monthlyLimit: 120, currency: 'AUD' },
  { id: 'bud_compras', categoryId: 'cat_compras', owner: 'all', monthlyLimit: 300, currency: 'AUD' },
  { id: 'bud_ocio', categoryId: 'cat_ocio', owner: 'all', monthlyLimit: 350, currency: 'AUD' },
];

export const DEFAULT_MOOMOO_HOLDINGS: MoomooHolding[] = [
  {
    id: 'moo_1',
    owner: 'abdiel',
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    assetType: 'ETF',
    shares: 12,
    avgCostPerShare: 445,
    currentPricePerShare: 518.4,
    dividendYieldAnnual: 1.32,
    currency: 'USD',
  },
  {
    id: 'moo_2',
    owner: 'abdiel',
    ticker: 'SCHD',
    name: 'Schwab US Dividend Equity ETF',
    assetType: 'ETF',
    shares: 85,
    avgCostPerShare: 25.8,
    currentPricePerShare: 28.9,
    dividendYieldAnnual: 3.45,
    currency: 'USD',
  },
  {
    id: 'moo_3',
    owner: 'abdiel',
    ticker: 'VAS',
    name: 'Vanguard Australian Shares ETF',
    assetType: 'ETF',
    shares: 38,
    avgCostPerShare: 91.5,
    currentPricePerShare: 101.2,
    dividendYieldAnnual: 3.6,
    currency: 'AUD',
  },
  {
    id: 'moo_4',
    owner: 'lara',
    ticker: 'IVV',
    name: 'iShares S&P 500 ETF (ASX)',
    assetType: 'ETF',
    shares: 65,
    avgCostPerShare: 49.2,
    currentPricePerShare: 58.6,
    dividendYieldAnnual: 1.25,
    currency: 'AUD',
  },
  {
    id: 'moo_5',
    owner: 'lara',
    ticker: 'NDQ',
    name: 'Betashares Nasdaq 100 ETF',
    assetType: 'ETF',
    shares: 72,
    avgCostPerShare: 37.8,
    currentPricePerShare: 46.1,
    dividendYieldAnnual: 0.9,
    currency: 'AUD',
  },
  {
    id: 'moo_6',
    owner: 'lara',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    assetType: 'Acción',
    shares: 14,
    avgCostPerShare: 185,
    currentPricePerShare: 226.5,
    dividendYieldAnnual: 0.45,
    currency: 'USD',
  },
];

function monthOffsetDate(monthsAgo: number, day: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, Math.min(day, 28));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildSampleTransactions(): Transaction[] {
  const list: Transaction[] = [];
  let idx = 1;

  const pushTx = (
    monthsAgo: number,
    day: number,
    owner: ProfileId,
    type: 'income' | 'expense' | 'transfer',
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
      amount,
      currency,
      categoryId,
      accountId,
      toAccountId,
      description,
      source: 'manual',
    });
  };

  for (let m = 5; m >= 0; m--) {
    // Sueldos en CommBank
    pushTx(m, 1, 'abdiel', 'income', 4650, 'AUD', 'cat_sueldo', 'acc_abdiel_commbank', 'Sueldo mensual Abdiel');
    pushTx(m, 1, 'lara', 'income', 4150, 'AUD', 'cat_sueldo', 'acc_lara_commbank', 'Sueldo mensual Lara');

    // Aportes a GoalSaver (transferencias internas)
    pushTx(
      m,
      2,
      'abdiel',
      'transfer',
      800,
      'AUD',
      'cat_transfer',
      'acc_abdiel_commbank',
      'Ahorro mensual a GoalSaver',
      'acc_abdiel_goalsaver'
    );
    pushTx(
      m,
      2,
      'lara',
      'transfer',
      700,
      'AUD',
      'cat_transfer',
      'acc_lara_commbank',
      'Ahorro mensual a GoalSaver',
      'acc_lara_goalsaver'
    );

    // Intereses GoalSaver recibidos
    pushTx(m, 28, 'abdiel', 'income', 74.2 + (5 - m) * 3.1, 'AUD', 'cat_intereses', 'acc_abdiel_goalsaver', 'Interés mensual CommBank GoalSaver');
    pushTx(m, 28, 'lara', 'income', 65.1 + (5 - m) * 2.8, 'AUD', 'cat_intereses', 'acc_lara_goalsaver', 'Interés mensual CommBank GoalSaver');

    // Alquiler desde CommBank
    pushTx(m, 3, 'abdiel', 'expense', 1200, 'AUD', 'cat_vivienda', 'acc_abdiel_commbank', 'Alquiler departamento (50%)');
    pushTx(m, 3, 'lara', 'expense', 1200, 'AUD', 'cat_vivienda', 'acc_lara_commbank', 'Alquiler departamento (50%)');

    // Servicios
    pushTx(m, 7, 'abdiel', 'expense', 145 + (m % 2) * 25, 'AUD', 'cat_servicios', 'acc_abdiel_commbank', 'Electricidad y Gas AGL');
    pushTx(m, 9, 'lara', 'expense', 89, 'AUD', 'cat_servicios', 'acc_lara_commbank', 'Internet Fibra');

    // Gastos diarios en Revolut
    pushTx(m, 4, 'abdiel', 'expense', 168.4 + m * 6, 'AUD', 'cat_supermercado', 'acc_abdiel_revolut', 'Woolworths compra semanal');
    pushTx(m, 11, 'lara', 'expense', 194.2 + (m % 3) * 18, 'AUD', 'cat_supermercado', 'acc_lara_revolut', 'Coles y verdulería');
    pushTx(m, 18, 'abdiel', 'expense', 210.5, 'AUD', 'cat_supermercado', 'acc_abdiel_revolut', 'Aldi & mercado');
    pushTx(m, 24, 'lara', 'expense', 185.0, 'AUD', 'cat_supermercado', 'acc_lara_revolut', 'Supermercado fin de mes');

    // Restaurantes (en el mes actual m===0 superamos ligeramente el presupuesto para mostrar la alerta!)
    pushTx(m, 6, 'abdiel', 'expense', 78.5, 'AUD', 'cat_restaurantes', 'acc_abdiel_revolut', 'Cena viernes');
    pushTx(m, 14, 'lara', 'expense', 94.0, 'AUD', 'cat_restaurantes', 'acc_lara_revolut', 'Brunch domingo');
    pushTx(m, 20, 'abdiel', 'expense', m === 0 ? 225.0 : 112.0, 'AUD', 'cat_restaurantes', 'acc_abdiel_revolut', m === 0 ? 'Cena aniversario y café' : 'Salida con amigos');

    // Transporte
    pushTx(m, 8, 'abdiel', 'expense', 92.0, 'AUD', 'cat_transporte', 'acc_abdiel_revolut', 'Opal / Transporte público');
    pushTx(m, 15, 'lara', 'expense', 110.0, 'AUD', 'cat_transporte', 'acc_lara_revolut', 'Combustible y Uber');

    // Suscripciones
    pushTx(m, 10, 'abdiel', 'expense', 22.99, 'AUD', 'cat_suscripciones', 'acc_abdiel_revolut', 'Netflix & Spotify');
    pushTx(m, 12, 'lara', 'expense', 55.0, 'AUD', 'cat_suscripciones', 'acc_lara_revolut', 'Gimnasio');

    // Compras / Salud / Ocio
    pushTx(m, 16, 'lara', 'expense', m === 1 ? 390 : 135, 'AUD', 'cat_compras', 'acc_lara_revolut', 'Artículos hogar & ropa');
    pushTx(m, 19, 'abdiel', 'expense', 84.0, 'AUD', 'cat_salud', 'acc_abdiel_revolut', 'Farmacia Chemist Warehouse');
    pushTx(m, 22, 'lara', 'expense', m === 2 ? 420 : 140, 'AUD', 'cat_ocio', 'acc_lara_revolut', m === 2 ? 'Escapada fin de semana' : 'Cine y salidas');

    // Dividendos Moomoo trimestrales
    if (m === 0 || m === 3) {
      pushTx(m, 15, 'abdiel', 'income', 68.5, 'USD', 'cat_dividendos', 'acc_abdiel_moomoo', 'Dividendos ETF VOO + SCHD');
      pushTx(m, 15, 'lara', 'income', 42.0, 'AUD', 'cat_dividendos', 'acc_lara_moomoo', 'Dividendos ETF IVV');
    }
  }

  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export const DEFAULT_FIXED_EXPENSES: FixedExpense[] = [
  {
    id: 'fix_1',
    name: 'Alquiler departamento (50% Abdiel)',
    owner: 'abdiel',
    amount: 1200,
    currency: 'AUD',
    categoryId: 'cat_vivienda',
    accountId: 'acc_abdiel_commbank',
    dueDay: 3,
  },
  {
    id: 'fix_2',
    name: 'Alquiler departamento (50% Lara)',
    owner: 'lara',
    amount: 1200,
    currency: 'AUD',
    categoryId: 'cat_vivienda',
    accountId: 'acc_lara_commbank',
    dueDay: 3,
  },
  {
    id: 'fix_3',
    name: 'Electricidad y Gas AGL',
    owner: 'abdiel',
    amount: 145,
    currency: 'AUD',
    categoryId: 'cat_servicios',
    accountId: 'acc_abdiel_commbank',
    dueDay: 7,
  },
  {
    id: 'fix_4',
    name: 'Internet Fibra Hogar',
    owner: 'lara',
    amount: 89,
    currency: 'AUD',
    categoryId: 'cat_servicios',
    accountId: 'acc_lara_commbank',
    dueDay: 9,
  },
  {
    id: 'fix_5',
    name: 'Netflix & Spotify',
    owner: 'abdiel',
    amount: 22.99,
    currency: 'AUD',
    categoryId: 'cat_suscripciones',
    accountId: 'acc_abdiel_revolut',
    dueDay: 15,
  },
  {
    id: 'fix_6',
    name: 'Gimnasio mensual',
    owner: 'lara',
    amount: 55,
    currency: 'AUD',
    categoryId: 'cat_suscripciones',
    accountId: 'acc_lara_revolut',
    dueDay: 18,
  },
];

function getSamplePaidMap(): Record<string, Record<string, boolean>> {
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    [mk]: {
      fix_1: true,
      fix_2: true,
      fix_3: true,
      fix_4: false,
      fix_5: false,
      fix_6: false,
    },
  };
}

export function createInitialFinanceState(withSamples = true): FinanceState {
  return {
    version: 1,
    displayCurrency: 'AUD',
    exchangeRates: {
      AUD: 1,
      USD: 1.54,
      EUR: 1.66,
      ARS: 0.0015,
      MXN: 0.077,
      CLP: 0.0016,
    },
    profiles: DEFAULT_PROFILES,
    accounts: DEFAULT_ACCOUNTS,
    categories: DEFAULT_CATEGORIES,
    transactions: withSamples ? buildSampleTransactions() : [],
    budgets: DEFAULT_BUDGETS,
    goalSavers: DEFAULT_GOALSAVERS,
    moomooHoldings: withSamples ? DEFAULT_MOOMOO_HOLDINGS : [],
    fixedExpenses: withSamples ? DEFAULT_FIXED_EXPENSES : [],
    fixedExpensePaidByMonth: withSamples ? getSamplePaidMap() : {},
    isSampleData: withSamples,
  };
}
