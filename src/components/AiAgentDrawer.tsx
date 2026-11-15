import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  AccountKind,
  Budget,
  CurrencyCode,
  FinanceState,
  FixedExpense,
  ProfileFilter,
  ProfileId,
  Transaction,
  TransactionType,
} from '../types/finance';
import {
  askFinancialAssistant,
  type AiProposedAction,
} from '../utils/aiClient';
import { CURRENCY_META, getProfileLabel, getTodayISO, normalizeDateToISO } from '../utils/formatters';

export type AgentTabContext = 'dashboard' | 'transactions' | 'budgets' | 'accounts' | 'investments';

interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  highlights?: string[];
  proposedActions?: AiProposedAction[];
}

interface AiAgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  state: FinanceState;
  activeTab: AgentTabContext;
  activeProfile: ProfileFilter;
  selectedMonth: string;
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
  onOpenImport: () => void;
  onOpenReclassify: () => void;
  onReclassifyBatch: (
    patches: Array<{
      id: string;
      categoryId?: string;
      type?: TransactionType;
      description?: string;
    }>
  ) => void;
  onUpsertBudget: (budget: Omit<Budget, 'id'> & { id?: string }) => void;
  onAddFixedExpense: (item: Omit<FixedExpense, 'id'>) => void;
  onAddTransaction: (tx: Omit<Transaction, 'id'>) => void;
  onAddAccount: (acc: Omit<Account, 'id'>) => string;
  onDeleteAccount: (id: string) => void;
}

export function AiAgentDrawer({
  isOpen,
  onClose,
  state,
  activeTab,
  activeProfile,
  selectedMonth,
  initialPrompt,
  onClearInitialPrompt,
  onOpenImport,
  onOpenReclassify,
  onReclassifyBatch,
  onUpsertBudget,
  onAddFixedExpense,
  onAddTransaction,
  onAddAccount,
  onDeleteAccount,
}: AiAgentDrawerProps) {
  const { tr, lang } = useUiPreferences();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [appliedKeys, setAppliedKeys] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isLoading]);

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isLoading) return;

    setError('');
    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextHistory = [...turns, userTurn];
    setTurns(nextHistory);
    setInput('');
    setIsLoading(true);

    try {
      const res = await askFinancialAssistant({
        messages: nextHistory.map((t) => ({ role: t.role, text: t.text })),
        activeTab,
        activeProfile,
        selectedMonth,
        lang,
        state,
      });

      const modelTurn: ChatTurn = {
        id: `m_${Date.now()}`,
        role: 'model',
        text: res.reply,
        highlights: res.highlights,
        proposedActions: res.proposedActions,
      };
      setTurns((prev) => [...prev, modelTurn]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Error al consultar al agente de IA.', 'Failed to reach AI agent.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && initialPrompt && initialPrompt.trim()) {
      const p = initialPrompt;
      onClearInitialPrompt?.();
      void sendMessage(p);
    }
  }, [isOpen, initialPrompt]);

  const quickPrompts = useMemo(() => {
    if (activeTab === 'transactions') {
      return [
        tr(
          'Revisa mis últimos movimientos y dime cuáles están mal clasificados o podrían reclasificarse',
          'Review my recent transactions and tell me which ones are misclassified or need recategorization'
        ),
        tr(
          '¿Cuáles fueron mis principales fugas de gasto este mes?',
          'What were my biggest spending leaks this month?'
        ),
      ];
    }
    if (activeTab === 'budgets') {
      return [
        tr(
          'Analiza mis presupuestos actuales y propón límites realistas donde me estoy pasando o falta presupuesto',
          'Analyze my current budgets and propose realistic limits where I am overspending or missing a budget'
        ),
        tr(
          '¿Cómo puedo cerrar este mes sin exceder mis categorías?',
          'How can I finish this month without exceeding my category budgets?'
        ),
      ];
    }
    if (activeTab === 'accounts') {
      return [
        tr(
          'Evalúa los saldos de nuestras cuentas y fondos de ahorro y sugiere cómo maximizar el interés mensual',
          'Evaluate balances across our accounts and savings funds and suggest how to maximize monthly interest'
        ),
        tr(
          '¿Tenemos suficiente colchón líquido o deberíamos ajustar el aporte mensual al fondo de ahorro?',
          'Do we have enough liquid buffer or should we adjust our monthly savings contribution?'
        ),
      ];
    }
    if (activeTab === 'investments') {
      return [
        tr(
          'Analiza nuestro portafolio de inversiones: concentración, rendimiento por dividendos y próximos pasos',
          'Analyze our investment portfolio: concentration, dividend yield, and next steps'
        ),
        tr(
          '¿Cuánto dividendo anual estimamos generar y cómo reinvertirlo de forma inteligente?',
          'How much annual dividend income are we generating and how should we reinvest it?'
        ),
      ];
    }
    return [
      tr(
        'Dame un diagnóstico completo del mes: ingresos, gastos, % de ahorro y acciones recomendadas',
        'Give me a full diagnosis of this month: income, expenses, savings rate, and recommended actions'
      ),
      tr(
        'Revisa mis gastos fijos y presupuestos y dime qué debo ajustar hoy',
        'Review my fixed expenses and budgets and tell me what I should adjust today'
      ),
    ];
  }, [activeTab, tr]);

  const tabLabel =
    activeTab === 'transactions'
      ? tr('Movimientos', 'Transactions')
      : activeTab === 'budgets'
      ? tr('Presupuestos', 'Budgets')
      : activeTab === 'accounts'
      ? tr('Cuentas Bancarias', 'Bank Accounts')
      : activeTab === 'investments'
      ? tr('Inversiones', 'Investments')
      : tr('Resumen', 'Overview');

  const profileLabel =
    activeProfile === 'all'
      ? tr('Todos (Hogar)', 'All (Household)')
      : getProfileLabel(activeProfile, state.profiles);

  const resolveActionOwner = (rawOwner?: string): ProfileId => {
    if (rawOwner && state.profiles.some((p) => p.id === rawOwner)) {
      return rawOwner;
    }
    if (rawOwner) {
      const byName = state.profiles.find(
        (p) => p.name.toLowerCase() === rawOwner.trim().toLowerCase()
      );
      if (byName) return byName.id;
    }
    if (activeProfile !== 'all' && state.profiles.some((p) => p.id === activeProfile)) {
      return activeProfile;
    }
    return state.profiles[0]?.id || '';
  };

  // The model can hallucinate ids/currencies: only accept values that exist in the app.
  const validCategory = (id: string | undefined, fallback: string) =>
    id && state.categories.some((c) => c.id === id) ? id : fallback;
  const validCurrency = (code: string | undefined, fallback: CurrencyCode): CurrencyCode =>
    code && code.toUpperCase() in CURRENCY_META ? (code.toUpperCase() as CurrencyCode) : fallback;
  const validTxType = (t: string | undefined): TransactionType | undefined =>
    t === 'income' || t === 'expense' || t === 'transfer' ? t : undefined;

  const handleApplyAction = (actionKey: string, action: AiProposedAction) => {
    if (appliedKeys[actionKey]) return;

    if (action.actionType === 'reclassify_tx' && action.txId) {
      const tx = state.transactions.find((t) => t.id === action.txId);
      if (!tx) return;
      onReclassifyBatch([
        {
          id: action.txId,
          categoryId: validCategory(action.categoryId, tx.categoryId),
          type: validTxType(action.txType) || tx.type,
          description: action.description?.trim() || tx.description,
        },
      ]);
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
      return;
    }

    if (
      action.actionType === 'upsert_budget' &&
      action.categoryId &&
      state.categories.some((c) => c.id === action.categoryId) &&
      Number(action.monthlyLimit) > 0
    ) {
      const resolvedOwner =
        action.owner === 'all'
          ? 'all'
          : action.owner && state.profiles.some((p) => p.id === action.owner)
          ? action.owner
          : activeProfile;
      onUpsertBudget({
        categoryId: action.categoryId,
        owner: resolvedOwner,
        monthlyLimit: Number(action.monthlyLimit),
        currency: validCurrency(action.currency, state.displayCurrency),
      });
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
      return;
    }

    if (action.actionType === 'add_fixed_expense' && action.amount) {
      const owner = resolveActionOwner(action.owner);
      const fallbackAccount =
        state.accounts.find((a) => a.id === action.accountId) ||
        state.accounts.find((a) => a.owner === owner) ||
        state.accounts[0];

      onAddFixedExpense({
        name: action.description || action.title,
        owner,
        amount: Math.abs(Number(action.amount)),
        currency: validCurrency(action.currency, fallbackAccount?.currency || state.displayCurrency),
        categoryId: validCategory(action.categoryId, 'cat_servicios'),
        accountId: fallbackAccount?.id || '',
        dueDay: Math.min(28, Math.max(1, Number(action.dueDay) || 5)),
      });
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
      return;
    }

    if (action.actionType === 'add_transaction' && action.amount) {
      const owner = resolveActionOwner(action.owner);
      const fallbackAccount =
        state.accounts.find((a) => a.id === action.accountId) ||
        state.accounts.find((a) => a.owner === owner) ||
        state.accounts[0];
      const txType: TransactionType =
        action.txType === 'income' || action.txType === 'transfer' ? action.txType : 'expense';

      onAddTransaction({
        owner,
        type: txType,
        date: action.date ? normalizeDateToISO(action.date) : getTodayISO(),
        amount: Math.abs(Number(action.amount)),
        currency: validCurrency(action.currency, fallbackAccount?.currency || state.displayCurrency),
        categoryId: validCategory(
          action.categoryId,
          txType === 'income' ? 'cat_otros_ingresos' : txType === 'transfer' ? 'cat_transfer' : 'cat_otros_gastos'
        ),
        accountId: fallbackAccount?.id || '',
        description: action.description || action.title,
        source: 'manual',
      });
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
      return;
    }

    if (action.actionType === 'create_account') {
      const owner = resolveActionOwner(action.owner);
      const validKinds: AccountKind[] = [
        'transaccional',
        'ahorro',
        'inversion',
        'tarjeta_credito',
        'efectivo',
        'otra',
      ];
      const kind: AccountKind = validKinds.includes(action.accountKind as AccountKind)
        ? (action.accountKind as AccountKind)
        : 'otra';

      onAddAccount({
        name: action.description || action.title || tr('Cuenta nueva', 'New account'),
        owner,
        kind,
        institution: action.institution?.trim() || undefined,
        currency: validCurrency(action.currency, state.displayCurrency),
        initialBalance: Number(action.amount) || 0,
        notes: action.notes || action.detail || undefined,
      });
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
      return;
    }

    if (action.actionType === 'delete_account') {
      // Only an exact id, or a name that matches exactly ONE account. Fuzzy matching could delete
      // another person's account (a bank name matched the first account of any profile).
      const needle = (action.description || '').trim().toLowerCase();
      const byName = needle ? state.accounts.filter((a) => a.name.trim().toLowerCase() === needle) : [];
      const targetAcc =
        state.accounts.find((a) => a.id === action.accountId) || (byName.length === 1 ? byName[0] : undefined);
      if (!targetAcc) {
        setError(
          tr(
            'No se encontró una única cuenta que coincida; elimínala manualmente desde Cuentas.',
            'Could not find a single matching account; delete it manually from Accounts.'
          )
        );
        return;
      }
      const ownerName = getProfileLabel(targetAcc.owner, state.profiles);
      const ok = window.confirm(
        tr(
          `¿Eliminar la cuenta "${targetAcc.name}" de ${ownerName}? Se borrarán también sus movimientos.`,
          `Delete account "${targetAcc.name}" (${ownerName})? Its transactions will also be removed.`
        )
      );
      if (!ok) return;
      onDeleteAccount(targetAcc.id);
      setAppliedKeys((prev) => ({ ...prev, [actionKey]: true }));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#031725]/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-drawer-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#062035] border-l border-[#D3E3FA] dark:border-[#123B66] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2
              id="ai-drawer-title"
              className="text-base font-bold text-[#031725] dark:text-[#DAEAFF] flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-[#499BED]" />
              {tr('Agente IA · Midas Tracker', 'AI Agent · Midas Tracker')}
            </h2>
            <p className="text-[11px] text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tabLabel} · {profileLabel} · {selectedMonth}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTurns([]);
                  setError('');
                }}
                className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
                title={tr('Limpiar conversación', 'Clear conversation')}
                aria-label={tr('Limpiar conversación', 'Clear conversation')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
              aria-label={tr('Cerrar agente IA', 'Close AI agent')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Direct Smart Tools Strip */}
        <div className="px-5 py-2.5 bg-[#EDF4FF] dark:bg-[#041E32] border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenImport();
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs font-medium rounded-lg hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B]"
          >
            <Upload className="w-3.5 h-3.5 text-[#499BED]" />
            {tr('Leer PDF / CSV / Foto con IA', 'Read PDF / CSV / Photo with AI')}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenReclassify();
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-xs font-medium rounded-lg hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B]"
          >
            <Wand2 className="w-3.5 h-3.5 text-[#499BED]" />
            {tr('Reclasificar historial (A posteriori)', 'Reclassify history (Post-import)')}
          </button>
        </div>

        {/* Conversation Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {turns.length === 0 ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#F5F9FF] dark:bg-[#041E32] border border-[#D3E3FA] dark:border-[#123B66] text-xs text-[#355170] dark:text-[#A1C6F6] space-y-1.5">
                <p className="font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr(
                    `Asistente financiero contextual (${state.profiles.map((p) => p.name).join(' · ')})`,
                    `Contextual financial agent (${state.profiles.map((p) => p.name).join(' · ')})`
                  )}
                </p>
                <p>
                  {tr(
                    'Analiza tus ingresos, gastos, presupuestos, cuentas, ahorro e inversiones del mes. También puede proponerte acciones aplicables en 1 clic.',
                    'Analyzes your income, expenses, budgets, accounts, savings and investments for the month, and proposes 1-click actions you can confirm.'
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A7694] dark:text-[#A1C6F6]">
                  {tr(`Sugerencias para ${tabLabel}`, `Suggested prompts for ${tabLabel}`)}
                </p>
                {quickPrompts.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void sendMessage(q)}
                    className="w-full text-left p-3 rounded-xl border border-[#D3E3FA] dark:border-[#123B66] bg-white dark:bg-[#041E32] hover:border-[#499BED] text-xs text-[#031725] dark:text-[#DAEAFF] transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] font-medium'
                      : 'bg-[#F5F9FF] dark:bg-[#041E32] border border-[#D3E3FA] dark:border-[#123B66] text-[#031725] dark:text-[#DAEAFF]'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{turn.text}</p>

                  {turn.highlights && turn.highlights.length > 0 && (
                    <ul className="mt-2.5 pt-2.5 border-t border-[#D3E3FA] dark:border-[#123B66] space-y-1 text-xs text-[#355170] dark:text-[#A1C6F6]">
                      {turn.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-[#499BED] font-bold">•</span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {turn.proposedActions && turn.proposedActions.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-[#D3E3FA] dark:border-[#123B66] space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#022E5B] dark:text-[#499BED]">
                        {tr('Acciones propuestas (1 clic)', 'Proposed actions (1-click)')}
                      </p>
                      {turn.proposedActions.map((act, idx) => {
                        const key = `${turn.id}_${idx}`;
                        const done = Boolean(appliedKeys[key]);
                        return (
                          <div
                            key={key}
                            className="p-2.5 rounded-lg bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[#031725] dark:text-[#DAEAFF]">
                                {act.title}
                              </div>
                              <div className="text-[11px] text-[#5A7694] dark:text-[#A1C6F6]">
                                {act.detail}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={done}
                              onClick={() => handleApplyAction(key, act)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold shrink-0 transition-colors ${
                                done
                                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] hover:bg-[#031725] dark:hover:bg-[#6EB1F5]'
                              }`}
                            >
                              {done && <Check className="w-3.5 h-3.5" />}
                              {done ? tr('Aplicado', 'Applied') : tr('Aplicar', 'Apply')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-[#499BED] font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              {tr('El agente de IA está analizando tus finanzas...', 'AI agent is analyzing your finances...')}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="p-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr(
              'Pregunta sobre gastos, presupuestos, ahorro o inversiones...',
              'Ask about expenses, budgets, savings, or investments...'
            )}
            className="flex-1 px-3.5 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] placeholder:text-[#7FA6D6] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="inline-flex items-center justify-center p-2.5 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-45 transition-colors"
            aria-label={tr('Enviar mensaje', 'Send message')}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
