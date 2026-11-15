import { useCallback, useEffect, useState } from 'react';
import { createInitialFinanceState, createSavingsConfig } from '../data/defaultState';
import { normalizeState } from '../data/migrations';
import type { CloudSync } from '../firebase/cloudStore';
import {
  CURRENT_DATA_VERSION,
  type Account,
  type Budget,
  type Category,
  type CurrencyCode,
  type ExchangeRates,
  type FinanceState,
  type FixedExpense,
  type InvestmentHolding,
  type ProfileFilter,
  type ProfileId,
  type SavingsInterestConfig,
  type Transaction,
  type UserProfile,
} from '../types/finance';

// IMPORTANT: real household data lives under this key. Never rename it; change the data shape
// through a migration in data/migrations.ts instead.
const STORAGE_KEY = 'finanzas_hogar_abdiel_lara_v1';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadStateFromStorage(): FinanceState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return createInitialFinanceState(true);

  try {
    const parsed = JSON.parse(raw) as { version?: number };
    const storedVersion = Number(parsed?.version) || 1;
    if (storedVersion < CURRENT_DATA_VERSION) {
      // Keep an untouched copy of the pre-migration data, just in case.
      try {
        window.localStorage.setItem(`${STORAGE_KEY}_pre_v${CURRENT_DATA_VERSION}_backup`, raw);
      } catch {
        /* storage full: the migration still runs, the original stays in memory */
      }
    }
    return normalizeState(parsed);
  } catch (err) {
    // Never silently overwrite unreadable data: keep a copy before falling back to samples.
    try {
      window.localStorage.setItem(`${STORAGE_KEY}_corrupt_${Date.now()}`, raw);
    } catch {
      /* ignore */
    }
    console.error('No se pudieron leer los datos guardados:', err);
    return createInitialFinanceState(true);
  }
}

/**
 * Changing a transaction's type must keep the money flowing in the same direction:
 * an inflow (income) turned into a transfer becomes an incoming transfer to the same account,
 * and an incoming transfer turned back into income/expense goes back to its destination account.
 */
function retypeTransaction(tx: Transaction, nextType: Transaction['type']): Transaction {
  if (nextType === tx.type) return tx;
  if (nextType === 'transfer') {
    if (tx.type === 'income') {
      return { ...tx, type: 'transfer', accountId: '', toAccountId: tx.accountId };
    }
    return { ...tx, type: 'transfer' };
  }
  // transfer -> income/expense
  if (tx.type === 'transfer') {
    const next: Transaction = { ...tx, type: nextType, accountId: tx.accountId || tx.toAccountId || '' };
    delete next.toAccountId;
    return next;
  }
  return { ...tx, type: nextType };
}

/** Reads the legacy browser-only data (used for the one-time import into the cloud). */
export function readLocalBrowserState(): { state: FinanceState; isSample: boolean } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = normalizeState(JSON.parse(raw));
    return { state, isSample: state.isSampleData };
  } catch {
    return null;
  }
}

export const LOCAL_STORAGE_KEY = STORAGE_KEY;

export interface FinanceStoreOptions {
  /** Cloud mode: state comes from Firestore and every change is synced there. */
  cloud?: { initialState: FinanceState; sync: CloudSync };
}

export function useFinanceStore(options: FinanceStoreOptions = {}) {
  const cloud = options.cloud;
  const [state, setState] = useState<FinanceState>(() => cloud?.initialState ?? loadStateFromStorage());
  const [saveError, setSaveError] = useState<string | null>(null);

  // Cloud mode: listen to the other device and report sync errors.
  useEffect(() => {
    if (!cloud) return;
    const offError = cloud.sync.onError(setSaveError);
    const unsubscribe = cloud.sync.subscribe(setState);
    return () => {
      offError();
      unsubscribe();
    };
  }, [cloud]);

  useEffect(() => {
    if (cloud) {
      cloud.sync.push(state);
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveError(null);
    } catch (err) {
      console.error('Error guardando en localStorage:', err);
      setSaveError(
        err instanceof Error ? err.message : 'No se pudo guardar en el almacenamiento del navegador'
      );
    }
  }, [state, cloud]);

  const setDisplayCurrency = useCallback((currency: CurrencyCode) => {
    setState((prev) => ({ ...prev, displayCurrency: currency }));
  }, []);

  const updateExchangeRates = useCallback((rates: ExchangeRates) => {
    setState((prev) => ({ ...prev, exchangeRates: { ...rates, AUD: 1 }, exchangeRatesUpdatedAt: new Date().toISOString() }));
  }, []);

  const markBackupDone = useCallback(() => {
    setState((prev) => ({ ...prev, lastBackupAt: new Date().toISOString() }));
  }, []);

  // Transactions
  const addTransaction = useCallback((tx: Omit<Transaction, 'id'>) => {
    const id = uid('tx');
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      transactions: [{ ...tx, id }, ...prev.transactions].sort((a, b) =>
        b.date.localeCompare(a.date)
      ),
    }));
  }, []);

  const updateTransaction = useCallback((updated: Transaction) => {
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      transactions: prev.transactions
        .map((t) => (t.id === updated.id ? updated : t))
        .sort((a, b) => b.date.localeCompare(a.date)),
    }));
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }));
  }, []);

  const updateTransactionsBatch = useCallback(
    (
      patches: Array<{
        id: string;
        categoryId?: string;
        type?: Transaction['type'];
        description?: string;
        owner?: ProfileId;
        accountId?: string;
        toAccountId?: string;
      }>
    ) => {
      if (patches.length === 0) return 0;
      const patchMap = new Map(patches.map((p) => [p.id, p]));
      let changedCount = 0;

      setState((prev) => ({
        ...prev,
        isSampleData: false,
        transactions: prev.transactions.map((tx) => {
          const patch = patchMap.get(tx.id);
          if (!patch) return tx;
          changedCount++;
          const retyped = patch.type !== undefined ? retypeTransaction(tx, patch.type) : tx;
          return {
            ...retyped,
            ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
            ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
            ...(patch.toAccountId !== undefined ? { toAccountId: patch.toAccountId } : {}),
          };
        }),
      }));
      return changedCount || patches.length;
    },
    []
  );

  const importTransactionsBatch = useCallback((items: Omit<Transaction, 'id'>[]) => {
    const now = Date.now();
    const newTxs: Transaction[] = items.map((item, idx) => ({
      ...item,
      id: `tx_csv_${now}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    }));

    setState((prev) => ({
      ...prev,
      isSampleData: false,
      transactions: [...newTxs, ...prev.transactions].sort((a, b) =>
        b.date.localeCompare(a.date)
      ),
    }));
    return newTxs.length;
  }, []);

  // Categories
  const addCategory = useCallback((cat: Omit<Category, 'id'>) => {
    const id = uid('cat');
    setState((prev) => ({
      ...prev,
      categories: [...prev.categories, { ...cat, id }],
    }));
    return id;
  }, []);

  // Accounts
  const addAccount = useCallback((acc: Omit<Account, 'id'>) => {
    const id = uid('acc');
    setState((prev) => ({
      ...prev,
      accounts: [...prev.accounts, { ...acc, id }],
    }));
    return id;
  }, []);

  const updateAccount = useCallback((acc: Account) => {
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === acc.id ? acc : a)),
    }));
  }, []);

  const deleteAccount = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.filter((a) => a.id !== id),
      // Movements that only lived in the deleted account are removed; transfers that touched it
      // keep the other side (as a one-sided transfer) so the remaining account balance is unchanged.
      transactions: prev.transactions
        .filter((t) => {
          if (t.type === 'transfer') {
            const from = t.accountId === id ? '' : t.accountId;
            const to = t.toAccountId === id ? '' : t.toAccountId || '';
            return Boolean(from || to);
          }
          return t.accountId !== id;
        })
        .map((t) => {
          if (t.type !== 'transfer') return t;
          if (t.accountId === id) return { ...t, accountId: '' };
          if (t.toAccountId === id) {
            const next = { ...t };
            delete next.toAccountId;
            return next;
          }
          return t;
        }),
      fixedExpenses: prev.fixedExpenses.filter((f) => f.accountId !== id),
      // Keep interest settings and holdings, just unlink them from the deleted account.
      savingsConfigs: prev.savingsConfigs.map((c) =>
        c.accountId === id ? { ...c, accountId: undefined, useAccountBalance: false } : c
      ),
      investments: prev.investments.map((h) => (h.accountId === id ? { ...h, accountId: undefined } : h)),
    }));
  }, []);

  // Budgets
  const upsertBudget = useCallback((budget: Omit<Budget, 'id'> & { id?: string }) => {
    setState((prev) => {
      const existing = prev.budgets.find(
        (b) =>
          (budget.id && b.id === budget.id) ||
          (b.categoryId === budget.categoryId && b.owner === budget.owner)
      );
      if (existing) {
        return {
          ...prev,
          budgets: prev.budgets.map((b) =>
            b.id === existing.id ? { ...b, ...budget, id: existing.id } : b
          ),
        };
      }
      const newBudget: Budget = {
        ...budget,
        id: uid('bud'),
      };
      return {
        ...prev,
        budgets: [...prev.budgets, newBudget],
      };
    });
  }, []);

  const deleteBudget = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      budgets: prev.budgets.filter((b) => b.id !== id),
    }));
  }, []);

  // Profiles
  const addProfile = useCallback((profile: Omit<UserProfile, 'id'>) => {
    const slug =
      profile.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 18) || 'user';
    const id = `prof_${slug}_${Math.random().toString(36).slice(2, 8)}`;
    const newProfile: UserProfile = {
      ...profile,
      id,
      name: profile.name.trim() || 'Nuevo perfil',
    };
    setState((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newProfile],
    }));
    return id;
  }, []);

  const updateProfile = useCallback((updated: UserProfile) => {
    setState((prev) => {
      const nextName = updated.name.trim() || prev.profiles.find((p) => p.id === updated.id)?.name || 'Perfil';
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === updated.id ? { ...updated, name: nextName } : p
        ),
      };
    });
  }, []);

  const deleteProfile = useCallback((id: string, reassignToId?: string) => {
    setState((prev) => {
      if (prev.profiles.length <= 1) return prev;
      const remaining = prev.profiles.filter((p) => p.id !== id);
      const validReassign =
        reassignToId && remaining.some((p) => p.id === reassignToId) ? reassignToId : undefined;

      const deletedAccountIds = new Set(
        prev.accounts.filter((a) => a.owner === id).map((a) => a.id)
      );

      return {
        ...prev,
        profiles: remaining,
        savingsConfigs: validReassign
          ? prev.savingsConfigs.map((c) => (c.owner === id ? { ...c, owner: validReassign } : c))
          : prev.savingsConfigs.filter((c) => c.owner !== id),
        accounts: validReassign
          ? prev.accounts.map((a) => (a.owner === id ? { ...a, owner: validReassign } : a))
          : prev.accounts.filter((a) => a.owner !== id),
        transactions: validReassign
          ? prev.transactions.map((t) => (t.owner === id ? { ...t, owner: validReassign } : t))
          : prev.transactions.filter(
              (t) => t.owner !== id && !deletedAccountIds.has(t.accountId)
            ),
        investments: validReassign
          ? prev.investments.map((h) => (h.owner === id ? { ...h, owner: validReassign } : h))
          : prev.investments.filter((h) => h.owner !== id),
        fixedExpenses: validReassign
          ? prev.fixedExpenses.map((f) => (f.owner === id ? { ...f, owner: validReassign } : f))
          : prev.fixedExpenses.filter(
              (f) => f.owner !== id && !deletedAccountIds.has(f.accountId)
            ),
        budgets: validReassign
          ? prev.budgets.map((b) => (b.owner === id ? { ...b, owner: validReassign } : b))
          : prev.budgets.filter((b) => b.owner !== id),
      };
    });
  }, []);

  // Savings accounts with interest (formerly "GoalSaver")
  const addSavingsConfig = useCallback(
    (params: { owner: ProfileId; name: string; accountId?: string; currency?: CurrencyCode }) => {
      const cfg = createSavingsConfig(params);
      setState((prev) => ({ ...prev, savingsConfigs: [...prev.savingsConfigs, cfg] }));
      return cfg.id;
    },
    []
  );

  const updateSavingsConfig = useCallback((id: string, patch: Partial<SavingsInterestConfig>) => {
    setState((prev) => ({
      ...prev,
      savingsConfigs: prev.savingsConfigs.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
    }));
  }, []);

  const deleteSavingsConfig = useCallback((id: string) => {
    setState((prev) => ({ ...prev, savingsConfigs: prev.savingsConfigs.filter((c) => c.id !== id) }));
  }, []);

  // Investments
  const addInvestment = useCallback((holding: Omit<InvestmentHolding, 'id'>) => {
    const id = uid('inv');
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      investments: [...prev.investments, { ...holding, id }],
    }));
  }, []);

  const updateInvestment = useCallback((updated: InvestmentHolding) => {
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      investments: prev.investments.map((h) => (h.id === updated.id ? updated : h)),
    }));
  }, []);

  const deleteInvestment = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      investments: prev.investments.filter((h) => h.id !== id),
    }));
  }, []);

  const importInvestmentTradesBatch = useCallback(
    (
      trades: Array<{
        owner: ProfileId;
        /** Destination investment account (optional). */
        accountId?: string;
        ticker: string;
        name: string;
        assetType: 'ETF' | 'Acción' | 'Fondo';
        side: 'BUY' | 'SELL';
        shares: number;
        price: number;
        currency: CurrencyCode;
      }>
    ) => {
      setState((prev) => {
        const nextHoldings = [...prev.investments];
        for (const t of trades) {
          const tickerUpper = t.ticker.toUpperCase().trim();
          const idx = nextHoldings.findIndex(
            (h) =>
              h.owner === t.owner &&
              h.ticker.toUpperCase() === tickerUpper &&
              (!t.accountId || !h.accountId || h.accountId === t.accountId)
          );
          if (idx >= 0) {
            const current = nextHoldings[idx];
            if (t.side === 'BUY') {
              const totalOldCost = current.shares * current.avgCostPerShare;
              const totalNewCost = t.shares * t.price;
              const newShares = current.shares + t.shares;
              nextHoldings[idx] = {
                ...current,
                shares: Number(newShares.toFixed(4)),
                avgCostPerShare:
                  newShares > 0 ? Number(((totalOldCost + totalNewCost) / newShares).toFixed(4)) : current.avgCostPerShare,
                currentPricePerShare: t.price,
              };
            } else {
              const remaining = Math.max(0, current.shares - t.shares);
              nextHoldings[idx] = {
                ...current,
                shares: Number(remaining.toFixed(4)),
                currentPricePerShare: t.price,
              };
            }
          } else if (t.side === 'BUY' && t.shares > 0) {
            nextHoldings.push({
              id: uid('inv'),
              accountId: t.accountId,
              owner: t.owner,
              ticker: tickerUpper,
              name: t.name || tickerUpper,
              assetType: t.assetType,
              shares: t.shares,
              avgCostPerShare: t.price,
              currentPricePerShare: t.price,
              dividendYieldAnnual: 1.5,
              currency: t.currency,
            });
          }
        }
        return {
          ...prev,
          isSampleData: false,
          investments: nextHoldings.filter((h) => h.shares > 0),
        };
      });
    },
    []
  );

  // Fixed Expenses
  const toggleFixedExpensePaid = useCallback((monthKey: string, fixedExpenseId: string) => {
    setState((prev) => {
      const monthMap = prev.fixedExpensePaidByMonth[monthKey] || {};
      const nextVal = !monthMap[fixedExpenseId];
      return {
        ...prev,
        fixedExpensePaidByMonth: {
          ...prev.fixedExpensePaidByMonth,
          [monthKey]: {
            ...monthMap,
            [fixedExpenseId]: nextVal,
          },
        },
      };
    });
  }, []);

  const addFixedExpense = useCallback((item: Omit<FixedExpense, 'id'>) => {
    const id = uid('fix');
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      fixedExpenses: [...prev.fixedExpenses, { ...item, id }].sort(
        (a, b) => a.dueDay - b.dueDay
      ),
    }));
  }, []);

  const deleteFixedExpense = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      fixedExpenses: prev.fixedExpenses.filter((f) => f.id !== id),
    }));
  }, []);

  // Backup / Restore / Reset
  const restoreFullState = useCallback((jsonText: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonText) as FinanceState;
      if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
        return { ok: false, error: 'El archivo no tiene el formato de respaldo válido.' };
      }
      // Old backups (any version) are migrated to the current structure here.
      setState(normalizeState(parsed));
      return { ok: true };
    } catch {
      return { ok: false, error: 'No se pudo leer el archivo JSON. Verifica que no esté dañado.' };
    }
  }, []);

  const clearToBlank = useCallback(() => {
    setState((prev) => ({
      ...createInitialFinanceState(false),
      profiles: prev.profiles,
      accounts: prev.accounts.map((a) => ({ ...a, initialBalance: 0 })),
      categories: prev.categories,
      budgets: prev.budgets,
      displayCurrency: prev.displayCurrency,
      exchangeRates: prev.exchangeRates,
      exchangeRatesUpdatedAt: prev.exchangeRatesUpdatedAt,
      savingsConfigs: prev.savingsConfigs.map((c) => ({ ...c, currentBalance: 0 })),
      lastBackupAt: prev.lastBackupAt,
      isSampleData: false,
    }));
  }, []);

  const resetToZero = useCallback(
    (options: {
      accounts: boolean;
      investments: boolean;
      transactions: boolean;
      scope?: ProfileFilter;
    }) => {
      const scope = options.scope ?? 'all';
      const matchesOwner = (owner: string) => scope === 'all' || owner === scope;

      setState((prev) => {
        const nextAccounts = prev.accounts.map((acc) => {
          if (!matchesOwner(acc.owner)) return acc;
          if (options.accounts || (options.investments && acc.kind === 'inversion')) {
            return { ...acc, initialBalance: 0 };
          }
          return acc;
        });

        const nextSavings = options.accounts
          ? prev.savingsConfigs.map((c) => (matchesOwner(c.owner) ? { ...c, currentBalance: 0 } : c))
          : prev.savingsConfigs;

        const nextInvestments = options.investments
          ? prev.investments.filter((h) => !matchesOwner(h.owner))
          : prev.investments;

        const nextTransactions = options.transactions
          ? scope === 'all'
            ? []
            : prev.transactions.filter((t) => !matchesOwner(t.owner))
          : prev.transactions;

        let nextPaidMap = prev.fixedExpensePaidByMonth;
        if (options.transactions) {
          if (scope === 'all') {
            nextPaidMap = {};
          } else {
            const scopedFixedIds = new Set(
              prev.fixedExpenses.filter((f) => matchesOwner(f.owner)).map((f) => f.id)
            );
            const updatedPaid: Record<string, Record<string, boolean>> = {};
            for (const [mk, monthEntries] of Object.entries(prev.fixedExpensePaidByMonth)) {
              const filtered: Record<string, boolean> = {};
              for (const [fid, val] of Object.entries(monthEntries || {})) {
                if (!scopedFixedIds.has(fid)) filtered[fid] = val;
              }
              updatedPaid[mk] = filtered;
            }
            nextPaidMap = updatedPaid;
          }
        }

        return {
          ...prev,
          isSampleData: false,
          accounts: nextAccounts,
          savingsConfigs: nextSavings,
          investments: nextInvestments,
          transactions: nextTransactions,
          fixedExpensePaidByMonth: nextPaidMap,
        };
      });
    },
    []
  );

  const loadSampleData = useCallback(() => {
    setState(createInitialFinanceState(true));
  }, []);

  return {
    state,
    saveError,
    isCloud: Boolean(cloud),
    setDisplayCurrency,
    updateExchangeRates,
    addProfile,
    updateProfile,
    deleteProfile,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateTransactionsBatch,
    importTransactionsBatch,
    addCategory,
    addAccount,
    updateAccount,
    deleteAccount,
    upsertBudget,
    deleteBudget,
    addSavingsConfig,
    updateSavingsConfig,
    deleteSavingsConfig,
    addInvestment,
    updateInvestment,
    deleteInvestment,
    importInvestmentTradesBatch,
    markBackupDone,
    toggleFixedExpensePaid,
    addFixedExpense,
    deleteFixedExpense,
    restoreFullState,
    clearToBlank,
    resetToZero,
    loadSampleData,
  };
}
