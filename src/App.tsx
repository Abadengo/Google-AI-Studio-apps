import React, { useEffect, useState } from 'react';
import { Globe, HardDriveDownload, Moon, Plus, RotateCcw, Sparkles, Sun, Upload, Users, X } from 'lucide-react';
import { AccountsGoalSaverView } from './components/AccountsGoalSaverView';
import { AiAgentDrawer } from './components/AiAgentDrawer';
import { AiReclassifyModal } from './components/AiReclassifyModal';
import { BackupModal } from './components/BackupModal';
import { BudgetsView } from './components/BudgetsView';
import { CsvImportModal } from './components/CsvImportModal';
import { DashboardView } from './components/DashboardView';
import { MoomooInvestmentsView } from './components/MoomooInvestmentsView';
import { ProfilesModal } from './components/ProfilesModal';
import { ResetZeroModal } from './components/ResetZeroModal';
import { TransactionModal } from './components/TransactionModal';
import { TransactionsView } from './components/TransactionsView';
import { useUiPreferences } from './contexts/UiPreferencesContext';
import { useFinanceStore } from './hooks/useFinanceStore';
import type { ProfileFilter, Transaction } from './types/finance';
import { getCurrentMonthKey, type CsvPreset } from './utils/formatters';

type ActiveTab = 'dashboard' | 'transactions' | 'budgets' | 'accounts' | 'moomoo';

export default function App() {
  const {
    state,
    saveError,
    setDisplayCurrency,
    updateExchangeRates,
    addTransaction,
    updateTransaction,
    updateTransactionsBatch,
    deleteTransaction,
    importTransactionsBatch,
    addCategory,
    addAccount,
    updateAccount,
    deleteAccount,
    upsertBudget,
    deleteBudget,
    updateGoalSaver,
    addMoomooHolding,
    updateMoomooHolding,
    deleteMoomooHolding,
    importMoomooHoldingsBatch,
    toggleFixedExpensePaid,
    addFixedExpense,
    deleteFixedExpense,
    addProfile,
    updateProfile,
    deleteProfile,
    restoreFullState,
    clearToBlank,
    resetToZero,
    loadSampleData,
  } = useFinanceStore();

  const { theme, setTheme, lang, setLang, tr } = useUiPreferences();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [activeProfile, setActiveProfile] = useState<ProfileFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthKey());

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [importModalPreset, setImportModalPreset] = useState<CsvPreset>('auto');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string>('');
  const [isAiReclassifyOpen, setIsAiReclassifyOpen] = useState(false);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const [isResetZeroOpen, setIsResetZeroOpen] = useState(false);
  const [hideSampleNotice, setHideSampleNotice] = useState(false);

  useEffect(() => {
    if (
      activeProfile !== 'all' &&
      !state.profiles.some((p) => p.id === activeProfile)
    ) {
      setActiveProfile('all');
    }
  }, [activeProfile, state.profiles]);

  const handleOpenAi = (prompt?: string) => {
    setAiInitialPrompt(prompt || '');
    setIsAiDrawerOpen(true);
  };

  const handleOpenImport = (preset: CsvPreset = 'auto') => {
    setImportModalPreset(preset);
    setIsCsvModalOpen(true);
  };

  const handleOpenNewTransaction = () => {
    setEditingTransaction(null);
    setIsTxModalOpen(true);
  };

  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx);
    setIsTxModalOpen(true);
  };

  const handleSaveTransaction = (tx: Omit<Transaction, 'id'>, existingId?: string) => {
    if (existingId) {
      updateTransaction({ ...tx, id: existingId });
    } else {
      addTransaction(tx);
    }
  };

  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'dashboard', label: tr('Resumen', 'Overview') },
    { id: 'transactions', label: tr('Movimientos', 'Transactions') },
    { id: 'budgets', label: tr('Presupuestos', 'Budgets') },
    { id: 'accounts', label: tr('Cuentas Bancarias', 'Bank Accounts') },
    { id: 'moomoo', label: tr('Inversiones', 'Investments') },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F8FF] dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] transition-colors">
      {/* Top Bar Contract: 3 zones (Wordmark — Nav Links — 1 Primary Action) */}
      <header className="bg-white/95 dark:bg-[#062035]/95 backdrop-blur-sm border-b border-[#D3E3FA] dark:border-[#123B66] sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-lg font-bold tracking-tight text-[#022E5B] dark:text-[#DAEAFF] font-display whitespace-nowrap shrink-0 hover:text-[#499BED] transition-colors"
          >
            Midas Tracker
          </button>

          {/* Zone 2: Clean single-line navigation links */}
          <nav
            className="hidden md:flex items-center gap-6"
            aria-label={tr('Navegación principal', 'Main navigation')}
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-[#022E5B] dark:border-[#499BED] text-[#022E5B] dark:text-[#DAEAFF] font-semibold'
                      : 'border-transparent text-[#496685] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary CTA */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleOpenNewTransaction}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              {tr('Registrar', 'Add Entry')}
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <div className="md:hidden border-t border-[#E1EDFF] dark:border-[#123B66] px-3 py-2 flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] font-semibold'
                    : 'text-[#496685] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B]/60'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Workspace Toolbar: Profile Switcher + Theme + Language + Import & Backup */}
      <div className="bg-[#EDF4FF] dark:bg-[#041E32] border-b border-[#D3E3FA] dark:border-[#123B66]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-[#496685] dark:text-[#A1C6F6]">
              {tr('Perfil activo:', 'Active profile:')}
            </span>
            <div
              className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#DCE9FC] dark:bg-[#022E5B]/70 rounded-lg"
              role="group"
              aria-label={tr('Seleccionar perfil', 'Select profile')}
            >
              {[
                { id: 'all', label: tr('Todos (Hogar)', 'All (Household)') },
                ...state.profiles.map((p) => ({ id: p.id, label: p.name })),
              ].map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setActiveProfile(profile.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeProfile === profile.id
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-sm font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                  }`}
                >
                  {profile.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsProfilesModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] transition-colors whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5 text-[#499BED]" />
              {tr('Perfiles', 'Profiles')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Language switcher (ES / EN) */}
            <div
              className="inline-flex items-center gap-0.5 p-0.5 bg-[#DCE9FC] dark:bg-[#022E5B]/70 rounded-lg"
              role="group"
              aria-label={tr('Idioma de la interfaz', 'Interface language')}
            >
              <span className="pl-2 pr-1 text-[#355170] dark:text-[#A1C6F6]" aria-hidden="true">
                <Globe className="w-3.5 h-3.5" />
              </span>
              {(['es', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 uppercase ${
                    lang === code
                      ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-sm font-semibold'
                      : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            {/* Light / Dark Mode Switch */}
            <div
              className="inline-flex items-center gap-0.5 p-0.5 bg-[#DCE9FC] dark:bg-[#022E5B]/70 rounded-lg"
              role="group"
              aria-label={tr('Tema visual', 'Visual theme')}
            >
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  theme === 'light'
                    ? 'bg-white text-[#031725] shadow-sm font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
                aria-label={tr('Modo claro', 'Light mode')}
              >
                <Sun className="w-3.5 h-3.5" />
                {tr('Claro', 'Light')}
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  theme === 'dark'
                    ? 'bg-[#499BED] text-[#031725] shadow-sm font-semibold'
                    : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                }`}
                aria-label={tr('Modo oscuro', 'Dark mode')}
              >
                <Moon className="w-3.5 h-3.5" />
                {tr('Oscuro', 'Dark')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleOpenAi()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white dark:text-[#031725] bg-[#022E5B] dark:bg-[#499BED] rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {tr('Agente IA', 'AI Agent')}
            </button>

            <button
              type="button"
              onClick={() => handleOpenImport('auto')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-[#499BED]" />
              {tr('Importar PDF / CSV', 'Import PDF / CSV')}
            </button>

            <button
              type="button"
              onClick={() => setIsResetZeroOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-white dark:bg-[#022E5B]/80 border border-red-200 dark:border-red-800/70 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors whitespace-nowrap shrink-0"
              title={tr(
                'Volver a $0 saldos por cuenta, Moomoo y movimientos',
                'Reset account balances, Moomoo, and transactions to $0'
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {tr('Volver a $0', 'Reset to $0')}
            </button>

            <button
              type="button"
              onClick={() => setIsBackupModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] transition-colors whitespace-nowrap shrink-0"
            >
              <HardDriveDownload className="w-3.5 h-3.5 text-[#499BED]" />
              {tr('Respaldo y Moneda', 'Backup & Currency')} ({state.displayCurrency})
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {saveError && (
          <div
            role="alert"
            className="bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-xl px-5 py-3.5 text-xs sm:text-sm"
          >
            {tr(
              `No se pudieron guardar los últimos cambios en este navegador (${saveError}). Descarga un respaldo .json ahora para no perder datos.`,
              `Your latest changes could not be saved in this browser (${saveError}). Download a .json backup now to avoid losing data.`
            )}
          </div>
        )}
        {state.isSampleData && !hideSampleNotice && (
          <div className="bg-[#022E5B] dark:bg-[#062644] border border-[#022E5B] dark:border-[#499BED]/30 text-[#DAEAFF] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs sm:text-sm">
              {tr(
                `Estás viendo datos de ejemplo (${state.profiles
                  .map((p) => p.name)
                  .join(', ')}) para explorar los gráficos, GoalSaver y Moomoo. Cuando quieras cargar tus datos reales, limpia los ejemplos en 1 clic.`,
                `You are viewing sample data (${state.profiles
                  .map((p) => p.name)
                  .join(', ')}) to explore the charts, GoalSaver, and Moomoo. When you are ready for your real numbers, clear the samples in 1 click.`
              )}
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={clearToBlank}
                className="px-3 py-1.5 bg-[#DAEAFF] dark:bg-[#499BED] text-[#031725] text-xs font-semibold rounded-lg hover:bg-white dark:hover:bg-[#6EB1F5] whitespace-nowrap transition-colors"
              >
                {tr('Empezar con datos en blanco', 'Start with blank data')}
              </button>
              <button
                type="button"
                onClick={() => setHideSampleNotice(true)}
                className="p-1 text-[#A1C6F6] hover:text-white transition-colors"
                aria-label={tr('Ocultar aviso', 'Dismiss notice')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            state={state}
            activeProfile={activeProfile}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
            onOpenNewTransaction={handleOpenNewTransaction}
            onEditTransaction={handleEditTransaction}
            onNavigateTab={setActiveTab}
            onToggleFixedExpensePaid={toggleFixedExpensePaid}
            onAddFixedExpense={addFixedExpense}
            onDeleteFixedExpense={deleteFixedExpense}
            onAddAccount={addAccount}
            onDeleteAccount={deleteAccount}
            onOpenImport={() => handleOpenImport('auto')}
            onAskAi={handleOpenAi}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsView
            state={state}
            activeProfile={activeProfile}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
            onOpenNewTransaction={handleOpenNewTransaction}
            onEditTransaction={handleEditTransaction}
            onDeleteTransaction={deleteTransaction}
            onOpenCsvImport={() => handleOpenImport('auto')}
            onOpenAiReclassify={() => setIsAiReclassifyOpen(true)}
            onResetToZero={resetToZero}
          />
        )}

        {activeTab === 'budgets' && (
          <BudgetsView
            state={state}
            activeProfile={activeProfile}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
            onUpsertBudget={upsertBudget}
            onDeleteBudget={deleteBudget}
            onOpenImport={() => handleOpenImport('auto')}
            onAskAi={handleOpenAi}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsGoalSaverView
            state={state}
            activeProfile={activeProfile}
            onAddAccount={addAccount}
            onUpdateAccount={updateAccount}
            onDeleteAccount={deleteAccount}
            onUpdateGoalSaver={updateGoalSaver}
            onResetToZero={resetToZero}
            onOpenImport={(preset) => handleOpenImport(preset || 'commbank')}
            onAskAi={handleOpenAi}
          />
        )}

        {activeTab === 'moomoo' && (
          <MoomooInvestmentsView
            state={state}
            activeProfile={activeProfile}
            onAddHolding={addMoomooHolding}
            onUpdateHolding={updateMoomooHolding}
            onDeleteHolding={deleteMoomooHolding}
            onResetToZero={resetToZero}
            onOpenCsvImport={() => handleOpenImport('moomoo')}
            onAskAi={handleOpenAi}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#D3E3FA] dark:border-[#123B66] bg-white dark:bg-[#062035] mt-12">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#496685] dark:text-[#A1C6F6]">
          <span>
            {tr(
              'Midas Tracker · Datos guardados localmente en este navegador sin conexión bancaria.',
              'Midas Tracker · Data stored locally in this browser with no bank connection.'
            )}
          </span>
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="text-[#022E5B] dark:text-[#499BED] hover:underline font-medium underline-offset-4"
          >
            {tr('Descargar copia de seguridad (.json)', 'Download backup (.json)')}
          </button>
        </div>
      </footer>

      {/* Modals */}
      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => {
          setIsTxModalOpen(false);
          setEditingTransaction(null);
        }}
        onSave={handleSaveTransaction}
        accounts={state.accounts}
        profiles={state.profiles}
        categories={state.categories}
        activeProfile={activeProfile}
        editingTransaction={editingTransaction}
        onAddCategory={addCategory}
      />

      <CsvImportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        accounts={state.accounts}
        profiles={state.profiles}
        categories={state.categories}
        existingTransactions={state.transactions}
        activeProfile={activeProfile}
        initialPreset={importModalPreset}
        onImportTransactions={importTransactionsBatch}
        onImportMoomooTrades={importMoomooHoldingsBatch}
        onUpdateGoalSaver={updateGoalSaver}
        onAddAccount={addAccount}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        state={state}
        onRestoreState={restoreFullState}
        onClearToBlank={clearToBlank}
        onOpenResetZero={() => setIsResetZeroOpen(true)}
        onLoadSampleData={loadSampleData}
        onUpdateExchangeRates={updateExchangeRates}
        onSetDisplayCurrency={setDisplayCurrency}
      />

      <ResetZeroModal
        isOpen={isResetZeroOpen}
        onClose={() => setIsResetZeroOpen(false)}
        state={state}
        activeProfile={activeProfile}
        onResetToZero={resetToZero}
      />

      <ProfilesModal
        isOpen={isProfilesModalOpen}
        onClose={() => setIsProfilesModalOpen(false)}
        state={state}
        onAddProfile={addProfile}
        onUpdateProfile={updateProfile}
        onDeleteProfile={deleteProfile}
        onSelectActiveProfile={(id) => setActiveProfile(id)}
      />

      <AiReclassifyModal
        isOpen={isAiReclassifyOpen}
        onClose={() => setIsAiReclassifyOpen(false)}
        transactions={state.transactions}
        categories={state.categories}
        accounts={state.accounts}
        profiles={state.profiles}
        activeProfile={activeProfile}
        selectedMonth={selectedMonth}
        onApplyBatch={updateTransactionsBatch}
      />

      <AiAgentDrawer
        isOpen={isAiDrawerOpen}
        onClose={() => setIsAiDrawerOpen(false)}
        state={state}
        activeTab={activeTab}
        activeProfile={activeProfile}
        selectedMonth={selectedMonth}
        initialPrompt={aiInitialPrompt}
        onClearInitialPrompt={() => setAiInitialPrompt('')}
        onOpenImport={() => handleOpenImport('auto')}
        onOpenReclassify={() => setIsAiReclassifyOpen(true)}
        onReclassifyBatch={updateTransactionsBatch}
        onUpsertBudget={upsertBudget}
        onAddFixedExpense={addFixedExpense}
        onAddTransaction={addTransaction}
        onAddAccount={addAccount}
        onDeleteAccount={deleteAccount}
      />
    </div>
  );
}
