import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Landmark, Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
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
  GoalSaverProfile,
  ProfileFilter,
  ProfileId,
} from '../types/finance';
import {
  CURRENCY_META,
  computeAccountBalances,
  convertCurrency,
  formatMoney,
  getGoalSaverForProfile,
  getProfileLabel,
  simulateAnnualCompoundSavings,
  simulateGoalSaver,
  type CsvPreset,
} from '../utils/formatters';
import { ProjectionBarChart } from './Charts';
import { getSafeProfileChartColor } from './SavingsGrowthLineChart';

interface AccountsGoalSaverViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  onAddAccount: (acc: Omit<Account, 'id'>) => string;
  onUpdateAccount: (acc: Account) => void;
  onDeleteAccount: (id: string) => void;
  onUpdateGoalSaver: (owner: ProfileId, patch: Partial<GoalSaverProfile>) => void;
  onResetToZero?: (options: {
    accounts: boolean;
    moomoo: boolean;
    transactions: boolean;
    scope?: ProfileFilter;
  }) => void;
  onOpenImport?: (preset?: CsvPreset) => void;
  onAskAi?: (prompt?: string) => void;
}

export function AccountsGoalSaverView({
  state,
  activeProfile,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onUpdateGoalSaver,
  onResetToZero,
  onOpenImport,
  onAskAi,
}: AccountsGoalSaverViewProps) {
  const { tr, lang, isDark } = useUiPreferences();

  const defaultOwnerId: ProfileId =
    activeProfile === 'all'
      ? state.profiles[0]?.id || 'abdiel'
      : state.profiles.some((p) => p.id === activeProfile)
      ? activeProfile
      : state.profiles[0]?.id || 'abdiel';

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
  const [newAccKind, setNewAccKind] = useState<AccountKind>('revolut');
  const [newAccCurrency, setNewAccCurrency] = useState<CurrencyCode>('AUD');
  const [newAccBalance, setNewAccBalance] = useState('0');
  const [confirmDeleteAccId, setConfirmDeleteAccId] = useState<string | null>(null);

  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceVal, setEditingBalanceVal] = useState<string>('');
  const [confirmZeroAccounts, setConfirmZeroAccounts] = useState(false);

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

  // GoalSaver active simulator config (combines all visible profiles when activeProfile === 'all')
  const goalSaverCombined = useMemo(() => {
    if (activeProfile !== 'all') {
      const profile = state.profiles.find((p) => p.id === activeProfile);
      return getGoalSaverForProfile(
        state.goalSavers,
        profile || { id: activeProfile, name: getProfileLabel(activeProfile, state.profiles) }
      );
    }

    const list = state.profiles.map((p) => getGoalSaverForProfile(state.goalSavers, p));
    const count = Math.max(1, list.length);
    const names = state.profiles.map((p) => p.name).join(' + ');

    return {
      owner: state.profiles[0]?.id || 'abdiel',
      accountName: tr(
        `CommBank GoalSaver · Conjunto (${names})`,
        `CommBank GoalSaver · Combined (${names})`
      ),
      currentBalance: list.reduce((s, g) => s + g.currentBalance, 0),
      monthlyContribution: list.reduce((s, g) => s + g.monthlyContribution, 0),
      baseRateAnnual: list.reduce((s, g) => s + g.baseRateAnnual, 0) / count,
      bonusRateAnnual: list.reduce((s, g) => s + g.bonusRateAnnual, 0) / count,
      currency: 'AUD' as CurrencyCode,
    };
  }, [state.goalSavers, state.profiles, activeProfile, tr]);

  // Each profile earns its own rate (and only gets the bonus if it contributes), so the household
  // projection is the sum of per-profile simulations rather than one simulation with averaged rates.
  const goalSaverSources = useMemo(
    () =>
      activeProfile === 'all'
        ? state.profiles.map((p) => getGoalSaverForProfile(state.goalSavers, p))
        : [goalSaverCombined],
    [activeProfile, state.profiles, state.goalSavers, goalSaverCombined]
  );

  const runCombinedSimulation = (withBonus: boolean) => {
    const perProfile = goalSaverSources.map((gs) =>
      simulateGoalSaver({
        initialBalance: gs.currentBalance,
        monthlyContribution: gs.monthlyContribution,
        baseRateAnnual: gs.baseRateAnnual,
        bonusRateAnnual: gs.bonusRateAnnual,
        months: horizonMonths,
        includeBonus: withBonus,
        lang,
      })
    );
    if (perProfile.length === 0) return [];
    return perProfile[0].map((pt, i) => {
      const sum = (key: keyof typeof pt) =>
        perProfile.reduce((acc, list) => acc + (Number(list[i]?.[key]) || 0), 0);
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
    [goalSaverSources, horizonMonths, includeBonus, lang]
  );

  const simulationWithoutBonus = useMemo(
    () => runCombinedSimulation(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goalSaverSources, horizonMonths, lang]
  );

  const lastPoint = simulationPoints[simulationPoints.length - 1];
  const lastNoBonus = simulationWithoutBonus[simulationWithoutBonus.length - 1];
  const effectiveAnnualPct = (() => {
    const rateOf = (gs: GoalSaverProfile) =>
      gs.baseRateAnnual + (includeBonus && gs.monthlyContribution > 0 ? gs.bonusRateAnnual : 0);
    const totalBal = goalSaverSources.reduce((s, gs) => s + Math.max(0, gs.currentBalance), 0);
    if (totalBal <= 0) {
      return goalSaverSources.reduce((s, gs) => s + rateOf(gs), 0) / Math.max(1, goalSaverSources.length);
    }
    return goalSaverSources.reduce((s, gs) => s + rateOf(gs) * Math.max(0, gs.currentBalance), 0) / totalBal;
  })();

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    onAddAccount({
      name: newAccName.trim(),
      owner: newAccOwner,
      kind: newAccKind,
      currency: newAccCurrency,
      initialBalance: Number(newAccBalance) || 0,
    });
    setNewAccName('');
    setNewAccBalance('0');
    setShowAddAccount(false);
  };

  // Herramienta interactiva: Proyección Anual con Interés Mensual Compuesto (dinámica por perfil)
  const [compInitials, setCompInitials] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = getGoalSaverForProfile(state.goalSavers, p).currentBalance;
    }
    return out;
  });
  const [compMonthlies, setCompMonthlies] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = getGoalSaverForProfile(state.goalSavers, p).monthlyContribution;
    }
    return out;
  });
  const [compMonthlyRatePct, setCompMonthlyRatePct] = useState<number>(() => {
    const first = state.profiles[0]
      ? getGoalSaverForProfile(state.goalSavers, state.profiles[0])
      : undefined;
    return first
      ? Number(((first.baseRateAnnual + first.bonusRateAnnual) / 12).toFixed(2)) || 0.41
      : 0.41;
  });
  const [compYears, setCompYears] = useState<number>(10);

  const syncCompoundFromAccounts = () => {
    const nextInit: Record<string, number> = {};
    const nextMonthly: Record<string, number> = {};
    let rateSum = 0;

    for (const p of state.profiles) {
      const gs = getGoalSaverForProfile(state.goalSavers, p);
      nextInit[p.id] = gs.currentBalance;
      nextMonthly[p.id] = gs.monthlyContribution;
      rateSum += gs.baseRateAnnual + gs.bonusRateAnnual;
    }

    setCompInitials(nextInit);
    setCompMonthlies(nextMonthly);
    const avgAnnual = rateSum / Math.max(1, state.profiles.length);
    setCompMonthlyRatePct(Number((avgAnnual / 12).toFixed(2)) || 0.41);
  };

  useEffect(() => {
    setCompInitials((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const p of state.profiles) {
        next[p.id] = getGoalSaverForProfile(state.goalSavers, p).currentBalance;
      }
      return next;
    });
    setCompMonthlies((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const p of state.profiles) {
        if (next[p.id] === undefined) {
          next[p.id] = getGoalSaverForProfile(state.goalSavers, p).monthlyContribution;
        }
      }
      return next;
    });
  }, [state.profiles, state.goalSavers]);

  const effectiveAnnualCompoundPct = useMemo(() => {
    const r = Math.max(0, compMonthlyRatePct) / 100;
    return (Math.pow(1 + r, 12) - 1) * 100;
  }, [compMonthlyRatePct]);

  const annualCompoundPoints = useMemo(() => {
    const entries = visibleProfiles.map((p) => ({
      id: p.id,
      initial: compInitials[p.id] ?? getGoalSaverForProfile(state.goalSavers, p).currentBalance,
      monthly:
        compMonthlies[p.id] ?? getGoalSaverForProfile(state.goalSavers, p).monthlyContribution,
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
    state.goalSavers,
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
              'Administra tus cuentas de sueldo, gastos diarios y proyecta los intereses mensuales de tu colchón GoalSaver.',
              'Manage salary and daily spending accounts and forecast monthly interest on your GoalSaver cushion.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onAskAi && (
            <button
              type="button"
              onClick={() =>
                onAskAi(
                  tr(
                    'Evalúa nuestras cuentas bancarias y GoalSaver y sugiere la mejor estrategia para maximizar el interés mensual.',
                    'Evaluate our bank accounts and GoalSaver and suggest the best strategy to maximize monthly interest.'
                  )
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] whitespace-nowrap transition-colors"
            >
              <Sparkles className="w-4 h-4 text-[#499BED]" />
              {tr('Estrategia GoalSaver IA', 'AI GoalSaver Strategy')}
            </button>
          )}
          {onOpenImport && (
            <button
              type="button"
              onClick={() => onOpenImport('commbank')}
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
              placeholder={tr('Ej. Wise USD, Revolut Viajes...', 'e.g. Wise USD, Revolut Travel...')}
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
              <option value="commbank">CommBank</option>
              <option value="goalsaver">GoalSaver</option>
              <option value="revolut">Revolut</option>
              <option value="wise">Wise</option>
              <option value="moomoo">Moomoo</option>
              <option value="cash">{tr('Efectivo', 'Cash')}</option>
              <option value="other">{tr('Otra', 'Other')}</option>
            </select>
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
                '¿Volver a $0.00 el saldo base de las cuentas y GoalSaver?',
                'Reset account starting balances and GoalSaver capital to $0.00?'
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onResetToZero({
                    accounts: true,
                    moomoo: false,
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
                      moomoo: false,
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
                <th className="py-3 px-4">{tr('Uso', 'Purpose')}</th>
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
                      {acc.name}{' '}
                      <span className="text-xs font-normal text-[#5A7694] dark:text-[#A1C6F6]">
                        ({acc.currency})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6]">
                      {getProfileLabel(acc.owner, state.profiles)}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#5A7694] dark:text-[#7FA6D6] max-w-[240px] truncate">
                      {acc.notes || tr('Cuenta personal', 'Personal account')}
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

      {/* CommBank GoalSaver Interest Simulator */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D3E3FA] dark:border-[#123B66] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED] shrink-0">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr(
                  'Simulador CommBank GoalSaver (Ahorro Colchón)',
                  'CommBank GoalSaver Simulator (Emergency Cushion)'
                )}
              </h2>
              <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
                {activeProfile === 'all'
                  ? tr(
                      `Vista combinada de los GoalSaver (${householdNames}). Ajusta cada perfil abajo o filtra por un perfil individual.`,
                      `Combined view of GoalSaver accounts (${householdNames}). Adjust each profile below or filter by an individual profile.`
                    )
                  : tr(
                      `Configuración de GoalSaver para ${getProfileLabel(
                        activeProfile,
                        state.profiles
                      )}. El banco paga tasa base + tasa bonus cada mes que aumentas el saldo.`,
                      `GoalSaver configuration for ${getProfileLabel(
                        activeProfile,
                        state.profiles
                      )}. Bank pays base rate + bonus rate every month the balance grows.`
                    )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {onOpenImport && (
              <button
                type="button"
                onClick={() => onOpenImport('goalsaver')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                {tr(
                  'Importar Statement GoalSaver (PDF / CSV)',
                  'Import GoalSaver Statement (PDF / CSV)'
                )}
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

        {/* Inputs */}
        {activeProfile === 'all' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {state.profiles.map((profile) => {
              const gs = getGoalSaverForProfile(state.goalSavers, profile);
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
                    GoalSaver · {profile.name}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Capital actual (AUD)', 'Current capital (AUD)')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={gs.currentBalance}
                        onChange={(e) =>
                          onUpdateGoalSaver(profile.id, {
                            currentBalance: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Aporte mensual (AUD)', 'Monthly contribution (AUD)')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="50"
                        value={gs.monthlyContribution}
                        onChange={(e) =>
                          onUpdateGoalSaver(profile.id, {
                            monthlyContribution: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Tasa base (% anual)', 'Base rate (% p.a.)')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.05"
                        value={gs.baseRateAnnual}
                        onChange={(e) =>
                          onUpdateGoalSaver(profile.id, {
                            baseRateAnnual: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Tasa bonus mensual (% anual)', 'Monthly bonus rate (% p.a.)')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.05"
                        value={gs.bonusRateAnnual}
                        onChange={(e) =>
                          onUpdateGoalSaver(profile.id, {
                            bonusRateAnnual: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const singleGs = getGoalSaverForProfile(state.goalSavers, {
                id: activeProfile,
                name: getProfileLabel(activeProfile, state.profiles),
              });
              return (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                      {tr('Capital actual ahorrado (AUD)', 'Current saved capital (AUD)')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={singleGs.currentBalance}
                      onChange={(e) =>
                        onUpdateGoalSaver(activeProfile, {
                          currentBalance: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                      {tr('Aporte mensual nuevo (AUD)', 'New monthly deposit (AUD)')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      value={singleGs.monthlyContribution}
                      onChange={(e) =>
                        onUpdateGoalSaver(activeProfile, {
                          monthlyContribution: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                      {tr('Tasa base (% anual)', 'Base rate (% p.a.)')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.05"
                      value={singleGs.baseRateAnnual}
                      onChange={(e) =>
                        onUpdateGoalSaver(activeProfile, {
                          baseRateAnnual: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                      {tr('Tasa bonus por crecer al mes (% anual)', 'Monthly growth bonus (% p.a.)')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.05"
                      value={singleGs.bonusRateAnnual}
                      onChange={(e) =>
                        onUpdateGoalSaver(activeProfile, {
                          bonusRateAnnual: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg font-mono-num text-sm text-[#031725] dark:text-[#DAEAFF]"
                    />
                  </div>
                </>
              );
            })()}
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
                {formatMoney(lastPoint.endingBalance, 'AUD')}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Total aportado por ustedes', 'Total principal contributed')}
              </div>
              <div className="text-2xl font-bold text-[#355170] dark:text-[#A1C6F6] font-mono-num mt-1">
                {formatMoney(lastPoint.totalContributed, 'AUD')}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Intereses pagados por el banco', 'Bank interest earned')}
              </div>
              <div className="text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num mt-1">
                +{formatMoney(lastPoint.totalInterest, 'AUD')}
              </div>
              {includeBonus && lastNoBonus && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                  {tr('Ganancia extra por tasa bonus:', 'Extra gain from bonus rate:')} +
                  {formatMoney(lastPoint.totalInterest - lastNoBonus.totalInterest, 'AUD')}
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
          currency="AUD"
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
                      {formatMoney(pt.startingBalance, 'AUD')}
                    </td>
                    <td className="py-2 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      +{formatMoney(pt.contribution, 'AUD')}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-[#022E5B] dark:text-[#499BED]">
                      +{formatMoney(pt.interestEarned, 'AUD')}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.endingBalance, 'AUD')}
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
              {tr('Sincronizar con GoalSaver', 'Sync with GoalSaver')}
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
            const gs = getGoalSaverForProfile(state.goalSavers, profile);
            const initVal = compInitials[profile.id] ?? gs.currentBalance;
            const monthlyVal = compMonthlies[profile.id] ?? gs.monthlyContribution;

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
                      {tr('Capital mantenido hoy (AUD)', 'Current capital held (AUD)')}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(initVal, 'AUD')}
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
                      {tr('Aporte mensual adicional (AUD)', 'Additional monthly deposit (AUD)')}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(monthlyVal, 'AUD')}/{tr('mes', 'mo')}
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
                {formatMoney(lastCompoundPoint.endingBalance, 'AUD')}
              </div>
              {activeProfile === 'all' && visibleProfiles.length > 1 && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num flex flex-wrap gap-x-2">
                  {visibleProfiles.map((p, idx) => (
                    <span key={p.id}>
                      {idx > 0 ? '· ' : ''}
                      {p.name}:{' '}
                      {formatMoney(lastCompoundPoint.profileBalances[p.id] || 0, 'AUD', true)}
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
                {formatMoney(lastCompoundPoint.totalContributed, 'AUD')}
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
                +{formatMoney(lastCompoundPoint.totalInterest, 'AUD')}
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
                  'AUD'
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
                tickFormatter={(val: number) => formatMoney(val, 'AUD', true)}
                tick={{ fill: tickColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  formatMoney(Number(value || 0), 'AUD'),
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
                      {formatMoney(pt.startingBalance, 'AUD')}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      +{formatMoney(pt.yearlyContributions, 'AUD')}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-[#022E5B] dark:text-[#499BED]">
                      +{formatMoney(pt.yearlyInterest, 'AUD')}
                    </td>
                    {activeProfile === 'all' &&
                      visibleProfiles.map((p) => (
                        <td
                          key={p.id}
                          className="py-2.5 px-4 text-right text-[#355170] dark:text-[#DAEAFF]"
                        >
                          {formatMoney(pt.profileBalances[p.id] || 0, 'AUD')}
                        </td>
                      ))}
                    <td className="py-2.5 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.endingBalance, 'AUD')}
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
