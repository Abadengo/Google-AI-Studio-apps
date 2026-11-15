import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { Budget, CurrencyCode, FinanceState, ProfileFilter } from '../types/finance';
import {
  CURRENCY_META,
  convertCurrency,
  formatFullMonthLabel,
  formatMoney,
  getMonthKey,
  getProfileLabel,
} from '../utils/formatters';

interface BudgetsViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onUpsertBudget: (budget: Omit<Budget, 'id'> & { id?: string }) => void;
  onDeleteBudget: (id: string) => void;
  onOpenImport?: () => void;
  onAskAi?: (prompt?: string) => void;
}

export function BudgetsView({
  state,
  activeProfile,
  selectedMonth,
  onSelectMonth,
  onUpsertBudget,
  onDeleteBudget,
  onOpenImport,
  onAskAi,
}: BudgetsViewProps) {
  const { tr, catName, lang } = useUiPreferences();

  const currency = state.displayCurrency;
  const [newCatId, setNewCatId] = useState<string>('cat_salud');
  const [newLimit, setNewLimit] = useState<string>('250');
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>(currency);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const expenseCategories = useMemo(
    () => state.categories.filter((c) => c.type === 'expense'),
    [state.categories]
  );

  // Compute monthly spending per category for the active profile
  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of state.transactions) {
      if (tx.type !== 'expense') continue;
      if (getMonthKey(tx.date) !== selectedMonth) continue;
      if (activeProfile !== 'all' && tx.owner !== activeProfile) continue;
      const val = convertCurrency(tx.amount, tx.currency, currency, state.exchangeRates);
      map.set(tx.categoryId, (map.get(tx.categoryId) || 0) + val);
    }
    return map;
  }, [state.transactions, state.exchangeRates, selectedMonth, activeProfile, currency]);

  const rows = useMemo(() => {
    const relevantBudgets = state.budgets.filter((b) =>
      activeProfile === 'all' ? b.owner === 'all' : b.owner === activeProfile || b.owner === 'all'
    );

    // Deduplicate if specific override exists
    const finalBudgets: Budget[] = [];
    for (const b of relevantBudgets) {
      if (activeProfile !== 'all' && b.owner === 'all') {
        const hasSpecific = relevantBudgets.some(
          (o) => o.categoryId === b.categoryId && o.owner === activeProfile
        );
        if (hasSpecific) continue;
      }
      finalBudgets.push(b);
    }

    const profileDivisor = Math.max(1, state.profiles.length);

    return finalBudgets
      .map((b) => {
        const cat = state.categories.find((c) => c.id === b.categoryId);
        const isHalfHousehold = activeProfile !== 'all' && b.owner === 'all';
        const rawLimit = isHalfHousehold ? b.monthlyLimit / profileDivisor : b.monthlyLimit;
        const limitInDisplay = convertCurrency(rawLimit, b.currency, currency, state.exchangeRates);
        const spent = spentByCategory.get(b.categoryId) || 0;
        const pct = limitInDisplay > 0 ? (spent / limitInDisplay) * 100 : 0;
        const status: 'exceeded' | 'warning' | 'ok' =
          pct >= 100 ? 'exceeded' : pct >= 80 ? 'warning' : 'ok';

        return {
          budget: b,
          catLabel: catName(cat, tr('Categoría', 'Category')),
          catColor: cat?.color || '#499BED',
          isHalfHousehold,
          sharePct: Math.round(100 / profileDivisor),
          limitInDisplay,
          spent,
          remaining: limitInDisplay - spent,
          pct,
          status,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [
    state.budgets,
    state.categories,
    state.exchangeRates,
    state.profiles.length,
    activeProfile,
    currency,
    spentByCategory,
    catName,
    tr,
  ]);

  const totalBudget = rows.reduce((s, r) => s + r.limitInDisplay, 0);
  const totalSpentInBudgeted = rows.reduce((s, r) => s + r.spent, 0);
  const exceededCount = rows.filter((r) => r.status === 'exceeded').length;

  const handleAddBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const limitNum = Number(newLimit);
    if (!limitNum || limitNum <= 0) return;
    onUpsertBudget({
      categoryId: newCatId,
      owner: activeProfile,
      monthlyLimit: limitNum,
      currency: newCurrency,
    });
    setNewLimit('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] tracking-tight">
            {tr('Presupuestos por Categoría', 'Category Budgets')}
          </h1>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
            {tr(
              'Define un límite mensual para cada categoría y recibe alertas automáticas cuando te acerques o te pases.',
              'Set a monthly limit per category and receive automatic alerts when nearing or exceeding it.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onAskAi && (
            <button
              type="button"
              onClick={() =>
                onAskAi(
                  tr(
                    'Analiza mis presupuestos actuales y propón ajustes o límites para categorías sin presupuesto.',
                    'Analyze my current budgets and propose adjustments or limits for unbudgeted categories.'
                  )
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs font-medium rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] whitespace-nowrap transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#499BED]" />
              {tr('Optimizar presupuestos con IA', 'Optimize budgets with AI')}
            </button>
          )}
          {onOpenImport && (
            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] whitespace-nowrap transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              {tr('Importar PDF / CSV', 'Import PDF / CSV')}
            </button>
          )}
          <label htmlFor="bud-month" className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
            {tr('Mes evaluado:', 'Evaluated month:')}
          </label>
          <input
            id="bud-month"
            type="month"
            value={selectedMonth}
            onChange={(e) => e.target.value && onSelectMonth(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-medium text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
          />
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Presupuesto total', 'Total budget')} ({formatFullMonthLabel(selectedMonth, lang)})
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num">
            {formatMoney(totalBudget, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Gastado en categorías con límite', 'Spent in budgeted categories')}
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num">
            {formatMoney(totalSpentInBudgeted, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 shadow-xs">
          <div className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6]">
            {tr('Estado de alertas', 'Alert status')}
          </div>
          <div
            className={`mt-1.5 text-2xl font-bold ${
              exceededCount > 0
                ? 'text-red-700 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {exceededCount > 0
              ? tr(
                  `${exceededCount} ${exceededCount === 1 ? 'categoría excedida' : 'categorías excedidas'}`,
                  `${exceededCount} ${exceededCount === 1 ? 'category exceeded' : 'categories exceeded'}`
                )
              : tr('Todo dentro del límite', 'All within budget')}
          </div>
        </div>
      </div>

      {/* Add / update budget form */}
      <form
        onSubmit={handleAddBudget}
        className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-5 flex flex-wrap items-end gap-4 shadow-xs"
      >
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="new-bud-cat"
            className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
          >
            {tr('Categoría', 'Category')}
          </label>
          <select
            id="new-bud-cat"
            value={newCatId}
            onChange={(e) => setNewCatId(e.target.value)}
            className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
          >
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {catName(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="w-40">
          <label
            htmlFor="new-bud-limit"
            className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
          >
            {tr('Límite mensual', 'Monthly limit')}
          </label>
          <input
            id="new-bud-limit"
            type="number"
            min="1"
            step="10"
            required
            placeholder="300"
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
          />
        </div>

        <div className="w-32">
          <label
            htmlFor="new-bud-curr"
            className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
          >
            {tr('Moneda', 'Currency')}
          </label>
          <select
            id="new-bud-curr"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value as CurrencyCode)}
            className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
          >
            {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
        >
          <Plus className="w-4 h-4" />
          {tr('Guardar presupuesto', 'Save budget')} (
          {activeProfile === 'all'
            ? tr('Hogar', 'Household')
            : getProfileLabel(activeProfile, state.profiles)}
          )
        </button>
      </form>

      {/* Budget rows */}
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl divide-y divide-[#E6EFFB] dark:divide-[#123B66] shadow-xs">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#5A7694] dark:text-[#A1C6F6]">
            {tr(
              'Aún no hay presupuestos configurados. Agrega tu primer límite arriba.',
              'No budgets configured yet. Add your first monthly limit above.'
            )}
          </div>
        ) : (
          rows.map((row) => {
            const isEditing = editingId === row.budget.id;
            const barWidth = Math.min(100, row.pct);

            return (
              <div key={row.budget.id} className="p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: row.catColor }}
                    />
                    <div>
                      <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                        {row.catLabel}
                      </span>
                      {row.isHalfHousehold && (
                        <span className="ml-2 text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                          {tr(
                            `(${row.sharePct}% del presupuesto conjunto)`,
                            `(${row.sharePct}% of household budget)`
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                        row.status === 'exceeded'
                          ? 'text-red-700 dark:text-red-400'
                          : row.status === 'warning'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {row.status === 'exceeded' ? (
                        <>
                          <AlertTriangle className="w-4 h-4" />
                          {tr('Excedido por', 'Exceeded by')}{' '}
                          {formatMoney(Math.abs(row.remaining), currency)}
                        </>
                      ) : row.status === 'warning' ? (
                        <>
                          <AlertTriangle className="w-4 h-4" />
                          {tr('Cerca del límite', 'Near limit')} ({row.pct.toFixed(0)}%)
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          {tr('En rango · Quedan', 'On track · Remaining')}{' '}
                          {formatMoney(row.remaining, currency)}
                        </>
                      )}
                    </span>

                    <div className="flex items-center gap-2 font-mono-num text-sm">
                      <span className="font-semibold text-[#031725] dark:text-[#DAEAFF]">
                        {formatMoney(row.spent, currency)}
                      </span>
                      <span className="text-[#7FA6D6]">/</span>

                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const val = Number(editValue);
                            if (val > 0) {
                              onUpsertBudget({
                                id: row.budget.id,
                                categoryId: row.budget.categoryId,
                                owner: row.budget.owner,
                                monthlyLimit: val,
                                currency: row.budget.currency,
                              });
                            }
                            setEditingId(null);
                          }}
                          className="inline-flex items-center gap-1.5"
                        >
                          <input
                            type="number"
                            min="1"
                            step="10"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-24 px-2 py-1 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-sm text-[#031725] dark:text-[#DAEAFF]"
                          />
                          <button
                            type="submit"
                            className="px-2.5 py-1 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-xs rounded font-sans font-semibold"
                          >
                            OK
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(row.budget.id);
                            setEditValue(String(row.budget.monthlyLimit));
                          }}
                          className="text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] underline decoration-dotted underline-offset-4"
                          title={tr('Clic para editar límite', 'Click to edit limit')}
                        >
                          {formatMoney(row.limitInDisplay, currency)}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onDeleteBudget(row.budget.id)}
                      className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"
                      aria-label={tr('Eliminar presupuesto', 'Delete budget')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="w-full h-2.5 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      row.status === 'exceeded'
                        ? 'bg-red-600 dark:bg-red-500'
                        : row.status === 'warning'
                        ? 'bg-amber-500 dark:bg-amber-400'
                        : 'bg-[#022E5B] dark:bg-[#499BED]'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
