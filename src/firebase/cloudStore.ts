import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { normalizeState } from '../data/migrations';
import { CURRENT_DATA_VERSION, type FinanceState, type Transaction } from '../types/finance';

/*
 * FIRESTORE LAYOUT
 *   households/{householdId}                     → every FinanceState field except transactions (+ import metadata)
 *   households/{householdId}/transactions/{txId} → one document per transaction
 * Transactions live in their own collection so the household never hits Firestore's 1 MB document limit.
 */

export const META_FIELDS = [
  'version',
  'displayCurrency',
  'exchangeRates',
  'exchangeRatesUpdatedAt',
  'profiles',
  'accounts',
  'categories',
  'budgets',
  'savingsConfigs',
  'investments',
  'fixedExpenses',
  'fixedExpensePaidByMonth',
  'lastBackupAt',
  'isSampleData',
] as const satisfies ReadonlyArray<Exclude<keyof FinanceState, 'transactions'>>;

type MetaField = (typeof META_FIELDS)[number];

/** Firestore accepts at most 500 writes per batch. */
const BATCH_LIMIT = 450;

export type ImportStatus = 'in_progress' | 'done';

export interface CloudLoadResult {
  exists: boolean;
  importStatus?: ImportStatus;
  /** Data version stored in the cloud (may be newer than this app). */
  storedVersion?: number;
  state?: FinanceState;
}

const householdRef = (db: Firestore, householdId: string) => doc(db, 'households', householdId);
const txCollection = (db: Firestore, householdId: string) => collection(db, 'households', householdId, 'transactions');

/** Firestore rejects `undefined`; JSON round-trip drops those keys (all our data is JSON-safe). */
function clean<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Key-order-independent JSON so values coming back from Firestore compare equal to local ones. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            if (v[key] !== undefined) acc[key] = v[key];
            return acc;
          }, {})
      : v
  ) ?? 'undefined';
}

function isValidDocId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..';
}

function stateFromDocs(meta: DocumentData, txDocs: Array<{ id: string; data: DocumentData }>): FinanceState {
  const raw: Record<string, unknown> = {};
  for (const f of META_FIELDS) if (meta[f] !== undefined) raw[f] = meta[f];
  raw.transactions = txDocs.map((d) => ({ ...d.data, id: d.id }));
  // Runs data migrations too, so a household written by an older version is upgraded on load.
  return normalizeState(raw);
}

/** Reads the whole household (server first, falling back to the offline cache). */
export async function loadCloudState(db: Firestore, householdId: string): Promise<CloudLoadResult> {
  let metaSnap;
  try {
    metaSnap = await getDocFromServer(householdRef(db, householdId));
  } catch (err) {
    if ((err as { code?: string }).code === 'permission-denied') throw err;
    metaSnap = await getDoc(householdRef(db, householdId)); // offline: use the local cache
  }
  if (!metaSnap.exists()) return { exists: false };
  const meta = metaSnap.data();
  const importStatus = meta.importStatus as ImportStatus | undefined;
  const storedVersion = Number(meta.version) || 1;
  if (importStatus === 'in_progress') return { exists: true, importStatus, storedVersion };

  let txSnap;
  try {
    txSnap = await getDocsFromServer(txCollection(db, householdId));
  } catch (err) {
    if ((err as { code?: string }).code === 'permission-denied') throw err;
    txSnap = await getDocs(txCollection(db, householdId));
  }
  return {
    exists: true,
    importStatus,
    storedVersion,
    state: stateFromDocs(
      meta,
      txSnap.docs.map((d) => ({ id: d.id, data: d.data() }))
    ),
  };
}

async function commitInChunks(db: Firestore, ops: Array<(b: WriteBatch) => void>) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

/**
 * Writes a complete state to an EMPTY (or half-imported) household and verifies it by reading it back.
 * The household is marked 'in_progress' first and 'done' only after every transaction was written and
 * counted, so an interrupted import is never mistaken for a finished one.
 */
export async function importStateToCloud(
  db: Firestore,
  householdId: string,
  state: FinanceState,
  info: { userEmail: string; source: 'localStorage' | 'backup_file' | 'blank' }
): Promise<{ transactions: number; accounts: number }> {
  const hRef = householdRef(db, householdId);
  const validTx = state.transactions.filter((t) => isValidDocId(t.id));
  if (validTx.length !== state.transactions.length) {
    throw new Error('Hay movimientos con un identificador inválido; no se importó nada.');
  }

  // 1. Mark as in progress (so a crash mid-way can be resumed safely).
  const metaFields: Record<string, unknown> = {};
  for (const f of META_FIELDS) metaFields[f] = clean(state[f]) ?? null;
  const batch0 = writeBatch(db);
  batch0.set(hRef, {
    ...metaFields,
    version: CURRENT_DATA_VERSION,
    importStatus: 'in_progress',
    importSource: info.source,
    importedBy: info.userEmail,
    importStartedAt: serverTimestamp(),
  });
  await batch0.commit();

  // 2. Remove leftovers of a previous interrupted import, then write every transaction.
  const existing = await getDocsFromServer(txCollection(db, householdId));
  const wanted = new Set(validTx.map((t) => t.id));
  const ops: Array<(b: WriteBatch) => void> = [];
  for (const d of existing.docs) if (!wanted.has(d.id)) ops.push((b) => b.delete(d.ref));
  for (const tx of validTx) {
    const { id, ...data } = tx;
    ops.push((b) => b.set(doc(txCollection(db, householdId), id), clean(data)));
  }
  await commitInChunks(db, ops);

  // 3. Verify by reading back from the server.
  const check = await getDocsFromServer(txCollection(db, householdId));
  if (check.size !== validTx.length) {
    throw new Error(
      `Verificación fallida: se esperaban ${validTx.length} movimientos en la nube y hay ${check.size}. Los datos locales siguen intactos; vuelve a intentarlo.`
    );
  }

  // 4. Done.
  const batch1 = writeBatch(db);
  batch1.update(hRef, { importStatus: 'done', importFinishedAt: serverTimestamp() });
  await batch1.commit();
  return { transactions: check.size, accounts: state.accounts.length };
}

type StateUpdater = (updater: (prev: FinanceState) => FinanceState) => void;

/**
 * Keeps React state and Firestore in sync.
 *  - push(): diffs the new state against what the server is known to hold and writes only what changed
 *    (one field of the household document, or one transaction document).
 *  - subscribe(): real-time listener; applies changes made on another device. Our own writes are
 *    recognised and skipped so they never overwrite newer local edits.
 * Conflicts are last-writer-wins per field / per transaction, which is fine for two people.
 */
export class CloudSync {
  private serverMeta = new Map<MetaField, string>();
  private serverTx = new Map<string, string>();
  /** Values we wrote and whose confirmation (echo) hasn't arrived yet. */
  private pendingEchoes = new Map<string, number>();
  private errorListeners = new Set<(message: string | null) => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private db: Firestore,
    private householdId: string,
    initialState: FinanceState,
    private userEmail: string
  ) {
    this.remember(initialState);
  }

  private remember(state: FinanceState) {
    for (const f of META_FIELDS) this.serverMeta.set(f, stableJson(state[f]));
    this.serverTx = new Map(state.transactions.map((t) => [t.id, stableJson(t)]));
  }

  private addEcho(key: string) {
    this.pendingEchoes.set(key, (this.pendingEchoes.get(key) || 0) + 1);
  }

  private consumeEcho(key: string): boolean {
    const n = this.pendingEchoes.get(key) || 0;
    if (n <= 0) return false;
    if (n === 1) this.pendingEchoes.delete(key);
    else this.pendingEchoes.set(key, n - 1);
    return true;
  }

  onError(listener: (message: string | null) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private emitError(message: string | null) {
    for (const l of this.errorListeners) l(message);
  }

  /** Write the difference between `next` and the last known server state. */
  push(next: FinanceState) {
    const metaUpdate: Record<string, unknown> = {};
    for (const f of META_FIELDS) {
      const json = stableJson(next[f]);
      if (this.serverMeta.get(f) === json) continue;
      this.serverMeta.set(f, json);
      metaUpdate[f] = next[f] === undefined ? deleteField() : clean(next[f]);
      this.addEcho(`meta:${f}:${json}`);
    }

    const txOps: Array<(b: WriteBatch) => void> = [];
    const nextIds = new Set<string>();
    for (const tx of next.transactions) {
      if (!isValidDocId(tx.id)) continue;
      nextIds.add(tx.id);
      const json = stableJson(tx);
      if (this.serverTx.get(tx.id) === json) continue;
      this.serverTx.set(tx.id, json);
      this.addEcho(`tx:${tx.id}:${json}`);
      const { id, ...data } = tx;
      txOps.push((b) => b.set(doc(txCollection(this.db, this.householdId), id), clean(data)));
    }
    for (const id of Array.from(this.serverTx.keys())) {
      if (nextIds.has(id)) continue;
      this.serverTx.delete(id);
      this.addEcho(`tx:${id}:deleted`);
      txOps.push((b) => b.delete(doc(txCollection(this.db, this.householdId), id)));
    }

    const hasMeta = Object.keys(metaUpdate).length > 0;
    if (!hasMeta && txOps.length === 0) return;

    const ops = [...txOps];
    if (hasMeta) {
      const update = { ...metaUpdate, updatedAt: serverTimestamp(), updatedBy: this.userEmail };
      ops.push((b) => b.update(householdRef(this.db, this.householdId), update));
    }
    // Writes are queued so batches from consecutive edits are applied in order.
    this.queue = this.queue
      .then(() => commitInChunks(this.db, ops))
      .then(() => this.emitError(null))
      .catch((err: unknown) => {
        const code = (err as { code?: string }).code;
        this.emitError(
          code === 'permission-denied'
            ? 'Sin permiso para guardar en la nube (¿sesión con otra cuenta?).'
            : `No se pudo guardar en la nube: ${err instanceof Error ? err.message : String(err)}`
        );
      });
  }

  /** Real-time updates from other devices. Returns an unsubscribe function. */
  subscribe(setState: StateUpdater): () => void {
    const unsubMeta = onSnapshot(
      householdRef(this.db, this.householdId),
      (snap) => {
        // Local (not yet confirmed) writes are already in React state.
        if (snap.metadata.hasPendingWrites || !snap.exists()) return;
        const data = snap.data();
        const changed: Partial<Record<MetaField, unknown>> = {};
        for (const f of META_FIELDS) {
          const json = stableJson(data[f] ?? undefined);
          if (this.consumeEcho(`meta:${f}:${json}`)) continue;
          if (this.serverMeta.get(f) === json) continue;
          this.serverMeta.set(f, json);
          changed[f] = data[f] ?? undefined;
        }
        if (Object.keys(changed).length === 0) return;
        setState((prev) => {
          const merged = normalizeState({ ...prev, ...changed, transactions: [] });
          const next = { ...prev };
          for (const f of Object.keys(changed) as MetaField[]) {
            (next as Record<string, unknown>)[f] = merged[f];
          }
          return next;
        });
      },
      (err) => this.emitError(`Sin conexión con la nube: ${err.message}`)
    );

    const unsubTx = onSnapshot(
      txCollection(this.db, this.householdId),
      (snap) => {
        const upserts = new Map<string, Transaction>();
        const deletes = new Set<string>();
        for (const change of snap.docChanges()) {
          const d = change.doc;
          if (d.metadata.hasPendingWrites) continue;
          if (change.type === 'removed') {
            if (this.consumeEcho(`tx:${d.id}:deleted`)) continue;
            if (!this.serverTx.has(d.id)) continue;
            this.serverTx.delete(d.id);
            deletes.add(d.id);
          } else {
            const tx = { ...(d.data() as Omit<Transaction, 'id'>), id: d.id } as Transaction;
            const json = stableJson(tx);
            if (this.consumeEcho(`tx:${d.id}:${json}`)) continue;
            if (this.serverTx.get(d.id) === json) continue;
            this.serverTx.set(d.id, json);
            upserts.set(d.id, tx);
          }
        }
        if (upserts.size === 0 && deletes.size === 0) return;
        setState((prev) => {
          const byId = new Map(prev.transactions.map((t) => [t.id, t]));
          for (const id of deletes) byId.delete(id);
          const normalized = normalizeState({ ...prev, transactions: Array.from(upserts.values()) }).transactions;
          for (const t of normalized) byId.set(t.id, t);
          return {
            ...prev,
            transactions: Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date)),
          };
        });
      },
      (err) => this.emitError(`Sin conexión con la nube: ${err.message}`)
    );

    return () => {
      unsubMeta();
      unsubTx();
    };
  }

  /** Waits until queued writes were sent (used by tests and before signing out). */
  flush(): Promise<void> {
    return this.queue;
  }
}
