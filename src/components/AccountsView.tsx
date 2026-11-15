import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Landmark, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  AccountKind,
  CurrencyCode,
  FinanceState,
  SavingsInterestConfig,
  ProfileFilter,
  ProfileId,
} from '../types/finance';
import {
  CURRENCY_META,
  computeAccountBalances,
  convertCurrency,
  formatMoney,
  accountDisplayName,
  accountKindLabel,
  getSavingsBalance,
  getProfileLabel,
  simulateAnnualCompoundSavings,
  simulateSavingsInterest,
  type CsvPreset,
} from '../utils/formatters';
import { ACCOUNT_KINDS } from '../data/migrations';
import { ProjectionBarChart } from './Charts';
import { getSafeProfileChartColor } from './SavingsGrowthLineChart';

interface AccountsViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  onAddAccount: (acc: Omit<Account, 'id'>) => string;
  onUpdateAccount: (acc: Account) => void;
  onDeleteAccount: (id: string) => void;
  onAddSavingsConfig: (params: { owner: ProfileId; name: string; accountId?: string; currency?: CurrencyCode }) => string;
  onUpdateSavingsConfig: (id: string, patch: Partial<SavingsInterestConfig>) => void;
  onDeleteSavingsConfig: (id: string) => void;
  onResetToZero?: (options: {
    accounts: boolean;
    investments: boolean;
    transactions: boolean;
    scope?: ProfileFilter;
  }) => void;
  onOpenImport?: (preset?: CsvPreset) => void;
}

export function AccountsView({
  state,
  activeProfile,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onAddSavingsConfig,
  onUpdateSavingsConfig,
  onDeleteSavingsConfig,
  onResetToZero,
  onOpenImport,
}: AccountsViewProps) {
  const { tr, lang, isDark } = useUiPreferences();

  const defaultOwnerId: ProfileId =
    activeProfile === 'all'
      ? state.profiles[0]?.id || ''
      : state.profiles.some((p) => p.id === activeProfile)
      ? activeProfile
      : state.profiles[0]?.id || '';

  const visibleProfiles = useMemo(
    () =>
      activeProfile === 'all'
        ? state.profiles
        : state.profiles.filter((p) => p.id === activeProfile),
    [state.profiles, activeProfile]
  );

  const [horizonMonths, setHorizonMonths] = useState<number>(24);
  const [includeBonus, setIncludeBonus] = useState<boolean>(true);
  const [showAddAccount, setShowAddAccount] = useState<boolean>(false);

  // New account form
  const [newAccName, setNewAccName] = useState('');
  const [newAccOwner, setNewAccOwner] = useState<ProfileId>(defaultOwnerId);
  const [newAccKind, setNewAccKind] = useState<AccountKind>('transaccional');
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>('AUD');
  const [newAccBalance, setNewAccBalance] = useState('0');
  const [newAccInstitution, setNewAccInstitution] = useState('');
  const [confirmDeleteAccId, setConfirmDeleteAccId] = useState<string | null>(null);

  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceVal, setEditingBalanceVal] = useState<string>('');
  const [confirmZeroAccounts, setConfirmZeroAccounts] = useState(false);
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<{ name: string; kind: AccountKind; institution: string }>({
    name: '',
    kind: 'transaccional',
    institution: '',
  });

  useEffect(() => {
    setNewAccOwner(defaultOwnerId);
  }, [defaultOwnerId]);

  // Compute live account balances from initialBalance + transactions
  const accountBalances = useMemo(
    () => computeAccountBalances(state.accounts, state.transactions, state.exchangeRates),
    [state.accounts, state.transactions, state.exchangeRates]
  );

  const visibleAccounts = useMemo(() => {
    return state.accounts.filter((a) => activeProfile === 'all' || a.owner === activeProfile);
  }, [state.accounts, activeProfile]);

  const totalNetLiquid = useMemo(() => {
    return visibleAccounts.reduce((sum, acc) => {
      const bal = accountBalances.get(acc.id) ?? acc.initialBalance;
      return sum + convertCurrency(bal, acc.currency, state.displayCurrency, state.exchangeRates);
    }, 0);
  }, [visibleAccounts, accountBalances, state.displayCurrency, state.exchangeRates]);

  // Savings accounts with interest. Projections run in the display currency.
  const dc = state.displayCurrency;
  const visibleSavings = useMemo(
    () => state.savingsConfigs.filter((c) => activeProfile === 'all' || c.owner === activeProfile),
    [state.savingsConfigs, activeProfile]
  );

  const savingsSources = useMemo(
    () =>
      visibleSavings.map((c) => ({
        ...c,
        currentBalance: convertCurrency(
          getSavingsBalance(c, accountBalances, state.accounts, state.exchangeRates),
          c.currency,
          dc,
          state.exchangeRates
        ),
        monthlyContribution: convertCurrency(c.monthlyContribution, c.currency, dc, state.exchangeRates),
      })),
    [visibleSavings, accountBalances, state.accounts, state.exchangeRates, dc]
  );

  /** Aggregated savings of one profile (all its configs), in the display currency. */
  const profileSavings = (profileId: ProfileId) => {
    const list = state.savingsConfigs
      .filter((c) => c.owner === profileId)
      .map((c) => ({
        bal: convertCurrency(getSavingsBalance(c, accountBalances, state.accounts, state.exchangeRates), c.currency, dc, state.exchangeRates),
        monthly: convertCurrency(c.monthlyContribution, c.currency, dc, state.exchangeRates),
        rate: c.baseRateAnnual + c.bonusRateAnnual,
      }));
    const currentBalance = list.reduce((s, x) => s + x.bal, 0);
    const monthlyContribution = list.reduce((s, x) => s + x.monthly, 0);
    const annualRate =
      currentBalance > 0
        ? list.reduce((s, x) => s + x.rate * x.bal, 0) / currentBalance
        : list.reduce((s, x) => s + x.rate, 0) / Math.max(1, list.length);
    return { currentBalance, monthlyContribution, annualRate, count: list.length };
  };

  // Each savings account earns its own rate (and only gets the bonus if it receives contributions),
  // so the projection is the sum of one simulation per account.
  const runCombinedSimulation = (withBonus: boolean) => {
    const perAccount = savingsSources.map((gs) =>
      simulateSavingsInterest({
        initialBalance: gs.currentBalance,
        monthlyContribution: gs.monthlyContribution,
        baseRateAnnual: gs.baseRateAnnual,
        bonusRateAnnual: gs.bonusRateAnnual,
        months: horizonMonths,
        includeBonus: withBonus,
        lang,
      })
    );
    if (perAccount.length === 0) return [];
    return perAccount[0].map((pt, i) => {
      const sum = (key: keyof typeof pt) =>
        perAccount.reduce((acc, list) => acc + (Number(list[i]?.[key]) || 0), 0);
      return {
        ...pt,
        startingBalance: sum('startingBalance'),
        contribution: sum('contribution'),
        interestEarned: sum('interestEarned'),
        endingBalance: sum('endingBalance'),
        totalContributed: sum('totalContributed'),
        totalInterest: sum('totalInterest'),
      };
    });
  };

  const simulationPoints = useMemo(
    () => runCombinedSimulation(includeBonus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savingsSources, horizonMonths, includeBonus, lang]
  );

  const simulationWithoutBonus = useMemo(
    () => runCombinedSimulation(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savingsSources, horizonMonths, lang]
  );

  const lastPoint = simulationPoints[simulationPoints.length - 1];
  const lastNoBonus = simulationWithoutBonus[simulationWithoutBonus.length - 1];
  const effectiveAnnualPct = (() => {
    const rateOf = (gs: SavingsInterestConfig) =>
      gs.baseRateAnnual + (includeBonus && gs.monthlyContribution > 0 ? gs.bonusRateAnnual : 0);
    const totalBal = savingsSources.reduce((s, gs) => s + Math.max(0, gs.currentBalance), 0);
    if (savingsSources.length === 0) return 0;
    if (totalBal <= 0) {
      return savingsSources.reduce((s, gs) => s + rateOf(gs), 0) / savingsSources.length;
    }
    return savingsSources.reduce((s, gs) => s + rateOf(gs) * Math.max(0, gs.currentBalance), 0) / totalBal;
  })();

  const savingsAccountsFor = (owner: ProfileId) =>
    state.accounts.filter((a) => a.owner === owner && a.kind === 'ahorro');

  const handleAddSavingsConfig = () => {
    const owner = defaultOwnerId;
    const linkedIds = new Set(state.savingsConfigs.map((c) => c.accountId).filter(Boolean));
    const freeAccount = savingsAccountsFor(owner).find((a) => !linkedIds.has(a.id));
    onAddSavingsConfig({
      owner,
      name: freeAccount?.name || tr('Fondo de ahorro', 'Savings fund'),
      accountId: freeAccount?.id,
      currency: freeAccount?.currency || dc,
    });
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    onAddAccount({
      name: newAccName.trim(),
      owner: newAccOwner,
      kind: newAccKind,
      institution: newAccInstitution.trim() || undefined,
      currency: newAccCurrency,
      initialBalance: Number(newAccBalance) || 0,
    });
    setNewAccName('');
    setNewAccInstitution('');
    setNewAccBalance('0');
    setShowAddAccount(false);
  };

  // Herramienta interactiva: Proyección Anual con Interés Mensual Compuesto (dinámica por perfil)
  const [compInitials, setCompInitials] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = Math.round(profileSavings(p.id).currentBalance);
    }
    return out;
  });
  const [compMonthlies, setCompMonthlies] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = Math.round(profileSavings(p.id).monthlyContribution);
    }
    return out;
  });
  const [compMonthlyRatePct, setCompMonthlyRatePct] = useState<number>(() => {
    const first = state.profiles[0] ? profileSavings(state.profiles[0].id) : undefined;
    return first && first.count > 0 ? Number((first.annualRate / 12).toFixed(2)) || 0.37 : 0.37;
  });
  const [compYears, setCompYears] = useState<number>(10);

  const syncCompoundFromAccounts = () => {
    const nextInit: Record<string, number> = {};
    const nextMonthly: Record<string, number> = {};
    let rateSum = 0;

    let rateCount = 0;
    for (const p of state.profiles) {
      const ps = profileSavings(p.id);
      nextInit[p.id] = Math.round(ps.currentBalance);
      nextMonthly[p.id] = Math.round(ps.monthlyContribution);
      if (ps.count > 0) {
        rateSum += ps.annualRate;
        rateCount += 1;
      }
    }

    setCompInitials(nextInit);
    setCompMonthlies(nextMonthly);
    const avgAnnual = rateSum / Math.max(1, rateCount);
    setCompMonthlyRatePct(Number((avgAnnual / 12).toFixed(2)) || 0.37);
  };

  useEffect(() => {
    setCompInitials((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const p of state.profiles) {
        next[p.id] = Math.round(profileSavings(p.id).currentBalance);
      }
      return next;
    });
    setCompMonthlies((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const p of state.profiles) {
        if (next[p.id] === undefined) {
          next[p.id] = Math.round(profileSavings(p.id).monthlyContribution);
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profiles, state.savingsConfigs, accountBalances, dc]);

  const effectiveAnnualCompoundPct = useMemo(() => {
    const r = Math.max(0, compMonthlyRatePct) / 100;
    return (Math.pow(1 + r, 12) - 1) * 100;
  }, [compMonthlyRatePct]);

  const annualCompoundPoints = useMemo(() => {
    const entries = visibleProfiles.map((p) => ({
      id: p.id,
      initial: compInitials[p.id] ?? 0,
      monthly: compMonthlies[p.id] ?? 0,
    }));

    return simulateAnnualCompoundSavings({
      entries,
      monthlyRatePct: compMonthlyRatePct,
      years: compYears,
      lang,
    });
  }, [
    visibleProfiles,
    compInitials,
    compMonthlies,
    compMonthlyRatePct,
    compYears,
    lang,
  ]);

  const lastCompoundPoint = annualCompoundPoints[annualCompoundPoints.length - 1];
  const householdNames = state.profiles.map((p) => p.name).join(' & ');

  // Recharts palette tokens
  const gridStroke = isDark ? '#123B66' : '#DCE8FA';
  const tickColor = isDark ? '#A1C6F6' : '#5A7694';
  const totalStroke = isDark ? '#499BED' : '#022E5B';
  const contribStroke = isDark ? '#A1C6F6' : '#5A7694';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] tracking-tight">
            {tr('Cuentas Bancarias', 'Bank Accounts')}
          </h1>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
            {tr(
              'Administra tus cuentas (sueldo, gastos diarios, ahorro, tarjetas) y proyecta los intereses de tus fondos de ahorro.',
              'Manage your accounts (salary, daily spending, savings, cards) and forecast interest on your savings funds.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenImport && (
            <button
              type="button"
              onClick={() => onOpenImport('auto')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
            >
              <Upload className="w-4 h-4" />
              {tr('Importar PDF / CSV', 'Import PDF / CSV')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNewAccOwner(defaultOwnerId);
              setShowAddAccount((v) => !v);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
          >
            <Plus className="w-4 h-4" />
            {showAddAccount
              ? tr('Cerrar formulario', 'Close form')
              : tr('Agregar cuenta', 'Add account')}
          </button>
        </div>
      </div>

      {/* Add account panel */}
      {showAddAccount && (
        <form
          onSubmit={handleCreateAccount}
          className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end shadow-xs"
        >
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Nombre de la cuenta', 'Account name')}
            </label>
            <input
              type="text"
              required
              placeholder={tr('Ej. Cuenta en USD, Ahorro viajes...', 'e.g. USD account, Travel savings...')}
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Dueño', 'Owner')}
            </label>
            <select
              value={newAccOwner}
              onChange={(e) => setNewAccOwner(e.target.value as ProfileId)}
              className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
            >
              {state.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Tipo', 'Type')}
            </label>
            <select
              value={newAccKind}
              onChange={(e) => setNewAccKind(e.target.value as AccountKind)}
              className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
            >
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {accountKindLabel(k, lang)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-acc-institution" className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Institución (opcional)', 'Institution (optional)')}
            </label>
            <input
              id="new-acc-institution"
              type="text"
              placeholder={tr('Ej. nombre del banco', 'e.g. bank name')}
              value={newAccInstitution}
              onChange={(e) => setNewAccInstitution(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
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
                className="px-2 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
              >
                {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
          >
            {tr('Guardar', 'Save')}
          </button>
        </form>
      )}

      {/* Accounts Table */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('Saldos por cuenta', 'Account balances')}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
              {tr(
                'Haz clic en el saldo inicial si deseas ajustarlo al saldo real de tu banco.',
                'Click on the starting balance to align it with your actual bank balance.'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-[#355170] dark:text-[#A1C6F6] font-mono-num">
              {tr('Total cuentas:', 'Total accounts:')}{' '}
              <strong className="text-[#031725] dark:text-[#DAEAFF] text-base">
                {formatMoney(totalNetLiquid, state.displayCurrency)}
              </strong>
            </div>
            {onResetToZero && (
              <button
                type="button"
                onClick={() => setConfirmZeroAccounts((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50/70 dark:bg-red-950/35 border border-red-200 dark:border-red-800/70 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {tr('Saldos a $0', 'Reset balances to $0')}
              </button>
            )}
          </div>
        </div>

        {confirmZeroAccounts && onResetToZero && (
          <div className="px-6 py-3 bg-red-50/80 dark:bg-red-950/35 border-b border-red-200 dark:border-red-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-red-900 dark:text-red-200 font-medium">
              {tr(
                '¿Volver a $0.00 el saldo base de las cuentas y de los fondos de ahorro?',
                'Reset account starting balances and savings funds to $0.00?'
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onResetToZero({
                    accounts: true,
                    investments: false,
                    transactions: false,
                    scope: activeProfile,
                  });
                  setConfirmZeroAccounts(false);
                }}
                className="px-3 py-1.5 bg-red-700 text-white font-semibold rounded-md hover:bg-red-800"
              >
                {state.transactions.length > 0
                  ? tr('Solo saldos base a $0', 'Base balances to $0 only')
                  : tr('Sí, volver saldos a $0', 'Yes, reset balances to $0')}
              </button>
              {state.transactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onResetToZero({
                      accounts: true,
                      investments: false,
                      transactions: true,
                      scope: activeProfile,
                    });
                    setConfirmZeroAccounts(false);
                  }}
                  className="px-3 py-1.5 bg-red-900 text-white font-semibold rounded-md hover:bg-red-950"
                >
                  {tr('Saldos + movimientos a $0', 'Balances + transactions to $0')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmZeroAccounts(false)}
                className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#031725] dark:text-[#DAEAFF] font-medium rounded-md"
              >
                {tr('Cancelar', 'Cancel')}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-[#EAF2FF]/80 dark:bg-[#022E5B]/55 border-b border-[#D3E3FA] dark:border-[#123B66] text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
              <tr>
                <th className="py-3 px-4">{tr('Cuenta', 'Account')}</th>
                <th className="py-3 px-4">{tr('Perfil', 'Profile')}</th>
                <th className="py-3 px-4">{tr('Tipo', 'Type')}</th>
                <th className="py-3 px-4 text-right">{tr('Saldo base', 'Starting balance')}</th>
                <th className="py-3 px-4 text-right">{tr('Saldo calculado', 'Current balance')}</th>
                <th className="py-3 px-4 text-right w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
              {visibleAccounts.map((acc) => {
                const calculated = accountBalances.get(acc.id) ?? acc.initialBalance;
                const isEditing = editingBalanceId === acc.id;
                const isConfirmingDel = confirmDeleteAccId === acc.id;

                return (
                  <tr
                    key={acc.id}
                    className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-[#031725] dark:text-[#DAEAFF]">
                      {editingMetaId === acc.id ? (
                        <input
                          aria-label={tr('Nombre de la cuenta', 'Account name')}
                          value={metaDraft.name}
                          onChange={(e) => setMetaDraft((d) => ({ ...d, name: e.target.value }))}
                          className="w-full px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-xs text-[#031725] dark:text-[#DAEAFF]"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMetaId(acc.id);
                            setMetaDraft({ name: acc.name, kind: acc.kind, institution: acc.institution || '' });
                          }}
                          className="text-left hover:underline decoration-dotted underline-offset-4"
                          title={tr('Editar nombre, tipo e institución', 'Edit name, type and institution')}
                        >
                          {acc.name}{' '}
                          <span className="text-xs font-normal text-[#5A7694] dark:text-[#A1C6F6]">
                            ({acc.currency})
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6]">
                      {getProfileLabel(acc.owner, state.profiles)}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#5A7694] dark:text-[#7FA6D6] max-w-[260px]">
                      {editingMetaId === acc.id ? (
                        <div className="flex flex-col gap-1">
                          <select
                            aria-label={tr('Tipo de cuenta', 'Account type')}
                            value={metaDraft.kind}
                            onChange={(e) => setMetaDraft((d) => ({ ...d, kind: e.target.value as AccountKind }))}
                            className="w-full px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-xs text-[#031725] dark:text-[#DAEAFF]"
                          >
                            {ACCOUNT_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {accountKindLabel(k, lang)}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={tr('Institución (opcional)', 'Institution (optional)')}
                            placeholder={tr('Institución (opcional)', 'Institution (optional)')}
                            value={metaDraft.institution}
                            onChange={(e) => setMetaDraft((d) => ({ ...d, institution: e.target.value }))}
                            className="w-full px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-xs text-[#031725] dark:text-[#DAEAFF]"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onUpdateAccount({
                                  ...acc,
                                  name: metaDraft.name.trim() || acc.name,
                                  kind: metaDraft.kind,
                                  institution: metaDraft.institution.trim() || undefined,
                                });
                                setEditingMetaId(null);
                              }}
                              className="px-2 py-1 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded text-xs font-semibold"
                            >
                              {tr('Guardar', 'Save')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingMetaId(null)}
                              className="px-2 py-1 text-xs text-[#5A7694] dark:text-[#A1C6F6]"
                            >
                              {tr('Cancelar', 'Cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {accountKindLabel(acc.kind, lang)}
                          {acc.institution ? ` · ${acc.institution}` : ''}
                          {acc.notes ? <div className="truncate">{acc.notes}</div> : null}
                        </>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-xs text-[#355170] dark:text-[#A1C6F6]">
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            onUpdateAccount({
                              ...acc,
                              initialBalance: Number(editingBalanceVal) || 0,
                            });
                            setEditingBalanceId(null);
                          }}
                          className="inline-flex items-center gap-1"
                        >
                          <input
                            type="number"
                            step="0.01"
                            autoFocus
                            value={editingBalanceVal}
                            onChange={(e) => setEditingBalanceVal(e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-right text-[#031725] dark:text-[#DAEAFF]"
                          />
                          <button
                            type="submit"
                            className="px-2 py-1 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded text-xs font-sans font-semibold"
                          >
                            OK
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBalanceId(acc.id);
                            setEditingBalanceVal(String(acc.initialBalance));
                          }}
                          className="underline decoration-dotted hover:text-[#031725] dark:hover:text-[#DAEAFF]"
                        >
                          {formatMoney(acc.initialBalance, acc.currency)}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(calculated, acc.currency)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isConfirmingDel ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteAccount(acc.id);
                              setConfirmDeleteAccId(null);
                            }}
                            className="px-2 py-1 text-[11px] font-semibold bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            {tr('Eliminar + movimientos', 'Delete + transactions')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteAccId(null)}
                            className="px-1.5 py-1 text-[11px] text-[#5A7694] dark:text-[#A1C6F6]"
                          >
                            {tr('No', 'No')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAccId(acc.id)}
                          className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
                          aria-label={tr('Eliminar cuenta', 'Delete account')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Savings accounts with interest */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D3E3FA] dark:border-[#123B66] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED] shrink-0">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Cuentas de ahorro con interés', 'Savings accounts with interest')}
              </h2>
              <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5 max-w-2xl">
                {tr(
                  'Proyecta el interés de tus fondos de ahorro: tasa base, más una tasa bonificada si cumples la condición de tu banco (por ejemplo, aportar cada mes). Asocia cada una a una cuenta de tipo Ahorro.',
                  'Forecast interest on your savings funds: base rate, plus a bonus rate when you meet your bank’s condition (e.g. depositing every month). Link each one to a Savings account.'
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleAddSavingsConfig}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {tr('Agregar cuenta de ahorro con interés', 'Add savings account with interest')}
            </button>
            {onOpenImport && (
              <button
                type="button"
                onClick={() => onOpenImport('auto')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                {tr('Importar extracto de ahorro', 'Import savings statement')}
              </button>
            )}
            <div className="text-right font-mono-num">
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Tasa anual efectiva', 'Effective annual rate')}
              </div>
              <div className="text-xl font-bold text-[#022E5B] dark:text-[#499BED]">
                {effectiveAnnualPct.toFixed(2)}% p.a.
              </div>
            </div>
          </div>
        </div>

        {/* One card per savings config */}
        {visibleSavings.length === 0 ? (
          <p className="text-sm text-[#5A7694] dark:text-[#A1C6F6]">
            {tr(
              'Todavía no configuraste ninguna cuenta de ahorro con interés. Crea una cuenta de tipo "Ahorro" y pulsa "Agregar cuenta de ahorro con interés".',
              'No savings account with interest yet. Create a "Savings" account and click "Add savings account with interest".'
            )}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {visibleSavings.map((cfg) => {
              const profile = state.profiles.find((p) => p.id === cfg.owner);
              const linkedBalance = cfg.accountId ? accountBalances.get(cfg.accountId) : undefined;
              const linkedAccount = state.accounts.find((a) => a.id === cfg.accountId);
              const num = (v: string) => Math.max(0, Number(v) || 0);
              return (
                <div
                  key={cfg.id}
                  className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: getSafeProfileChartColor(profile?.color || '#499BED', isDark) }}
                      />
                      <span className="truncate">
                        {cfg.name} · {profile?.name || cfg.owner}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteSavingsConfig(cfg.id)}
                      className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                      aria-label={tr(`Quitar configuración de interés ${cfg.name}`, `Remove interest settings ${cfg.name}`)}
                      title={tr('Quitar esta configuración (no borra la cuenta)', 'Remove these settings (does not delete the account)')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="col-span-2 sm:col-span-1">
                      <label htmlFor={`sav-name-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Nombre', 'Name')}
                      </label>
                      <input
                        id={`sav-name-${cfg.id}`}
                        type="text"
                        value={cfg.name}
                        onChange={(e) => onUpdateSavingsConfig(cfg.id, { name: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label htmlFor={`sav-acc-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Cuenta de ahorro asociada', 'Linked savings account')}
                      </label>
                      <select
                        id={`sav-acc-${cfg.id}`}
                        value={cfg.accountId || ''}
                        onChange={(e) => {
                          const accountId = e.target.value || undefined;
                          const acc = state.accounts.find((a) => a.id === accountId);
                          onUpdateSavingsConfig(cfg.id, {
                            accountId,
                            useAccountBalance: Boolean(accountId),
                            ...(acc ? { currency: acc.currency } : {}),
                          });
                        }}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                      >
                        <option value="">{tr('Sin asociar', 'Not linked')}</option>
                        {savingsAccountsFor(cfg.owner).map((a) => (
                          <option key={a.id} value={a.id}>
                            {accountDisplayName(a)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {linkedAccount && (
                      <label className="col-span-2 inline-flex items-center gap-2 text-[#355170] dark:text-[#A1C6F6] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cfg.useAccountBalance}
                          onChange={(e) => onUpdateSavingsConfig(cfg.id, { useAccountBalance: e.target.checked })}
                          className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
                        />
                        {tr(
                          `Usar el saldo calculado de la cuenta (${formatMoney(linkedBalance ?? 0, linkedAccount.currency)})`,
                          `Use the account's calculated balance (${formatMoney(linkedBalance ?? 0, linkedAccount.currency)})`
                        )}
                      </label>
                    )}
                    <div>
                      <label htmlFor={`sav-bal-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr(`Capital actual (${cfg.currency})`, `Current capital (${cfg.currency})`)}
                      </label>
                      <input
                        id={`sav-bal-${cfg.id}`}
                        type="number"
                        min="0"
                        step="100"
                        disabled={cfg.useAccountBalance && Boolean(linkedAccount)}
                        value={
                          cfg.useAccountBalance && linkedAccount
                            ? Number(getSavingsBalance(cfg, accountBalances, state.accounts, state.exchangeRates).toFixed(2))
                            : cfg.currentBalance
                        }
                        onChange={(e) => onUpdateSavingsConfig(cfg.id, { currentBalance: num(e.target.value) })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm disabled:opacity-60 text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label htmlFor={`sav-monthly-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr(`Aporte mensual (${cfg.currency})`, `Monthly contribution (${cfg.currency})`)}
                      </label>
                      <input
                        id={`sav-monthly-${cfg.id}`}
                        type="number"
                        min="0"
                        step="50"
                        value={cfg.monthlyContribution}
                        onChange={(e) => onUpdateSavingsConfig(cfg.id, { monthlyContribution: num(e.target.value) })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label htmlFor={`sav-base-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Tasa base (% anual)', 'Base rate (% p.a.)')}
                      </label>
                      <input
                        id={`sav-base-${cfg.id}`}
                        type="number"
                        min="0"
                        step="0.05"
                        value={cfg.baseRateAnnual}
                        onChange={(e) => onUpdateSavingsConfig(cfg.id, { baseRateAnnual: num(e.target.value) })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label htmlFor={`sav-bonus-${cfg.id}`} className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Tasa bonificada adicional (% anual)', 'Additional bonus rate (% p.a.)')}
                      </label>
                      <input
                        id={`sav-bonus-${cfg.id}`}
                        type="number"
                        min="0"
                        step="0.05"
                        value={cfg.bonusRateAnnual}
                        onChange={(e) => onUpdateSavingsConfig(cfg.id, { bonusRateAnnual: num(e.target.value) })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Horizon + Bonus toggle */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
              {tr('Horizonte de proyección:', 'Projection horizon:')}
            </span>
            <div className="inline-flex p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
              {[
                { m: 12, label: tr('1 año', '1 yr') },
                { m: 24, label: tr('2 años', '2 yrs') },
                { m: 36, label: tr('3 años', '3 yrs') },
                { m: 60, label: tr('5 años', '5 yrs') },
              ].map((opt) => (
                <button
                  key={opt.m}
                  type="button"
                  onClick={() => setHorizonMonths(opt.m)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    horizonMonths === opt.m
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#355170] dark:text-[#A1C6F6] cursor-pointer">
            <input
              type="checkbox"
              checked={includeBonus}
              onChange={(e) => setIncludeBonus(e.target.checked)}
              className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
            />
            {tr(
              'Cumplir condición de incremento mensual (incluir tasa bonus)',
              'Meet monthly balance-growth rule (include bonus rate)'
            )}
          </label>
        </div>

        {/* Result KPIs */}
        {lastPoint && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-b border-[#D3E3FA] dark:border-[#123B66] py-5">
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  `Capital final proyectado (${horizonMonths} meses)`,
                  `Projected ending balance (${horizonMonths} months)`
                )}
              </div>
              <div className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                {formatMoney(lastPoint.endingBalance, dc)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Total aportado por ustedes', 'Total principal contributed')}
              </div>
              <div className="text-2xl font-bold text-[#355170] dark:text-[#A1C6F6] font-mono-num mt-1">
                {formatMoney(lastPoint.totalContributed, dc)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Intereses pagados por el banco', 'Bank interest earned')}
              </div>
              <div className="text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num mt-1">
                +{formatMoney(lastPoint.totalInterest, dc)}
              </div>
              {includeBonus && lastNoBonus && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                  {tr('Ganancia extra por tasa bonus:', 'Extra gain from bonus rate:')} +
                  {formatMoney(lastPoint.totalInterest - lastNoBonus.totalInterest, dc)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chart */}
        <ProjectionBarChart
          points={simulationPoints.map((pt) => ({
            label: `M${pt.month}`,
            baseAmount: pt.totalContributed,
            gainAmount: pt.totalInterest,
            totalAmount: pt.endingBalance,
          }))}
          currency={dc}
          baseLabel={tr('Capital aportado', 'Principal contributed')}
          gainLabel={tr('Intereses del banco', 'Bank interest')}
        />

        {/* Month-by-month table */}
        <div>
          <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] mb-2">
            {tr('Detalle mes a mes del interés bancario', 'Month-by-month bank interest schedule')}
          </h3>
          <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#EAF2FF] dark:bg-[#022E5B] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-2.5 px-4">{tr('Mes', 'Month')}</th>
                  <th className="py-2.5 px-4 text-right">{tr('Saldo inicial', 'Starting')}</th>
                  <th className="py-2.5 px-4 text-right">{tr('Aporte', 'Deposit')}</th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Interés ganado ese mes', 'Interest earned')}
                  </th>
                  <th className="py-2.5 px-4 text-right">{tr('Saldo final', 'Ending balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66] font-mono-num">
                {simulationPoints.map((pt) => (
                  <tr key={pt.month} className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46]">
                    <td className="py-2 px-4 font-sans font-medium text-[#355170] dark:text-[#A1C6F6]">
                      {pt.label}
                    </td>
                    <td className="py-2 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      {formatMoney(pt.startingBalance, dc)}
                    </td>
                    <td className="py-2 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      +{formatMoney(pt.contribution, dc)}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-[#022E5B] dark:text-[#499BED]">
                      +{formatMoney(pt.interestEarned, dc)}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.endingBalance, dc)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Herramienta interactiva: Proyecciones Anuales con Interés Mensual Compuesto */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D3E3FA] dark:border-[#123B66] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED] shrink-0">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr(
                  'Proyección Anual con Interés Mensual Compuesto',
                  'Annual Projection with Monthly Compounding'
                )}
              </h2>
              <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
                {tr(
                  `Simula año por año cómo crecerán los ahorros de ${householdNames} si mantienen su capital en la cuenta reinvirtiendo los intereses mensuales.`,
                  `Simulate year by year how ${householdNames} savings will grow by keeping capital in the account and compounding monthly interest.`
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const zeroed: Record<string, number> = {};
                for (const p of state.profiles) zeroed[p.id] = 0;
                setCompMonthlies(zeroed);
              }}
              className="px-3 py-1.5 text-xs font-medium text-[#355170] dark:text-[#A1C6F6] bg-[#EAF2FF] dark:bg-[#022E5B]/70 hover:bg-[#DAEAFF] dark:hover:bg-[#022E5B] rounded-lg whitespace-nowrap transition-colors"
            >
              {tr('Simular sin aportes extra ($0/mes)', 'Simulate without extra deposits ($0/mo)')}
            </button>
            <button
              type="button"
              onClick={syncCompoundFromAccounts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-[#DAEAFF]/60 dark:bg-[#022E5B] border border-[#A1C6F6]/60 dark:border-[#499BED]/50 hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] rounded-lg whitespace-nowrap transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {tr('Sincronizar con mis fondos de ahorro', 'Sync with my savings funds')}
            </button>
          </div>
        </div>

        {/* Interactive Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monthly Compound Rate + Horizon */}
          <div className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label
                  htmlFor="comp-rate"
                  className="font-semibold text-[#031725] dark:text-[#DAEAFF]"
                >
                  {tr('Tasa de interés mensual compuesta (%)', 'Monthly compound rate (%)')}
                </label>
                <span className="font-mono-num font-bold text-[#022E5B] dark:text-[#499BED]">
                  {compMonthlyRatePct.toFixed(2)}% / {tr('mes', 'mo')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="comp-rate"
                  type="range"
                  min="0.05"
                  max="1.5"
                  step="0.01"
                  value={compMonthlyRatePct}
                  onChange={(e) => setCompMonthlyRatePct(Number(e.target.value))}
                  className="flex-1 accent-[#499BED] cursor-pointer"
                />
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.01"
                  value={compMonthlyRatePct}
                  onChange={(e) => setCompMonthlyRatePct(Math.max(0, Number(e.target.value) || 0))}
                  className="w-20 px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-right text-[#031725] dark:text-[#DAEAFF]"
                  aria-label={tr('Tasa mensual en porcentaje', 'Monthly rate percentage')}
                />
              </div>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-1.5 font-mono-num">
                {tr('Equivale a', 'Equals')} <strong>{effectiveAnnualCompoundPct.toFixed(2)}%</strong>{' '}
                {tr('Tasa Efectiva Anual (TEA)', 'Effective Annual Yield (APY)')}
              </p>
            </div>

            <div>
              <span className="block text-xs font-semibold text-[#031725] dark:text-[#DAEAFF] mb-2">
                {tr('Horizonte de proyección anual', 'Annual projection horizon')}
              </span>
              <div className="grid grid-cols-5 gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                {[3, 5, 10, 15, 20].map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setCompYears(yr)}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      compYears === yr
                        ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    {yr}
                    {tr('a', 'y')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dynamic per-profile interactive capital & contribution cards */}
          {visibleProfiles.map((profile) => {
            const initVal = compInitials[profile.id] ?? 0;
            const monthlyVal = compMonthlies[profile.id] ?? 0;

            return (
              <div
                key={profile.id}
                className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-4 space-y-3"
              >
                <div className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: getSafeProfileChartColor(profile.color, isDark) }}
                  />
                  {profile.name} · {tr('Capital y Aporte', 'Capital & Deposit')}
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label className="text-[#355170] dark:text-[#A1C6F6]">
                      {tr(`Capital mantenido hoy (${dc})`, `Current capital held (${dc})`)}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(initVal, dc)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={initVal}
                    onChange={(e) =>
                      setCompInitials((prev) => ({
                        ...prev,
                        [profile.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label className="text-[#355170] dark:text-[#A1C6F6]">
                      {tr(`Aporte mensual adicional (${dc})`, `Additional monthly deposit (${dc})`)}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(monthlyVal, dc)}/{tr('mes', 'mo')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="4000"
                    step="50"
                    value={Math.min(4000, monthlyVal)}
                    onChange={(e) =>
                      setCompMonthlies((prev) => ({
                        ...prev,
                        [profile.id]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-[#499BED] cursor-pointer"
                  />
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={monthlyVal}
                    onChange={(e) =>
                      setCompMonthlies((prev) => ({
                        ...prev,
                        [profile.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="mt-1.5 w-full px-3 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Result KPIs */}
        {lastCompoundPoint && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-b border-[#D3E3FA] dark:border-[#123B66] py-5">
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Capital final al año ${compYears}`, `Projected capital at year ${compYears}`)}
              </div>
              <div className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                {formatMoney(lastCompoundPoint.endingBalance, dc)}
              </div>
              {activeProfile === 'all' && visibleProfiles.length > 1 && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num flex flex-wrap gap-x-2">
                  {visibleProfiles.map((p, idx) => (
                    <span key={p.id}>
                      {idx > 0 ? '· ' : ''}
                      {p.name}:{' '}
                      {formatMoney(lastCompoundPoint.profileBalances[p.id] || 0, dc, true)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Total capital propio aportado', 'Total principal contributed')}
              </div>
              <div className="text-2xl font-bold text-[#355170] dark:text-[#A1C6F6] font-mono-num mt-1">
                {formatMoney(lastCompoundPoint.totalContributed, dc)}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5">
                {tr(`Inicial + aportes en ${compYears} años`, `Initial + deposits over ${compYears} yrs`)}
              </div>
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Interés compuesto ganado', 'Compound interest earned')}
              </div>
              <div className="text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num mt-1">
                +{formatMoney(lastCompoundPoint.totalInterest, dc)}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                {lastCompoundPoint.totalContributed > 0
                  ? `+${(
                      (lastCompoundPoint.totalInterest / lastCompoundPoint.totalContributed) *
                      100
                    ).toFixed(1)}% ${tr('extra sobre lo aportado', 'extra on principal')}`
                  : tr('Generado por interés compuesto', 'Generated by compound interest')}
              </div>
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Renta mensual generada al año ${compYears}`, `Monthly interest income at year ${compYears}`)}
              </div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num mt-1">
                {formatMoney(
                  lastCompoundPoint.endingBalance * (Math.max(0, compMonthlyRatePct) / 100),
                  dc
                )}
                /{tr('mes', 'mo')}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5">
                {tr(
                  'Interés pasivo mensual solo por mantener el capital',
                  'Passive monthly interest simply from holding capital'
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recharts Area Chart */}
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={annualCompoundPoints}
              margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: tickColor, fontSize: 12 }}
                axisLine={{ stroke: gridStroke }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(val: number) => formatMoney(val, dc, true)}
                tick={{ fill: tickColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  formatMoney(Number(value || 0), dc),
                  String(name || ''),
                ]}
                contentStyle={{
                  backgroundColor: isDark ? '#031725' : '#FFFFFF',
                  borderRadius: '0.75rem',
                  borderColor: isDark ? '#1B4A7C' : '#D3E3FA',
                  color: isDark ? '#DAEAFF' : '#031725',
                  fontSize: '12px',
                }}
              />
              <Legend
                wrapperStyle={{
                  fontSize: '12px',
                  paddingTop: '10px',
                  color: isDark ? '#DAEAFF' : '#031725',
                }}
              />

              <Area
                type="monotone"
                dataKey="endingBalance"
                name={
                  activeProfile === 'all'
                    ? tr(`Capital Total (${householdNames})`, `Total Capital (${householdNames})`)
                    : tr('Capital Total Proyectado', 'Projected Total Capital')
                }
                stroke={totalStroke}
                strokeWidth={2.5}
                fill={totalStroke}
                fillOpacity={0.16}
              />

              <Area
                type="monotone"
                dataKey="totalContributed"
                name={tr('Capital Propio Aportado', 'Principal Contributed')}
                stroke={contribStroke}
                strokeWidth={2}
                strokeDasharray="4 4"
                fill={contribStroke}
                fillOpacity={0.08}
              />

              {activeProfile === 'all' &&
                visibleProfiles.map((p) => (
                  <Area
                    key={p.id}
                    type="monotone"
                    dataKey={`profileBalances.${p.id}`}
                    name={`${tr('Capital', 'Capital')} ${p.name}`}
                    stroke={getSafeProfileChartColor(p.color, isDark)}
                    strokeWidth={2}
                    fill="none"
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Year-by-year table */}
        <div>
          <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] mb-2">
            {tr('Tabla de crecimiento año por año', 'Year-by-year growth schedule')}
          </h3>
          <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#EAF2FF] dark:bg-[#022E5B] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-2.5 px-4">{tr('Año', 'Year')}</th>
                  <th className="py-2.5 px-4 text-right">{tr('Saldo inicial', 'Starting')}</th>
                  <th className="py-2.5 px-4 text-right">{tr('Aportes del año', 'Annual deposits')}</th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Interés compuesto del año', 'Annual compound interest')}
                  </th>
                  {activeProfile === 'all' &&
                    visibleProfiles.map((p) => (
                      <th key={p.id} className="py-2.5 px-4 text-right">
                        {p.name}
                      </th>
                    ))}
                  <th className="py-2.5 px-4 text-right">
                    {tr('Capital cierre de año', 'Year-end capital')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66] font-mono-num">
                {annualCompoundPoints.map((pt) => (
                  <tr key={pt.year} className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46]">
                    <td className="py-2.5 px-4 font-sans font-medium text-[#355170] dark:text-[#A1C6F6]">
                      {pt.label}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      {formatMoney(pt.startingBalance, dc)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      +{formatMoney(pt.yearlyContributions, dc)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-[#022E5B] dark:text-[#499BED]">
                      +{formatMoney(pt.yearlyInterest, dc)}
                    </td>
                    {activeProfile === 'all' &&
                      visibleProfiles.map((p) => (
                        <td
                          key={p.id}
                          className="py-2.5 px-4 text-right text-[#355170] dark:text-[#DAEAFF]"
                        >
                          {formatMoney(pt.profileBalances[p.id] || 0, dc)}
                        </td>
                      ))}
                    <td className="py-2.5 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.endingBalance, dc)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
