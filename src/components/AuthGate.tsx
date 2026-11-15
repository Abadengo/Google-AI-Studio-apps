import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { CloudUpload, FileJson, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import { createInitialFinanceState } from '../data/defaultState';
import { normalizeState } from '../data/migrations';
import { CloudSync, importStateToCloud, loadCloudState } from '../firebase/cloudStore';
import { getDb, getFirebaseAuth, HOUSEHOLD_ID, signInWithGoogle, signOutUser } from '../firebase/client';
import { LOCAL_STORAGE_KEY, readLocalBrowserState } from '../hooks/useFinanceStore';
import { CURRENT_DATA_VERSION, type FinanceState } from '../types/finance';
import { downloadBlob, getTodayISO } from '../utils/formatters';

export interface CloudSession {
  user: User;
  initialState: FinanceState;
  sync: CloudSync;
  /** This browser still holds pre-cloud data that was NOT imported (e.g. the second device). */
  hasUnimportedLocalData: boolean;
}

const IMPORTED_FLAG_KEY = `${LOCAL_STORAGE_KEY}_cloud_imported_at`;

type Phase =
  | { kind: 'checking' }
  | { kind: 'signedOut'; error?: string }
  | { kind: 'loading'; user: User }
  | { kind: 'denied'; user: User }
  | { kind: 'needsImport'; user: User; resuming: boolean }
  | { kind: 'importing'; user: User; label: string }
  | { kind: 'tooNew'; user: User }
  | { kind: 'error'; user: User; message: string }
  | { kind: 'ready'; session: CloudSession };

function readImportedFlag(): boolean {
  try {
    return Boolean(window.localStorage.getItem(IMPORTED_FLAG_KEY));
  } catch {
    return false;
  }
}

function countSummary(state: FinanceState) {
  return {
    transactions: state.transactions.length,
    accounts: state.accounts.length,
    budgets: state.budgets.length,
    investments: state.investments.length,
    fixedExpenses: state.fixedExpenses.length,
    profiles: state.profiles.map((p) => p.name).join(', '),
  };
}

/**
 * Sign-in with Google + access check + first-time import of the browser data into Firestore.
 * Firestore security rules decide who can read/write; a "permission-denied" here means the
 * signed-in Google account is not one of the two allowed emails.
 */
export function AuthGate({ children }: { children: (session: CloudSession) => React.ReactNode }) {
  const { tr } = useUiPreferences();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const local = useRef(readLocalBrowserState());
  const [fileError, setFileError] = useState('');

  const openSession = useCallback(async (user: User) => {
    setPhase({ kind: 'loading', user });
    try {
      const db = getDb();
      const res = await loadCloudState(db, HOUSEHOLD_ID);
      if (!res.exists || res.importStatus === 'in_progress') {
        setPhase({ kind: 'needsImport', user, resuming: res.importStatus === 'in_progress' });
        return;
      }
      if ((res.storedVersion || 1) > CURRENT_DATA_VERSION) {
        setPhase({ kind: 'tooNew', user });
        return;
      }
      const state = res.state!;
      const sync = new CloudSync(db, HOUSEHOLD_ID, state, user.email || '');
      // Data stored by an older app version was migrated in memory: save the upgraded version.
      if ((res.storedVersion || 1) < CURRENT_DATA_VERSION) sync.push({ ...state });
      const leftover = local.current;
      setPhase({
        kind: 'ready',
        session: {
          user,
          initialState: state,
          sync,
          hasUnimportedLocalData: Boolean(leftover && !leftover.isSample && !readImportedFlag()),
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'permission-denied') setPhase({ kind: 'denied', user });
      else setPhase({ kind: 'error', user, message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (user) => {
      if (!user) setPhase({ kind: 'signedOut' });
      else void openSession(user);
    });
  }, [openSession]);

  // Test hook (only with the Firebase emulator): sign in without the Google popup.
  useEffect(() => {
    if (!import.meta.env.VITE_FIREBASE_EMULATOR_HOST) return;
    (window as unknown as Record<string, unknown>).__midasEmulatorSignIn = async (email: string) => {
      const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
      const cred = GoogleAuthProvider.credential(
        JSON.stringify({ sub: `uid-${email}`, email, email_verified: true, name: email.split('@')[0] })
      );
      await signInWithCredential(getFirebaseAuth(), cred);
    };
  }, []);

  const runImport = async (user: User, state: FinanceState, source: 'localStorage' | 'backup_file' | 'blank') => {
    setPhase({ kind: 'importing', user, label: tr('Subiendo tus datos a la nube…', 'Uploading your data to the cloud…') });
    try {
      await importStateToCloud(getDb(), HOUSEHOLD_ID, { ...state, isSampleData: false }, {
        userEmail: user.email || '',
        source,
      });
      if (source === 'localStorage') {
        try {
          // The local copy is kept untouched; this flag only silences the "unimported data" notice.
          window.localStorage.setItem(IMPORTED_FLAG_KEY, new Date().toISOString());
        } catch {
          /* ignore */
        }
      }
      await openSession(user);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'permission-denied') setPhase({ kind: 'denied', user });
      else
        setPhase({
          kind: 'error',
          user,
          message: `${tr('La importación no terminó', 'The import did not finish')}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
    }
  };

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F8FF] dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-sm p-6 space-y-4">
        <div className="text-lg font-bold text-[#022E5B] dark:text-[#DAEAFF]">Midas Tracker</div>
        {content}
      </div>
    </div>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={() => void signOutUser()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#355170] dark:text-[#A1C6F6] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg"
    >
      <LogOut className="w-3.5 h-3.5" />
      {tr('Cerrar sesión', 'Sign out')}
    </button>
  );

  const primaryBtn =
    'inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-60';
  const secondaryBtn =
    'inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#022E5B]/80 border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] text-sm font-medium rounded-lg cursor-pointer';

  switch (phase.kind) {
    case 'checking':
    case 'loading':
      return shell(<p className="text-sm text-[#355170] dark:text-[#A1C6F6]">{tr('Cargando…', 'Loading…')}</p>);

    case 'signedOut':
      return shell(
        <>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6]">
            {tr(
              'Inicia sesión con tu cuenta de Google para ver las finanzas del hogar desde cualquier dispositivo.',
              'Sign in with your Google account to see the household finances from any device.'
            )}
          </p>
          {phase.error && <p className="text-xs text-red-700 dark:text-red-300">{phase.error}</p>}
          <button
            type="button"
            className={primaryBtn}
            onClick={async () => {
              try {
                await signInWithGoogle();
              } catch (err) {
                const code = (err as { code?: string }).code;
                if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
                setPhase({
                  kind: 'signedOut',
                  error:
                    code === 'auth/unauthorized-domain'
                      ? tr(
                          'Este dominio no está autorizado en Firebase (Authentication → Settings → Authorized domains).',
                          'This domain is not authorized in Firebase (Authentication → Settings → Authorized domains).'
                        )
                      : err instanceof Error
                      ? err.message
                      : String(err),
                });
              }
            }}
          >
            <LogIn className="w-4 h-4" />
            {tr('Entrar con Google', 'Sign in with Google')}
          </button>
        </>
      );

    case 'denied':
      return shell(
        <>
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-semibold text-sm">
            <ShieldAlert className="w-4 h-4" />
            {tr('Esta cuenta no tiene acceso', 'This account has no access')}
          </div>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6]">
            {tr(
              `La cuenta ${phase.user.email} no está autorizada para ver estos datos. Entra con una de las dos cuentas permitidas.`,
              `The account ${phase.user.email} is not authorized to see this data. Sign in with one of the two allowed accounts.`
            )}
          </p>
          {signOutButton}
        </>
      );

    case 'tooNew':
      return shell(
        <>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6]">
            {tr(
              'Los datos de la nube fueron guardados por una versión más nueva de la app. Actualiza la app (recarga la página o despliega la última versión) antes de continuar, para no dañarlos.',
              'The cloud data was saved by a newer version of the app. Update the app (reload or deploy the latest version) before continuing, so it is not damaged.'
            )}
          </p>
          {signOutButton}
        </>
      );

    case 'error':
      return shell(
        <>
          <p className="text-sm text-red-700 dark:text-red-300">{phase.message}</p>
          <div className="flex gap-2">
            <button type="button" className={primaryBtn} onClick={() => void openSession(phase.user)}>
              {tr('Reintentar', 'Retry')}
            </button>
            {signOutButton}
          </div>
        </>
      );

    case 'importing':
      return shell(<p className="text-sm text-[#355170] dark:text-[#A1C6F6]">{phase.label}</p>);

    case 'needsImport': {
      const user = phase.user;
      const localData = local.current && !local.current.isSample ? local.current.state : null;
      const summary = localData ? countSummary(localData) : null;
      return shell(
        <>
          <p className="text-sm text-[#355170] dark:text-[#A1C6F6]">
            {phase.resuming
              ? tr(
                  'Una importación anterior no terminó. Vuelve a importar para completarla (no se duplica nada).',
                  'A previous import did not finish. Import again to complete it (nothing is duplicated).'
                )
              : tr(
                  'La nube todavía está vacía. Primero sube los datos que ya tienes; después ambos verán lo mismo desde cualquier dispositivo.',
                  'The cloud is still empty. First upload the data you already have; then both of you will see the same data from any device.'
                )}
          </p>

          {summary ? (
            <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-lg p-4 space-y-3 bg-[#F8FBFF] dark:bg-[#041E32]">
              <div className="text-sm font-semibold">
                {tr('Datos guardados en este navegador', 'Data saved in this browser')}
              </div>
              <ul className="text-xs text-[#355170] dark:text-[#A1C6F6] space-y-0.5 font-mono-num">
                <li>{tr('Perfiles', 'Profiles')}: {summary.profiles}</li>
                <li>{tr('Movimientos', 'Transactions')}: {summary.transactions}</li>
                <li>{tr('Cuentas', 'Accounts')}: {summary.accounts}</li>
                <li>{tr('Presupuestos', 'Budgets')}: {summary.budgets}</li>
                <li>{tr('Inversiones', 'Investments')}: {summary.investments}</li>
                <li>{tr('Gastos fijos', 'Fixed bills')}: {summary.fixedExpenses}</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} onClick={() => void runImport(user, localData!, 'localStorage')}>
                  <CloudUpload className="w-4 h-4" />
                  {tr('Importar estos datos a la nube', 'Import this data to the cloud')}
                </button>
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() =>
                    downloadBlob(
                      new Blob([JSON.stringify(localData, null, 2)], { type: 'application/json' }),
                      `midas_tracker_backup_antes_de_nube_${getTodayISO()}.json`
                    )
                  }
                >
                  <FileJson className="w-4 h-4" />
                  {tr('Descargar copia antes', 'Download a copy first')}
                </button>
              </div>
              <p className="text-[11px] text-[#5A7694] dark:text-[#7FA6D6]">
                {tr(
                  'Los datos de este navegador no se borran: quedan como copia de seguridad.',
                  'The data in this browser is not deleted: it stays as a backup.'
                )}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
              {tr(
                'Este navegador no tiene datos propios guardados. Si tus datos están en otro dispositivo, entra desde ese dispositivo primero, o importa un respaldo .json.',
                'This browser has no saved data of its own. If your data is on another device, sign in there first, or import a .json backup.'
              )}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className={secondaryBtn}>
              <FileJson className="w-4 h-4" />
              {tr('Importar desde un respaldo .json', 'Import from a .json backup')}
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const parsed = JSON.parse(await file.text());
                    if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
                      throw new Error('formato');
                    }
                    setFileError('');
                    await runImport(user, normalizeState(parsed), 'backup_file');
                  } catch {
                    setFileError(tr('El archivo no es un respaldo válido de Midas Tracker.', 'The file is not a valid Midas Tracker backup.'));
                  }
                }}
              />
            </label>
            {!summary && (
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => void runImport(user, createInitialFinanceState(false), 'blank')}
              >
                {tr('Empezar en blanco', 'Start blank')}
              </button>
            )}
            {signOutButton}
          </div>
          {fileError && <p className="text-xs text-red-700 dark:text-red-300">{fileError}</p>}
        </>
      );
    }

    case 'ready':
      return <>{children(phase.session)}</>;
  }
}
