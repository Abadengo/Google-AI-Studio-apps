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
 * Firebase is configured with VITE_FIREBASE_* variables (public web config, see .env.example).
 * Without them the app keeps working in the old "this browser only" mode (localStorage).
 */
const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || undefined,
  messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || undefined,
};

/** Both of you share this household document. */
export const HOUSEHOLD_ID = (env.VITE_FIREBASE_HOUSEHOLD_ID as string | undefined) || 'hogar';

/** Set VITE_FIREBASE_EMULATOR_HOST=127.0.0.1 to use the local Firebase emulators (tests / development). */
const emulatorHost = (env.VITE_FIREBASE_EMULATOR_HOST as string | undefined) || '';

export const isCloudConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (!isCloudConfigured || app) return;
  app = initializeApp(firebaseConfig);
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
  if (!isCloudConfigured) return;
  await signOut(getFirebaseAuth());
}

/** Fresh ID token of the signed-in user (used to authorise /api/ai/* calls). */
export async function getIdToken(forceRefresh = false): Promise<string> {
  if (!isCloudConfigured) return '';
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken(forceRefresh) : '';
}
