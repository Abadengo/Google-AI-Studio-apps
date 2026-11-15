import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { FinanceState, ProfileFilter } from '../types/finance';
import { getProfileLabel } from '../utils/formatters';

export interface ResetToZeroPayload {
  accounts: boolean;
  moomoo: boolean;
  transactions: boolean;
  scope: ProfileFilter;
}

interface ResetZeroModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FinanceState;
  activeProfile: ProfileFilter;
  onResetToZero: (options: ResetToZeroPayload) => void;
}

export function ResetZeroModal({
  isOpen,
  onClose,
  state,
  activeProfile,
  onResetToZero,
}: ResetZeroModalProps) {
  const { tr } = useUiPreferences();

  const [zeroAccounts, setZeroAccounts] = useState(true);
  const [zeroMoomoo, setZeroMoomoo] = useState(true);
  const [zeroTransactions, setZeroTransactions] = useState(true);
  const [scope, setScope] = useState<ProfileFilter>(activeProfile);
  const [doneMsg, setDoneMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setZeroAccounts(true);
      setZeroMoomoo(true);
      setZeroTransactions(true);
      setScope(activeProfile);
      setDoneMsg('');
    }
  }, [isOpen, activeProfile]);

  if (!isOpen) return null;

  const matchesScope = (owner: string) => scope === 'all' || owner === scope;
  const affectedAccountsCount = state.accounts.filter((a) => matchesScope(a.owner)).length;
  const affectedMoomooCount = state.moomooHoldings.filter((h) => matchesScope(h.owner)).length;
  const affectedTxCount = state.transactions.filter((t) => matchesScope(t.owner)).length;
  const scopeLabel =
    scope === 'all'
      ? tr('Todo el hogar', 'Entire household')
      : getProfileLabel(scope, state.profiles);

  const nothingSelected = !zeroAccounts && !zeroMoomoo && !zeroTransactions;

  const handleConfirm = () => {
    if (nothingSelected) return;
    onResetToZero({
      accounts: zeroAccounts,
      moomoo: zeroMoomoo,
      transactions: zeroTransactions,
      scope,
    });
    const parts: string[] = [];
    if (zeroAccounts) parts.push(tr('saldos por cuenta y GoalSaver', 'account & GoalSaver balances'));
    if (zeroMoomoo) parts.push(tr('saldos de Moomoo', 'Moomoo balances'));
    if (zeroTransactions) parts.push(tr('movimientos', 'transactions'));
    setDoneMsg(
      tr(
        `¡Listo! Se volvieron a cero: ${parts.join(', ')} (${scopeLabel}).`,
        `Done! Reset to zero: ${parts.join(', ')} (${scopeLabel}).`
      )
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-zero-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <h2 id="reset-zero-title" className="text-base font-bold text-[#031725] dark:text-[#DAEAFF]">
                {tr('Volver saldos y movimientos a $0', 'Reset Balances & Transactions to $0')}
              </h2>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  'Conserva tus perfiles, cuentas creadas, categorías y presupuestos.',
                  'Keeps your profiles, configured accounts, categories, and budgets intact.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
            aria-label={tr('Cerrar', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {activeProfile !== 'all' && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                {tr('Alcance del reinicio', 'Reset scope')}
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setScope(activeProfile)}
                  className={`py-2 px-3 rounded-md font-medium transition-colors ${
                    scope === activeProfile
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6]'
                  }`}
                >
                  {tr('Solo', 'Only')} {getProfileLabel(activeProfile, state.profiles)}
                </button>
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className={`py-2 px-3 rounded-md font-medium transition-colors ${
                    scope === 'all'
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6]'
                  }`}
                >
                  {tr('Todo el hogar', 'Entire household')}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] cursor-pointer hover:border-[#499BED] transition-colors">
              <input
                type="checkbox"
                checked={zeroAccounts}
                onChange={(e) => setZeroAccounts(e.target.checked)}
                className="mt-0.5 rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                    {tr('Saldos por cuenta y GoalSaver → $0.00', 'Account & GoalSaver balances → $0.00')}
                  </span>
                  <span className="text-xs font-mono-num text-[#5A7694] dark:text-[#A1C6F6]">
                    {affectedAccountsCount} {tr('cuentas', 'accounts')}
                  </span>
                </div>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
                  {tr(
                    'Reinicia a 0 el saldo inicial de cada cuenta bancaria y el capital actual de GoalSaver.',
                    'Resets initial balance of every bank account and GoalSaver current balance to 0.'
                  )}
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] cursor-pointer hover:border-[#499BED] transition-colors">
              <input
                type="checkbox"
                checked={zeroMoomoo}
                onChange={(e) => setZeroMoomoo(e.target.checked)}
                className="mt-0.5 rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                    {tr('Saldos en Moomoo → $0.00', 'Moomoo balances → $0.00')}
                  </span>
                  <span className="text-xs font-mono-num text-[#5A7694] dark:text-[#A1C6F6]">
                    {affectedMoomooCount} {tr('activos', 'holdings')}
                  </span>
                </div>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
                  {tr(
                    'Deja en 0 el capital invertido, valor actual, dividendos y cuentas vinculadas a Moomoo.',
                    'Resets Moomoo invested capital, current value, dividends, and Moomoo account balances to 0.'
                  )}
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] cursor-pointer hover:border-[#499BED] transition-colors">
              <input
                type="checkbox"
                checked={zeroTransactions}
                onChange={(e) => setZeroTransactions(e.target.checked)}
                className="mt-0.5 rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                    {tr('Movimientos en general → 0', 'All transactions → 0')}
                  </span>
                  <span className="text-xs font-mono-num text-[#5A7694] dark:text-[#A1C6F6]">
                    {affectedTxCount} {tr('movimientos', 'transactions')}
                  </span>
                </div>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
                  {tr(
                    'Elimina ingresos, gastos, transferencias y estados pagados del historial.',
                    'Clears recorded income, expenses, transfers, and monthly paid flags.'
                  )}
                </p>
              </div>
            </label>
          </div>

          {zeroAccounts && !zeroTransactions && affectedTxCount > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                {tr(
                  'Nota: Si mantienes los movimientos existentes, el saldo calculado de las cuentas seguirá sumando esos movimientos.',
                  'Note: If you keep existing transactions, calculated account balances will still reflect those transactions.'
                )}
              </span>
            </div>
          )}

          {doneMsg && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-xs font-medium text-emerald-800 dark:text-emerald-200">
              <Check className="w-4 h-4 shrink-0" />
              <span>{doneMsg}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#EAF2FF]/50 dark:bg-[#041E32] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#355170] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B] rounded-lg transition-colors"
          >
            {tr('Cerrar', 'Close')}
          </button>
          <button
            type="button"
            disabled={nothingSelected}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-45 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            {tr('Volver a $0 ahora', 'Reset to $0 now')}
          </button>
        </div>
      </div>
    </div>
  );
}
