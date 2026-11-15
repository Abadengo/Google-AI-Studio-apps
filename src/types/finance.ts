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

export type AccountKind = 'commbank' | 'goalsaver' | 'revolut' | 'moomoo' | 'wise' | 'cash' | 'other';

export interface Account {
  id: string;
  name: string;
  owner: ProfileId;
  kind: AccountKind;
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
    | 'ai_document';
}

export interface Budget {
  id: string;
  categoryId: string;
  owner: ProfileFilter;
  monthlyLimit: number;
  currency: CurrencyCode;
}

export interface GoalSaverProfile {
  owner: ProfileId;
  accountName: string;
  currentBalance: number;
  monthlyContribution: number;
  baseRateAnnual: number; // e.g. 0.45%
  bonusRateAnnual: number; // e.g. 4.45% (paid if balance grows monthly)
  currency: CurrencyCode;
}

export interface MoomooHolding {
  id: string;
  owner: ProfileId;
  ticker: string;
  name: string;
  assetType: 'ETF' | 'Acción' | 'Fondo';
  shares: number;
  avgCostPerShare: number;
  currentPricePerShare: number;
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

export interface FinanceState {
  version: number;
  displayCurrency: CurrencyCode;
  exchangeRates: ExchangeRates;
  profiles: UserProfile[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  goalSavers: Record<string, GoalSaverProfile>;
  moomooHoldings: MoomooHolding[];
  fixedExpenses: FixedExpense[];
  fixedExpensePaidByMonth: Record<string, Record<string, boolean>>;
  isSampleData: boolean;
}
