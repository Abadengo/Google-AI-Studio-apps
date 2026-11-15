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
import { firebaseConfig, HOUSEHOLD_ID } from './config';

/*
 * Development / tests only: `VITE_FIREBASE_EMULATOR_HOST=127.0.0.1 npm run dev` connects to the local
 * Firebase emulators (with a demo project if config.ts is still empty). Never set in production builds.
 */
const emulatorHost = (import.meta.env.VITE_FIREBASE_EMULATOR_HOST as string | undefined) || '';
const activeConfig =
  firebaseConfig.apiKey && firebaseConfig.projectId
    ? firebaseConfig
    : emulatorHost
    ? { apiKey: 'demo-key', authDomain: 'demo-midas.firebaseapp.com', projectId: 'demo-midas', appId: 'demo' }
    : null;

export function isCloudConfigured(): boolean {
  return Boolean(activeConfig);
}

/** Both of you share this household document. */
export function getHouseholdId(): string {
  return HOUSEHOLD_ID;
}

export function getEmulatorHost(): string {
  return emulatorHost;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (!activeConfig || app) return;
  app = initializeApp(activeConfig);
  auth = getAuth(app);
  // Offline cache shared across tabs: the app keeps working without connection and syncs later.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
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
