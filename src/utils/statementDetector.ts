import type {
  Account,
  AccountKind,
  CurrencyCode,
  ProfileFilter,
  ProfileId,
  Transaction,
  UserProfile,
} from '../types/finance';
import { getProfileLabel, type CsvPreset } from './formatters';

export type DetectionConfidence = 'high' | 'medium' | 'fallback';

export interface SuggestedNewAccount {
  name: string;
  owner: ProfileId;
  kind: AccountKind;
  currency: CurrencyCode;
  notes: string;
}

export interface StatementDetectionResult {
  owner: ProfileId;
  accountId: string;
  preset: Exclude<CsvPreset, 'auto'>;
  confidence: DetectionConfidence;
  ownerExplicitlyDetected: boolean;
  matchedExistingAccount: boolean;
  suggestedNewAccount?: SuggestedNewAccount;
  reasonEs: string;
  reasonEn: string;
}

const GENERIC_ACCOUNT_TOKENS = new Set([
  'abdiel',
  'lara',
  'commbank',
  'commonwealth',
  'goalsaver',
  'revolut',
  'moomoo',
  'wise',
  'cash',
  'efectivo',
  'cuenta',
  'account',
  'savings',
  'ahorro',
  'colchon',
  'sueldo',
  'gastos',
  'diario',
  'diarios',
  'diaria',
  'diarias',
  'acciones',
  'etfs',
  'broker',
  'aud',
  'usd',
  'eur',
  'ars',
  'mxn',
  'clp',
]);

const KNOWN_EXTERNAL_BANKS: Array<{
  keywords: string[];
  label: string;
  kind: AccountKind;
}> = [
  { keywords: ['ing direct', 'ing australia', 'orange everyday', 'savings maximiser'], label: 'ING Bank', kind: 'other' },
  { keywords: ['anz bank', 'anz plus', 'australia and new zealand banking'], label: 'ANZ', kind: 'other' },
  { keywords: ['nab', 'national australia bank'], label: 'NAB', kind: 'other' },
  { keywords: ['westpac'], label: 'Westpac', kind: 'other' },
  { keywords: ['macquarie bank', 'macquarie'], label: 'Macquarie Bank', kind: 'other' },
  { keywords: ['up bank', 'upbank'], label: 'Up Bank', kind: 'other' },
  { keywords: ['ubank'], label: 'ubank', kind: 'other' },
  { keywords: ['hsbc'], label: 'HSBC', kind: 'other' },
  { keywords: ['american express', 'amex'], label: 'American Express', kind: 'other' },
  { keywords: ['paypal'], label: 'PayPal', kind: 'other' },
  { keywords: ['bendigo bank', 'bendigo'], label: 'Bendigo Bank', kind: 'other' },
  { keywords: ['suncorp'], label: 'Suncorp', kind: 'other' },
  { keywords: ['citibank', 'citi'], label: 'Citibank', kind: 'other' },
  { keywords: ['stripe'], label: 'Stripe', kind: 'other' },
  { keywords: ['binance'], label: 'Binance', kind: 'other' },
];

function normalizeSearchableText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countWordMatches(normalizedText: string, word: string): number {
  if (!normalizedText || !word) return 0;
  const rx = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(word)}(?:[^a-z0-9]|$)`, 'g');
  const matches = normalizedText.match(rx);
  return matches ? matches.length : 0;
}

export function refinePresetWithContext(
  detectedPreset: Exclude<CsvPreset, 'auto'>,
  fileName: string,
  rawText: string
): Exclude<CsvPreset, 'auto'> {
  const combined = normalizeSearchableText(`${fileName} ${rawText.slice(0, 3000)}`);

  if (
    combined.includes('goalsaver') ||
    combined.includes('goal saver') ||
    (combined.includes('bonus interest') && combined.includes('commbank'))
  ) {
    return 'goalsaver';
  }

  if (detectedPreset !== 'generic') {
    return detectedPreset;
  }

  if (combined.includes('moomoo') || combined.includes('futu')) {
    return 'moomoo';
  }
  if (combined.includes('revolut')) {
    return 'revolut';
  }
  if (
    combined.includes('commbank') ||
    combined.includes('commonwealth') ||
    combined.includes('smart access') ||
    combined.includes('netbank')
  ) {
    return 'commbank';
  }

  return 'generic';
}

function presetToAccountKind(
  preset: CsvPreset,
  rawContextNormalized: string
): AccountKind | null {
  if (preset === 'commbank') return 'commbank';
  if (preset === 'goalsaver') return 'goalsaver';
  if (preset === 'revolut') return 'revolut';
  if (preset === 'moomoo') return 'moomoo';
  if (preset === 'generic') {
    if (countWordMatches(rawContextNormalized, 'wise') > 0) return 'wise';
    if (
      countWordMatches(rawContextNormalized, 'cash') > 0 ||
      countWordMatches(rawContextNormalized, 'efectivo') > 0
    ) {
      return 'cash';
    }
  }
  return null;
}

function detectExternalBankBrand(normalizedCtx: string): { label: string; kind: AccountKind } | null {
  for (const bank of KNOWN_EXTERNAL_BANKS) {
    // Whole-word matching only: substring matching made "nab" hit "unable" and "citi" hit "city".
    if (bank.keywords.some((kw) => countWordMatches(normalizedCtx, kw) > 0)) {
      return { label: bank.label, kind: bank.kind };
    }
  }
  return null;
}

export function pickAccountForOwnerAndPreset(
  accounts: Account[],
  targetOwner: ProfileId,
  chosenPreset: CsvPreset,
  preferredCurrency?: CurrencyCode,
  rawContext?: string
): Account | undefined {
  const ownerAccs = accounts.filter((a) => a.owner === targetOwner);
  const pool = ownerAccs.length > 0 ? ownerAccs : accounts;
  if (pool.length === 0) return undefined;

  const normalizedCtx = normalizeSearchableText(rawContext || '');
  const desiredKind = presetToAccountKind(chosenPreset, normalizedCtx);

  if (desiredKind) {
    const byKind = pool.filter((a) => a.kind === desiredKind);
    if (byKind.length > 0) {
      if (preferredCurrency) {
        const byCurrency = byKind.find((a) => a.currency === preferredCurrency);
        if (byCurrency) return byCurrency;
      }
      return byKind[0];
    }
  }

  if (preferredCurrency) {
    const byCurrency = pool.find((a) => a.currency === preferredCurrency);
    if (byCurrency) return byCurrency;
  }

  return pool[0];
}

function findDirectAccountMatch(
  accounts: Account[],
  fileName: string,
  rawText: string
): Account | undefined {
  const compactDoc = `${fileName}\n${rawText.slice(0, 4000)}`.toLowerCase();
  const normalizedDoc = normalizeSearchableText(`${fileName} ${rawText.slice(0, 4000)}`);
  const digitsOnlyDoc = compactDoc.replace(/[^0-9]/g, '');

  for (const acc of accounts) {
    const sourceMeta = `${acc.name} ${acc.notes || ''}`;
    // Account-number style tokens only (ignore years such as "2025" that appear in every statement).
    const digitTokens = (sourceMeta.match(/\d{4,}/g) || []).filter(
      (d) => !(d.length === 4 && /^(19|20)\d{2}$/.test(d))
    );
    for (const digits of digitTokens) {
      const wordRx = new RegExp(`(?:^|\\D)${digits}(?:\\D|$)`);
      // The concatenated-digits check only makes sense for long numbers (e.g. "06 2000 12345678").
      if (wordRx.test(compactDoc) || (digits.length >= 8 && digitsOnlyDoc.includes(digits))) {
        return acc;
      }
    }

    const customTokens = normalizeSearchableText(sourceMeta)
      .split(' ')
      .filter((tok) => tok.length >= 4 && !GENERIC_ACCOUNT_TOKENS.has(tok) && !/^\d+$/.test(tok));
    if (customTokens.length > 0 && customTokens.some((tok) => countWordMatches(normalizedDoc, tok) > 0)) {
      return acc;
    }
  }

  return undefined;
}

function buildSuggestedNewAccount(params: {
  owner: ProfileId;
  preset: Exclude<CsvPreset, 'auto'>;
  currency: CurrencyCode;
  externalBank: { label: string; kind: AccountKind } | null;
  normalizedCtx: string;
}): SuggestedNewAccount {
  const { owner, preset, currency, externalBank, normalizedCtx } = params;
  if (externalBank) {
    return {
      name: `${externalBank.label} (${currency})`,
      owner,
      kind: externalBank.kind,
      currency,
      notes: 'Cuenta creada automáticamente desde statement importado',
    };
  }
  if (preset === 'commbank') {
    return {
      name: `CommBank (${currency})`,
      owner,
      kind: 'commbank',
      currency,
      notes: 'Cuenta principal CommBank',
    };
  }
  if (preset === 'goalsaver') {
    return {
      name: `CommBank GoalSaver (${currency})`,
      owner,
      kind: 'goalsaver',
      currency,
      notes: 'Cuenta de ahorro GoalSaver',
    };
  }
  if (preset === 'revolut') {
    return {
      name: `Revolut (${currency})`,
      owner,
      kind: 'revolut',
      currency,
      notes: 'Tarjeta diaria Revolut',
    };
  }
  if (preset === 'moomoo') {
    return {
      name: `Moomoo (${currency})`,
      owner,
      kind: 'moomoo',
      currency,
      notes: 'Broker Moomoo',
    };
  }
  const desiredKind = presetToAccountKind(preset, normalizedCtx);
  if (desiredKind === 'wise') {
    return {
      name: `Wise (${currency})`,
      owner,
      kind: 'wise',
      currency,
      notes: 'Cuenta multidivisa Wise',
    };
  }
  return {
    name: `Nueva Cuenta (${currency})`,
    owner,
    kind: desiredKind || 'other',
    currency,
    notes: 'Cuenta detectada al importar statement',
  };
}

export function detectStatementOwnerAndAccount(params: {
  fileName: string;
  rawText: string;
  detectedPreset: Exclude<CsvPreset, 'auto'>;
  detectedCurrency?: CurrencyCode;
  accounts: Account[];
  profiles?: UserProfile[];
  activeProfile: ProfileFilter;
}): StatementDetectionResult {
  const {
    fileName,
    rawText,
    detectedPreset,
    detectedCurrency = 'AUD',
    accounts,
    profiles = [],
    activeProfile,
  } = params;

  const refinedPreset = refinePresetWithContext(detectedPreset, fileName, rawText);
  const directAccountMatch = findDirectAccountMatch(accounts, fileName, rawText);

  const normFile = normalizeSearchableText(fileName);
  const normHead = normalizeSearchableText(rawText.slice(0, 2200));
  const normBody = normalizeSearchableText(rawText.slice(2200, 14000));
  const combinedCtx = normalizeSearchableText(`${fileName} ${rawText.slice(0, 2500)}`);

  const holderLines = rawText
    .slice(0, 2500)
    .split(/\r?\n/)
    .filter((line) =>
      /(account\s*holder|holder|titular|client|customer|name|nombre|owner)/i.test(line)
    )
    .map(normalizeSearchableText)
    .join(' ');

  // Dynamically score every configured profile
  const effectiveProfiles: Array<{ id: ProfileId; name: string; email?: string }> =
    profiles.length > 0
      ? profiles
      : [
          { id: 'abdiel', name: 'Abdiel' },
          { id: 'lara', name: 'Lara' },
        ];

  let bestProfile: { id: ProfileId; name: string } = effectiveProfiles[0];
  let bestScore = 0;
  let secondScore = 0;
  let matchedInFile = false;

  for (const prof of effectiveProfiles) {
    const tokens = new Set<string>();
    const normName = normalizeSearchableText(prof.name);
    if (normName) {
      tokens.add(normName);
      normName
        .split(' ')
        .filter((t) => t.length >= 3)
        .forEach((t) => tokens.add(t));
    }
    const normId = normalizeSearchableText(prof.id);
    if (normId && !normId.startsWith('prof')) tokens.add(normId);
    if (prof.email) {
      const localPart = normalizeSearchableText(prof.email.split('@')[0] || '');
      if (localPart.length >= 3) tokens.add(localPart);
    }

    let score = 0;
    let inFile = false;
    for (const tok of tokens) {
      const fHits = countWordMatches(normFile, tok);
      if (fHits > 0) inFile = true;
      score +=
        fHits * 6 +
        countWordMatches(normHead, tok) * 4 +
        countWordMatches(normBody, tok) +
        (holderLines ? countWordMatches(holderLines, tok) * 6 : 0);
    }

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestProfile = prof;
      matchedInFile = inFile;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  let owner: ProfileId;
  let confidence: DetectionConfidence;
  let ownerExplicitlyDetected = false;
  let reasonEs = '';
  let reasonEn = '';

  if (directAccountMatch) {
    owner = directAccountMatch.owner;
    const ownerName = getProfileLabel(owner, profiles);
    confidence = 'high';
    ownerExplicitlyDetected = true;
    reasonEs = `Coincidencia directa con "${directAccountMatch.name}" (${ownerName})`;
    reasonEn = `Direct match with "${directAccountMatch.name}" (${ownerName})`;

    return {
      owner,
      accountId: directAccountMatch.id,
      preset: refinedPreset,
      confidence,
      ownerExplicitlyDetected,
      matchedExistingAccount: true,
      reasonEs,
      reasonEn,
    };
  }

  if (bestScore > secondScore && bestScore > 0) {
    owner = bestProfile.id;
    ownerExplicitlyDetected = true;
    confidence = bestScore >= 4 ? 'high' : 'medium';
    reasonEs = matchedInFile
      ? `Titular "${bestProfile.name}" detectado en el nombre del archivo / documento`
      : `Titular "${bestProfile.name}" detectado en el contenido del statement`;
    reasonEn = matchedInFile
      ? `Holder "${bestProfile.name}" detected in filename / document`
      : `Holder "${bestProfile.name}" detected inside statement text`;
  } else if (activeProfile !== 'all' && effectiveProfiles.some((p) => p.id === activeProfile)) {
    owner = activeProfile;
    const ownerName = getProfileLabel(owner, profiles);
    confidence = 'fallback';
    reasonEs = `Sin nombre explícito en el archivo; asignado al perfil activo (${ownerName})`;
    reasonEn = `No explicit name in file; defaulted to active profile (${ownerName})`;
  } else {
    owner = effectiveProfiles[0].id;
    const ownerName = effectiveProfiles[0].name;
    confidence = 'fallback';
    reasonEs = `Sin nombre explícito en el archivo; verifica si corresponde a ${ownerName} u otro perfil`;
    reasonEn = `No explicit name in file; please verify if this belongs to ${ownerName} or another profile`;
  }

  // Check if the statement points to an external bank or an account kind not yet owned by this profile
  const externalBank = detectExternalBankBrand(combinedCtx);
  const ownerAccounts = accounts.filter((a) => a.owner === owner);
  const desiredKind = presetToAccountKind(refinedPreset, combinedCtx);

  let matchedExistingAccount = true;
  let matchedAcc: Account | undefined;

  if (externalBank) {
    const extLower = externalBank.label.toLowerCase();
    const matchingExternal = ownerAccounts.find(
      (a) =>
        a.name.toLowerCase().includes(extLower) ||
        (a.notes || '').toLowerCase().includes(extLower)
    );
    if (matchingExternal) {
      matchedAcc = matchingExternal;
    } else {
      matchedExistingAccount = false;
    }
  } else if (desiredKind) {
    const matchingKind = ownerAccounts.find(
      (a) => a.kind === desiredKind && a.currency === detectedCurrency
    ) || ownerAccounts.find((a) => a.kind === desiredKind);
    if (matchingKind) {
      matchedAcc = matchingKind;
    } else {
      matchedExistingAccount = false;
    }
  } else if (ownerAccounts.length === 0) {
    matchedExistingAccount = false;
  } else {
    matchedAcc = pickAccountForOwnerAndPreset(
      accounts,
      owner,
      refinedPreset,
      detectedCurrency,
      `${fileName} ${rawText.slice(0, 2000)}`
    );
  }

  const suggestedNewAccount = !matchedExistingAccount
    ? buildSuggestedNewAccount({
        owner,
        preset: refinedPreset,
        currency: detectedCurrency,
        externalBank,
        normalizedCtx: combinedCtx,
      })
    : undefined;

  if (!matchedExistingAccount && suggestedNewAccount) {
    const ownerName = getProfileLabel(owner, profiles);
    reasonEs = `${reasonEs} · Statement externo o sin cuenta coincidente (${suggestedNewAccount.name} para ${ownerName})`;
    reasonEn = `${reasonEn} · External or unmatched account detected (${suggestedNewAccount.name} for ${ownerName})`;
  }

  return {
    owner,
    accountId: matchedAcc?.id || accounts[0]?.id || '',
    preset: refinedPreset,
    confidence,
    ownerExplicitlyDetected,
    matchedExistingAccount,
    suggestedNewAccount,
    reasonEs,
    reasonEn,
  };
}

// ==========================================
// MULTIPLICITY-AWARE DUPLICATE DETECTION
// ==========================================

export function normalizeDescriptionForDedup(desc: string): string {
  return desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildStrictTxSignature(tx: {
  date: string;
  amount: number;
  currency: CurrencyCode;
  description: string;
}): string {
  const normDesc = normalizeDescriptionForDedup(tx.description);
  return `${tx.date}|${Math.abs(tx.amount).toFixed(2)}|${tx.currency}|${normDesc}`;
}

export function buildLooseTxSignature(tx: {
  date: string;
  amount: number;
  currency: CurrencyCode;
  accountId: string;
  description: string;
}): string {
  const normDesc = normalizeDescriptionForDedup(tx.description).slice(0, 14);
  return `${tx.date}|${Math.abs(tx.amount).toFixed(2)}|${tx.currency}|${tx.accountId}|${normDesc}`;
}

export type DuplicateSource = 'history' | 'batch' | null;

export class StatementDedupContext {
  private historyStrict = new Map<string, number>();
  private historyLoose = new Map<string, number>();
  private batchStrict = new Map<string, number>();

  constructor(existingTransactions: Transaction[]) {
    for (const tx of existingTransactions) {
      const sKey = buildStrictTxSignature(tx);
      this.historyStrict.set(sKey, (this.historyStrict.get(sKey) || 0) + 1);

      const lKey = buildLooseTxSignature(tx);
      this.historyLoose.set(lKey, (this.historyLoose.get(lKey) || 0) + 1);
    }
  }

  checkCandidate(candidate: {
    date: string;
    amount: number;
    currency: CurrencyCode;
    accountId: string;
    description: string;
  }): DuplicateSource {
    const sKey = buildStrictTxSignature(candidate);
    const lKey = buildLooseTxSignature(candidate);

    const histStrictCount = this.historyStrict.get(sKey) || 0;
    if (histStrictCount > 0) {
      this.historyStrict.set(sKey, histStrictCount - 1);
      const histLooseCount = this.historyLoose.get(lKey) || 0;
      if (histLooseCount > 0) {
        this.historyLoose.set(lKey, histLooseCount - 1);
      }
      return 'history';
    }

    const histLooseCount = this.historyLoose.get(lKey) || 0;
    if (histLooseCount > 0) {
      this.historyLoose.set(lKey, histLooseCount - 1);
      return 'history';
    }

    const batchCount = this.batchStrict.get(sKey) || 0;
    if (batchCount > 0) {
      this.batchStrict.set(sKey, batchCount - 1);
      return 'batch';
    }

    return null;
  }

  recordAcceptedFromBatchFile(
    rows: Array<{
      date: string;
      amount: number;
      currency: CurrencyCode;
      description: string;
    }>
  ) {
    for (const r of rows) {
      const sKey = buildStrictTxSignature(r);
      this.batchStrict.set(sKey, (this.batchStrict.get(sKey) || 0) + 1);
    }
  }
}
