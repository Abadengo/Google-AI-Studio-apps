// Security-rules test against the Firebase emulators.
// Run: npm run test:rules   (starts Auth + Firestore emulators, runs this file, stops them)
// Uses the first two emails of ALLOWED_EMAILS as allowed accounts and an extra one as intruder.
import 'dotenv/config';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, terminate } from 'firebase/firestore';

const allowed = (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
if (allowed.length === 0) throw new Error('Define ALLOWED_EMAILS para probar las reglas');
const intruder = 'intruso@example.com';
const projectId = 'demo-midas';

let failures = 0;
const check = async (label, fn, shouldSucceed) => {
  try {
    await fn();
    if (shouldSucceed) console.log('OK  ', label);
    else {
      failures++;
      console.log('FAIL', label, '→ se permitió y debía rechazarse');
    }
  } catch (err) {
    const denied = err?.code === 'permission-denied';
    if (!shouldSucceed && denied) console.log('OK  ', label, '(rechazado)');
    else {
      failures++;
      console.log('FAIL', label, '→', err?.code || err?.message);
    }
  }
};

const clearAuthAccounts = () =>
  fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });

async function session(email, { verified = true } = {}) {
  const app = initializeApp({ apiKey: 'demo', projectId, authDomain: `${projectId}.firebaseapp.com` }, `app-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (email && !verified) {
    // Email/password accounts start with email_verified = false.
    await createUserWithEmailAndPassword(auth, email, 'clave-de-prueba-123');
  } else if (email) {
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: `uid-${email}`, email, email_verified: verified }))
    );
  }
  return { app, auth, db, close: async () => { await signOut(auth); await terminate(db); await deleteApp(app); } };
}

const household = (db) => doc(db, 'households', 'hogar');
const tx = (db, id = 'tx_test_1') => doc(db, 'households', 'hogar', 'transactions', id);
const goodTx = { date: '2026-11-01', amount: 12.5, type: 'expense', currency: 'AUD', description: 'test', categoryId: 'c', accountId: 'a', owner: 'p' };

await clearAuthAccounts();
const u = await session(allowed[0], { verified: false });
await check('correo permitido SIN verificar lee hogar', () => getDoc(household(u.db)), false);
await u.close();
await clearAuthAccounts();

const a = await session(allowed[0]);
await check(`permitido (${allowed[0]}) escribe hogar`, () => setDoc(household(a.db), { version: 2 }), true);
await check(`permitido (${allowed[0]}) escribe movimiento`, () => setDoc(tx(a.db), goodTx), true);
await check('movimiento inválido (monto texto)', () => setDoc(tx(a.db, 'bad'), { ...goodTx, amount: '12' }), false);
await check('colección fuera de households', () => setDoc(doc(a.db, 'otros', 'x'), { a: 1 }), false);
await a.close();

if (allowed[1]) {
  const b = await session(allowed[1].toUpperCase()); // case-insensitive
  await check(`permitido (${allowed[1]}, en mayúsculas) lee hogar`, () => getDoc(household(b.db)).then((s) => { if (!s.exists()) throw new Error('no existe'); }), true);
  await check(`permitido (${allowed[1]}) lee movimiento`, () => getDoc(tx(b.db)), true);
  await b.close();
}

const x = await session(intruder);
await check(`intruso (${intruder}) lee hogar`, () => getDoc(household(x.db)), false);
await check(`intruso lee movimiento`, () => getDoc(tx(x.db)), false);
await check(`intruso escribe hogar`, () => setDoc(household(x.db), { hacked: true }), false);
await check(`intruso borra movimiento`, () => deleteDoc(tx(x.db)), false);
await x.close();



const anon = await session(null);
await check('sin sesión lee hogar', () => getDoc(household(anon.db)), false);
await check('sin sesión escribe movimiento', () => setDoc(tx(anon.db, 'anon'), goodTx), false);
await anon.close();

console.log(failures === 0 ? '\nTodas las pruebas de reglas pasaron.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
