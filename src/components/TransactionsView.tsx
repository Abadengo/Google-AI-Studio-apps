import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Upload, Wand2 } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { FinanceState, ProfileFilter, Transaction, TransactionType } from '../types/finance';
import {
  convertCurrency,
  formatDateShort,
  formatMoney,
  getMonthKey,
  getProfileLabel,
} from '../utils/formatters';

interface TransactionsViewProps {
  state: FinanceState;
  activeProfile: ProfileFilter;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onOpenNewTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onOpenCsvImport: () => void;
  onOpenAiReclassify?: () => void;
  onResetToZero?: (options: {
    accounts: boolean;
    moomoo: boolean;
    transactions: boolean;
    scope?: ProfileFilter;
  }) => void;
}

export function TransactionsView({
  state,
  activeProfile,
  selectedMonth,
  onSelectMonth,
  onOpenNewTransaction,
  onEditTransaction,
  onDeleteTransaction,
  onOpenCsvImport,
  onOpenAiReclassify,
  onResetToZero,
}: TransactionsViewProps) {
  const { tr, catName, lang } = useUiPreferences();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [monthScope, setMonthScope] = useState<'selected' | 'all'>('selected');
  const [confirmClearTx, setConfirmClearTx] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.transactions.filter((tx) => {
      if (activeProfile !== 'all' && tx.owner !== activeProfile) return false;
      if (monthScope === 'selected' && getMonthKey(tx.date) !== selectedMonth) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && tx.categoryId !== categoryFilter) return false;
      if (accountFilter !== 'all' && tx.accountId !== accountFilter && tx.toAccountId !== accountFilter) {
        return false;
      }
      if (q) {
        const catObj = state.categories.find((c) => c.id === tx.categoryId);
        const cat = catName(catObj, '').toLowerCase();
        const acc = state.accounts.find((a) => a.id === tx.accountId)?.name.toLowerCase() || '';
        const desc = tx.description.toLowerCase();
        if (!desc.includes(q) && !cat.includes(q) && !acc.includes(q)) return false;
      }
      return true;
    });
  }, [
    state.transactions,
    state.categories,
    state.accounts,
    activeProfile,
    monthScope,
    selectedMonth,
    typeFilter,
    categoryFilter,
    accountFilter,
    search,
    catName,
  ]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of filtered) {
      const converted = convertCurrency(
        tx.amount,
        tx.currency,
        state.displayCurrency,
        state.exchangeRates
      );
      if (tx.type === 'income') income += converted;
      else if (tx.type === 'expense') expense += converted;
    }
    return { income, expense };
  }, [filtered, state.displayCurrency, state.exchangeRates]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#031725] dark:text-[#DAEAFF] tracking-tight">
            {tr('Movimientos (Ingresos y Gastos)', 'Transactions (Income & Expenses)')}
          </h1>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6] mt-0.5">
            {tr(
              'Registra o importa desde PDF o CSV todos tus movimientos por cuenta, moneda y categoría.',
              'Record or import from PDF or CSV all your transactions by account, currency, and category.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenAiReclassify && (
            <button
              type="button"
              onClick={onOpenAiReclassify}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73] transition-colors whitespace-nowrap"
            >
              <Wand2 className="w-4 h-4 text-[#499BED]" />
              {tr('Reclasificar con IA', 'Reclassify with AI')}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCsvImport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            {tr('Importar PDF / CSV', 'Import PDF / CSV')}
          </button>
          {onResetToZero && state.transactions.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearTx((v) => !v)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-red-50/70 dark:bg-red-950/35 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 text-sm font-medium rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              {tr('Movimientos a 0', 'Clear transactions')}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNewTransaction}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {tr('Nuevo movimiento', 'New transaction')}
          </button>
        </div>
      </div>

      {confirmClearTx && onResetToZero && (
        <div className="p-4 rounded-xl bg-red-50/80 dark:bg-red-950/35 border border-red-200 dark:border-red-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-red-900 dark:text-red-200 font-medium">
            {tr(
              '¿Eliminar todos los movimientos registrados y volver el flujo a 0?',
              'Clear all recorded transactions and reset cashflow to 0?'
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResetToZero({
                  accounts: false,
                  moomoo: false,
                  transactions: true,
                  scope: activeProfile,
                });
                setConfirmClearTx(false);
              }}
              className="px-3 py-1.5 bg-red-700 text-white font-semibold rounded-md hover:bg-red-800"
            >
              {tr('Sí, limpiar movimientos', 'Yes, clear transactions')}
            </button>
            <button
              type="button"
              onClick={() => {
                onResetToZero({
                  accounts: true,
                  moomoo: true,
                  transactions: true,
                  scope: activeProfile,
                });
                setConfirmClearTx(false);
              }}
              className="px-3 py-1.5 bg-red-900 text-white font-semibold rounded-md hover:bg-red-950"
            >
              {tr('Limpiar movimientos + saldos a $0', 'Clear transactions + all balances to $0')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearTx(false)}
              className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#031725] dark:text-[#DAEAFF] font-medium rounded-md"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Filters bar */}
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-4 space-y-3 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-[#7FA6D6] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={tr(
                'Buscar por comercio, nota, categoría...',
                'Search by merchant, note, category...'
              )}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] placeholder:text-[#7FA6D6] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | TransactionType)}
            className="px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            aria-label={tr('Filtrar por tipo', 'Filter by type')}
          >
            <option value="all">{tr('Todos los tipos', 'All types')}</option>
            <option value="expense">{tr('Solo gastos', 'Expenses only')}</option>
            <option value="income">{tr('Solo ingresos', 'Income only')}</option>
            <option value="transfer">{tr('Solo transferencias', 'Transfers only')}</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            aria-label={tr('Filtrar por categoría', 'Filter by category')}
          >
            <option value="all">{tr('Todas las categorías', 'All categories')}</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {catName(c)}
              </option>
            ))}
          </select>

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            aria-label={tr('Filtrar por cuenta', 'Filter by account')}
          >
            <option value="all">{tr('Todas las cuentas', 'All accounts')}</option>
            {state.accounts
              .filter((a) => activeProfile === 'all' || a.owner === activeProfile)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {getProfileLabel(a.owner, state.profiles)} · {a.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E6EFFB] dark:border-[#123B66] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-0.5 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg">
              <button
                type="button"
                onClick={() => setMonthScope('selected')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  monthScope === 'selected'
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6]'
                }`}
              >
                {tr('Por mes', 'By month')}
              </button>
              <button
                type="button"
                onClick={() => setMonthScope('all')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  monthScope === 'all'
                    ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6]'
                }`}
              >
                {tr('Todo el historial', 'All history')}
              </button>
            </div>

            {monthScope === 'selected' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => e.target.value && onSelectMonth(e.target.value)}
                className="px-2.5 py-1 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] font-medium"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[#355170] dark:text-[#A1C6F6] font-mono-num">
            <span>
              {filtered.length} {tr('movimientos', 'transactions')}
            </span>
            <span>
              {tr('Ingresos:', 'Income:')}{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {formatMoney(totals.income, state.displayCurrency)}
              </strong>
            </span>
            <span>
              {tr('Gastos:', 'Expenses:')}{' '}
              <strong className="text-[#031725] dark:text-[#DAEAFF]">
                {formatMoney(totals.expense, state.displayCurrency)}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-[#5A7694] dark:text-[#A1C6F6] mb-4">
              {tr(
                'No se encontraron movimientos con los filtros actuales.',
                'No transactions match your current filters.'
              )}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenNewTransaction}
                className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
              >
                {tr('Registrar movimiento', 'Record transaction')}
              </button>
              <button
                type="button"
                onClick={onOpenCsvImport}
                className="px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B]"
              >
                {tr('Importar PDF / CSV', 'Import PDF / CSV')}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-[#EAF2FF]/80 dark:bg-[#022E5B]/55 border-b border-[#D3E3FA] dark:border-[#123B66] text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                <tr>
                  <th className="py-3 px-4">{tr('Fecha', 'Date')}</th>
                  <th className="py-3 px-4">{tr('Descripción', 'Description')}</th>
                  <th className="py-3 px-4">{tr('Categoría', 'Category')}</th>
                  <th className="py-3 px-4">{tr('Cuenta', 'Account')}</th>
                  <th className="py-3 px-4">{tr('Perfil', 'Profile')}</th>
                  <th className="py-3 px-4 text-right">{tr('Monto', 'Amount')}</th>
                  <th className="py-3 px-4 text-right w-24">{tr('Acciones', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
                {filtered.map((tx) => {
                  const cat = state.categories.find((c) => c.id === tx.categoryId);
                  const acc = state.accounts.find((a) => a.id === tx.accountId);
                  const toAcc = tx.toAccountId
                    ? state.accounts.find((a) => a.id === tx.toAccountId)
                    : null;

                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono-num text-xs text-[#5A7694] dark:text-[#A1C6F6] whitespace-nowrap">
                        {formatDateShort(tx.date, lang)}
                      </td>
                      <td className="py-3 px-4 text-[#031725] dark:text-[#DAEAFF] font-medium max-w-[260px] truncate">
                        {tx.description}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6] whitespace-nowrap">
                        {catName(cat)}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6] whitespace-nowrap">
                        {acc?.name ||
                          (tx.type === 'transfer' && !tx.accountId
                            ? tr('Otra cuenta', 'Other account')
                            : tr('Cuenta eliminada', 'Deleted account'))}
                        {toAcc ? ` → ${toAcc.name}` : ''}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#355170] dark:text-[#A1C6F6] whitespace-nowrap">
                        {getProfileLabel(tx.owner, state.profiles)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                          tx.type === 'income'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : tx.type === 'transfer'
                            ? 'text-[#5A7694] dark:text-[#A1C6F6]'
                            : 'text-[#031725] dark:text-[#DAEAFF]'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                        {formatMoney(tx.amount, tx.currency)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            className="p-1.5 text-[#7FA6D6] hover:text-[#022E5B] dark:hover:text-[#DAEAFF] rounded-md hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
                            aria-label={tr('Editar movimiento', 'Edit transaction')}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTransaction(tx.id)}
                            className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40"
                            aria-label={tr('Eliminar movimiento', 'Delete transaction')}
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
      </div>
    </div>
  );
}
