import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Landmark,
  Layers,
  LayoutGrid,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  AccountKind,
  CurrencyCode,
  FinanceState,
  FixedExpense,
  ProfileFilter,
  ProfileId,
  Transaction,
} from '../types/finance';
import {
  CURRENCY_META,
  convertCurrency,
  formatDateShort,
  formatFullMonthLabel,
  formatMoney,
  formatMonthLabel,
  getGoalSaverForProfile,
  getLastNMonths,
  getMonthKey,
  getProfileLabel,
} from '../utils/formatters';
import { CategoryPieChart, SixMonthBarChart, type CategorySlice, type MonthlyBarPoint } from './Charts';
import {
  SavingsGrowthLineChart,
  getSafeProfileChartColor,
  type SavingsGrowthPoint,
} from './SavingsGrowthLineChart';

interface DashboardViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onOpenNewTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onNavigateTab: (tab: 'transactions' | 'budgets' | 'accounts' | 'moomoo') => void;
  onToggleFixedExpensePaid: (monthKey: string, fixedExpenseId: string) => void;
  onAddFixedExpense: (item: Omit<FixedExpense, 'id'>) => void;
  onDeleteFixedExpense: (id: string) => void;
  onAddAccount: (acc: Omit<Account, 'id'>) => string;
  onDeleteAccount: (id: string) => void;
  onOpenImport?: () => void;
  onAskAi?: (prompt?: string) => void;
}

const ACCOUNT_KIND_LABELS: Record<AccountKind, { es: string; en: string }> = {
  commbank: { es: 'CommBank', en: 'CommBank' },
  goalsaver: { es: 'GoalSaver', en: 'GoalSaver' },
  revolut: { es: 'Revolut', en: 'Revolut' },
  wise: { es: 'Wise', en: 'Wise' },
  moomoo: { es: 'Moomoo', en: 'Moomoo' },
  cash: { es: 'Efectivo', en: 'Cash' },
  other: { es: 'Banco externo', en: 'External bank' },
};

export function DashboardView({
  state,
  activeProfile,
  selectedMonth,
  onSelectMonth,
  onOpenNewTransaction,
  onEditTransaction,
  onNavigateTab,
  onToggleFixedExpensePaid,
  onAddFixedExpense,
  onDeleteFixedExpense,
  onAddAccount,
  onDeleteAccount,
  onOpenImport,
  onAskAi,
}: DashboardViewProps) {
  const { tr, catName, lang, isDark } = useUiPreferences();

  const defaultOwnerId: ProfileId =
    activeProfile === 'all'
      ? state.profiles[0]?.id || 'abdiel'
      : state.profiles.some((p) => p.id === activeProfile)
      ? activeProfile
      : state.profiles[0]?.id || 'abdiel';

  // View mode: Totals vs By Account
  const [viewMode, setViewMode] = useState<'totals' | 'by_account'>('totals');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');

  // Inline create account inside Resumen -> Vista por cuenta
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccOwner, setNewAccOwner] = useState<ProfileId>(defaultOwnerId);
  const [newAccKind, setNewAccKind] = useState<AccountKind>('other');
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>(state.displayCurrency);
  const [newAccBalance, setNewAccBalance] = useState('0');
  const [confirmDeleteAccId, setConfirmDeleteAccId] = useState<string | null>(null);

  const [compareIncome, setCompareIncome] = useState(true);
  const [showSavingsLine, setShowSavingsLine] = useState(true);
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [newFixName, setNewFixName] = useState('');
  const [newFixOwner, setNewFixOwner] = useState<ProfileId>(defaultOwnerId);
  const [newFixAmount, setNewFixAmount] = useState('');
  const [newFixCurrency, setNewFixCurrency] = useState<CurrencyCode>(state.displayCurrency);
  const [newFixDueDay, setNewFixDueDay] = useState('5');
  const [newFixAccountId, setNewFixAccountId] = useState(
    state.accounts.find((a) => a.owner === defaultOwnerId)?.id || state.accounts[0]?.id || ''
  );
  const [newFixCategoryId, setNewFixCategoryId] = useState('cat_servicios');
  const currency = state.displayCurrency;

  // Reset selectedAccountId if account is deleted or filtered out by activeProfile
  const visibleAccounts = useMemo(() => {
    return state.accounts.filter((a) => activeProfile === 'all' || a.owner === activeProfile);
  }, [state.accounts, activeProfile]);

  useEffect(() => {
    if (
      selectedAccountId !== 'all' &&
      !visibleAccounts.some((a) => a.id === selectedAccountId)
    ) {
      setSelectedAccountId('all');
    }
  }, [visibleAccounts, selectedAccountId]);

  useEffect(() => {
    setNewAccOwner(defaultOwnerId);
    setNewFixOwner(defaultOwnerId);
  }, [defaultOwnerId]);

  // Live account balances + selected month activity per account
  const accountStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        liveBalance: number;
        monthIncome: number;
        monthExpenses: number;
        monthTransfersNet: number;
        monthTxCount: number;
      }
    >();

    for (const acc of state.accounts) {
      map.set(acc.id, {
        liveBalance: acc.initialBalance,
        monthIncome: 0,
        monthExpenses: 0,
        monthTransfersNet: 0,
        monthTxCount: 0,
      });
    }

    for (const tx of state.transactions) {
      const isSelectedMonth = getMonthKey(tx.date) === selectedMonth;

      if (tx.type === 'income') {
        const acc = state.accounts.find((a) => a.id === tx.accountId);
        const entry = map.get(tx.accountId);
        if (acc && entry) {
          const val = convertCurrency(tx.amount, tx.currency, acc.currency, state.exchangeRates);
          entry.liveBalance += val;
          if (isSelectedMonth) {
            entry.monthIncome += convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
            entry.monthTxCount += 1;
          }
        }
      } else if (tx.type === 'expense') {
        const acc = state.accounts.find((a) => a.id === tx.accountId);
        const entry = map.get(tx.accountId);
        if (acc && entry) {
          const val = convertCurrency(tx.amount, tx.currency, acc.currency, state.exchangeRates);
          entry.liveBalance -= val;
          if (isSelectedMonth) {
            entry.monthExpenses += convertCurrency(
              tx.amount,
              tx.currency,
              currency,
              state.exchangeRates
            );
            entry.monthTxCount += 1;
          }
        }
      } else if (tx.type === 'transfer') {
        const fromAcc = state.accounts.find((a) => a.id === tx.accountId);
        const fromEntry = map.get(tx.accountId);
        if (fromAcc && fromEntry) {
          const val = convertCurrency(tx.amount, tx.currency, fromAcc.currency, state.exchangeRates);
          fromEntry.liveBalance -= val;
          if (isSelectedMonth) {
            fromEntry.monthTransfersNet -= convertCurrency(
              tx.amount,
              tx.currency,
              currency,
              state.exchangeRates
            );
            fromEntry.monthTxCount += 1;
          }
        }
        if (tx.toAccountId) {
          const toAcc = state.accounts.find((a) => a.id === tx.toAccountId);
          const toEntry = map.get(tx.toAccountId);
          if (toAcc && toEntry) {
            const val = convertCurrency(tx.amount, tx.currency, toAcc.currency, state.exchangeRates);
            toEntry.liveBalance += val;
            if (isSelectedMonth) {
              toEntry.monthTransfersNet += convertCurrency(
                tx.amount,
                tx.currency,
                currency,
                state.exchangeRates
              );
              toEntry.monthTxCount += 1;
            }
          }
        }
      }
    }

    return map;
  }, [state.accounts, state.transactions, state.exchangeRates, selectedMonth, currency]);

  const totalAccountsBalance = useMemo(() => {
    return visibleAccounts.reduce((sum, acc) => {
      const live = accountStatsMap.get(acc.id)?.liveBalance ?? acc.initialBalance;
      return sum + convertCurrency(live, acc.currency, currency, state.exchangeRates);
    }, 0);
  }, [visibleAccounts, accountStatsMap, currency, state.exchangeRates]);

  const isSingleAccountFiltered = viewMode === 'by_account' && selectedAccountId !== 'all';
  const activeAccount = isSingleAccountFiltered
    ? visibleAccounts.find((a) => a.id === selectedAccountId)
    : undefined;

  const profileTransactions = useMemo(() => {
    const byProfile =
      activeProfile === 'all'
        ? state.transactions
        : state.transactions.filter((t) => t.owner === activeProfile);

    if (!isSingleAccountFiltered) return byProfile;

    return byProfile.filter(
      (t) => t.accountId === selectedAccountId || t.toAccountId === selectedAccountId
    );
  }, [state.transactions, activeProfile, isSingleAccountFiltered, selectedAccountId]);

  const monthTransactions = useMemo(
    () => profileTransactions.filter((t) => getMonthKey(t.date) === selectedMonth),
    [profileTransactions, selectedMonth]
  );

  // Top KPIs: Ingresos del mes, Gastos del mes, % de ahorro
  const { monthIncome, monthExpenses, netSavings, savingsRate } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const tx of monthTransactions) {
      if (isSingleAccountFiltered && tx.type !== 'transfer' && tx.accountId !== selectedAccountId) {
        continue;
      }
      const converted = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
      if (tx.type === 'income') inc += converted;
      else if (tx.type === 'expense') exp += converted;
    }
    const net = inc - exp;
    const rate = inc > 0 ? (net / inc) * 100 : 0;
    return {
      monthIncome: inc,
      monthExpenses: exp,
      netSavings: net,
      savingsRate: rate,
    };
  }, [monthTransactions, currency, state.exchangeRates, isSingleAccountFiltered, selectedAccountId]);

  // Pie Chart data: Gastos por categoría del mes seleccionado
  const categorySlices: CategorySlice[] = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of monthTransactions) {
      if (tx.type !== 'expense') continue;
      if (isSingleAccountFiltered && tx.accountId !== selectedAccountId) continue;
      const val = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
      totals.set(tx.categoryId, (totals.get(tx.categoryId) || 0) + val);
    }

    const items: CategorySlice[] = [];
    for (const [catId, amount] of totals.entries()) {
      const cat = state.categories.find((c) => c.id === catId);
      items.push({
        id: catId,
        name: catName(cat, tr('Otros', 'Other')),
        color: cat?.color || '#499BED',
        amount,
        percentage: monthExpenses > 0 ? (amount / monthExpenses) * 100 : 0,
      });
    }
    return items.sort((a, b) => b.amount - a.amount);
  }, [
    monthTransactions,
    currency,
    state.exchangeRates,
    state.categories,
    monthExpenses,
    catName,
    tr,
    isSingleAccountFiltered,
    selectedAccountId,
  ]);

  // Bar chart data: Últimos 6 meses hasta el mes seleccionado
  const sixMonthData: MonthlyBarPoint[] = useMemo(() => {
    const monthKeys = getLastNMonths(selectedMonth, 6);
    return monthKeys.map((mk) => {
      let inc = 0;
      let exp = 0;
      for (const tx of profileTransactions) {
        if (getMonthKey(tx.date) !== mk) continue;
        if (isSingleAccountFiltered && tx.accountId !== selectedAccountId) continue;
        const val = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
        if (tx.type === 'income') inc += val;
        else if (tx.type === 'expense') exp += val;
      }
      return {
        monthKey: mk,
        label: formatMonthLabel(mk, lang),
        expenses: exp,
        income: inc,
      };
    });
  }, [
    profileTransactions,
    selectedMonth,
    currency,
    state.exchangeRates,
    lang,
    isSingleAccountFiltered,
    selectedAccountId,
  ]);

  // Line chart data (Recharts): Progreso histórico de ahorro acumulado y crecimiento GoalSaver por perfil
  const savingsGrowthData: SavingsGrowthPoint[] = useMemo(() => {
    const monthKeys = getLastNMonths(selectedMonth, 6);

    const gsIdsByProfile = new Map<string, Set<string>>();
    const gsInitialByProfile = new Map<string, number>();
    const hasGsTxByProfile = new Map<string, boolean>();

    for (const profile of state.profiles) {
      const gsAccounts = state.accounts.filter(
        (a) => a.owner === profile.id && a.kind === 'goalsaver'
      );
      const idSet = new Set(gsAccounts.map((a) => a.id));
      gsIdsByProfile.set(profile.id, idSet);

      const initial = gsAccounts.reduce(
        (sum, a) => sum + convertCurrency(a.initialBalance, a.currency, currency, state.exchangeRates),
        0
      );
      gsInitialByProfile.set(profile.id, initial);

      const hasTx = state.transactions.some(
        (tx) => idSet.has(tx.accountId) || (tx.toAccountId ? idSet.has(tx.toAccountId) : false)
      );
      hasGsTxByProfile.set(profile.id, hasTx);
    }

    return monthKeys.map((mk) => {
      let cumulativeSavings = 0;
      for (const tx of profileTransactions) {
        if (getMonthKey(tx.date) > mk) continue;
        const val = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
        if (tx.type === 'income') cumulativeSavings += val;
        else if (tx.type === 'expense') cumulativeSavings -= val;
      }

      const deltaByProfile: Record<string, number> = {};
      for (const p of state.profiles) {
        deltaByProfile[p.id] = 0;
      }

      for (const tx of state.transactions) {
        if (getMonthKey(tx.date) > mk) continue;
        const val = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);

        for (const p of state.profiles) {
          const idSet = gsIdsByProfile.get(p.id);
          if (!idSet || idSet.size === 0) continue;

          if (tx.type === 'income' && idSet.has(tx.accountId)) {
            deltaByProfile[p.id] += val;
          } else if (tx.type === 'expense' && idSet.has(tx.accountId)) {
            deltaByProfile[p.id] -= val;
          } else if (tx.type === 'transfer') {
            if (tx.toAccountId && idSet.has(tx.toAccountId)) deltaByProfile[p.id] += val;
            if (idSet.has(tx.accountId)) deltaByProfile[p.id] -= val;
          }
        }
      }

      const goalSaverByProfile: Record<string, number> = {};
      for (const p of state.profiles) {
        const hasTx = hasGsTxByProfile.get(p.id);
        const gsProfile = getGoalSaverForProfile(state.goalSavers, p);
        const val = hasTx
          ? (gsInitialByProfile.get(p.id) || 0) + (deltaByProfile[p.id] || 0)
          : convertCurrency(
              gsProfile.currentBalance,
              gsProfile.currency,
              currency,
              state.exchangeRates
            );
        goalSaverByProfile[p.id] = Math.max(0, val);
      }

      return {
        monthKey: mk,
        label: formatMonthLabel(mk, lang),
        ahorroAcumulado: cumulativeSavings,
        goalSaverByProfile,
      };
    });
  }, [
    profileTransactions,
    state.profiles,
    state.accounts,
    state.transactions,
    state.goalSavers,
    selectedMonth,
    currency,
    state.exchangeRates,
    lang,
  ]);

  // Budget Alerts
  const budgetAlerts = useMemo(() => {
    const activeBudgets = state.budgets.filter((b) =>
      activeProfile === 'all' ? b.owner === 'all' : b.owner === activeProfile || b.owner === 'all'
    );

    const exceeded: Array<{ name: string; spent: number; limit: number; pct: number }> = [];
    const nearLimit: Array<{ name: string; spent: number; limit: number; pct: number }> = [];
    const divisor = Math.max(1, state.profiles.length);

    for (const b of activeBudgets) {
      if (b.monthlyLimit <= 0) continue;
      const hasSpecific = state.budgets.some(
        (other) => other.categoryId === b.categoryId && other.owner === activeProfile
      );
      if (activeProfile !== 'all' && b.owner === 'all' && hasSpecific) continue;

      const effectiveLimit = convertCurrency(
        activeProfile !== 'all' && b.owner === 'all' ? b.monthlyLimit / divisor : b.monthlyLimit,
        b.currency,
        currency,
        state.exchangeRates
      );

      const spent = categorySlices.find((s) => s.id === b.categoryId)?.amount || 0;
      const pct = effectiveLimit > 0 ? (spent / effectiveLimit) * 100 : 0;
      const cat = state.categories.find((c) => c.id === b.categoryId);
      const name = catName(cat, tr('Categoría', 'Category'));

      if (pct >= 100) {
        exceeded.push({ name, spent, limit: effectiveLimit, pct });
      } else if (pct >= 80) {
        nearLimit.push({ name, spent, limit: effectiveLimit, pct });
      }
    }

    return { exceeded, nearLimit };
  }, [
    state.budgets,
    state.categories,
    state.exchangeRates,
    state.profiles.length,
    activeProfile,
    currency,
    categorySlices,
    catName,
    tr,
  ]);

  // Quick GoalSaver + Moomoo Summary
  const goalSaverTotal = useMemo(() => {
    const targetProfiles =
      activeProfile === 'all'
        ? state.profiles
        : state.profiles.filter((p) => p.id === activeProfile);

    return targetProfiles.reduce<number>((acc, profile) => {
      const gs = getGoalSaverForProfile(state.goalSavers, profile);
      return acc + convertCurrency(gs.currentBalance, gs.currency, currency, state.exchangeRates);
    }, 0);
  }, [state.goalSavers, state.profiles, activeProfile, currency, state.exchangeRates]);

  const moomooSummary = useMemo(() => {
    const holdings =
      activeProfile === 'all'
        ? state.moomooHoldings
        : state.moomooHoldings.filter((h) => h.owner === activeProfile);

    let invested = 0;
    let current = 0;
    for (const h of holdings) {
      invested += convertCurrency(h.shares * h.avgCostPerShare, h.currency, currency, state.exchangeRates);
      current += convertCurrency(
        h.shares * h.currentPricePerShare,
        h.currency,
        currency,
        state.exchangeRates
      );
    }
    return { invested, current, gain: current - invested };
  }, [state.moomooHoldings, activeProfile, currency, state.exchangeRates]);

  const recentTransactions = monthTransactions.slice(0, 6);

  // Gastos Fijos del mes filtrados por perfil (y cuenta si aplica)
  const { fixedItems, fixedPaidCount, fixedPaidTotal, fixedPendingTotal } = useMemo(() => {
    const paidMap = state.fixedExpensePaidByMonth[selectedMonth] || {};
    const items = state.fixedExpenses
      .filter((f) => activeProfile === 'all' || f.owner === activeProfile)
      .filter((f) => !isSingleAccountFiltered || f.accountId === selectedAccountId)
      .slice()
      .sort((a, b) => a.dueDay - b.dueDay);

    let paidCount = 0;
    let paidSum = 0;
    let pendingSum = 0;

    for (const item of items) {
      const converted = convertCurrency(item.amount, item.currency, currency, state.exchangeRates);
      if (paidMap[item.id]) {
        paidCount += 1;
        paidSum += converted;
      } else {
        pendingSum += converted;
      }
    }

    return {
      fixedItems: items.map((item) => ({
        ...item,
        isPaid: Boolean(paidMap[item.id]),
      })),
      fixedPaidCount: paidCount,
      fixedPaidTotal: paidSum,
      fixedPendingTotal: pendingSum,
    };
  }, [
    state.fixedExpenses,
    state.fixedExpensePaidByMonth,
    selectedMonth,
    activeProfile,
    isSingleAccountFiltered,
    selectedAccountId,
    currency,
    state.exchangeRates,
  ]);

  const handleCreateFixedExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(newFixAmount);
    if (!newFixName.trim() || !numericAmount || numericAmount <= 0) return;

    const ownerAccount =
      state.accounts.find((a) => a.id === newFixAccountId) ||
      state.accounts.find((a) => a.owner === newFixOwner) ||
      state.accounts[0];

    onAddFixedExpense({
      name: newFixName.trim(),
      owner: newFixOwner,
      amount: numericAmount,
      currency: newFixCurrency,
      categoryId: newFixCategoryId,
      accountId: ownerAccount?.id || '',
      dueDay: Math.min(31, Math.max(1, Number(newFixDueDay) || 1)),
    });

    setNewFixName('');
    setNewFixAmount('');
    setShowAddFixed(false);
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const createdId = onAddAccount({
      name: newAccName.trim(),
      owner: newAccOwner,
      kind: newAccKind,
      currency: newAccCurrency,
      initialBalance: Number(newAccBalance) || 0,
    });
    setNewAccName('');
    setNewAccBalance('0');
    setShowAddAccount(false);
    setSelectedAccountId(createdId);
  };

  const monthHeading = formatFullMonthLabel(selectedMonth, lang);
  const householdNames = state.profiles.map((p) => p.name).join(' · ');
  const visibleProfiles =
    activeProfile === 'all'
      ? state.profiles
      : state.profiles.filter((p) => p.id === activeProfile);

  return (
    <div className="space-y-6">
      {/* Month selector + profile context bar + View Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] tracking-tight">
            {tr(`Resumen de ${monthHeading}`, `Overview for ${monthHeading}`)}
          </h1>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
            {activeProfile === 'all'
              ? tr(
                  `Vista conjunta del hogar · ${householdNames}`,
                  `Combined household view · ${householdNames}`
                )
              : tr(
                  `Perfil individual · ${getProfileLabel(activeProfile, state.profiles)}`,
                  `Individual profile · ${getProfileLabel(activeProfile, state.profiles)}`
                )}
            {activeAccount && (
              <>
                {' · '}
                <span className="font-semibold text-[#022E5B] dark:text-[#499BED]">
                  {activeAccount.name} ({activeAccount.currency})
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented Toggle: Vista por totales vs Vista por cuenta */}
          <div
            className="inline-flex items-center gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/65 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs"
            role="group"
            aria-label={tr('Modo de vista del resumen', 'Overview view mode')}
          >
            <button
              type="button"
              onClick={() => setViewMode('totals')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                viewMode === 'totals'
                  ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                  : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              {tr('Vista por totales', 'Totals view')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('by_account')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                viewMode === 'by_account'
                  ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                  : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {tr('Vista por cuenta', 'By account')}
            </button>
          </div>

          {onAskAi && (
            <button
              type="button"
              onClick={() =>
                onAskAi(
                  tr(
                    `Analiza el resumen de ${monthHeading}: ingresos, gastos, % de ahorro y dime qué mejorar.`,
                    `Analyze the ${monthHeading} overview: income, expenses, savings rate, and key improvements.`
                  )
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs font-medium rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#499BED]" />
              {tr('Diagnóstico IA del mes', 'AI Month Diagnosis')}
            </button>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="dash-month" className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
              {tr('Mes:', 'Month:')}
            </label>
            <input
              id="dash-month"
              type="month"
              value={selectedMonth}
              onChange={(e) => e.target.value && onSelectMonth(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-medium text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            />
          </div>
        </div>
      </div>

      {/* Vista por cuenta section */}
      {viewMode === 'by_account' && (
        <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED]">
                <Landmark className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr('Desglose y filtro por cuenta', 'Breakdown & filter by account')}
                </h2>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                  {tr(
                    `Total consolidado en ${visibleAccounts.length} cuentas: `,
                    `Consolidated total across ${visibleAccounts.length} accounts: `
                  )}
                  <strong className="font-mono-num text-[#031725] dark:text-[#DAEAFF]">
                    {formatMoney(totalAccountsBalance, currency)}
                  </strong>
                  {' · '}
                  {tr(
                    'Haz clic en una cuenta para filtrar gráficos, KPIs y movimientos.',
                    'Click an account card to filter charts, KPIs, and transactions.'
                  )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setNewAccOwner(defaultOwnerId);
                setShowAddAccount((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddAccount ? tr('Cerrar', 'Close') : tr('Nueva cuenta', 'New account')}
            </button>
          </div>

          {showAddAccount && (
            <form
              onSubmit={handleCreateAccount}
              className="p-4 bg-[#EDF4FF] dark:bg-[#041E32] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end text-xs"
            >
              <div className="lg:col-span-2">
                <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                  {tr('Nombre de la cuenta', 'Account name')}
                </label>
                <input
                  type="text"
                  required
                  placeholder={tr('Ej. ING Savings, Wise USD...', 'e.g. ING Savings, Wise USD...')}
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                />
              </div>
              <div>
                <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                  {tr('Perfil (Dueño)', 'Profile (Owner)')}
                </label>
                <select
                  value={newAccOwner}
                  onChange={(e) => setNewAccOwner(e.target.value as ProfileId)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                >
                  {state.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                  {tr('Tipo / Banco', 'Type / Bank')}
                </label>
                <select
                  value={newAccKind}
                  onChange={(e) => setNewAccKind(e.target.value as AccountKind)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                >
                  <option value="commbank">CommBank</option>
                  <option value="goalsaver">GoalSaver</option>
                  <option value="revolut">Revolut</option>
                  <option value="wise">Wise</option>
                  <option value="moomoo">Moomoo</option>
                  <option value="cash">{tr('Efectivo', 'Cash')}</option>
                  <option value="other">{tr('Otro banco', 'Other bank')}</option>
                </select>
              </div>
              <div>
                <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                  {tr('Saldo inicial', 'Starting balance')}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={newAccBalance}
                    onChange={(e) => setNewAccBalance(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                  <select
                    value={newAccCurrency}
                    onChange={(e) => setNewAccCurrency(e.target.value as CurrencyCode)}
                    className="px-2 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs text-[#031725] dark:text-[#DAEAFF]"
                  >
                    {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
                >
                  {tr('Crear', 'Create')}
                </button>
              </div>
            </form>
          )}

          {/* Account filter strip */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedAccountId('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                selectedAccountId === 'all'
                  ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] border-[#022E5B] dark:border-[#499BED] font-semibold'
                  : 'bg-[#F5F9FF] dark:bg-[#041E32] text-[#355170] dark:text-[#A1C6F6] border-[#D3E3FA] dark:border-[#123B66] hover:border-[#499BED]'
              }`}
            >
              {tr('Todas las cuentas', 'All accounts')} ({visibleAccounts.length})
            </button>
            {visibleAccounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() =>
                  setSelectedAccountId((cur) => (cur === acc.id ? 'all' : acc.id))
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedAccountId === acc.id
                    ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] border-[#022E5B] dark:border-[#499BED] font-semibold'
                    : 'bg-[#F5F9FF] dark:bg-[#041E32] text-[#355170] dark:text-[#A1C6F6] border-[#D3E3FA] dark:border-[#123B66] hover:border-[#499BED]'
                }`}
              >
                {acc.name} · {getProfileLabel(acc.owner, state.profiles)}
              </button>
            ))}
          </div>

          {/* Accounts Grid */}
          {visibleAccounts.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#5A7694] dark:text-[#A1C6F6]">
              {tr(
                'No hay cuentas registradas para este perfil todavía.',
                'No accounts recorded for this profile yet.'
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleAccounts.map((acc) => {
                const stats = accountStatsMap.get(acc.id) || {
                  liveBalance: acc.initialBalance,
                  monthIncome: 0,
                  monthExpenses: 0,
                  monthTransfersNet: 0,
                  monthTxCount: 0,
                };
                const isSelected = selectedAccountId === acc.id;
                const netMonth = stats.monthIncome - stats.monthExpenses;
                const kindLabel =
                  lang === 'en'
                    ? ACCOUNT_KIND_LABELS[acc.kind].en
                    : ACCOUNT_KIND_LABELS[acc.kind].es;
                const isConfirmingDelete = confirmDeleteAccId === acc.id;

                return (
                  <div
                    key={acc.id}
                    className={`rounded-xl border p-4 transition-all flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#EDF4FF] dark:bg-[#0A2F52] border-[#499BED] ring-2 ring-[#499BED]/30'
                        : 'bg-[#F8FBFF] dark:bg-[#041E32] border-[#D3E3FA] dark:border-[#123B66] hover:border-[#499BED]/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedAccountId((cur) => (cur === acc.id ? 'all' : acc.id))
                        }
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#031725] dark:text-[#DAEAFF] truncate">
                            {acc.name}
                          </span>
                          <span className="text-[11px] font-mono-num font-semibold text-[#022E5B] dark:text-[#499BED] shrink-0">
                            {acc.currency}
                          </span>
                        </div>
                        <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
                          {getProfileLabel(acc.owner, state.profiles)} · {kindLabel}
                        </div>
                      </button>

                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteAccount(acc.id);
                              setConfirmDeleteAccId(null);
                              if (selectedAccountId === acc.id) setSelectedAccountId('all');
                            }}
                            className="px-2 py-1 text-[11px] font-semibold bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            {tr('Eliminar', 'Delete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteAccId(null)}
                            className="px-2 py-1 text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6] hover:underline"
                          >
                            {tr('No', 'No')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAccId(acc.id)}
                          className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                          aria-label={tr(`Eliminar cuenta ${acc.name}`, `Delete account ${acc.name}`)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAccountId((cur) => (cur === acc.id ? 'all' : acc.id))
                      }
                      className="text-left space-y-2.5"
                    >
                      <div>
                        <div className="text-[11px] text-[#5A7694] dark:text-[#7FA6D6]">
                          {tr('Saldo actual estimado', 'Estimated current balance')}
                        </div>
                        <div className="text-xl font-bold font-mono-num text-[#031725] dark:text-[#DAEAFF]">
                          {formatMoney(stats.liveBalance, acc.currency)}
                        </div>
                        {acc.currency !== currency && (
                          <div className="text-[11px] font-mono-num text-[#5A7694] dark:text-[#A1C6F6]">
                            ≈{' '}
                            {formatMoney(
                              convertCurrency(
                                stats.liveBalance,
                                acc.currency,
                                currency,
                                state.exchangeRates
                              ),
                              currency
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-2.5 border-t border-[#D3E3FA] dark:border-[#123B66] grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <div className="text-[#5A7694] dark:text-[#7FA6D6]">
                            {tr('Ingresos', 'Income')}
                          </div>
                          <div className="font-mono-num font-semibold text-emerald-700 dark:text-emerald-400">
                            +{formatMoney(stats.monthIncome, currency, true)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#5A7694] dark:text-[#7FA6D6]">
                            {tr('Gastos', 'Expenses')}
                          </div>
                          <div className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                            -{formatMoney(stats.monthExpenses, currency, true)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#5A7694] dark:text-[#7FA6D6]">
                            {tr('Flujo neto', 'Net flow')}
                          </div>
                          <div
                            className={`font-mono-num font-semibold ${
                              netMonth >= 0
                                ? 'text-[#022E5B] dark:text-[#499BED]'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {netMonth >= 0 ? '+' : ''}
                            {formatMoney(netMonth, currency, true)}
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Budget Alert Banner */}
      {(budgetAlerts.exceeded.length > 0 || budgetAlerts.nearLimit.length > 0) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 rounded-xl border ${
            budgetAlerts.exceeded.length > 0
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/70 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`w-5 h-5 mt-0.5 shrink-0 ${
                budgetAlerts.exceeded.length > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <div className="text-sm">
              {budgetAlerts.exceeded.length > 0 ? (
                <p>
                  <strong className="font-semibold">
                    {tr(
                      `Presupuesto superado en ${budgetAlerts.exceeded.length} ${
                        budgetAlerts.exceeded.length === 1 ? 'categoría' : 'categorías'
                      }:`,
                      `Budget exceeded in ${budgetAlerts.exceeded.length} ${
                        budgetAlerts.exceeded.length === 1 ? 'category' : 'categories'
                      }:`
                    )}
                  </strong>{' '}
                  {budgetAlerts.exceeded
                    .map(
                      (b) =>
                        `${b.name} (${formatMoney(b.spent, currency)} ${tr('de', 'of')} ${formatMoney(
                          b.limit,
                          currency
                        )})`
                    )
                    .join(' · ')}
                </p>
              ) : (
                <p>
                  <strong className="font-semibold">{tr('Atención:', 'Heads up:')}</strong>{' '}
                  {tr(
                    'Estás cerca del límite mensual en',
                    'You are close to your monthly limit in'
                  )}{' '}
                  {budgetAlerts.nearLimit.map((b) => `${b.name} (${b.pct.toFixed(0)}%)`).join(', ')}.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('budgets')}
            className="text-xs font-semibold underline hover:no-underline whitespace-nowrap shrink-0"
          >
            {tr('Revisar presupuestos', 'Review budgets')}
          </button>
        </div>
      )}

      {/* Top 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {activeAccount
              ? tr(`Ingresos del mes · ${activeAccount.name}`, `Monthly income · ${activeAccount.name}`)
              : tr('Ingresos del mes', 'Monthly income')}
          </div>
          <div className="mt-2 text-3xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num tracking-tight">
            {formatMoney(monthIncome, currency)}
          </div>
          <div className="mt-2 text-xs text-[#5A7694] dark:text-[#7FA6D6]">
            {tr('Sueldos, dividendos e intereses recibidos', 'Salaries, dividends & interest received')}
          </div>
        </div>

        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {activeAccount
              ? tr(`Gastos del mes · ${activeAccount.name}`, `Monthly expenses · ${activeAccount.name}`)
              : tr('Gastos del mes', 'Monthly expenses')}
          </div>
          <div className="mt-2 text-3xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num tracking-tight">
            {formatMoney(monthExpenses, currency)}
          </div>
          <div className="mt-2 text-xs text-[#5A7694] dark:text-[#7FA6D6]">
            {categorySlices.length > 0
              ? `${tr('Mayor gasto:', 'Top expense:')} ${categorySlices[0].name}`
              : tr('Sin gastos registrados este mes', 'No expenses recorded this month')}
          </div>
        </div>

        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
              {tr('% de ahorro del mes', 'Monthly savings rate')}
            </span>
            <span
              className={`text-xs font-semibold ${
                savingsRate >= 20
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : savingsRate > 0
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {savingsRate >= 20
                ? tr('Excelente ritmo', 'Great pace')
                : savingsRate > 0
                ? tr('Ahorro positivo', 'Positive savings')
                : monthIncome === 0 && monthExpenses === 0
                ? tr('Sin movimientos', 'No activity')
                : tr('Déficit mensual', 'Monthly deficit')}
            </span>
          </div>
          <div
            className={`mt-2 text-3xl font-bold font-mono-num tracking-tight ${
              savingsRate >= 0
                ? 'text-[#022E5B] dark:text-[#499BED]'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {monthIncome > 0 ? `${savingsRate.toFixed(1)}%` : '0.0%'}
          </div>
          <div className="mt-2 text-xs text-[#5A7694] dark:text-[#7FA6D6] font-mono-num">
            {tr('Balance neto:', 'Net balance:')} {netSavings >= 0 ? '+' : ''}
            {formatMoney(netSavings, currency)}
          </div>
        </div>
      </div>

      {/* Charts: Pie by Category + Bar 6 Months */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Gastos por categoría', 'Expenses by category')}
              </h2>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Distribución de ${monthHeading}`, `Breakdown for ${monthHeading}`)}
                {activeAccount ? ` · ${activeAccount.name}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('budgets')}
              className="text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline whitespace-nowrap"
            >
              {tr('Ver límites', 'View limits')}
            </button>
          </div>
          <CategoryPieChart
            slices={categorySlices}
            totalAmount={monthExpenses}
            currency={currency}
          />
        </section>

        <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Últimos 6 meses', 'Last 6 months')}
              </h2>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Evolución mensual en ${currency}`, `Monthly trend in ${currency}`)}
                {activeAccount ? ` · ${activeAccount.name}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setCompareIncome(false)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  !compareIncome
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
              >
                {tr('Solo gastos', 'Expenses only')}
              </button>
              <button
                type="button"
                onClick={() => setCompareIncome(true)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  compareIncome
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
              >
                {tr('Ingresos vs Gastos', 'Income vs Expenses')}
              </button>
            </div>
          </div>
          <SixMonthBarChart
            data={sixMonthData}
            currency={currency}
            showIncomeComparison={compareIncome}
          />
        </section>
      </div>

      {/* Line Chart (Recharts): Progreso histórico de ahorro acumulado y crecimiento GoalSaver */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr(
                'Progreso histórico de ahorro acumulado y GoalSaver',
                'Historical Cumulative Savings & GoalSaver Growth'
              )}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tr(
                `Evolución del ahorro neto acumulado frente al crecimiento del capital en GoalSaver (${householdNames}) en ${currency}.`,
                `Cumulative net savings compared with GoalSaver capital growth (${householdNames}) in ${currency}.`
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setShowSavingsLine(true)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                  showSavingsLine
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
              >
                {tr('Ahorro + GoalSaver', 'Savings + GoalSaver')}
              </button>
              <button
                type="button"
                onClick={() => setShowSavingsLine(false)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                  !showSavingsLine
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
              >
                {tr('Solo GoalSaver', 'GoalSaver Only')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab('accounts')}
              className="text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline whitespace-nowrap"
            >
              {tr('Simular intereses', 'Simulate interest')}
            </button>
          </div>
        </div>

        <SavingsGrowthLineChart
          data={savingsGrowthData}
          currency={currency}
          activeProfile={activeProfile}
          profiles={state.profiles}
          showSavingsLine={showSavingsLine}
        />

        {savingsGrowthData.length > 0 && (
          <div className="pt-3 border-t border-[#E6EFFB] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-4 text-xs text-[#355170] dark:text-[#A1C6F6]">
            <span>
              {tr('Cierre de', 'Close of')} {savingsGrowthData[savingsGrowthData.length - 1].label}:
            </span>
            <div className="flex flex-wrap items-center gap-5 font-mono-num">
              {showSavingsLine && (
                <span>
                  {tr('Ahorro acumulado:', 'Cumulative savings:')}{' '}
                  <strong className="text-emerald-700 dark:text-emerald-400">
                    {formatMoney(
                      savingsGrowthData[savingsGrowthData.length - 1].ahorroAcumulado,
                      currency
                    )}
                  </strong>
                </span>
              )}
              {visibleProfiles.map((p) => {
                const lastPoint = savingsGrowthData[savingsGrowthData.length - 1];
                const gsAmount = lastPoint.goalSaverByProfile[p.id] || 0;
                const badgeColor = getSafeProfileChartColor(p.color, isDark);
                return (
                  <span key={p.id}>
                    GoalSaver {p.name}:{' '}
                    <strong style={{ color: badgeColor }}>{formatMoney(gsAmount, currency)}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Gastos Fijos recurrentes del mes */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr(`Gastos fijos de ${monthHeading}`, `Fixed bills for ${monthHeading}`)}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tr(
                'Marca cada recibo o suscripción como pagado o pendiente para llevar el control mensual.',
                'Check off each recurring bill or subscription as paid or pending for monthly tracking.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono-num">
              <span className="text-[#355170] dark:text-[#A1C6F6] font-sans">
                {fixedPaidCount} {tr('de', 'of')} {fixedItems.length} {tr('pagados', 'paid')}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400">
                {tr('Pagado:', 'Paid:')} <strong>{formatMoney(fixedPaidTotal, currency)}</strong>
              </span>
              <span className="text-amber-700 dark:text-amber-300">
                {tr('Pendiente:', 'Pending:')} <strong>{formatMoney(fixedPendingTotal, currency)}</strong>
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setNewFixOwner(defaultOwnerId);
                const acc =
                  state.accounts.find((a) => a.owner === defaultOwnerId) || state.accounts[0];
                if (acc) {
                  setNewFixAccountId(acc.id);
                  setNewFixCurrency(acc.currency);
                }
                setShowAddFixed((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddFixed ? tr('Cerrar', 'Close') : tr('Agregar gasto fijo', 'Add fixed bill')}
            </button>
          </div>
        </div>

        {showAddFixed && (
          <form
            onSubmit={handleCreateFixedExpense}
            className="px-6 py-4 bg-[#EDF4FF] dark:bg-[#041E32] border-b border-[#D3E3FA] dark:border-[#123B66] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end text-xs"
          >
            <div className="lg:col-span-2">
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Nombre del gasto fijo', 'Fixed expense name')}
              </label>
              <input
                type="text"
                required
                placeholder={tr('Ej. Seguro médico, Celular...', 'e.g. Health insurance, Mobile...')}
                value={newFixName}
                onChange={(e) => setNewFixName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
              />
            </div>

            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Perfil', 'Profile')}
              </label>
              <select
                value={newFixOwner}
                onChange={(e) => {
                  const nextOwner = e.target.value as ProfileId;
                  setNewFixOwner(nextOwner);
                  const acc = state.accounts.find((a) => a.owner === nextOwner);
                  if (acc) {
                    setNewFixAccountId(acc.id);
                    setNewFixCurrency(acc.currency);
                  }
                }}
                className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
              >
                {state.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Monto y Moneda', 'Amount & Currency')}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={newFixAmount}
                  onChange={(e) => setNewFixAmount(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                />
                <select
                  value={newFixCurrency}
                  onChange={(e) => setNewFixCurrency(e.target.value as CurrencyCode)}
                  className="px-2 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs text-[#031725] dark:text-[#DAEAFF]"
                >
                  {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Categoría', 'Category')}
              </label>
              <select
                value={newFixCategoryId}
                onChange={(e) => setNewFixCategoryId(e.target.value)}
                className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
              >
                {state.categories
                  .filter((c) => c.type === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {catName(c)}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Cuenta de pago', 'Payment account')}
              </label>
              <select
                value={newFixAccountId}
                onChange={(e) => setNewFixAccountId(e.target.value)}
                className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
              >
                {state.accounts
                  .filter((a) => a.owner === newFixOwner)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] font-medium mb-1">
                {tr('Día cobro', 'Due day')}
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={newFixDueDay}
                onChange={(e) => setNewFixDueDay(e.target.value)}
                className="w-full px-2.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-7 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddFixed(false)}
                className="px-4 py-2 text-[#355170] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B] text-sm font-medium rounded-lg"
              >
                {tr('Cancelar', 'Cancel')}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
              >
                {tr('Guardar gasto fijo', 'Save fixed bill')}
              </button>
            </div>
          </form>
        )}

        {fixedItems.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#5A7694] dark:text-[#A1C6F6] mb-3">
              {tr(
                'No tienes gastos fijos recurrentes registrados todavía (ej. alquiler, luz, internet, suscripciones).',
                'No recurring fixed bills added yet (e.g. rent, power, internet, subscriptions).'
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowAddFixed(true)}
              className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
            >
              {tr('Agregar primer gasto fijo', 'Add first fixed bill')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-[#D3E3FA] dark:bg-[#123B66]">
            {fixedItems.map((item) => {
              const acc = state.accounts.find((a) => a.id === item.accountId);
              const cat = state.categories.find((c) => c.id === item.categoryId);

              return (
                <div
                  key={item.id}
                  className="bg-white dark:bg-[#062035] px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] transition-colors"
                >
                  <label className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={item.isPaid}
                      onChange={() => onToggleFixedExpensePaid(selectedMonth, item.id)}
                      className="w-5 h-5 rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED] shrink-0 cursor-pointer"
                      aria-label={tr(
                        `Marcar ${item.name} como ${item.isPaid ? 'pendiente' : 'pagado'}`,
                        `Mark ${item.name} as ${item.isPaid ? 'pending' : 'paid'}`
                      )}
                    />
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${
                          item.isPaid
                            ? 'line-through text-[#7FA6D6] dark:text-[#4F77A4]'
                            : 'text-[#031725] dark:text-[#DAEAFF]'
                        }`}
                      >
                        {item.name}
                      </div>
                      <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6] flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span>{tr(`Día ${item.dueDay}`, `Day ${item.dueDay}`)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getProfileLabel(item.owner, state.profiles)}</span>
                        {acc && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[130px]">{acc.name}</span>
                          </>
                        )}
                        {cat && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[110px]">{catName(cat)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </label>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-sm font-semibold font-mono-num ${
                          item.isPaid
                            ? 'text-[#7FA6D6] dark:text-[#4F77A4]'
                            : 'text-[#031725] dark:text-[#DAEAFF]'
                        }`}
                      >
                        {formatMoney(item.amount, item.currency)}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          item.isPaid
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {item.isPaid ? tr('Pagado', 'Paid') : tr('Pendiente', 'Pending')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteFixedExpense(item.id)}
                      className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
                      aria-label={tr(`Eliminar gasto fijo ${item.name}`, `Delete fixed bill ${item.name}`)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom section: Recent Transactions + GoalSaver & Moomoo Snapshots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent transactions */}
        <section className="lg:col-span-2 bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Movimientos del mes', 'Monthly transactions')}
              </h2>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Últimos registros en ${monthHeading}`, `Latest entries in ${monthHeading}`)}
                {activeAccount ? ` · ${activeAccount.name}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenImport && (
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" /> {tr('Importar PDF / CSV', 'Import PDF / CSV')}
                </button>
              )}
              <button
                type="button"
                onClick={onOpenNewTransaction}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> {tr('Nuevo', 'New')}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('transactions')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B]/60 rounded-lg whitespace-nowrap transition-colors"
              >
                {tr('Ver todos', 'View all')} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[#5A7694] dark:text-[#A1C6F6] mb-3">
                {tr(
                  'No hay movimientos registrados en este mes todavía.',
                  'No transactions recorded for this month yet.'
                )}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={onOpenNewTransaction}
                  className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
                >
                  {tr('Registrar primer movimiento', 'Record first transaction')}
                </button>
                {onOpenImport && (
                  <button
                    type="button"
                    onClick={onOpenImport}
                    className="px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B]"
                  >
                    {tr('Importar PDF / CSV', 'Import PDF / CSV')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
              {recentTransactions.map((tx) => {
                const cat = state.categories.find((c) => c.id === tx.categoryId);
                const acc = state.accounts.find((a) => a.id === tx.accountId);
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onEditTransaction(tx)}
                    className="w-full px-6 py-3 flex items-center justify-between gap-4 hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#031725] dark:text-[#DAEAFF] truncate">
                        {tx.description}
                      </div>
                      <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6] flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span>{formatDateShort(tx.date, lang)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{catName(cat)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {getProfileLabel(tx.owner, state.profiles)} ({acc?.name || tr('Cuenta', 'Account')})
                        </span>
                      </div>
                    </div>
                    <div
                      className={`text-sm font-semibold font-mono-num whitespace-nowrap shrink-0 ${
                        tx.type === 'income'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : tx.type === 'transfer'
                          ? 'text-[#5A7694] dark:text-[#A1C6F6]'
                          : 'text-[#031725] dark:text-[#DAEAFF]'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      {formatMoney(tx.amount, tx.currency)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Wealth Snapshot: GoalSaver + Moomoo */}
        <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 flex flex-col justify-between space-y-5 shadow-xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Ahorro e Inversiones', 'Savings & Investments')}
              </h2>
              <TrendingUp className="w-4 h-4 text-[#022E5B] dark:text-[#499BED]" />
            </div>

            <div className="space-y-4">
              <div className="pb-4 border-b border-[#E6EFFB] dark:border-[#123B66]">
                <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                  {tr('Colchón CommBank GoalSaver', 'CommBank GoalSaver Cushion')}
                </div>
                <div className="text-xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                  {formatMoney(goalSaverTotal, currency)}
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('accounts')}
                  className="mt-1.5 text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline inline-flex items-center gap-1"
                >
                  {tr('Simular intereses mensuales', 'Simulate monthly interest')}{' '}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div>
                <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                  {tr('Portafolio Moomoo (Actual)', 'Moomoo Portfolio (Current)')}
                </div>
                <div className="text-xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                  {formatMoney(moomooSummary.current, currency)}
                </div>
                <div className="mt-1 text-xs font-mono-num text-[#355170] dark:text-[#A1C6F6]">
                  {tr('Invertido:', 'Invested:')} {formatMoney(moomooSummary.invested, currency)} ·{' '}
                  <span
                    className={
                      moomooSummary.gain >= 0
                        ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                        : 'text-red-700 dark:text-red-400 font-medium'
                    }
                  >
                    {moomooSummary.gain >= 0 ? '+' : ''}
                    {formatMoney(moomooSummary.gain, currency)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('moomoo')}
                  className="mt-1.5 text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline inline-flex items-center gap-1"
                >
                  {tr('Ver ETFs y calculadora de dividendos', 'View ETFs & dividend calculator')}{' '}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[#E6EFFB] dark:border-[#123B66] text-xs text-[#5A7694] dark:text-[#7FA6D6]">
            {tr(
              `Todos los cálculos convierten automáticamente USD y otras monedas a ${currency}.`,
              `All figures automatically convert USD and other currencies into ${currency}.`
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
