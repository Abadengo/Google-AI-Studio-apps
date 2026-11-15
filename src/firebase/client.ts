import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

/**
 * Firebase web config comes from the server at runtime (GET /api/config, built from the FIREBASE_*
 * environment variables), so the same build works locally and when published from AI Studio / Cloud Run.
 * Without that config the app keeps the "this browser only" mode (localStorage).
 */
interface RuntimeConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
  } | null;
  householdId: string;
  emulatorHost: string;
}

let runtimeConfig: RuntimeConfig = { firebase: null, householdId: 'hogar', emulatorHost: '' };

/** Must be awaited once before rendering (see main.tsx). Never throws: falls back to local mode. */
export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<RuntimeConfig>;
    runtimeConfig = {
      firebase: data.firebase && data.firebase.apiKey && data.firebase.projectId ? data.firebase : null,
      householdId: data.householdId || 'hogar',
      emulatorHost: data.emulatorHost || '',
    };
  } catch {
    /* server unreachable: local mode */
  }
}

export function isCloudConfigured(): boolean {
  return Boolean(runtimeConfig.firebase);
}

/** Both of you share this household document. */
export function getHouseholdId(): string {
  return runtimeConfig.householdId;
}

/** Set only when the server runs against the local Firebase emulators (tests / development). */
export function getEmulatorHost(): string {
  return runtimeConfig.emulatorHost;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (!runtimeConfig.firebase || app) return;
  app = initializeApp(runtimeConfig.firebase);
  auth = getAuth(app);
  // Offline cache shared across tabs: the app keeps working without connection and syncs later.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const emulatorHost = runtimeConfig.emulatorHost;
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
  }
}

export function getFirebaseAuth(): Auth {
  init();
  if (!auth) throw new Error('Firebase no está configurado');
  return auth;
}

export function getDb(): Firestore {
  init();
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(getFirebaseAuth(), provider);
}

export async function signOutUser() {
  if (!isCloudConfigured()) return;
  await signOut(getFirebaseAuth());
}

/** Fresh ID token of the signed-in user (used to authorise /api/ai/* calls). */
export async function getIdToken(forceRefresh = false): Promise<string> {
  if (!isCloudConfigured()) return '';
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken(forceRefresh) : '';
}
