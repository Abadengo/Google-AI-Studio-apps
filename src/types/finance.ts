export type ProfileId = string;
export type ProfileFilter = 'all' | ProfileId;

export interface UserProfile {
  id: ProfileId;
  name: string;
  email?: string;
  role?: string;
  phone?: string;
  country?: string;
  notes?: string;
  color: string;
}

export type CurrencyCode = 'AUD' | 'USD' | 'EUR' | 'ARS' | 'MXN' | 'CLP';

export type TransactionType = 'expense' | 'income' | 'transfer';

/** Generic account types (v2). Bank/broker names live in `institution`, never in the type. */
export type AccountKind =
  | 'transaccional' // cuenta corriente / débito
  | 'ahorro'
  | 'inversion'
  | 'tarjeta_credito'
  | 'efectivo'
  | 'otra';

/** Account kinds used before data version 2 (kept only for migrations). */
export type LegacyAccountKind = 'commbank' | 'goalsaver' | 'revolut' | 'moomoo' | 'wise' | 'cash' | 'other';

export interface Account {
  id: string;
  name: string;
  owner: ProfileId;
  kind: AccountKind;
  /** Optional, informative only (e.g. "CommBank"). Typed by the user. */
  institution?: string;
  currency: CurrencyCode;
  initialBalance: number;
  notes?: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'income' | 'both';
  color: string;
}

export interface Transaction {
  id: string;
  owner: ProfileId;
  type: TransactionType;
  date: string; // YYYY-MM-DD
  amount: number; // positive number
  currency: CurrencyCode;
  categoryId: string;
  accountId: string;
  toAccountId?: string; // only for internal transfers
  description: string;
  source?:
    | 'manual'
    | 'csv_commbank'
    | 'csv_revolut'
    | 'csv_moomoo'
    | 'csv_other'
    | 'pdf_commbank'
    | 'pdf_goalsaver'
    | 'pdf_revolut'
    | 'pdf_moomoo'
    | 'pdf_other'
    | 'ai_document'; // kept so older imported movements stay valid
}

export interface Budget {
  id: string;
  categoryId: string;
  owner: ProfileFilter;
  monthlyLimit: number;
  currency: CurrencyCode;
}

/**
 * Interest settings for a savings account ("cuenta de ahorro con interés").
 * When `accountId` points to an account of kind 'ahorro', the live balance of that account is used;
 * otherwise `currentBalance` is used.
 */
export interface SavingsInterestConfig {
  id: string;
  owner: ProfileId;
  accountId?: string;
  /** true → projections use the linked account's live balance; false → use `currentBalance`. */
  useAccountBalance: boolean;
  name: string;
  currentBalance: number;
  monthlyContribution: number;
  baseRateAnnual: number; // % anual base
  bonusRateAnnual: number; // % anual adicional si se cumple la condición (aportar cada mes)
  currency: CurrencyCode;
}

export interface InvestmentHolding {
  id: string;
  owner: ProfileId;
  /** Optional link to an account of kind 'inversion'. */
  accountId?: string;
  ticker: string;
  name: string;
  assetType: 'ETF' | 'Acción' | 'Fondo';
  shares: number;
  avgCostPerShare: number;
  currentPricePerShare: number;
  /** ISO date of the last manual price update (prices are entered by hand). */
  priceUpdatedAt?: string;
  dividendYieldAnnual: number; // % e.g. 1.5
  currency: CurrencyCode;
  notes?: string;
}

export interface FixedExpense {
  id: string;
  name: string;
  owner: ProfileId;
  amount: number;
  currency: CurrencyCode;
  categoryId: string;
  accountId: string;
  dueDay: number;
}

export interface ExchangeRates {
  // Value of 1 unit of currency in AUD (e.g. USD: 1.54 means 1 USD = 1.54 AUD)
  AUD: number;
  USD: number;
  EUR: number;
  ARS: number;
  MXN: number;
  CLP: number;
}

export const CURRENT_DATA_VERSION = 2;

export interface FinanceState {
  version: number;
  displayCurrency: CurrencyCode;
  exchangeRates: ExchangeRates;
  /** ISO timestamp of the last manual edit or live update of exchange rates. */
  exchangeRatesUpdatedAt?: string;
  profiles: UserProfile[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  savingsConfigs: SavingsInterestConfig[];
  investments: InvestmentHolding[];
  fixedExpenses: FixedExpense[];
  fixedExpensePaidByMonth: Record<string, Record<string, boolean>>;
  /** ISO timestamp of the last .json backup download. */
  lastBackupAt?: string;
  isSampleData: boolean;
}
