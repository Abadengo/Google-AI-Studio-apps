import React, { useState } from 'react';
import { Check, Download, Globe, Moon, RotateCcw, Sun, Trash2, Upload, X } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { CurrencyCode, ExchangeRates, FinanceState } from '../types/finance';
import { CURRENCY_META, getProfileLabel, getTodayISO } from '../utils/formatters';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FinanceState;
  onRestoreState: (jsonText: string) => { ok: boolean; error?: string };
  onClearToBlank: () => void;
  onOpenResetZero?: () => void;
  onLoadSampleData: () => void;
  onUpdateExchangeRates: (rates: ExchangeRates) => void;
  onSetDisplayCurrency: (currency: CurrencyCode) => void;
}

export function BackupModal({
  isOpen,
  onClose,
  state,
  onRestoreState,
  onClearToBlank,
  onOpenResetZero,
  onLoadSampleData,
  onUpdateExchangeRates,
  onSetDisplayCurrency,
}: BackupModalProps) {
  const { theme, setTheme, lang, setLang, tr, catName } = useUiPreferences();
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!isOpen) return null;

  const handleDownloadJsonBackup = () => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `midas_tracker_backup_${getTodayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg({
      type: 'ok',
      text: tr(
        'Respaldo descargado. Guárdalo en Google Drive, iCloud o una carpeta segura.',
        'Backup downloaded. Keep it in Google Drive, iCloud, or a safe folder.'
      ),
    });
  };

  const handleExportCsv = () => {
    const header = [
      tr('Fecha', 'Date'),
      tr('Perfil', 'Profile'),
      tr('Tipo', 'Type'),
      tr('Monto', 'Amount'),
      tr('Moneda', 'Currency'),
      tr('Categoria', 'Category'),
      tr('Cuenta', 'Account'),
      tr('Descripcion', 'Description'),
    ];
    const rows = state.transactions.map((t) => {
      const cat = state.categories.find((c) => c.id === t.categoryId);
      const catLabel = catName(cat, t.categoryId);
      const acc = state.accounts.find((a) => a.id === t.accountId)?.name || t.accountId;
      const safeDesc = `"${t.description.replace(/"/g, '""')}"`;
      return [
        t.date,
        getProfileLabel(t.owner, state.profiles),
        t.type === 'income'
          ? tr('Ingreso', 'Income')
          : t.type === 'expense'
          ? tr('Gasto', 'Expense')
          : tr('Transferencia', 'Transfer'),
        t.amount.toFixed(2),
        t.currency,
        `"${catLabel}"`,
        `"${acc}"`,
        safeDesc,
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `midas_tracker_transactions_${getTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg({
      type: 'ok',
      text: tr(
        'Movimientos exportados a CSV para Excel o Google Sheets.',
        'Transactions exported to CSV for Excel or Google Sheets.'
      ),
    });
  };

  const handleUploadRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = onRestoreState(String(reader.result || ''));
      if (result.ok) {
        setStatusMsg({
          type: 'ok',
          text: tr('¡Respaldo restaurado correctamente!', 'Backup restored successfully!'),
        });
      } else {
        setStatusMsg({
          type: 'err',
          text: result.error || tr('Error al restaurar respaldo.', 'Error restoring backup.'),
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-modal-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66]">
          <div>
            <h2 id="backup-modal-title" className="text-lg font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('Respaldo, Apariencia e Idioma', 'Backup, Appearance & Language')}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tr(
                'Tus datos viven en este navegador. Personaliza la interfaz y haz copias periódicas.',
                'Your data lives locally in this browser. Customize the interface and export regular backups.'
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

        <div className="p-6 overflow-y-auto space-y-6">
          {statusMsg && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium border ${
                statusMsg.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/35 border-red-200 dark:border-red-800/70 text-red-800 dark:text-red-200'
              }`}
            >
              <Check className="w-4 h-4 shrink-0" />
              {statusMsg.text}
            </div>
          )}

          {/* Sección 1: Apariencia e Idioma */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('1. Apariencia e Idioma de la interfaz', '1. Interface Theme & Language')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                  {tr('Modo visual', 'Color mode')}
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md font-medium transition-colors ${
                      theme === 'light'
                        ? 'bg-white text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    {tr('Modo claro', 'Light mode')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md font-medium transition-colors ${
                      theme === 'dark'
                        ? 'bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    {tr('Modo oscuro', 'Dark mode')}
                  </button>
                </div>
              </div>

              <div className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  {tr('Idioma de lectura', 'Interface language')}
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#EAF2FF] dark:bg-[#022E5B]/60 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setLang('es')}
                    className={`py-2 px-3 rounded-md font-medium transition-colors ${
                      lang === 'es'
                        ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    Español (ES)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('en')}
                    className={`py-2 px-3 rounded-md font-medium transition-colors ${
                      lang === 'en'
                        ? 'bg-white dark:bg-[#499BED] text-[#031725] shadow-xs font-semibold'
                        : 'text-[#355170] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF]'
                    }`}
                  >
                    English (EN)
                  </button>
                </div>
              </div>
            </div>
          </section>

          <hr className="border-[#D3E3FA] dark:border-[#123B66]" />

          {/* Sección 2: Respaldo y Restauración */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('2. Copia de seguridad (Respaldo en archivo)', '2. Data Backup & Restore')}
            </h3>
            <p className="text-xs text-[#355170] dark:text-[#A1C6F6] leading-relaxed">
              {tr(
                'Si limpias el historial del navegador o cambias de computadora, puedes restaurar todo tu historial, presupuestos, GoalSaver y Moomoo cargando tu último archivo de respaldo .json.',
                'If you clear browser storage or switch devices, restore your full history, budgets, GoalSaver, and Moomoo holdings from your latest .json backup file.'
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadJsonBackup}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] transition-colors"
              >
                <Download className="w-4 h-4" />
                {tr('Descargar respaldo completo (.json)', 'Download full backup (.json)')}
              </button>

              <label className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                {tr('Restaurar desde archivo (.json)', 'Restore from file (.json)')}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleUploadRestore}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] transition-colors"
              >
                <Download className="w-4 h-4" />
                {tr('Exportar tabla a Excel (.csv)', 'Export table to Excel (.csv)')}
              </button>
            </div>
          </section>

          <hr className="border-[#D3E3FA] dark:border-[#123B66]" />

          {/* Sección 3: Moneda principal y tipos de cambio */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr('3. Moneda principal y tipos de cambio', '3. Display Currency & Exchange Rates')}
                </h3>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                  {tr(
                    'Para sumar tus cuentas en AUD (CommBank/Revolut) y USD (Moomoo/Wise) en un solo resumen.',
                    'Combine AUD (CommBank/Revolut) and USD (Moomoo/Wise) accounts in one consolidated summary.'
                  )}
                </p>
              </div>
              <select
                value={state.displayCurrency}
                onChange={(e) => onSetDisplayCurrency(e.target.value as CurrencyCode)}
                className="px-3 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-medium bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
              >
                {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((code) => (
                  <option key={code} value={code}>
                    {tr('Mostrar en', 'Show in')} {code}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(['USD', 'EUR', 'MXN', 'ARS', 'CLP'] as CurrencyCode[]).map((code) => (
                <div
                  key={code}
                  className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-lg p-2.5"
                >
                  <label className="block text-xs font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr(`1 ${code} equivale en AUD:`, `1 ${code} equals in AUD:`)}
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={state.exchangeRates[code]}
                    onChange={(e) =>
                      onUpdateExchangeRates({
                        ...state.exchangeRates,
                        [code]: Math.max(0.0001, Number(e.target.value) || 0.0001),
                      })
                    }
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>
              ))}
            </div>
          </section>

          <hr className="border-[#D3E3FA] dark:border-[#123B66]" />

          {/* Sección 4: Datos de ejemplo vs Empezar de cero */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('4. Reiniciar o empezar con datos en blanco', '4. Reset or Start Fresh')}
            </h3>
            <p className="text-xs text-[#355170] dark:text-[#A1C6F6]">
              {state.isSampleData
                ? tr(
                    `Actualmente estás viendo datos de ejemplo (${state.profiles
                      .map((p) => p.name)
                      .join(' y ')}). Cuando estés listo para usar tus números reales, presiona "Empezar de cero" (tus cuentas y perfiles configurados se mantienen).`,
                    `You are currently viewing sample data (${state.profiles
                      .map((p) => p.name)
                      .join(' & ')}). When ready for your real numbers, click "Start fresh" (your configured accounts and profiles are kept).`
                  )
                : tr(
                    'Puedes limpiar todos tus movimientos o volver a cargar los datos de ejemplo si deseas hacer pruebas.',
                    'You can clear all transactions or reload sample data for testing.'
                  )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 bg-red-50/70 dark:bg-red-950/35 hover:bg-red-100 dark:hover:bg-red-950/60 text-sm font-medium rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  {tr('Empezar de cero (limpiar movimientos)', 'Start fresh (clear transactions)')}
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 rounded-lg">
                  <span className="text-xs font-medium text-red-800 dark:text-red-200">
                    {tr(
                      '¿Seguro? Se borrarán los movimientos e inversiones actuales.',
                      'Are you sure? Current transactions and holdings will be cleared.'
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearToBlank();
                      setConfirmClear(false);
                      setStatusMsg({
                        type: 'ok',
                        text: tr(
                          'Movimientos limpiados. Ya puedes registrar tus datos reales o importar tus archivos.',
                          'Transactions cleared. You can now log real data or import your statements.'
                        ),
                      });
                    }}
                    className="px-3 py-1.5 bg-red-700 text-white text-xs font-medium rounded-md hover:bg-red-800"
                  >
                    {tr('Sí, limpiar todo', 'Yes, clear all')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#031725] dark:text-[#DAEAFF] text-xs font-medium rounded-md"
                  >
                    {tr('Cancelar', 'Cancel')}
                  </button>
                </div>
              )}

              {onOpenResetZero && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenResetZero();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 bg-white dark:bg-[#062035] hover:bg-red-50 dark:hover:bg-red-950/50 text-sm font-medium rounded-lg transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  {tr(
                    'Volver saldos (Cuentas, Moomoo, Movimientos) a $0',
                    'Reset balances (Accounts, Moomoo, Transactions) to $0'
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  onLoadSampleData();
                  setConfirmClear(false);
                  setStatusMsg({
                    type: 'ok',
                    text: tr('Datos de ejemplo recargados.', 'Sample data reloaded.'),
                  });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] bg-white dark:bg-[#022E5B]/80 hover:bg-[#DAEAFF]/50 dark:hover:bg-[#022E5B] text-sm font-medium rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {tr('Cargar datos de ejemplo', 'Load sample data')}
              </button>
            </div>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#EAF2FF]/50 dark:bg-[#041E32] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
          >
            {tr('Listo', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
}
