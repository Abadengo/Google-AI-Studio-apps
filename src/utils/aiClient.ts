import type {
  Account,
  AccountKind,
  Category,
  CurrencyCode,
  FinanceState,
  ProfileFilter,
  ProfileId,
  Transaction,
  TransactionType,
  UserProfile,
} from '../types/finance';
import { convertCurrency, getMonthKey, getTodayISO, type CsvPreset } from './formatters';
import type { DetectionConfidence } from './statementDetector';

export interface AiExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  currency: CurrencyCode;
  categoryId: string;
  classificationNote?: string;
  ticker?: string;
  moomooAction?: 'BUY' | 'SELL' | 'DIVIDEND' | '';
  shares?: number;
  price?: number;
  assetType?: 'ETF' | 'Acción' | 'Fondo' | '';
}

export interface AiSuggestedNewAccount {
  shouldCreate: boolean;
  name: string;
  owner: ProfileId;
  kind: AccountKind;
  currency: CurrencyCode;
  notes: string;
}

export interface AiDocumentAnalysisResponse {
  owner: ProfileId;
  ownerReason: string;
  confidence: DetectionConfidence;
  preset: Exclude<CsvPreset, 'auto'>;
  targetAccountId: string;
  matchedExistingAccount: boolean;
  suggestedNewAccount?: AiSuggestedNewAccount;
  detectedCurrency: CurrencyCode;
  closingBalance: number;
  summary: string;
  transactions: AiExtractedTransaction[];
}

export interface AiClassificationSuggestion {
  id: string;
  suggestedCategoryId: string;
  suggestedType: TransactionType;
  suggestedDescription: string;
  confidence: string;
  reason: string;
}

export interface AiQuickEntryResult {
  owner?: ProfileId;
  type?: TransactionType;
  date?: string;
  amount?: number;
  currency?: CurrencyCode;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  description?: string;
  reasoning?: string;
}

export interface AiProposedAction {
  actionType:
    | 'reclassify_tx'
    | 'upsert_budget'
    | 'add_fixed_expense'
    | 'add_transaction'
    | 'create_account'
    | 'delete_account';
  title: string;
  detail: string;
  txId?: string;
  categoryId?: string;
  txType?: TransactionType;
  description?: string;
  owner?: ProfileId;
  monthlyLimit?: number;
  currency?: CurrencyCode;
  amount?: number;
  dueDay?: number;
  accountId?: string;
  accountKind?: AccountKind;
  notes?: string;
  date?: string;
}

export interface AiAssistantResponse {
  reply: string;
  highlights: string[];
  proposedActions: AiProposedAction[];
}

async function postAiJson<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(payload.error || `Error ${res.status}`);
  }
  return payload;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file as base64'));
    reader.readAsDataURL(file);
  });
}

export async function analyzeDocumentWithAi(params: {
  fileName: string;
  mimeType: string;
  base64Data?: string;
  textContent?: string;
  accounts: Account[];
  categories: Category[];
  profiles?: UserProfile[];
  activeProfile: ProfileFilter;
  lang: 'es' | 'en';
}): Promise<AiDocumentAnalysisResponse> {
  return postAiJson<AiDocumentAnalysisResponse>('/api/ai/analyze-document', {
    fileName: params.fileName,
    mimeType: params.mimeType,
    base64Data: params.base64Data,
    textContent: params.textContent,
    profiles: (params.profiles || []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role || '',
      email: p.email || '',
    })),
    accounts: params.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      owner: a.owner,
      kind: a.kind,
      currency: a.currency,
      notes: a.notes || '',
    })),
    categories: params.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
    })),
    activeProfile: params.activeProfile,
    lang: params.lang,
  });
}

export async function classifyTransactionsWithAi(params: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  lang: 'es' | 'en';
}): Promise<{ summary: string; suggestions: AiClassificationSuggestion[] }> {
  return postAiJson<{ summary: string; suggestions: AiClassificationSuggestion[] }>(
    '/api/ai/classify-transactions',
    {
      transactions: params.transactions.slice(0, 120).map((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        currency: tx.currency,
        type: tx.type,
        categoryId: tx.categoryId,
        accountId: tx.accountId,
        owner: tx.owner,
      })),
      categories: params.categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      accounts: params.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        owner: a.owner,
        kind: a.kind,
      })),
      lang: params.lang,
    }
  );
}

export async function parseQuickEntryWithAi(params: {
  promptText?: string;
  imageBase64?: string;
  imageMimeType?: string;
  accounts: Account[];
  categories: Category[];
  profiles?: UserProfile[];
  activeProfile: ProfileFilter;
  lang: 'es' | 'en';
}): Promise<AiQuickEntryResult> {
  return postAiJson<AiQuickEntryResult>('/api/ai/parse-quick-entry', {
    promptText: params.promptText,
    imageBase64: params.imageBase64,
    imageMimeType: params.imageMimeType,
    profiles: (params.profiles || []).map((p) => ({ id: p.id, name: p.name })),
    accounts: params.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      owner: a.owner,
      kind: a.kind,
      currency: a.currency,
    })),
    categories: params.categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    activeProfile: params.activeProfile,
    todayIso: getTodayISO(),
    lang: params.lang,
  });
}

export function buildFinancialSnapshot(
  state: FinanceState,
  activeProfile: ProfileFilter,
  selectedMonth: string
) {
  const dc = state.displayCurrency;
  const profileTxs =
    activeProfile === 'all'
      ? state.transactions
      : state.transactions.filter((t) => t.owner === activeProfile);

  const monthTxs = profileTxs.filter((t) => getMonthKey(t.date) === selectedMonth);

  let monthIncome = 0;
  let monthExpenses = 0;
  const spentByCategory = new Map<string, number>();

  for (const tx of monthTxs) {
    const val = convertCurrency(tx.amount, tx.currency, dc, state.exchangeRates);
    if (tx.type === 'income') monthIncome += val;
    else if (tx.type === 'expense') {
      monthExpenses += val;
      spentByCategory.set(tx.categoryId, (spentByCategory.get(tx.categoryId) || 0) + val);
    }
  }

  const netSavings = monthIncome - monthExpenses;
  const savingsRatePct = monthIncome > 0 ? Number(((netSavings / monthIncome) * 100).toFixed(1)) : 0;

  const accountBalances = new Map<string, number>();
  for (const acc of state.accounts) accountBalances.set(acc.id, acc.initialBalance);
  for (const tx of state.transactions) {
    if (tx.type === 'income') {
      const a = state.accounts.find((x) => x.id === tx.accountId);
      if (a) {
        accountBalances.set(
          a.id,
          (accountBalances.get(a.id) || 0) +
            convertCurrency(tx.amount, tx.currency, a.currency, state.exchangeRates)
        );
      }
    } else if (tx.type === 'expense') {
      const a = state.accounts.find((x) => x.id === tx.accountId);
      if (a) {
        accountBalances.set(
          a.id,
          (accountBalances.get(a.id) || 0) -
            convertCurrency(tx.amount, tx.currency, a.currency, state.exchangeRates)
        );
      }
    } else if (tx.type === 'transfer') {
      const from = state.accounts.find((x) => x.id === tx.accountId);
      const to = tx.toAccountId ? state.accounts.find((x) => x.id === tx.toAccountId) : undefined;
      if (from) {
        accountBalances.set(
          from.id,
          (accountBalances.get(from.id) || 0) -
            convertCurrency(tx.amount, tx.currency, from.currency, state.exchangeRates)
        );
      }
      if (to) {
        accountBalances.set(
          to.id,
          (accountBalances.get(to.id) || 0) +
            convertCurrency(tx.amount, tx.currency, to.currency, state.exchangeRates)
        );
      }
    }
  }

  const paidMap = state.fixedExpensePaidByMonth[selectedMonth] || {};

  return {
    displayCurrency: dc,
    selectedMonth,
    activeProfile,
    profiles: state.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role || '',
      country: p.country || '',
    })),
    monthSummary: {
      income: Number(monthIncome.toFixed(2)),
      expenses: Number(monthExpenses.toFixed(2)),
      netSavings: Number(netSavings.toFixed(2)),
      savingsRatePct,
    },
    categories: state.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      spentThisMonth: Number((spentByCategory.get(c.id) || 0).toFixed(2)),
    })),
    budgets: state.budgets.map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      owner: b.owner,
      monthlyLimit: b.monthlyLimit,
      currency: b.currency,
      spentThisMonth: Number((spentByCategory.get(b.categoryId) || 0).toFixed(2)),
    })),
    accounts: state.accounts
      .filter((a) => activeProfile === 'all' || a.owner === activeProfile)
      .map((a) => ({
        id: a.id,
        name: a.name,
        owner: a.owner,
        kind: a.kind,
        currency: a.currency,
        balance: Number((accountBalances.get(a.id) ?? a.initialBalance).toFixed(2)),
      })),
    goalSavers: state.goalSavers,
    fixedExpenses: state.fixedExpenses
      .filter((f) => activeProfile === 'all' || f.owner === activeProfile)
      .map((f) => ({
        id: f.id,
        name: f.name,
        owner: f.owner,
        amount: f.amount,
        currency: f.currency,
        dueDay: f.dueDay,
        isPaid: Boolean(paidMap[f.id]),
      })),
    moomooHoldings: state.moomooHoldings
      .filter((h) => activeProfile === 'all' || h.owner === activeProfile)
      .map((h) => ({
        owner: h.owner,
        ticker: h.ticker,
        name: h.name,
        assetType: h.assetType,
        shares: h.shares,
        avgCost: h.avgCostPerShare,
        currentPrice: h.currentPricePerShare,
        dividendYieldAnnual: h.dividendYieldAnnual,
        currency: h.currency,
      })),
    recentAndUncategorizedTransactions: profileTxs.slice(0, 35).map((t) => ({
      id: t.id,
      owner: t.owner,
      type: t.type,
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      categoryId: t.categoryId,
      accountId: t.accountId,
      description: t.description,
    })),
  };
}

export async function askFinancialAssistant(params: {
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  activeTab: string;
  activeProfile: ProfileFilter;
  selectedMonth: string;
  lang: 'es' | 'en';
  state: FinanceState;
}): Promise<AiAssistantResponse> {
  return postAiJson<AiAssistantResponse>('/api/ai/assistant', {
    messages: params.messages,
    activeTab: params.activeTab,
    activeProfile: params.activeProfile,
    selectedMonth: params.selectedMonth,
    lang: params.lang,
    financialSnapshot: buildFinancialSnapshot(
      params.state,
      params.activeProfile,
      params.selectedMonth
    ),
  });
}
