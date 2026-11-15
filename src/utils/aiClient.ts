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
import {
  CURRENCY_META,
  computeAccountBalances,
  getSavingsBalance,
  convertCurrency,
  getMonthKey,
  getTodayISO,
  guessCategoryId,
  normalizeDateToISO,
  type CsvPreset,
} from './formatters';

const VALID_TX_TYPES: TransactionType[] = ['expense', 'income', 'transfer'];
const VALID_PRESETS: Array<Exclude<CsvPreset, 'auto'>> = ['commbank', 'goalsaver', 'revolut', 'moomoo', 'generic'];
const VALID_ACCOUNT_KINDS: AccountKind[] = ['transaccional', 'ahorro', 'inversion', 'tarjeta_credito', 'efectivo', 'otra'];

function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && value.toUpperCase() in CURRENCY_META;
}

function asTxType(value: unknown): TransactionType | undefined {
  const v = String(value || '').toLowerCase() as TransactionType;
  return VALID_TX_TYPES.includes(v) ? v : undefined;
}

/** Guard against the model inventing category ids, types or currencies that don't exist in the app. */
function sanitizeDocumentAnalysis(
  raw: AiDocumentAnalysisResponse,
  categories: Category[],
  accounts: Account[],
  profiles: UserProfile[]
): AiDocumentAnalysisResponse {
  const catIds = new Set(categories.map((c) => c.id));
  const detectedCurrency: CurrencyCode = isCurrency(raw.detectedCurrency)
    ? (raw.detectedCurrency.toUpperCase() as CurrencyCode)
    : 'AUD';
  const txs = Array.isArray(raw.transactions) ? raw.transactions : [];
  const transactions: AiExtractedTransaction[] = [];
  for (const tx of txs) {
    const amount = Math.abs(Number(tx?.amount));
    if (!tx || !Number.isFinite(amount) || amount <= 0) continue;
    const type = asTxType(tx.type) || 'expense';
    const description = String(tx.description || '').trim();
    const categoryId = catIds.has(tx.categoryId) ? tx.categoryId : guessCategoryId(description, type);
    // The server calls it "tradeAction"; older responses used "moomooAction".
    const rawAction = String(tx.tradeAction || tx.moomooAction || '').toUpperCase();
    const moomooAction = ['BUY', 'SELL', 'DIVIDEND'].includes(rawAction)
      ? (rawAction as 'BUY' | 'SELL' | 'DIVIDEND')
      : '';
    const direction = tx.direction === 'in' || tx.direction === 'out' ? tx.direction : '';
    transactions.push({
      ...tx,
      date: normalizeDateToISO(String(tx.date || '')),
      description,
      amount,
      type,
      direction,
      currency: isCurrency(tx.currency) ? (tx.currency.toUpperCase() as CurrencyCode) : detectedCurrency,
      categoryId: catIds.has(categoryId) ? categoryId : categories[0]?.id || categoryId,
      ticker: String(tx.ticker || '').toUpperCase().trim(),
      moomooAction,
      shares: Number(tx.shares) > 0 ? Number(tx.shares) : undefined,
      price: Number(tx.price) > 0 ? Number(tx.price) : undefined,
    });
  }

  const profileIds = new Set(profiles.map((p) => p.id));
  const suggested = raw.suggestedNewAccount;
  return {
    ...raw,
    owner: profileIds.has(raw.owner) ? raw.owner : profiles[0]?.id || raw.owner,
    preset: VALID_PRESETS.includes(raw.preset) ? raw.preset : 'generic',
    targetAccountId: accounts.some((a) => a.id === raw.targetAccountId) ? raw.targetAccountId : '',
    detectedCurrency,
    closingBalance: Number(raw.closingBalance) > 0 ? Number(raw.closingBalance) : 0,
    summary: String(raw.summary || ''),
    suggestedNewAccount: suggested
      ? {
          ...suggested,
          kind: VALID_ACCOUNT_KINDS.includes(suggested.kind) ? suggested.kind : 'otra',
          institution: String(suggested.institution || '').trim() || undefined,
          currency: isCurrency(suggested.currency)
            ? (suggested.currency.toUpperCase() as CurrencyCode)
            : detectedCurrency,
        }
      : undefined,
    transactions,
  };
}
import type { DetectionConfidence } from './statementDetector';

export interface AiExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  /** "in" = money entered the statement account, "out" = money left it. */
  direction?: 'in' | 'out' | '';
  currency: CurrencyCode;
  categoryId: string;
  classificationNote?: string;
  ticker?: string;
  moomooAction?: 'BUY' | 'SELL' | 'DIVIDEND' | '';
  tradeAction?: string;
  shares?: number;
  price?: number;
  assetType?: 'ETF' | 'Acción' | 'Fondo' | '';
}

export interface AiSuggestedNewAccount {
  shouldCreate: boolean;
  name: string;
  owner: ProfileId;
  kind: AccountKind;
  institution?: string;
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
  institution?: string;
  notes?: string;
  date?: string;
}

export interface AiAssistantResponse {
  reply: string;
  highlights: string[];
  proposedActions: AiProposedAction[];
}

/** Supplies the signed-in user's Firebase ID token (cloud mode). Null in local-only mode. */
type TokenProvider = (forceRefresh?: boolean) => Promise<string>;
let tokenProvider: TokenProvider | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null) {
  tokenProvider = provider;
}

async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const token = tokenProvider ? await tokenProvider(forceRefresh) : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postAiJson<T>(endpoint: string, body: unknown): Promise<T> {
  const send = async (forceRefresh: boolean) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders(forceRefresh)) },
      body: JSON.stringify(body),
    });

  let res = await send(false);
  // An expired token is refreshed once and the call retried.
  if (res.status === 401 && tokenProvider) res = await send(true);

  const payload = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (res.status === 401 || res.status === 403) {
    throw new Error(payload.error || 'Tu sesión no está autorizada para usar la IA.');
  }
  if (res.status === 413) {
    throw new Error('El archivo es demasiado grande para analizarlo con IA (máximo ~7 MB).');
  }
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
  const raw = await postAiJson<AiDocumentAnalysisResponse>('/api/ai/analyze-document', {
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
      institution: a.institution || '',
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
  return sanitizeDocumentAnalysis(raw, params.categories, params.accounts, params.profiles || []);
}

export async function classifyTransactionsWithAi(params: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  lang: 'es' | 'en';
}): Promise<{ summary: string; suggestions: AiClassificationSuggestion[] }> {
  const raw = await postAiJson<{ summary: string; suggestions: AiClassificationSuggestion[] }>(
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
  const catIds = new Set(params.categories.map((c) => c.id));
  const txIds = new Set(params.transactions.map((t) => t.id));
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : [])
    .filter((sug) => sug && txIds.has(String(sug.id)))
    .map((sug) => {
      const original = params.transactions.find((t) => t.id === String(sug.id))!;
      const suggestedType = asTxType(sug.suggestedType) || original.type;
      return {
        ...sug,
        id: String(sug.id),
        suggestedType,
        suggestedCategoryId: catIds.has(sug.suggestedCategoryId)
          ? sug.suggestedCategoryId
          : original.categoryId,
        suggestedDescription: String(sug.suggestedDescription || '').trim() || original.description,
      };
    });
  return { summary: String(raw.summary || ''), suggestions };
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

const SNAPSHOT_MAX_MONTH_TX = 80;
const SNAPSHOT_MAX_UNCATEGORIZED = 20;
export const ASSISTANT_MAX_HISTORY = 10;

/**
 * Compact context for the assistant: only what it needs to answer about the selected month
 * (summary, totals per category, budgets, balances and that month's movements, capped) instead of
 * the full history. Keeps requests cheaper and sends less personal data.
 */
export function buildFinancialSnapshot(
  state: FinanceState,
  activeProfile: ProfileFilter,
  selectedMonth: string
) {
  const dc = state.displayCurrency;
  const inScope = (owner: string) => activeProfile === 'all' || owner === activeProfile;
  const profileTxs = state.transactions.filter((t) => inScope(t.owner));
  const monthTxs = profileTxs.filter((t) => getMonthKey(t.date) === selectedMonth);
  const round = (n: number) => Number(n.toFixed(2));

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

  const accountBalances = computeAccountBalances(state.accounts, state.transactions, state.exchangeRates);
  const visibleAccounts = state.accounts.filter((a) => inScope(a.owner));

  // This month's movements, biggest first, capped.
  const monthMovements = [...monthTxs]
    .sort(
      (a, b) =>
        convertCurrency(b.amount, b.currency, dc, state.exchangeRates) -
        convertCurrency(a.amount, a.currency, dc, state.exchangeRates)
    )
    .slice(0, SNAPSHOT_MAX_MONTH_TX);
  const monthIds = new Set(monthMovements.map((t) => t.id));
  // A few recent movements in generic categories (outside the month) so the agent can propose reclassifications.
  const uncategorized = profileTxs
    .filter((t) => !monthIds.has(t.id) && (t.categoryId === 'cat_otros_gastos' || t.categoryId === 'cat_otros_ingresos'))
    .slice(0, SNAPSHOT_MAX_UNCATEGORIZED);

  const txRow = (t: Transaction) => ({
    id: t.id,
    owner: t.owner,
    type: t.type,
    date: t.date,
    amount: t.amount,
    currency: t.currency,
    categoryId: t.categoryId,
    accountId: t.accountId,
    description: t.description.slice(0, 80),
  });

  const paidMap = state.fixedExpensePaidByMonth[selectedMonth] || {};

  // Investments aggregated per ticker (no per-lot detail).
  const investments = state.investments
    .filter((h) => inScope(h.owner))
    .map((h) => ({
      owner: h.owner,
      accountId: h.accountId || '',
      ticker: h.ticker,
      assetType: h.assetType,
      marketValue: round(h.shares * h.currentPricePerShare),
      costBasis: round(h.shares * h.avgCostPerShare),
      dividendYieldAnnual: h.dividendYieldAnnual,
      currency: h.currency,
    }));

  return {
    displayCurrency: dc,
    selectedMonth,
    activeProfile,
    profiles: state.profiles.map((p) => ({ id: p.id, name: p.name })),
    monthSummary: {
      income: round(monthIncome),
      expenses: round(monthExpenses),
      netSavings: round(netSavings),
      savingsRatePct: monthIncome > 0 ? Number(((netSavings / monthIncome) * 100).toFixed(1)) : 0,
      movementCount: monthTxs.length,
      movementsIncluded: monthMovements.length,
    },
    categories: state.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      ...(spentByCategory.get(c.id) ? { spentThisMonth: round(spentByCategory.get(c.id) || 0) } : {}),
    })),
    budgets: state.budgets
      .filter((b) => b.owner === 'all' || inScope(b.owner))
      .map((b) => ({
        id: b.id,
        categoryId: b.categoryId,
        owner: b.owner,
        monthlyLimit: b.monthlyLimit,
        currency: b.currency,
        spentThisMonth: round(spentByCategory.get(b.categoryId) || 0),
      })),
    accounts: visibleAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      owner: a.owner,
      kind: a.kind,
      currency: a.currency,
      balance: round(accountBalances.get(a.id) ?? a.initialBalance),
    })),
    savingsAccounts: state.savingsConfigs
      .filter((c) => inScope(c.owner))
      .map((c) => ({
        name: c.name,
        owner: c.owner,
        accountId: c.accountId || '',
        balance: round(getSavingsBalance(c, accountBalances, state.accounts, state.exchangeRates)),
        monthlyContribution: c.monthlyContribution,
        baseRateAnnual: c.baseRateAnnual,
        bonusRateAnnual: c.bonusRateAnnual,
        currency: c.currency,
      })),
    investments,
    fixedExpenses: state.fixedExpenses
      .filter((f) => inScope(f.owner))
      .map((f) => ({
        id: f.id,
        name: f.name,
        owner: f.owner,
        amount: f.amount,
        currency: f.currency,
        dueDay: f.dueDay,
        isPaid: Boolean(paidMap[f.id]),
      })),
    monthTransactions: monthMovements.map(txRow),
    recentUncategorizedTransactions: uncategorized.map(txRow),
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
    // Only the most recent turns are re-sent.
    messages: params.messages.slice(-ASSISTANT_MAX_HISTORY),
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
