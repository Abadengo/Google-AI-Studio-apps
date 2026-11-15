import { useCallback, useEffect, useState } from 'react';
import {
  createDefaultGoalSaverForProfile,
  createInitialFinanceState,
  DEFAULT_FIXED_EXPENSES,
  DEFAULT_PROFILES,
} from '../data/defaultState';
import type {
  Account,
  Budget,
  Category,
  CurrencyCode,
  ExchangeRates,
  FinanceState,
  FixedExpense,
  GoalSaverProfile,
  MoomooHolding,
  ProfileFilter,
  ProfileId,
  Transaction,
  UserProfile,
} from '../types/finance';

const STORAGE_KEY = 'finanzas_hogar_abdiel_lara_v1';

function hydrateProfilesAndGoalSavers(
  rawProfiles: UserProfile[] | undefined,
  rawGoalSavers: Record<string, GoalSaverProfile> | undefined,
  fallbackGoalSavers: Record<string, GoalSaverProfile>
): {
  profiles: UserProfile[];
  goalSavers: Record<string, GoalSaverProfile>;
} {
  const profiles: UserProfile[] =
    Array.isArray(rawProfiles) && rawProfiles.length > 0
      ? rawProfiles.map((p, idx) => ({
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

  const goalSavers: Record<string, GoalSaverProfile> = {
    ...(rawGoalSavers || fallbackGoalSavers),
  };

  for (const p of profiles) {
    if (!goalSavers[p.id]) {
      goalSavers[p.id] = createDefaultGoalSaverForProfile(p);
    }
  }

  return { profiles, goalSavers };
}

function loadStateFromStorage(): FinanceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialFinanceState(true);
    }
    const parsed = JSON.parse(raw) as Partial<FinanceState>;
    const fallback = createInitialFinanceState(false);
    const { profiles, goalSavers } = hydrateProfilesAndGoalSavers(
      parsed.profiles,
      parsed.goalSavers,
      fallback.goalSavers
    );

    return {
      version: parsed.version ?? 1,
      displayCurrency: parsed.displayCurrency ?? 'AUD',
      exchangeRates: { ...fallback.exchangeRates, ...(parsed.exchangeRates || {}) },
      profiles,
      accounts: Array.isArray(parsed.accounts) && parsed.accounts.length > 0 ? parsed.accounts : fallback.accounts,
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length > 0
          ? parsed.categories
          : fallback.categories,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : fallback.budgets,
      goalSavers,
      moomooHoldings: Array.isArray(parsed.moomooHoldings) ? parsed.moomooHoldings : [],
      fixedExpenses: Array.isArray(parsed.fixedExpenses)
        ? parsed.fixedExpenses
        : parsed.isSampleData
        ? DEFAULT_FIXED_EXPENSES
        : [],
      fixedExpensePaidByMonth:
        parsed.fixedExpensePaidByMonth && typeof parsed.fixedExpensePaidByMonth === 'object'
          ? parsed.fixedExpensePaidByMonth
          : {},
      isSampleData: Boolean(parsed.isSampleData),
    };
  } catch {
    return createInitialFinanceState(true);
  }
}

export function useFinanceStore() {
  const [state, setState] = useState<FinanceState>(() => loadStateFromStorage());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('Error guardando en localStorage:', err);
    }
  }, [state]);

  const setDisplayCurrency = useCallback((currency: CurrencyCode) => {
    setState((prev) => ({ ...prev, displayCurrency: currency }));
  }, []);

  const updateExchangeRates = useCallback((rates: ExchangeRates) => {
    setState((prev) => ({ ...prev, exchangeRates: rates }));
  }, []);

  // Transactions
  const addTransaction = useCallback((tx: Omit<Transaction, 'id'>) => {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
          return {
            ...tx,
            ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
            ...(patch.type !== undefined ? { type: patch.type } : {}),
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
    const id = `cat_${Date.now()}`;
    setState((prev) => ({
      ...prev,
      categories: [...prev.categories, { ...cat, id }],
    }));
    return id;
  }, []);

  // Accounts
  const addAccount = useCallback((acc: Omit<Account, 'id'>) => {
    const id = `acc_${Date.now()}`;
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
        id: `bud_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
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
    const id = `prof_${slug}_${Date.now().toString(36).slice(-4)}`;
    const newProfile: UserProfile = {
      ...profile,
      id,
      name: profile.name.trim() || 'Nuevo perfil',
    };
    setState((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newProfile],
      goalSavers: {
        ...prev.goalSavers,
        [id]: createDefaultGoalSaverForProfile(newProfile),
      },
    }));
    return id;
  }, []);

  const updateProfile = useCallback((updated: UserProfile) => {
    setState((prev) => {
      const nextName = updated.name.trim() || prev.profiles.find((p) => p.id === updated.id)?.name || 'Perfil';
      const currentGs = prev.goalSavers[updated.id] || createDefaultGoalSaverForProfile({ id: updated.id, name: nextName });
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === updated.id ? { ...updated, name: nextName } : p
        ),
        goalSavers: {
          ...prev.goalSavers,
          [updated.id]: {
            ...currentGs,
            accountName: `CommBank GoalSaver · ${nextName}`,
          },
        },
      };
    });
  }, []);

  const deleteProfile = useCallback((id: string, reassignToId?: string) => {
    setState((prev) => {
      if (prev.profiles.length <= 1) return prev;
      const remaining = prev.profiles.filter((p) => p.id !== id);
      const validReassign =
        reassignToId && remaining.some((p) => p.id === reassignToId) ? reassignToId : undefined;

      const nextGoalSavers = { ...prev.goalSavers };
      delete nextGoalSavers[id];

      const deletedAccountIds = new Set(
        prev.accounts.filter((a) => a.owner === id).map((a) => a.id)
      );

      return {
        ...prev,
        profiles: remaining,
        goalSavers: nextGoalSavers,
        accounts: validReassign
          ? prev.accounts.map((a) => (a.owner === id ? { ...a, owner: validReassign } : a))
          : prev.accounts.filter((a) => a.owner !== id),
        transactions: validReassign
          ? prev.transactions.map((t) => (t.owner === id ? { ...t, owner: validReassign } : t))
          : prev.transactions.filter(
              (t) => t.owner !== id && !deletedAccountIds.has(t.accountId)
            ),
        moomooHoldings: validReassign
          ? prev.moomooHoldings.map((h) => (h.owner === id ? { ...h, owner: validReassign } : h))
          : prev.moomooHoldings.filter((h) => h.owner !== id),
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

  // GoalSaver
  const updateGoalSaver = useCallback((owner: ProfileId, patch: Partial<GoalSaverProfile>) => {
    setState((prev) => {
      const profile = prev.profiles.find((p) => p.id === owner);
      const base =
        prev.goalSavers[owner] ||
        createDefaultGoalSaverForProfile({ id: owner, name: profile?.name || owner });
      return {
        ...prev,
        goalSavers: {
          ...prev.goalSavers,
          [owner]: {
            ...base,
            ...patch,
          },
        },
      };
    });
  }, []);

  // Moomoo Holdings
  const addMoomooHolding = useCallback((holding: Omit<MoomooHolding, 'id'>) => {
    const id = `moo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      moomooHoldings: [...prev.moomooHoldings, { ...holding, id }],
    }));
  }, []);

  const updateMoomooHolding = useCallback((updated: MoomooHolding) => {
    setState((prev) => ({
      ...prev,
      isSampleData: false,
      moomooHoldings: prev.moomooHoldings.map((h) => (h.id === updated.id ? updated : h)),
    }));
  }, []);

  const deleteMoomooHolding = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      moomooHoldings: prev.moomooHoldings.filter((h) => h.id !== id),
    }));
  }, []);

  const importMoomooHoldingsBatch = useCallback(
    (
      trades: Array<{
        owner: ProfileId;
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
        const nextHoldings = [...prev.moomooHoldings];
        for (const t of trades) {
          const tickerUpper = t.ticker.toUpperCase().trim();
          const idx = nextHoldings.findIndex(
            (h) => h.owner === t.owner && h.ticker.toUpperCase() === tickerUpper
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
              id: `moo_csv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
          moomooHoldings: nextHoldings.filter((h) => h.shares > 0),
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
    const id = `fix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
      const fallback = createInitialFinanceState(false);
      const { profiles, goalSavers } = hydrateProfilesAndGoalSavers(
        parsed.profiles,
        parsed.goalSavers,
        fallback.goalSavers
      );
      setState({
        ...parsed,
        profiles,
        goalSavers,
        fixedExpenses: Array.isArray(parsed.fixedExpenses) ? parsed.fixedExpenses : [],
        fixedExpensePaidByMonth: parsed.fixedExpensePaidByMonth || {},
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'No se pudo leer el archivo JSON. Verifica que no esté dañado.' };
    }
  }, []);

  const clearToBlank = useCallback(() => {
    setState((prev) => {
      const zeroGoalSavers: Record<string, GoalSaverProfile> = {};
      for (const p of prev.profiles) {
        const cur = prev.goalSavers[p.id] || createDefaultGoalSaverForProfile(p);
        zeroGoalSavers[p.id] = { ...cur, currentBalance: 0 };
      }
      return {
        ...createInitialFinanceState(false),
        profiles: prev.profiles,
        accounts: prev.accounts.map((a) => ({ ...a, initialBalance: 0 })),
        categories: prev.categories,
        budgets: prev.budgets,
        displayCurrency: prev.displayCurrency,
        exchangeRates: prev.exchangeRates,
        goalSavers: zeroGoalSavers,
        transactions: [],
        moomooHoldings: [],
        fixedExpenses: [],
        fixedExpensePaidByMonth: {},
        isSampleData: false,
      };
    });
  }, []);

  const resetToZero = useCallback(
    (options: {
      accounts: boolean;
      moomoo: boolean;
      transactions: boolean;
      scope?: ProfileFilter;
    }) => {
      const scope = options.scope ?? 'all';
      const matchesOwner = (owner: string) => scope === 'all' || owner === scope;

      setState((prev) => {
        const nextAccounts = prev.accounts.map((acc) => {
          if (!matchesOwner(acc.owner)) return acc;
          if (options.accounts || (options.moomoo && acc.kind === 'moomoo')) {
            return { ...acc, initialBalance: 0 };
          }
          return acc;
        });

        const nextGoalSavers: Record<string, GoalSaverProfile> = { ...prev.goalSavers };
        if (options.accounts) {
          for (const p of prev.profiles) {
            if (!matchesOwner(p.id)) continue;
            const cur = nextGoalSavers[p.id] || createDefaultGoalSaverForProfile(p);
            nextGoalSavers[p.id] = { ...cur, currentBalance: 0 };
          }
        }

        const nextMoomooHoldings = options.moomoo
          ? scope === 'all'
            ? []
            : prev.moomooHoldings.filter((h) => !matchesOwner(h.owner))
          : prev.moomooHoldings;

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
          goalSavers: nextGoalSavers,
          moomooHoldings: nextMoomooHoldings,
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
    updateGoalSaver,
    addMoomooHolding,
    updateMoomooHolding,
    deleteMoomooHolding,
    importMoomooHoldingsBatch,
    toggleFixedExpensePaid,
    addFixedExpense,
    deleteFixedExpense,
    restoreFullState,
    clearToBlank,
    resetToZero,
    loadSampleData,
  };
}
