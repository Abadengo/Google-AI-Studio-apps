import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import { checkAiAuth, storeAppPassword } from '../utils/aiClient';

interface AppPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

/**
 * Asks once for the APP_PASSWORD configured on the server. It is stored in this browser
 * (localStorage) and sent in the X-App-Password header of every /api/ai/* request.
 */
export function AppPasswordModal({ isOpen, onClose, onAuthenticated }: AppPasswordModalProps) {
  const { tr } = useUiPreferences();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setChecking(true);
    setError('');
    try {
      const res = await checkAiAuth(password);
      if (res.valid) {
        storeAppPassword(password);
        setPassword('');
        onAuthenticated();
      } else {
        setError(tr('Contraseña incorrecta.', 'Wrong password.'));
      }
    } catch {
      setError(tr('No se pudo contactar al servidor.', 'Could not reach the server.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-password-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#499BED]" />
            <h2 id="app-password-title" className="text-base font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr('Contraseña de la app', 'App password')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#5A7694] hover:text-[#031725] dark:text-[#A1C6F6] dark:hover:text-white"
            aria-label={tr('Cerrar', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-[#355170] dark:text-[#A1C6F6]">
          {tr(
            'Las funciones de IA están protegidas. Escribe la contraseña configurada en el servidor (APP_PASSWORD). Se guardará en este navegador y no se volverá a pedir.',
            'AI features are protected. Enter the password configured on the server (APP_PASSWORD). It is saved in this browser and won’t be asked again.'
          )}
        </p>
        <input
          id="app-password-input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
          aria-label={tr('Contraseña', 'Password')}
        />
        {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-[#355170] dark:text-[#A1C6F6]"
          >
            {tr('Ahora no', 'Not now')}
          </button>
          <button
            type="submit"
            disabled={checking || !password}
            className="px-4 py-1.5 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-xs font-semibold rounded-lg disabled:opacity-60"
          >
            {checking ? tr('Verificando…', 'Checking…') : tr('Guardar', 'Save')}
          </button>
        </div>
      </form>
    </div>
  );
}
