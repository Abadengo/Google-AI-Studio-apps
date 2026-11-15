import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Pencil, Plus, RefreshCw, Sparkles, Trash2, TrendingUp, Upload } from 'lucide-react';
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
  CurrencyCode,
  FinanceState,
  InvestmentHolding,
  ProfileFilter,
  ProfileId,
} from '../types/finance';
import {
  CURRENCY_META,
  convertCurrency,
  accountDisplayName,
  formatMoney,
  getProfileLabel,
  simulateDividendCapitalGrowth,
  simulateInvestmentGrowth,
  type DividendPayoutFrequency,
} from '../utils/formatters';
import { fetchMarketQuotes, toYahooSymbol } from '../utils/marketData';
import { ProjectionBarChart } from './Charts';
import { getSafeProfileChartColor } from './SavingsGrowthLineChart';

interface InvestmentsViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  onAddHolding: (holding: Omit<InvestmentHolding, 'id'>) => void;
  onUpdateHolding: (holding: InvestmentHolding) => void;
  onDeleteHolding: (id: string) => void;
  onResetToZero?: (options: {
    accounts: boolean;
    investments: boolean;
    transactions: boolean;
    scope?: ProfileFilter;
  }) => void;
  onOpenCsvImport: () => void;
  onAskAi?: (prompt?: string) => void;
}

export function InvestmentsView({
  state,
  activeProfile,
  onAddHolding,
  onUpdateHolding,
  onDeleteHolding,
  onResetToZero,
  onOpenCsvImport,
  onAskAi,
}: InvestmentsViewProps) {
  const { tr, lang, isDark } = useUiPreferences();

  const displayCurr = state.displayCurrency;

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

  // Holdings filtered by profile
  const holdings = useMemo(() => {
    if (activeProfile === 'all') return state.investments;
    return state.investments.filter((h) => h.owner === activeProfile);
  }, [state.investments, activeProfile]);

  const portfolioStats = useMemo(() => {
    let totalInvested = 0;
    let totalCurrent = 0;
    let totalAnnualDividends = 0;

    for (const h of holdings) {
      const inv = convertCurrency(
        h.shares * h.avgCostPerShare,
        h.currency,
        displayCurr,
        state.exchangeRates
      );
      const cur = convertCurrency(
        h.shares * h.currentPricePerShare,
        h.currency,
        displayCurr,
        state.exchangeRates
      );
      const div = cur * (h.dividendYieldAnnual / 100);
      totalInvested += inv;
      totalCurrent += cur;
      totalAnnualDividends += div;
    }

    const gain = totalCurrent - totalInvested;
    const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
    const weightedYield = totalCurrent > 0 ? (totalAnnualDividends / totalCurrent) * 100 : 1.8;

    return {
      totalInvested,
      totalCurrent,
      gain,
      gainPct,
      totalAnnualDividends,
      weightedYield,
    };
  }, [holdings, displayCurr, state.exchangeRates]);

  // Dynamic per-profile portfolio baselines for the Dividend Capital Simulator
  const ownerPortfolioStats = useMemo(() => {
    const out: Record<string, { current: number; yieldPct: number }> = {};
    for (const p of state.profiles) {
      const list = state.investments.filter((h) => h.owner === p.id);
      let current = 0;
      let annualDiv = 0;
      for (const h of list) {
        const cur = convertCurrency(
          h.shares * h.currentPricePerShare,
          h.currency,
          displayCurr,
          state.exchangeRates
        );
        current += cur;
        annualDiv += cur * (h.dividendYieldAnnual / 100);
      }
      const yieldPct = current > 0 ? (annualDiv / current) * 100 : 2.0;
      out[p.id] = { current: Math.round(current), yieldPct: Number(yieldPct.toFixed(2)) };
    }
    return out;
  }, [state.profiles, state.investments, displayCurr, state.exchangeRates]);

  // Add/Edit holding form state
  const [showHoldingForm, setShowHoldingForm] = useState(false);
  const [editingHolding, setEditingHolding] = useState<InvestmentHolding | null>(null);
  const [formOwner, setFormOwner] = useState<ProfileId>(defaultOwnerId);
  const [formTicker, setFormTicker] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'ETF' | 'Acción' | 'Fondo'>('ETF');
  const [formShares, setFormShares] = useState('');
  const [formAvgCost, setFormAvgCost] = useState('');
  const [formCurrentPrice, setFormCurrentPrice] = useState('');
  const [formDivYield, setFormDivYield] = useState('1.5');
  const [formCurrency, setFormCurrency] = useState<CurrencyCode>('USD');
  const [formAccountId, setFormAccountId] = useState<string>('');
  const investmentAccountsFor = (owner: ProfileId) =>
    state.accounts.filter((a) => a.kind === 'inversion' && a.owner === owner);

  // Inline quick price edit
  const [quickPriceId, setQuickPriceId] = useState<string | null>(null);
  const [quickPriceVal, setQuickPriceVal] = useState<string>('');
  const [confirmZeroInvestments, setConfirmZeroInvestments] = useState(false);

  // DRIP & Growth Calculator State
  const [calcInitial, setCalcInitial] = useState<number>(() => Math.round(portfolioStats.totalCurrent));
  const [calcMonthly, setCalcMonthly] = useState<number>(600);
  const [calcGrowthPct, setCalcGrowthPct] = useState<number>(7.5);
  const [calcDivYieldPct, setCalcDivYieldPct] = useState<number>(() =>
    Number(portfolioStats.weightedYield.toFixed(2)) || 2.0
  );
  const [calcReinvest, setCalcReinvest] = useState<boolean>(true);
  const [calcYears, setCalcYears] = useState<number>(10);

  useEffect(() => {
    setCalcInitial(Math.round(portfolioStats.totalCurrent));
    setCalcDivYieldPct(Number(portfolioStats.weightedYield.toFixed(2)) || 2.0);
  }, [activeProfile, portfolioStats.totalCurrent, portfolioStats.weightedYield]);

  const projectionYears = useMemo(() => {
    return simulateInvestmentGrowth({
      initialCapital: calcInitial,
      monthlyContribution: calcMonthly,
      annualPriceGrowthPct: calcGrowthPct,
      annualDividendYieldPct: calcDivYieldPct,
      reinvestDividends: calcReinvest,
      years: calcYears,
      lang,
    });
  }, [calcInitial, calcMonthly, calcGrowthPct, calcDivYieldPct, calcReinvest, calcYears, lang]);

  const projectionNoDrip = useMemo(() => {
    return simulateInvestmentGrowth({
      initialCapital: calcInitial,
      monthlyContribution: calcMonthly,
      annualPriceGrowthPct: calcGrowthPct,
      annualDividendYieldPct: calcDivYieldPct,
      reinvestDividends: false,
      years: calcYears,
      lang,
    });
  }, [calcInitial, calcMonthly, calcGrowthPct, calcDivYieldPct, calcYears, lang]);

  const finalYear = projectionYears[projectionYears.length - 1];
  const finalNoDrip = projectionNoDrip[projectionNoDrip.length - 1];

  // Interactive Dividend-Based Capital Growth Simulator (Dynamic across profiles)
  const [divCaps, setDivCaps] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = ownerPortfolioStats[p.id]?.current || 0;
    }
    return out;
  });
  const [divYields, setDivYields] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const p of state.profiles) {
      out[p.id] = ownerPortfolioStats[p.id]?.yieldPct ?? 2.0;
    }
    return out;
  });
  const [divMonthlies, setDivMonthlies] = useState<Record<string, number>>({});
  const [divPriceGrowth, setDivPriceGrowth] = useState<number>(5.0);
  const [divFrequency, setDivFrequency] = useState<DividendPayoutFrequency>('quarterly');
  const [divReinvest, setDivReinvest] = useState<boolean>(true);
  const [divYears, setDivYears] = useState<number>(10);

  const syncDividendSimulator = () => {
    const nextCaps: Record<string, number> = {};
    const nextYields: Record<string, number> = {};
    for (const p of state.profiles) {
      nextCaps[p.id] = ownerPortfolioStats[p.id]?.current || 0;
      nextYields[p.id] = ownerPortfolioStats[p.id]?.yieldPct ?? 2.0;
    }
    setDivCaps(nextCaps);
    setDivYields(nextYields);
  };

  useEffect(() => {
    syncDividendSimulator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerPortfolioStats]);

  const dividendCapPoints = useMemo(() => {
    const entries = visibleProfiles.map((p) => ({
      id: p.id,
      initial: divCaps[p.id] ?? ownerPortfolioStats[p.id]?.current ?? 0,
      monthly: divMonthlies[p.id] ?? 0,
      yieldPct: divYields[p.id] ?? ownerPortfolioStats[p.id]?.yieldPct ?? 2.0,
    }));

    return simulateDividendCapitalGrowth({
      entries,
      annualPriceGrowthPct: divPriceGrowth,
      reinvestDividends: divReinvest,
      payoutFrequency: divFrequency,
      years: divYears,
      lang,
    });
  }, [
    visibleProfiles,
    divCaps,
    divMonthlies,
    divYields,
    ownerPortfolioStats,
    divPriceGrowth,
    divReinvest,
    divFrequency,
    divYears,
    lang,
  ]);

  const lastDividendCapPoint = dividendCapPoints[dividendCapPoints.length - 1];

  // Real market data: refresh prices, trailing dividend yield and historical growth for the projections.
  const [marketStatus, setMarketStatus] = useState<{ type: 'ok' | 'err' | 'loading'; text: string } | null>(
    null
  );

  const handleRefreshMarketData = async () => {
    if (holdings.length === 0) return;
    setMarketStatus({ type: 'loading', text: tr('Consultando el mercado…', 'Fetching market data…') });
    try {
      const symbolByHolding = new Map(holdings.map((h) => [h.id, toYahooSymbol(h.ticker, h.currency)]));
      const { quotes } = await fetchMarketQuotes(Array.from(new Set(symbolByHolding.values())));
      const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

      let updated = 0;
      const failed: string[] = [];
      let cagrWeighted = 0;
      let cagrWeight = 0;

      for (const h of holdings) {
        const q = bySymbol.get((symbolByHolding.get(h.id) || '').toUpperCase());
        if (!q || !q.ok || q.price <= 0) {
          failed.push(h.ticker);
          continue;
        }
        // Quote currency may differ from the holding currency (e.g. ASX listing tracked in USD).
        const quoteCurrency = (q.currency in CURRENCY_META ? q.currency : h.currency) as CurrencyCode;
        const price = convertCurrency(q.price, quoteCurrency, h.currency, state.exchangeRates);
        onUpdateHolding({
          ...h,
          currentPricePerShare: Number(price.toFixed(4)),
          dividendYieldAnnual: Number(q.dividendYieldPct.toFixed(2)),
          name: h.name && h.name !== h.ticker ? h.name : q.name,
        });
        updated++;
        if (q.historicalCagrPct !== null) {
          const weight = convertCurrency(h.shares * price, h.currency, displayCurr, state.exchangeRates);
          cagrWeighted += q.historicalCagrPct * weight;
          cagrWeight += weight;
        }
      }

      let growthNote = '';
      if (cagrWeight > 0) {
        // Conservative: historical growth is not guaranteed, cap the default used for projections.
        const cagr = Math.min(15, Math.max(0, cagrWeighted / cagrWeight));
        setCalcGrowthPct(Number(cagr.toFixed(2)));
        setDivPriceGrowth(Math.round(cagr * 2) / 2);
        growthNote = tr(
          ` Crecimiento histórico ponderado del precio: ${cagr.toFixed(2)}% anual (aplicado a las proyecciones).`,
          ` Weighted historical price growth: ${cagr.toFixed(2)}% p.a. (applied to projections).`
        );
      }

      setMarketStatus({
        type: failed.length > 0 && updated === 0 ? 'err' : 'ok',
        text:
          tr(
            `${updated} posición(es) actualizada(s) con precios reales.`,
            `${updated} holding(s) updated with live prices.`
          ) +
          growthNote +
          (failed.length > 0
            ? tr(
                ` Sin datos para: ${failed.join(', ')} (revisa el ticker; para ASX usa la moneda AUD).`,
                ` No data for: ${failed.join(', ')} (check the ticker; ASX listings should use AUD).`
              )
            : ''),
      });
    } catch (err) {
      setMarketStatus({
        type: 'err',
        text: tr(
          `No se pudo consultar el mercado: ${err instanceof Error ? err.message : ''}. Verifica tu conexión a internet.`,
          `Could not reach market data: ${err instanceof Error ? err.message : ''}. Check your internet connection.`
        ),
      });
    }
  };

  const openNewForm = () => {
    setEditingHolding(null);
    setFormOwner(defaultOwnerId);
    setFormTicker('');
    setFormName('');
    setFormType('ETF');
    setFormShares('');
    setFormAvgCost('');
    setFormCurrentPrice('');
    setFormDivYield('1.5');
    setFormCurrency('USD');
    setFormAccountId(investmentAccountsFor(defaultOwnerId)[0]?.id || '');
    setShowHoldingForm(true);
  };

  const openEditForm = (h: InvestmentHolding) => {
    setEditingHolding(h);
    setFormOwner(h.owner);
    setFormTicker(h.ticker);
    setFormName(h.name);
    setFormType(h.assetType);
    setFormShares(String(h.shares));
    setFormAvgCost(String(h.avgCostPerShare));
    setFormCurrentPrice(String(h.currentPricePerShare));
    setFormDivYield(String(h.dividendYieldAnnual));
    setFormCurrency(h.currency);
    setFormAccountId(h.accountId || '');
    setShowHoldingForm(true);
  };

  const handleSaveHolding = (e: React.FormEvent) => {
    e.preventDefault();
    const shares = Number(formShares);
    const avgCost = Number(formAvgCost);
    const curPrice = Number(formCurrentPrice) || avgCost;
    if (!formTicker.trim() || !shares || shares <= 0 || !avgCost || avgCost <= 0) return;

    const payload: Omit<InvestmentHolding, 'id'> = {
      owner: formOwner,
      accountId: formAccountId && investmentAccountsFor(formOwner).some((a) => a.id === formAccountId) ? formAccountId : undefined,
      ticker: formTicker.toUpperCase().trim(),
      name: formName.trim() || formTicker.toUpperCase().trim(),
      assetType: formType,
      shares,
      avgCostPerShare: avgCost,
      currentPricePerShare: curPrice,
      dividendYieldAnnual: Math.max(0, Number(formDivYield) || 0),
      currency: formCurrency,
    };

    if (editingHolding) {
      onUpdateHolding({ ...payload, id: editingHolding.id });
    } else {
      onAddHolding(payload);
    }
    setShowHoldingForm(false);
    setEditingHolding(null);
  };

  // Recharts palette tokens
  const gridStroke = isDark ? '#123B66' : '#DCE8FA';
  const tickColor = isDark ? '#A1C6F6' : '#5A7694';
  const totalStroke = isDark ? '#499BED' : '#022E5B';
  const noDivStroke = isDark ? '#A1C6F6' : '#5A7694';
  const householdNames = state.profiles.map((p) => p.name).join(' & ');

  const translateAssetType = (t: 'ETF' | 'Acción' | 'Fondo') => {
    if (lang === 'es') return t;
    if (t === 'Acción') return 'Stock';
    if (t === 'Fondo') return 'Fund';
    return 'ETF';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] tracking-tight">
            {tr('Inversiones', 'Investments')}
          </h1>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
            {tr(
              'Controla tu capital invertido, valor actual, ganancia y proyecta el efecto bola de nieve con reinversión de dividendos.',
              'Track your invested principal, market value, gain/loss, and forecast compounding with dividend reinvestment.'
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
                    'Analiza nuestro portafolio de inversiones: diversificación, rendimiento por dividendos y cómo optimizar la reinversión.',
                    'Analyze our investment portfolio: diversification, dividend yield, and how to optimize reinvestment.'
                  )
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] whitespace-nowrap transition-colors"
            >
              <Sparkles className="w-4 h-4 text-[#499BED]" />
              {tr('Analizar portafolio IA', 'AI Portfolio Review')}
            </button>
          )}
          {onResetToZero && holdings.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmZeroInvestments((v) => !v)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-red-50/70 dark:bg-red-950/35 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 text-sm font-medium rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 whitespace-nowrap transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {tr('Saldos de inversiones a $0', 'Reset investments to $0')}
            </button>
          )}
          {holdings.length > 0 && (
            <button
              type="button"
              onClick={handleRefreshMarketData}
              disabled={marketStatus?.type === 'loading'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors disabled:opacity-60"
            >
              <TrendingUp className="w-4 h-4" />
              {marketStatus?.type === 'loading'
                ? tr('Actualizando…', 'Updating…')
                : tr('Precios reales del mercado', 'Live market prices')}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCsvImport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
          >
            <Upload className="w-4 h-4" />
            {tr('Importar extracto del broker', 'Import broker statement')}
          </button>
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
          >
            <Plus className="w-4 h-4" />
            {tr('Agregar fondo / acción', 'Add fund / stock')}
          </button>
        </div>
      </div>

      {marketStatus && marketStatus.type !== 'loading' && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-xs sm:text-sm ${
            marketStatus.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {marketStatus.text}
        </div>
      )}

      {confirmZeroInvestments && onResetToZero && (
        <div className="p-4 rounded-xl bg-red-50/80 dark:bg-red-950/35 border border-red-200 dark:border-red-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-red-900 dark:text-red-200 font-medium">
            {tr(
              '¿Volver a $0.00 el portafolio y los saldos de las cuentas de inversión? Se limpiarán las posiciones actuales.',
              'Reset the portfolio and investment account balances to $0.00? Current holdings will be cleared.'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResetToZero({
                  accounts: false,
                  investments: true,
                  transactions: false,
                  scope: activeProfile,
                });
                setConfirmZeroInvestments(false);
              }}
              className="px-3 py-1.5 bg-red-700 text-white font-semibold rounded-md hover:bg-red-800"
            >
              {tr('Sí, volver inversiones a $0', 'Yes, reset investments to $0')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmZeroInvestments(false)}
              className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#031725] dark:text-[#DAEAFF] font-medium rounded-md"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Top Portfolio KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Capital invertido', 'Invested capital')}
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num">
            {formatMoney(portfolioStats.totalInvested, displayCurr)}
          </div>
          <div className="mt-1 text-xs text-[#5A7694] dark:text-[#7FA6D6]">
            {tr('Costo total de compra', 'Total cost basis')}
          </div>
        </div>

        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Capital actual', 'Current value')}
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num">
            {formatMoney(portfolioStats.totalCurrent, displayCurr)}
          </div>
          <div className="mt-1 text-xs text-[#5A7694] dark:text-[#7FA6D6]">
            {tr('Valor de mercado hoy', 'Current market value')}
          </div>
        </div>

        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Ganancia / Pérdida', 'Gain / Loss')}
          </div>
          <div
            className={`mt-1.5 text-2xl font-bold font-mono-num ${
              portfolioStats.gain >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {portfolioStats.gain >= 0 ? '+' : ''}
            {formatMoney(portfolioStats.gain, displayCurr)}
          </div>
          <div
            className={`mt-1 text-xs font-mono-num font-medium ${
              portfolioStats.gain >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {tr('Rendimiento:', 'Return:')} {portfolioStats.gain >= 0 ? '+' : ''}
            {portfolioStats.gainPct.toFixed(2)}%
          </div>
        </div>

        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Dividendos estimados / año', 'Estimated dividends / year')}
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num">
            {formatMoney(portfolioStats.totalAnnualDividends, displayCurr)}
          </div>
          <div className="mt-1 text-xs text-[#5A7694] dark:text-[#7FA6D6] font-mono-num">
            {tr('Yield promedio:', 'Average yield:')} {portfolioStats.weightedYield.toFixed(2)}%{' '}
            {tr('anual', 'p.a.')}
          </div>
        </div>
      </div>

      {/* Add / Edit Holding Form */}
      {showHoldingForm && (
        <form
          onSubmit={handleSaveHolding}
          className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {editingHolding
                ? tr(`Editar ${editingHolding.ticker}`, `Edit ${editingHolding.ticker}`)
                : tr('Agregar inversión', 'Add investment')}
            </h2>
            <button
              type="button"
              onClick={() => setShowHoldingForm(false)}
              className="text-xs text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Perfil (Dueño)', 'Profile (Owner)')}
              </label>
              <select
                value={formOwner}
                onChange={(e) => {
                  const nextOwner = e.target.value as ProfileId;
                  setFormOwner(nextOwner);
                  setFormAccountId(investmentAccountsFor(nextOwner)[0]?.id || '');
                }}
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
              <label htmlFor="inv-account" className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Cuenta de inversión', 'Investment account')}
              </label>
              <select
                id="inv-account"
                value={formAccountId}
                onChange={(e) => setFormAccountId(e.target.value)}
                className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
              >
                <option value="">{tr('Sin asociar', 'Not linked')}</option>
                {investmentAccountsFor(formOwner).map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountDisplayName(a)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Ticker / Símbolo', 'Ticker / Symbol')}
              </label>
              <input
                type="text"
                required
                placeholder="VOO, VAS, IVV, AAPL"
                value={formTicker}
                onChange={(e) => setFormTicker(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm uppercase text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Nombre del fondo o empresa', 'Fund or company name')}
              </label>
              <input
                type="text"
                placeholder="Vanguard S&P 500 ETF"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Tipo y Moneda', 'Type & Currency')}
              </label>
              <div className="flex gap-2">
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as 'ETF' | 'Acción' | 'Fondo')}
                  className="flex-1 px-2.5 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                >
                  <option value="ETF">ETF</option>
                  <option value="Acción">{tr('Acción', 'Stock')}</option>
                  <option value="Fondo">{tr('Fondo', 'Fund')}</option>
                </select>
                <select
                  value={formCurrency}
                  onChange={(e) => setFormCurrency(e.target.value as CurrencyCode)}
                  className="w-24 px-2.5 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
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
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Cantidad de acciones / ETFs', 'Shares / Units')}
              </label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                required
                value={formShares}
                onChange={(e) => setFormShares(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Precio promedio de compra', 'Average cost per share')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={formAvgCost}
                onChange={(e) => setFormAvgCost(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Precio actual de mercado', 'Current market price')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={formCurrentPrice}
                onChange={(e) => setFormCurrentPrice(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
            <div>
              <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                {tr('Dividendo anual estimado (%)', 'Est. annual dividend (%)')}
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                value={formDivYield}
                onChange={(e) => setFormDivYield(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowHoldingForm(false)}
              className="px-4 py-2 text-sm text-[#355170] dark:text-[#A1C6F6] hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B] rounded-lg"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
            >
              {editingHolding
                ? tr('Guardar cambios', 'Save changes')
                : tr('Agregar al portafolio', 'Add to portfolio')}
            </button>
          </div>
        </form>
      )}

      {/* Portfolio Holdings Table */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('Posiciones actuales', 'Current holdings')}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
              {tr(
                'Haz clic en el precio actual de cualquier fondo para actualizarlo al valor de hoy.',
                'Click on the current price of any asset to update it to today’s market value.'
              )}
            </p>
          </div>
          <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
            {holdings.length} {tr('activos registrados', 'assets tracked')}
          </span>
        </div>

        {holdings.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#5A7694] dark:text-[#A1C6F6]">
              {tr(
                'Todavía no hay acciones o ETFs registrados para este perfil.',
                'No stocks or ETFs recorded for this profile yet.'
              )}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={openNewForm}
                className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
              >
                {tr('Agregar manualmente', 'Add manually')}
              </button>
              <button
                type="button"
                onClick={onOpenCsvImport}
                className="px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B]"
              >
                {tr('Importar extracto del broker', 'Import broker statement')}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-[#EAF2FF]/80 dark:bg-[#022E5B]/55 border-b border-[#D3E3FA] dark:border-[#123B66] text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-3 px-4">{tr('Activo', 'Asset')}</th>
                  <th className="py-3 px-4">{tr('Perfil', 'Profile')}</th>
                  <th className="py-3 px-4 text-right">{tr('Cantidad', 'Shares')}</th>
                  <th className="py-3 px-4 text-right">{tr('Precio compra', 'Avg cost')}</th>
                  <th className="py-3 px-4 text-right">{tr('Precio actual', 'Current price')}</th>
                  <th className="py-3 px-4 text-right">{tr('Invertido', 'Invested')}</th>
                  <th className="py-3 px-4 text-right">{tr('Valor actual', 'Current value')}</th>
                  <th className="py-3 px-4 text-right">{tr('Ganancia', 'Gain')}</th>
                  <th className="py-3 px-4 text-right">{tr('Dividendo', 'Yield')}</th>
                  <th className="py-3 px-4 text-right w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
                {holdings.map((h) => {
                  const investedNative = h.shares * h.avgCostPerShare;
                  const currentNative = h.shares * h.currentPricePerShare;
                  const gainNative = currentNative - investedNative;
                  const gainPct = investedNative > 0 ? (gainNative / investedNative) * 100 : 0;
                  const isEditingPrice = quickPriceId === h.id;

                  return (
                    <tr key={h.id} className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#031725] dark:text-[#DAEAFF]">{h.ticker}</div>
                        <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6] truncate max-w-[190px]">
                          {h.name} · {translateAssetType(h.assetType)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6]">
                        {getProfileLabel(h.owner, state.profiles)}
                        {h.accountId && (
                          <div className="text-[11px] text-[#5A7694] dark:text-[#7FA6D6] truncate max-w-[160px]">
                            {state.accounts.find((a) => a.id === h.accountId)?.name}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[#355170] dark:text-[#DAEAFF]">
                        {h.shares}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                        {formatMoney(h.avgCostPerShare, h.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num">
                        {isEditingPrice ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const val = Number(quickPriceVal);
                              if (val > 0) {
                                onUpdateHolding({ ...h, currentPricePerShare: val });
                              }
                              setQuickPriceId(null);
                            }}
                            className="inline-flex items-center gap-1"
                          >
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              autoFocus
                              value={quickPriceVal}
                              onChange={(e) => setQuickPriceVal(e.target.value)}
                              className="w-20 px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-right text-xs text-[#031725] dark:text-[#DAEAFF]"
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
                              setQuickPriceId(h.id);
                              setQuickPriceVal(String(h.currentPricePerShare));
                            }}
                            className="underline decoration-dotted text-[#031725] dark:text-[#DAEAFF] hover:text-[#499BED]"
                            title={tr('Clic para actualizar precio actual', 'Click to update current price')}
                          >
                            {formatMoney(h.currentPricePerShare, h.currency)}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-[#5A7694] dark:text-[#A1C6F6]">
                        {formatMoney(investedNative, h.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                        {formatMoney(currentNative, h.currency)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-num text-xs font-semibold whitespace-nowrap ${
                          gainNative >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {gainNative >= 0 ? '+' : ''}
                        {formatMoney(gainNative, h.currency)} ({gainPct >= 0 ? '+' : ''}
                        {gainPct.toFixed(1)}%)
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-xs text-[#022E5B] dark:text-[#499BED]">
                        {h.dividendYieldAnnual.toFixed(2)}%
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditForm(h)}
                            className="p-1.5 text-[#7FA6D6] hover:text-[#022E5B] dark:hover:text-[#DAEAFF] rounded hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
                            aria-label={tr('Editar activo', 'Edit asset')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteHolding(h.id)}
                            className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
                            aria-label={tr('Eliminar activo', 'Delete asset')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Calculadora de Crecimiento y Dividendos (DRIP) */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D3E3FA] dark:border-[#123B66] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED] shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr(
                  'Calculadora de crecimiento y reinversión de dividendos',
                  'Growth & Dividend Reinvestment Calculator (DRIP)'
                )}
              </h2>
              <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
                {tr(
                  `Simula cuánto crecerá tu capital en ${displayCurr} combinando aportes mensuales, crecimiento de ETFs/acciones y dividendos reinvertidos.`,
                  `Simulate how your capital in ${displayCurr} will grow combining monthly contributions, ETF/stock growth, and reinvested dividends.`
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setCalcInitial(Math.round(portfolioStats.totalCurrent));
              setCalcDivYieldPct(Number(portfolioStats.weightedYield.toFixed(2)) || 2.0);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-[#EAF2FF] dark:bg-[#022E5B]/80 hover:bg-[#DAEAFF] dark:hover:bg-[#022E5B] rounded-lg whitespace-nowrap transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {tr('Sincronizar con mi portafolio actual', 'Sync with current portfolio')}
          </button>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr(`Capital inicial (${displayCurr})`, `Initial capital (${displayCurr})`)}
            </label>
            <input
              type="number"
              min="0"
              step="100"
              value={calcInitial}
              onChange={(e) => setCalcInitial(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr(`Aporte mensual (${displayCurr})`, `Monthly contribution (${displayCurr})`)}
            </label>
            <input
              type="number"
              min="0"
              step="50"
              value={calcMonthly}
              onChange={(e) => setCalcMonthly(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Crecimiento anual esperado (%)', 'Expected annual growth (%)')}
            </label>
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={calcGrowthPct}
              onChange={(e) => setCalcGrowthPct(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Dividendo anual (%)', 'Annual dividend yield (%)')}
            </label>
            <input
              type="number"
              min="0"
              max="20"
              step="0.1"
              value={calcDivYieldPct}
              onChange={(e) => setCalcDivYieldPct(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
              {tr('Horizonte (años)', 'Horizon (years)')}
            </label>
            <select
              value={calcYears}
              onChange={(e) => setCalcYears(Number(e.target.value))}
              className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] font-medium text-[#031725] dark:text-[#DAEAFF]"
            >
              <option value={5}>5 {tr('años', 'years')}</option>
              <option value={10}>10 {tr('años', 'years')}</option>
              <option value={15}>15 {tr('años', 'years')}</option>
              <option value={20}>20 {tr('años', 'years')}</option>
              <option value={25}>25 {tr('años', 'years')}</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[#031725] dark:text-[#DAEAFF] cursor-pointer">
            <input
              type="checkbox"
              checked={calcReinvest}
              onChange={(e) => setCalcReinvest(e.target.checked)}
              className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED] w-4 h-4"
            />
            {tr(
              'Reinvertir automáticamente los dividendos (DRIP) para comprar más participaciones',
              'Automatically reinvest dividends (DRIP) to buy more shares'
            )}
          </label>
          <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6] font-mono-num">
            {tr('Retorno total compuesto estimado:', 'Estimated total compound return:')}{' '}
            {(calcGrowthPct + calcDivYieldPct).toFixed(2)}% {tr('anual', 'p.a.')}
          </span>
        </div>

        {/* Projection Result KPIs */}
        {finalYear && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-b border-[#D3E3FA] dark:border-[#123B66] py-5">
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Valor total en ${calcYears} años`, `Total value in ${calcYears} years`)}
              </div>
              <div className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                {formatMoney(finalYear.totalValue, displayCurr)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Capital propio aportado', 'Own capital contributed')}
              </div>
              <div className="text-2xl font-bold text-[#355170] dark:text-[#A1C6F6] font-mono-num mt-1">
                {formatMoney(finalYear.totalContributed, displayCurr)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Dividendos acumulados', 'Cumulative dividends')}
              </div>
              <div className="text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num mt-1">
                +{formatMoney(finalYear.dividendsAccumulated, displayCurr)}
              </div>
              {calcReinvest && finalNoDrip && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                  {tr('Extra por reinvertir (DRIP):', 'Extra from reinvesting (DRIP):')} +
                  {formatMoney(finalYear.totalValue - finalNoDrip.totalValue, displayCurr)}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  `Dividendo pasivo mensual al año ${calcYears}`,
                  `Monthly passive dividend at year ${calcYears}`
                )}
              </div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num mt-1">
                {formatMoney(finalYear.annualDividendIncome / 12, displayCurr)}/{tr('mes', 'mo')}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                ({formatMoney(finalYear.annualDividendIncome, displayCurr)}{' '}
                {tr('al año', 'per year')})
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        <ProjectionBarChart
          points={projectionYears.map((pt) => ({
            label: `${tr('Año', 'Yr')} ${pt.year}`,
            baseAmount: pt.totalContributed,
            gainAmount: pt.totalValue - pt.totalContributed,
            totalAmount: pt.totalValue,
          }))}
          currency={displayCurr}
          baseLabel={tr('Capital aportado', 'Principal contributed')}
          gainLabel={tr('Plusvalía + Dividendos', 'Growth + Dividends')}
        />

        {/* Year-by-year table */}
        <div>
          <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] mb-2">
            {tr('Proyección año por año', 'Year-by-year projection')}
          </h3>
          <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#EAF2FF] dark:bg-[#022E5B] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-2.5 px-4">{tr('Año', 'Year')}</th>
                  <th className="py-2.5 px-4 text-right">{tr('Capital aportado', 'Contributed')}</th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Dividendos del año', 'Annual dividends')}
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Dividendos acumulados', 'Cumulative dividends')}
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Patrimonio proyectado', 'Projected balance')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66] font-mono-num">
                {projectionYears.map((pt) => (
                  <tr key={pt.year} className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46]">
                    <td className="py-2 px-4 font-sans font-medium text-[#355170] dark:text-[#A1C6F6]">
                      {pt.label}
                    </td>
                    <td className="py-2 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      {formatMoney(pt.totalContributed, displayCurr)}
                    </td>
                    <td className="py-2 px-4 text-right text-emerald-700 dark:text-emerald-400 font-medium">
                      +{formatMoney(pt.annualDividendIncome, displayCurr)}
                    </td>
                    <td className="py-2 px-4 text-right text-[#022E5B] dark:text-[#499BED]">
                      +{formatMoney(pt.dividendsAccumulated, displayCurr)}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.totalValue, displayCurr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Simulador Interactivo de Incremento de Capital por Pagos de Dividendos */}
      <section className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D3E3FA] dark:border-[#123B66] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-[#EAF2FF] dark:bg-[#022E5B] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-[#022E5B] dark:text-[#499BED] shrink-0">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr(
                  `Simulador de Incremento de Capital por Pagos de Dividendos (${householdNames})`,
                  `Dividend Capital Growth Simulator (${householdNames})`
                )}
              </h2>
              <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
                {tr(
                  `Proyecta cuánto aumentará el capital de ${householdNames} si mantienen sus inversiones cobrando y acumulando dividendos.`,
                  `Forecast how much ${householdNames} capital will grow by holding their investments and collecting dividends.`
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
                setDivMonthlies(zeroed);
                setDivPriceGrowth(0);
              }}
              className="px-3 py-1.5 text-xs font-medium text-[#355170] dark:text-[#A1C6F6] bg-[#EAF2FF] dark:bg-[#022E5B]/70 hover:bg-[#DAEAFF] dark:hover:bg-[#022E5B] rounded-lg whitespace-nowrap transition-colors"
            >
              {tr(
                'Solo efecto dividendos ($0/mes · 0% precio)',
                'Dividends-only mode ($0/mo · 0% price)'
              )}
            </button>
            <button
              type="button"
              onClick={syncDividendSimulator}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-[#DAEAFF]/60 dark:bg-[#022E5B] border border-[#A1C6F6]/60 dark:border-[#499BED]/50 hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] rounded-lg whitespace-nowrap transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {tr('Cargar portafolios reales', 'Load live portfolios')}
            </button>
          </div>
        </div>

        {/* Interactive Parameter Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Strategy parameters */}
          <div className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-4 space-y-4">
            <div>
              <span className="block text-xs font-semibold text-[#031725] dark:text-[#DAEAFF] mb-1.5">
                {tr('Frecuencia de pago de dividendos', 'Dividend payout frequency')}
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                {(
                  [
                    { id: 'monthly', label: tr('Mensual', 'Monthly') },
                    { id: 'quarterly', label: tr('Trimestral', 'Quarterly') },
                    { id: 'annual', label: tr('Anual', 'Annual') },
                  ] as const
                ).map((freq) => (
                  <button
                    key={freq.id}
                    type="button"
                    onClick={() => setDivFrequency(freq.id)}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      divFrequency === freq.id
                        ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr('Crecimiento de mercado adicional (%/año)', 'Additional market growth (%/yr)')}
                </label>
                <span className="font-mono-num font-bold text-[#022E5B] dark:text-[#499BED]">
                  {divPriceGrowth.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="0.5"
                value={divPriceGrowth}
                onChange={(e) => setDivPriceGrowth(Number(e.target.value))}
                className="w-full accent-[#499BED] cursor-pointer"
              />
              <p className="text-[11px] text-[#5A7694] dark:text-[#7FA6D6] mt-0.5">
                {tr(
                  'Déjalo en 0% si solo quieres medir el incremento puro por pago de dividendos.',
                  'Leave at 0% to isolate pure capital increase from dividend payouts.'
                )}
              </p>
            </div>

            <div>
              <span className="block text-xs font-semibold text-[#031725] dark:text-[#DAEAFF] mb-1.5">
                {tr('Horizonte de permanencia', 'Holding horizon')}
              </span>
              <div className="grid grid-cols-5 gap-1 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                {[3, 5, 10, 15, 20].map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setDivYears(yr)}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      divYears === yr
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

            <label className="inline-flex items-start gap-2 text-xs font-medium text-[#355170] dark:text-[#A1C6F6] cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={divReinvest}
                onChange={(e) => setDivReinvest(e.target.checked)}
                className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED] mt-0.5"
              />
              <span>
                {tr(
                  'Reinvertir dividendos cobrados automáticamente (interés compuesto)',
                  'Automatically reinvest paid dividends (compounding)'
                )}
              </span>
            </label>
          </div>

          {/* Dynamic per-profile dividend controls */}
          {visibleProfiles.map((profile) => {
            const capVal = divCaps[profile.id] ?? ownerPortfolioStats[profile.id]?.current ?? 0;
            const yieldVal =
              divYields[profile.id] ?? ownerPortfolioStats[profile.id]?.yieldPct ?? 2.0;
            const monthlyVal = divMonthlies[profile.id] ?? 0;

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
                  {tr('Inversiones', 'Investments')} · {profile.name} ({displayCurr})
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label className="text-[#355170] dark:text-[#A1C6F6]">
                      {tr('Capital mantenido en cuenta', 'Capital held in account')}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(capVal, displayCurr)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={capVal}
                    onChange={(e) =>
                      setDivCaps((prev) => ({
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
                      {tr('Tasa de dividendo anual (%)', 'Annual dividend yield (%)')}
                    </label>
                    <span className="font-mono-num font-semibold text-[#022E5B] dark:text-[#499BED]">
                      {yieldVal.toFixed(2)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="12"
                    step="0.1"
                    value={Math.min(12, yieldVal)}
                    onChange={(e) =>
                      setDivYields((prev) => ({
                        ...prev,
                        [profile.id]: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-[#499BED] cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label className="text-[#355170] dark:text-[#A1C6F6]">
                      {tr('Aporte mensual opcional', 'Optional monthly deposit')}
                    </label>
                    <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(monthlyVal, displayCurr)}/{tr('mes', 'mo')}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={monthlyVal}
                    onChange={(e) =>
                      setDivMonthlies((prev) => ({
                        ...prev,
                        [profile.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary KPIs */}
        {lastDividendCapPoint && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-b border-[#D3E3FA] dark:border-[#123B66] py-5">
            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(`Capital proyectado al año ${divYears}`, `Projected capital at year ${divYears}`)}
              </div>
              <div className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num mt-1">
                {formatMoney(lastDividendCapPoint.totalCapital, displayCurr)}
              </div>
              {activeProfile === 'all' && visibleProfiles.length > 1 && (
                <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num flex flex-wrap gap-x-2">
                  {visibleProfiles.map((p, idx) => (
                    <span key={p.id}>
                      {idx > 0 ? '· ' : ''}
                      {p.name}:{' '}
                      {formatMoney(lastDividendCapPoint.profileCapitals[p.id] || 0, displayCurr, true)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Base sin dividendos', 'Baseline without dividends')}
              </div>
              <div className="text-2xl font-bold text-[#355170] dark:text-[#A1C6F6] font-mono-num mt-1">
                {formatMoney(lastDividendCapPoint.capitalWithoutDividends, displayCurr)}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5">
                {tr('Si las inversiones no pagaran dividendos', 'If investments paid zero dividends')}
              </div>
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr('Incremento generado por dividendos', 'Capital boost from dividends')}
              </div>
              <div className="text-2xl font-bold text-[#022E5B] dark:text-[#499BED] font-mono-num mt-1">
                +{formatMoney(lastDividendCapPoint.dividendGrowthDelta, displayCurr)}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                {lastDividendCapPoint.capitalWithoutDividends > 0
                  ? `+${(
                      (lastDividendCapPoint.dividendGrowthDelta /
                        lastDividendCapPoint.capitalWithoutDividends) *
                      100
                    ).toFixed(1)}% ${tr('de capital adicional', 'extra capital')}`
                  : tr('Incremento compuesto', 'Compounded boost')}
              </div>
            </div>

            <div>
              <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  `Dividendos cobrados en el año ${divYears}`,
                  `Dividends received in year ${divYears}`
                )}
              </div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num mt-1">
                {formatMoney(lastDividendCapPoint.dividendsThisYear, displayCurr)}/
                {tr('año', 'yr')}
              </div>
              <div className="text-xs text-[#5A7694] dark:text-[#7FA6D6] mt-0.5 font-mono-num">
                {tr('Equivale a', 'Equals')}{' '}
                {formatMoney(lastDividendCapPoint.dividendsThisYear / 12, displayCurr)}/
                {tr('mes', 'mo')}
              </div>
            </div>
          </div>
        )}

        {/* Recharts Area Chart */}
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={dividendCapPoints}
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
                tickFormatter={(val: number) => formatMoney(val, displayCurr, true)}
                tick={{ fill: tickColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={72}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  formatMoney(Number(value || 0), displayCurr),
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
                dataKey="totalCapital"
                name={
                  activeProfile === 'all'
                    ? tr('Capital Total con Dividendos', 'Total Capital with Dividends')
                    : tr('Capital con Dividendos', 'Capital with Dividends')
                }
                stroke={totalStroke}
                strokeWidth={2.5}
                fill={totalStroke}
                fillOpacity={0.16}
              />

              <Area
                type="monotone"
                dataKey="capitalWithoutDividends"
                name={tr('Capital sin Dividendos', 'Capital without Dividends')}
                stroke={noDivStroke}
                strokeWidth={2}
                strokeDasharray="4 4"
                fill={noDivStroke}
                fillOpacity={0.08}
              />

              {activeProfile === 'all' &&
                visibleProfiles.map((p) => (
                  <Area
                    key={p.id}
                    type="monotone"
                    dataKey={`profileCapitals.${p.id}`}
                    name={`${tr('Inversiones', 'Investments')} ${p.name}`}
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
            {tr(
              'Desglose anual del incremento de capital por dividendos',
              'Annual breakdown of dividend-driven capital growth'
            )}
          </h3>
          <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#EAF2FF] dark:bg-[#022E5B] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-2.5 px-4">{tr('Año', 'Year')}</th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Sin dividendos', 'Without dividends')}
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Dividendos del año', 'Annual dividends')}
                  </th>
                  <th className="py-2.5 px-4 text-right">
                    {tr('Incremento acumulado', 'Cumulative dividend boost')}
                  </th>
                  {activeProfile === 'all' &&
                    visibleProfiles.map((p) => (
                      <th key={p.id} className="py-2.5 px-4 text-right">
                        {p.name}
                      </th>
                    ))}
                  <th className="py-2.5 px-4 text-right">{tr('Capital Total', 'Total Capital')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66] font-mono-num">
                {dividendCapPoints.map((pt) => (
                  <tr key={pt.year} className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46]">
                    <td className="py-2.5 px-4 font-sans font-medium text-[#355170] dark:text-[#A1C6F6]">
                      {pt.label}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#5A7694] dark:text-[#A1C6F6]">
                      {formatMoney(pt.capitalWithoutDividends, displayCurr)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-emerald-700 dark:text-emerald-400 font-medium">
                      +{formatMoney(pt.dividendsThisYear, displayCurr)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#022E5B] dark:text-[#499BED] font-semibold">
                      +{formatMoney(pt.dividendGrowthDelta, displayCurr)}
                    </td>
                    {activeProfile === 'all' &&
                      visibleProfiles.map((p) => (
                        <td
                          key={p.id}
                          className="py-2.5 px-4 text-right text-[#355170] dark:text-[#DAEAFF]"
                        >
                          {formatMoney(pt.profileCapitals[p.id] || 0, displayCurr)}
                        </td>
                      ))}
                    <td className="py-2.5 px-4 text-right font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {formatMoney(pt.totalCapital, displayCurr)}
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
