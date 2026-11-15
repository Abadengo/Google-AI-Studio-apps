import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  Category,
  ProfileFilter,
  Transaction,
  TransactionType,
  UserProfile,
} from '../types/finance';
import { classifyTransactionsWithAi, type AiClassificationSuggestion } from '../utils/aiClient';
import { formatDateShort, formatMoney, getMonthKey, getProfileLabel } from '../utils/formatters';

interface AiReclassifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  profiles?: UserProfile[];
  activeProfile: ProfileFilter;
  selectedMonth: string;
  onApplyBatch: (
    patches: Array<{
      id: string;
      categoryId?: string;
      type?: TransactionType;
      description?: string;
    }>
  ) => void;
}

type AuditScope = 'generic' | 'month' | 'recent';

export function AiReclassifyModal({
  isOpen,
  onClose,
  transactions,
  categories,
  accounts,
  profiles,
  activeProfile,
  selectedMonth,
  onApplyBatch,
}: AiReclassifyModalProps) {
  const { tr, catName, lang } = useUiPreferences();

  const [scope, setScope] = useState<AuditScope>('month');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [suggestions, setSuggestions] = useState<AiClassificationSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [appliedMsg, setAppliedMsg] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setError('');
      setAppliedMsg('');
    }
  }, [isOpen]);

  const candidateTransactions = useMemo(() => {
    const byProfile =
      activeProfile === 'all'
        ? transactions
        : transactions.filter((t) => t.owner === activeProfile);

    if (scope === 'generic') {
      const genericList = byProfile.filter(
        (t) =>
          t.categoryId === 'cat_otros_gastos' ||
          t.categoryId === 'cat_otros_ingresos' ||
          t.description.length <= 10 ||
          t.source?.startsWith('csv_') ||
          t.source?.startsWith('pdf_')
      );
      return (genericList.length > 0 ? genericList : byProfile).slice(0, 80);
    }
    if (scope === 'month') {
      return byProfile.filter((t) => getMonthKey(t.date) === selectedMonth).slice(0, 80);
    }
    return byProfile.slice(0, 80);
  }, [transactions, activeProfile, scope, selectedMonth]);

  const txMap = useMemo(() => {
    const m = new Map<string, Transaction>();
    for (const t of transactions) m.set(t.id, t);
    return m;
  }, [transactions]);

  const actionableSuggestions = useMemo(() => {
    return suggestions.filter((s) => {
      const orig = txMap.get(s.id);
      if (!orig) return false;
      const changedCat = s.suggestedCategoryId && s.suggestedCategoryId !== orig.categoryId;
      const changedType = s.suggestedType && s.suggestedType !== orig.type;
      const changedDesc =
        s.suggestedDescription &&
        s.suggestedDescription.trim().toLowerCase() !== orig.description.trim().toLowerCase();
      return Boolean(changedCat || changedType || changedDesc);
    });
  }, [suggestions, txMap]);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (candidateTransactions.length === 0) return;
    setIsLoading(true);
    setError('');
    setAppliedMsg('');
    setSummary('');
    setSuggestions([]);

    try {
      const res = await classifyTransactionsWithAi({
        transactions: candidateTransactions,
        categories,
        accounts,
        lang,
      });
      setSummary(res.summary);
      setSuggestions(res.suggestions);

      const initialChecked: Record<string, boolean> = {};
      for (const s of res.suggestions) {
        initialChecked[s.id] = true;
      }
      setSelectedIds(initialChecked);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Error al analizar movimientos con IA.', 'Failed to analyze transactions with AI.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = actionableSuggestions.filter((s) => selectedIds[s.id]).length;

  const handleApply = () => {
    const patches = actionableSuggestions
      .filter((s) => selectedIds[s.id])
      .map((s) => ({
        id: s.id,
        categoryId: s.suggestedCategoryId,
        type: s.suggestedType,
        description: s.suggestedDescription,
      }));

    if (patches.length === 0) return;
    onApplyBatch(patches);
    setAppliedMsg(
      tr(
        `${patches.length} movimiento(s) reclasificado(s) correctamente.`,
        `${patches.length} transaction(s) reclassified successfully.`
      )
    );
    setTimeout(() => {
      onClose();
      setAppliedMsg('');
      setSuggestions([]);
      setSummary('');
    }, 1100);
  };

  const typeLabel = (t: TransactionType) =>
    t === 'income' ? tr('Ingreso', 'Income') : t === 'transfer' ? tr('Transf.', 'Transfer') : tr('Gasto', 'Expense');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reclassify-modal-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66]">
          <div>
            <h2
              id="reclassify-modal-title"
              className="text-lg font-semibold text-[#031725] dark:text-[#DAEAFF] flex items-center gap-2"
            >
              <Wand2 className="w-5 h-5 text-[#499BED]" />
              {tr(
                'Auditoría y Reclasificación Inteligente (A Posteriori)',
                'Smart Post-Import Audit & Reclassification'
              )}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tr(
                'El agente de IA revisa tus movimientos ya guardados para corregir categorías genéricas, limpiar nombres de comercios y detectar transferencias internas.',
                'The AI agent audits saved transactions to fix generic categories, clean merchant names, and detect internal transfers.'
              )}
            </p>
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

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#EDF4FF] dark:bg-[#041E32] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                {tr('Alcance:', 'Scope:')}
              </span>
              {(
                [
                  { id: 'month', label: tr(`Mes actual (${selectedMonth})`, `Current month (${selectedMonth})`) },
                  { id: 'generic', label: tr('Genéricos / Importados', 'Generic / Imported') },
                  { id: 'recent', label: tr('Últimos 80 movimientos', 'Last 80 transactions') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setScope(opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    scope === opt.id
                      ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] font-semibold'
                      : 'bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#355170] dark:text-[#A1C6F6]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={isLoading || candidateTransactions.length === 0}
              onClick={handleAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-xs font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-50 transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isLoading
                ? tr('Analizando movimientos...', 'Analyzing transactions...')
                : tr(
                    `Auditar ${candidateTransactions.length} movimiento(s)`,
                    `Audit ${candidateTransactions.length} transaction(s)`
                  )}
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 text-xs">
              {error}
            </div>
          )}

          {summary && (
            <div className="p-3.5 rounded-xl bg-[#EAF2FF] dark:bg-[#022E5B]/60 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-[#499BED] shrink-0 mt-0.5" />
              <span>{summary}</span>
            </div>
          )}

          {suggestions.length > 0 && actionableSuggestions.length === 0 && (
            <div className="p-6 text-center rounded-xl border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] text-sm text-[#355170] dark:text-[#A1C6F6]">
              {tr(
                '¡Todo luce bien! La IA no encontró cambios necesarios en este conjunto de movimientos.',
                'Everything looks clean! The AI found no needed changes in this batch.'
              )}
            </div>
          )}

          {actionableSuggestions.length > 0 && (
            <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#EAF2FF]/80 dark:bg-[#022E5B]/55 border-b border-[#D3E3FA] dark:border-[#123B66] flex items-center justify-between text-xs">
                <span className="font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr(
                    `${actionableSuggestions.length} sugerencia(s) de mejora encontradas`,
                    `${actionableSuggestions.length} improvement suggestion(s) found`
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      actionableSuggestions.forEach((s) => (next[s.id] = true));
                      setSelectedIds(next);
                    }}
                    className="text-[#022E5B] dark:text-[#499BED] hover:underline font-medium"
                  >
                    {tr('Todas', 'All')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds({})}
                    className="text-[#5A7694] dark:text-[#A1C6F6] hover:underline"
                  >
                    {tr('Ninguna', 'None')}
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-white dark:bg-[#062035] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                    <tr>
                      <th className="py-2 px-3 w-8"></th>
                      <th className="py-2 px-3">{tr('Movimiento', 'Transaction')}</th>
                      <th className="py-2 px-3">{tr('Cambio propuesto por IA', 'AI proposed update')}</th>
                      <th className="py-2 px-3 text-right">{tr('Monto', 'Amount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
                    {actionableSuggestions.map((s) => {
                      const orig = txMap.get(s.id);
                      if (!orig) return null;
                      const origCat = categories.find((c) => c.id === orig.categoryId);
                      const nextCat = categories.find((c) => c.id === s.suggestedCategoryId);
                      const checked = Boolean(selectedIds[s.id]);

                      return (
                        <tr
                          key={s.id}
                          className="hover:bg-[#F5F9FF] dark:hover:bg-[#082A46]"
                        >
                          <td className="py-2.5 px-3 align-top">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedIds((prev) => ({ ...prev, [s.id]: e.target.checked }))
                              }
                              className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED] mt-0.5"
                            />
                          </td>
                          <td className="py-2.5 px-3 align-top">
                            <div className="font-medium text-[#031725] dark:text-[#DAEAFF]">
                              {orig.description}
                            </div>
                            <div className="text-[11px] text-[#5A7694] dark:text-[#A1C6F6] font-mono-num mt-0.5">
                              {formatDateShort(orig.date, lang)} ·{' '}
                              {getProfileLabel(orig.owner, profiles)} ·{' '}
                              {catName(origCat)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 align-top space-y-1">
                            {s.suggestedDescription &&
                              s.suggestedDescription.trim() !== orig.description.trim() && (
                                <div className="flex items-center gap-1.5 text-[#022E5B] dark:text-[#499BED] font-medium">
                                  <ArrowRight className="w-3 h-3 shrink-0" />
                                  <span>{s.suggestedDescription}</span>
                                </div>
                              )}
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              {s.suggestedType !== orig.type && (
                                <span className="font-semibold text-amber-700 dark:text-amber-300">
                                  {typeLabel(orig.type)} → {typeLabel(s.suggestedType)} ·
                                </span>
                              )}
                              {s.suggestedCategoryId !== orig.categoryId && (
                                <span className="font-semibold text-[#022E5B] dark:text-[#DAEAFF]">
                                  {catName(origCat)} → {catName(nextCat)}
                                </span>
                              )}
                            </div>
                            {s.reason && (
                              <p className="text-[11px] text-[#5A7694] dark:text-[#A1C6F6]">
                                {s.reason}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF] whitespace-nowrap align-top">
                            {formatMoney(orig.amount, orig.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {appliedMsg && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-medium">
              <Check className="w-4 h-4 shrink-0" />
              {appliedMsg}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#EAF2FF]/50 dark:bg-[#041E32] flex items-center justify-between gap-3">
          <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
            {selectedCount > 0
              ? tr(
                  `${selectedCount} cambio(s) seleccionado(s) para aplicar`,
                  `${selectedCount} change(s) selected to apply`
                )
              : tr(
                  'Ejecuta la auditoría para revisar sugerencias.',
                  'Run the audit to review suggestions.'
                )}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[#355170] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B] rounded-lg"
            >
              {tr('Cerrar', 'Close')}
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={handleApply}
              className="px-4 py-2 text-sm font-semibold text-white dark:text-[#031725] bg-[#022E5B] dark:bg-[#499BED] hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-40 rounded-lg transition-colors"
            >
              {tr(`Aplicar cambios (${selectedCount})`, `Apply changes (${selectedCount})`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
