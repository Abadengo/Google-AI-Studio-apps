import React, { useEffect, useState } from 'react';
import { Camera, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  Category,
  CurrencyCode,
  ProfileFilter,
  ProfileId,
  Transaction,
  TransactionType,
  UserProfile,
} from '../types/finance';
import { CURRENCY_META, getProfileLabel, getTodayISO } from '../utils/formatters';
import { fileToBase64, parseQuickEntryWithAi } from '../utils/aiClient';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tx: Omit<Transaction, 'id'>, existingId?: string) => void;
  accounts: Account[];
  categories: Category[];
  profiles: UserProfile[];
  activeProfile: ProfileFilter;
  editingTransaction?: Transaction | null;
  onAddCategory: (cat: Omit<Category, 'id'>) => string;
}

export function TransactionModal({
  isOpen,
  onClose,
  onSave,
  accounts,
  categories,
  profiles,
  activeProfile,
  editingTransaction,
  onAddCategory,
}: TransactionModalProps) {
  const { tr, catName, lang } = useUiPreferences();
  const fallbackOwner: ProfileId = profiles[0]?.id || 'abdiel';
  const defaultOwner: ProfileId =
    activeProfile !== 'all' && profiles.some((p) => p.id === activeProfile)
      ? activeProfile
      : fallbackOwner;

  const [owner, setOwner] = useState<ProfileId>(defaultOwner);
  const [type, setType] = useState<TransactionType>('expense');
  const [date, setDate] = useState<string>(getTodayISO());
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<CurrencyCode>('AUD');
  const [accountId, setAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('cat_supermercado');
  const [description, setDescription] = useState<string>('');
  const [newCatName, setNewCatName] = useState<string>('');
  const [showNewCat, setShowNewCat] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiNote, setAiNote] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setAiNote('');
    setAiPrompt('');
    setAiLoading(false);
    setShowNewCat(false);
    setNewCatName('');

    if (editingTransaction) {
      setOwner(editingTransaction.owner);
      setType(editingTransaction.type);
      setDate(editingTransaction.date);
      setAmount(String(editingTransaction.amount));
      setCurrency(editingTransaction.currency);
      setAccountId(editingTransaction.accountId);
      setToAccountId(editingTransaction.toAccountId || '');
      setCategoryId(editingTransaction.categoryId);
      setDescription(editingTransaction.description);
    } else {
      const initialOwner: ProfileId =
        activeProfile !== 'all' && profiles.some((p) => p.id === activeProfile)
          ? activeProfile
          : profiles[0]?.id || 'abdiel';
      setOwner(initialOwner);
      setType('expense');
      setDate(getTodayISO());
      setAmount('');
      const ownerAccounts = accounts.filter((a) => a.owner === initialOwner);
      const preferredRevolut =
        ownerAccounts.find((a) => a.kind === 'revolut') || ownerAccounts[0] || accounts[0];
      setAccountId(preferredRevolut?.id || '');
      setCurrency(preferredRevolut?.currency || 'AUD');
      const goalSaver = ownerAccounts.find((a) => a.kind === 'goalsaver');
      setToAccountId(goalSaver?.id || '');
      setCategoryId('cat_supermercado');
      setDescription('');
    }
  }, [isOpen, editingTransaction, activeProfile, accounts, profiles]);

  if (!isOpen) return null;

  const ownerAccounts = accounts.filter((a) => a.owner === owner);
  const availableAccounts = ownerAccounts.length > 0 ? ownerAccounts : accounts;

  const handleOwnerChange = (nextOwner: ProfileId) => {
    setOwner(nextOwner);
    const nextOwnerAccs = accounts.filter((a) => a.owner === nextOwner);
    if (nextOwnerAccs.length > 0) {
      const preferred =
        type === 'income'
          ? nextOwnerAccs.find((a) => a.kind === 'commbank') || nextOwnerAccs[0]
          : nextOwnerAccs.find((a) => a.kind === 'revolut') || nextOwnerAccs[0];
      setAccountId(preferred.id);
      setCurrency(preferred.currency);
      const gs = nextOwnerAccs.find((a) => a.kind === 'goalsaver');
      if (gs) setToAccountId(gs.id);
    }
  };

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    if (nextType === 'income') {
      const comm = availableAccounts.find((a) => a.kind === 'commbank');
      if (comm) {
        setAccountId(comm.id);
        setCurrency(comm.currency);
      }
      setCategoryId('cat_sueldo');
    } else if (nextType === 'expense') {
      const rev = availableAccounts.find((a) => a.kind === 'revolut');
      if (rev) {
        setAccountId(rev.id);
        setCurrency(rev.currency);
      }
      setCategoryId('cat_supermercado');
    } else {
      const comm = availableAccounts.find((a) => a.kind === 'commbank');
      const gs = availableAccounts.find((a) => a.kind === 'goalsaver');
      if (comm) {
        setAccountId(comm.id);
        setCurrency(comm.currency);
      }
      if (gs) setToAccountId(gs.id);
      setCategoryId('cat_transfer');
    }
  };

  const handleAccountChange = (nextAccId: string) => {
    setAccountId(nextAccId);
    const acc = accounts.find((a) => a.id === nextAccId);
    if (acc) setCurrency(acc.currency);
  };

  const filteredCategories = categories.filter((c) => {
    if (type === 'transfer') return c.id === 'cat_transfer' || c.type === 'both';
    return c.type === type || c.type === 'both';
  });

  const handleCreateCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    const palette = ['#022E5B', '#499BED', '#059669', '#D97706', '#7C3AED', '#DB2777'];
    const color = palette[categories.length % palette.length];
    const newId = onAddCategory({
      name: trimmed,
      type: type === 'income' ? 'income' : 'expense',
      color,
    });
    setCategoryId(newId);
    setNewCatName('');
    setShowNewCat(false);
  };

  const applyAiQuickResult = (res: Awaited<ReturnType<typeof parseQuickEntryWithAi>>) => {
    if (res.owner && profiles.some((p) => p.id === res.owner)) {
      setOwner(res.owner);
    }
    if (res.type === 'income' || res.type === 'expense' || res.type === 'transfer') {
      setType(res.type);
    }
    if (res.date) setDate(res.date);
    if (typeof res.amount === 'number' && res.amount > 0) {
      setAmount(String(res.amount));
    }
    if (res.currency && res.currency in CURRENCY_META) {
      setCurrency(res.currency);
    }
    if (res.accountId && accounts.some((a) => a.id === res.accountId)) {
      setAccountId(res.accountId);
    }
    if (res.toAccountId && accounts.some((a) => a.id === res.toAccountId)) {
      setToAccountId(res.toAccountId);
    }
    if (res.categoryId && categories.some((c) => c.id === res.categoryId)) {
      setCategoryId(res.categoryId);
    }
    if (res.description) {
      setDescription(res.description);
    }
    if (res.reasoning) {
      setAiNote(res.reasoning);
    }
  };

  const handleAiQuickText = async () => {
    const trimmed = aiPrompt.trim();
    if (!trimmed) return;
    setAiLoading(true);
    setError('');
    setAiNote('');
    try {
      const res = await parseQuickEntryWithAi({
        promptText: trimmed,
        accounts,
        categories,
        profiles,
        activeProfile,
        lang,
      });
      applyAiQuickResult(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('No se pudo interpretar el texto con IA.', 'Could not parse text with AI.')
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiReceiptPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAiLoading(true);
    setError('');
    setAiNote('');
    try {
      const base64 = await fileToBase64(file);
      const res = await parseQuickEntryWithAi({
        promptText: aiPrompt.trim() || undefined,
        imageBase64: base64,
        imageMimeType: file.type || 'image/jpeg',
        accounts,
        categories,
        profiles,
        activeProfile,
        lang,
      });
      applyAiQuickResult(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('No se pudo leer el recibo con IA.', 'Could not read receipt with AI.')
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError(tr('Ingresa un monto mayor a 0.', 'Enter an amount greater than 0.'));
      return;
    }
    if (!accountId) {
      setError(tr('Selecciona una cuenta.', 'Please select an account.'));
      return;
    }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      setError(
        tr(
          'Elige una cuenta de destino diferente a la cuenta de origen.',
          'Choose a destination account different from the source account.'
        )
      );
      return;
    }

    onSave(
      {
        owner,
        type,
        date,
        amount: numericAmount,
        currency,
        categoryId: type === 'transfer' ? 'cat_transfer' : categoryId,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        description:
          description.trim() ||
          (type === 'income'
            ? tr('Ingreso', 'Income')
            : type === 'transfer'
            ? tr('Transferencia interna', 'Internal transfer')
            : tr('Gasto', 'Expense')),
        source: editingTransaction?.source || 'manual',
      },
      editingTransaction?.id
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-modal-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66]">
          <h2 id="tx-modal-title" className="text-lg font-semibold text-[#031725] dark:text-[#DAEAFF]">
            {editingTransaction
              ? tr('Editar movimiento', 'Edit transaction')
              : tr('Registrar movimiento', 'New transaction')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B] transition-colors"
            aria-label={tr('Cerrar ventana', 'Close dialog')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* AI Quick Entry */}
          {!editingTransaction && (
            <div className="p-3.5 rounded-xl bg-[#EDF4FF] dark:bg-[#041E32] border border-[#C6DAF7] dark:border-[#1B4A7C] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#022E5B] dark:text-[#DAEAFF]">
                  <Sparkles className="w-3.5 h-3.5 text-[#499BED]" />
                  {tr('Autocompletar con IA (texto o foto de recibo)', 'Auto-fill with AI (text or receipt photo)')}
                </span>
                <label className="inline-flex items-center gap-1 text-[11px] font-medium text-[#022E5B] dark:text-[#499BED] hover:underline cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  {tr('Subir recibo', 'Upload receipt')}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAiReceiptPhoto}
                    disabled={aiLoading}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAiQuickText();
                    }
                  }}
                  placeholder={tr(
                    'Ej. Ayer gasté 68.50 AUD en Coles con la Revolut de Lara',
                    'e.g. Yesterday spent 68.50 AUD at Coles on Lara Revolut'
                  )}
                  className="flex-1 px-3 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs text-[#031725] dark:text-[#DAEAFF] placeholder:text-[#7FA6D6] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
                />
                <button
                  type="button"
                  disabled={aiLoading || !aiPrompt.trim()}
                  onClick={() => void handleAiQuickText()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-xs font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-45 shrink-0"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {tr('Llenar', 'Fill')}
                </button>
              </div>
              {aiNote && (
                <p className="text-[11px] text-[#022E5B] dark:text-[#A1C6F6]">
                  {aiNote}
                </p>
              )}
            </div>
          )}

          {/* Tipo de movimiento */}
          <div>
            <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5">
              {tr('Tipo de movimiento', 'Transaction type')}
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg">
              {(
                [
                  { id: 'expense', label: tr('Gasto', 'Expense') },
                  { id: 'income', label: tr('Ingreso', 'Income') },
                  { id: 'transfer', label: tr('Transferencia', 'Transfer') },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTypeChange(item.id)}
                  className={`py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    type === item.id
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {type === 'transfer' && (
              <p className="mt-1.5 text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  'Mover dinero entre tus cuentas (ej. de CommBank a Revolut o GoalSaver) no se suma como gasto ni ingreso.',
                  'Moving money between your own accounts (e.g. CommBank to Revolut or GoalSaver) is excluded from income and expenses.'
                )}
              </p>
            )}
          </div>

          {/* Perfil + Fecha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5">
                {tr('Perfil', 'Profile')}
              </label>
              <div className="flex flex-wrap gap-1.5 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleOwnerChange(p.id)}
                    className={`flex-1 min-w-[72px] py-1.5 px-3 rounded-md text-sm font-medium transition-colors truncate ${
                      owner === p.id
                        ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="tx-date"
                className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
              >
                {tr('Fecha', 'Date')}
              </label>
              <input
                id="tx-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
              />
            </div>
          </div>

          {/* Monto + Moneda */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="tx-amount"
                className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
              >
                {tr('Monto', 'Amount')}
              </label>
              <input
                id="tx-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
              />
            </div>

            <div>
              <label
                htmlFor="tx-currency"
                className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
              >
                {tr('Moneda', 'Currency')}
              </label>
              <select
                id="tx-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] bg-white dark:bg-[#031725] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
              >
                {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
                  <option key={code} value={code}>
                    {code} ({CURRENCY_META[code].symbol})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cuenta(s) */}
          <div className={`grid grid-cols-1 ${type === 'transfer' ? 'sm:grid-cols-2' : ''} gap-4`}>
            <div>
              <label
                htmlFor="tx-account"
                className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
              >
                {type === 'income'
                  ? tr('Cuenta donde ingresó', 'Deposit account')
                  : type === 'transfer'
                  ? tr('Cuenta de origen (sale)', 'Source account (from)')
                  : tr('Cuenta de donde salió', 'Payment account')}
              </label>
              <select
                id="tx-account"
                value={accountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] bg-white dark:bg-[#031725] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {getProfileLabel(acc.owner, profiles)} · {acc.name} ({acc.currency})
                  </option>
                ))}
              </select>
            </div>

            {type === 'transfer' && (
              <div>
                <label
                  htmlFor="tx-to-account"
                  className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
                >
                  {tr('Cuenta destino (entra)', 'Destination account (to)')}
                </label>
                <select
                  id="tx-to-account"
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] bg-white dark:bg-[#031725] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {getProfileLabel(acc.owner, profiles)} · {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Categoría */}
          {type !== 'transfer' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="tx-category"
                  className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]"
                >
                  {tr('Categoría', 'Category')}
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewCat((v) => !v)}
                  className="text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline"
                >
                  {showNewCat ? tr('Cancelar', 'Cancel') : tr('+ Nueva categoría', '+ New category')}
                </button>
              </div>

              {showNewCat ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={tr('Nombre de nueva categoría...', 'New category name...')}
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    className="px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
                  >
                    {tr('Crear', 'Create')}
                  </button>
                </div>
              ) : (
                <select
                  id="tx-category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] bg-white dark:bg-[#031725] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
                >
                  {filteredCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {catName(cat)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Descripción */}
          <div>
            <label
              htmlFor="tx-desc"
              className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5"
            >
              {tr('Descripción o nota', 'Description or note')}
            </label>
            <input
              id="tx-desc"
              type="text"
              placeholder={
                type === 'income'
                  ? tr('Ej. Sueldo quincenal, Dividendos VOO...', 'e.g. Fortnightly salary, VOO dividends...')
                  : tr('Ej. Compra semanal Woolworths, Café...', 'e.g. Woolworths groceries, Coffee...')
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
            />
          </div>

          {error && (
            <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#D3E3FA] dark:border-[#123B66]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[#355170] dark:text-[#A1C6F6] hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B] rounded-lg transition-colors"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold text-white dark:text-[#031725] bg-[#022E5B] dark:bg-[#499BED] hover:bg-[#031725] dark:hover:bg-[#6EB1F5] rounded-lg transition-colors"
            >
              {editingTransaction
                ? tr('Guardar cambios', 'Save changes')
                : tr('Guardar movimiento', 'Save transaction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
