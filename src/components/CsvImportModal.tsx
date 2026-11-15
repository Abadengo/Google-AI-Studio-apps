import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type {
  Account,
  AccountKind,
  Category,
  CurrencyCode,
  SavingsInterestConfig,
  ProfileFilter,
  ProfileId,
  Transaction,
  TransactionType,
  UserProfile,
} from '../types/finance';
import {
  CURRENCY_META,
  formatMoney,
  getProfileLabel,
  getSampleCsvContent,
  guessCategoryId,
  normalizeDateToISO,
  parseCsvText,
  accountKindLabel,
  downloadBlob,
  FILE_FORMAT_LABELS,
  fileFormatLabel,
  suggestedKindForFormat,
  parseNumericAmount,
  type CsvPreset,
} from '../utils/formatters';
import { ACCOUNT_KINDS } from '../data/migrations';
import {
  generateSamplePdfStatementBytes,
  parsePdfStatement,
} from '../utils/pdfStatementParser';
import {
  detectStatementOwnerAndAccount,
  pickAccountForOwnerAndPreset,
  StatementDedupContext,
  type DetectionConfidence,
  type DuplicateSource,
  type SuggestedNewAccount,
} from '../utils/statementDetector';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  profiles: UserProfile[];
  categories: Category[];
  existingTransactions: Transaction[];
  activeProfile: ProfileFilter;
  initialPreset?: CsvPreset;
  onImportTransactions: (items: Omit<Transaction, 'id'>[]) => number;
  onImportInvestmentTrades: (
    trades: Array<{
      owner: ProfileId;
      accountId?: string;
      ticker: string;
      name: string;
      assetType: 'ETF' | 'Acción' | 'Fondo';
      side: 'BUY' | 'SELL';
      shares: number;
      price: number;
      currency: CurrencyCode;
    }>
  ) => void;
  savingsConfigs: SavingsInterestConfig[];
  onUpdateSavingsConfig?: (id: string, patch: Partial<SavingsInterestConfig>) => void;
  onAddAccount: (acc: Omit<Account, 'id'>) => string;
}

interface PreviewRow {
  rowIndex: number;
  /** true when money entered the statement account (positive amount / credit). */
  isInflow: boolean;
  selected: boolean;
  isDuplicate: boolean;
  duplicateSource: DuplicateSource;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  currency: CurrencyCode;
  categoryId: string;
  ticker?: string;
  moomooAction?: 'BUY' | 'SELL' | 'DIVIDEND';
  shares?: number;
  price?: number;
  assetType?: 'ETF' | 'Acción' | 'Fondo';
}

interface ImportedFileEntry {
  id: string;
  fileName: string;
  fileSize: number;
  fileFormat: 'csv' | 'pdf';
  mimeType: string;
  rawText: string;
  detectedPreset: Exclude<CsvPreset, 'auto'>;
  preset: Exclude<CsvPreset, 'auto'>;
  owner: ProfileId;
  detectedOwner: ProfileId;
  detectionConfidence: DetectionConfidence;
  detectionReasonEs: string;
  detectionReasonEn: string;
  manuallyCorrected: boolean;
  targetAccountId: string;
  defaultCurrency: CurrencyCode;
  headers: string[];
  rawRows: string[][];
  colDate: number;
  colDesc: number;
  colAmount: number;
  /** Separate Debit / Credit columns (Westpac, ANZ, ING, NAB…). -1 when not used. */
  colDebit: number;
  colCredit: number;
  colCurrency: number;
  colTicker: number;
  colSide: number;
  colQty: number;
  colPrice: number;
  rowOverrides: Record<number, { selected?: boolean; categoryId?: string; type?: TransactionType }>;
  pdfMeta: { pageCount: number; rawPreviewLines: string[] } | null;
  detectedClosingBalance: { amount: number; currency: CurrencyCode } | null;
  syncGoalSaverBalance: boolean;
  importMoomooToPortfolio: boolean;
  parseError: string;
  showRawPdfText: boolean;
  showColumnMapping: boolean;
  matchedExistingAccount: boolean;
  suggestedNewAccount: SuggestedNewAccount | null;
  showCreateAccountForm: boolean;
  newAccDraft: {
    name: string;
    owner: ProfileId;
    kind: AccountKind;
    institution: string;
    currency: CurrencyCode;
    notes: string;
  };
}

function computeColumnIndices(hdrs: string[]) {
  const lower = hdrs.map((h) => h.toLowerCase().trim());
  const findIdx = (terms: string[], exclude: string[] = []) =>
    lower.findIndex((h) => terms.some((t) => h.includes(t)) && !exclude.some((x) => h.includes(x)));

  const dIdx = findIdx(['completed date', 'started date', 'date', 'fecha', 'time']);
  const descIdx = findIdx([
    'description',
    'narrative',
    'merchant',
    'details',
    'payee',
    'name',
    'concepto',
    'descripción',
    'descripcion',
    'detalle',
    'memo',
    'reference',
  ]);
  const debitIdx = findIdx(['debit', 'withdrawal', 'money out', 'paid out', 'cargo', 'débito', 'debito', 'egreso']);
  const creditIdx = findIdx(['credit', 'deposit', 'money in', 'paid in', 'abono', 'crédito', 'credito', 'ingreso']);
  const amtIdx = findIdx(
    ['total amount', 'amount', 'monto', 'importe', 'value', 'valor'],
    ['debit', 'credit', 'balance', 'saldo', 'fee', 'withdrawal', 'deposit']
  );
  const useDebitCredit = amtIdx < 0 && (debitIdx >= 0 || creditIdx >= 0);
  const currIdx = findIdx(['currency', 'moneda', 'ccy']);
  const tickIdx = findIdx(['symbol', 'ticker', 'code', 'código']);
  const sideIdx = findIdx(['side', 'direction', 'action', 'type', 'operación']);
  const qtyIdx = findIdx(['qty', 'quantity', 'shares', 'cantidad']);
  const priceIdx = findIdx(['price', 'precio']);

  return {
    colDate: dIdx >= 0 ? dIdx : 0,
    colAmount:
      amtIdx >= 0
        ? amtIdx
        : useDebitCredit
        ? Math.max(debitIdx, creditIdx)
        : Math.min(1, Math.max(0, hdrs.length - 1)),
    colDebit: useDebitCredit ? debitIdx : -1,
    colCredit: useDebitCredit ? creditIdx : -1,
    colDesc: descIdx >= 0 ? descIdx : Math.min(2, Math.max(0, hdrs.length - 1)),
    colCurrency: currIdx,
    colTicker: tickIdx,
    colSide: sideIdx,
    colQty: qtyIdx,
    colPrice: priceIdx,
  };
}

/** Signed amount of a raw row: positive = money in, negative = money out. */
function getSignedRowAmount(
  entry: Pick<ImportedFileEntry, 'colAmount' | 'colDebit' | 'colCredit'>,
  row: string[]
): number {
  if (entry.colDebit >= 0 || entry.colCredit >= 0) {
    const debit = entry.colDebit >= 0 ? Math.abs(parseNumericAmount(row[entry.colDebit] || '')) : 0;
    const credit = entry.colCredit >= 0 ? Math.abs(parseNumericAmount(row[entry.colCredit] || '')) : 0;
    return credit - debit;
  }
  return parseNumericAmount(row[entry.colAmount] || '0');
}

/** Guess whether an internal transfer line is incoming when the source doesn't say. */
function looksLikeIncomingTransfer(description: string): boolean {
  return /\b(from|desde|received|recibid[ao]|deposit|dep[oó]sito|credit|abono)\b/i.test(description);
}

export function CsvImportModal({
  isOpen,
  onClose,
  accounts,
  profiles,
  categories,
  existingTransactions,
  activeProfile,
  initialPreset = 'auto',
  onImportTransactions,
  onImportInvestmentTrades,
  savingsConfigs,
  onUpdateSavingsConfig,
  onAddAccount,
}: CsvImportModalProps) {
  const { tr, catName, lang } = useUiPreferences();

  const [files, setFiles] = useState<ImportedFileEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>('');
  const [parsingCount, setParsingCount] = useState<number>(0);
  const [batchNotice, setBatchNotice] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string>('');

  useEffect(() => {
    if (!isOpen) {
      setBatchNotice('');
      setImportSuccessMsg('');
      setIsDragging(false);
    }
  }, [isOpen]);

  // Compute deduplicated preview rows sequentially across all files in the batch
  const computedFiles = useMemo(() => {
    const dedup = new StatementDedupContext(existingTransactions);

    return files.map((entry) => {
      const targetAcc =
        accounts.find((a) => a.id === entry.targetAccountId) ||
        pickAccountForOwnerAndPreset(accounts, entry.owner, entry.preset, entry.defaultCurrency) ||
        accounts[0];
      const accountId = targetAcc?.id || '';
      const isMoomooMode =
        entry.preset === 'moomoo' || (entry.colTicker >= 0 && entry.colQty >= 0);

      const stateCol = entry.headers.findIndex((h) => h.toLowerCase() === 'state');

      const previewRows: PreviewRow[] = [];
      for (let idx = 0; idx < entry.rawRows.length; idx++) {
        const row = entry.rawRows[idx];
        if (stateCol >= 0) {
          const st = (row[stateCol] || '').toUpperCase();
          if (st && st !== 'COMPLETED' && st !== 'SETTLED') {
            continue;
          }
        }

        const rawDate = row[entry.colDate] || '';
        const date = normalizeDateToISO(rawDate);
        const rawDesc = row[entry.colDesc] || '';
        const signedAmount = getSignedRowAmount(entry, row);

        let curr: CurrencyCode = entry.defaultCurrency;
        if (entry.colCurrency >= 0 && row[entry.colCurrency]) {
          const candidate = row[entry.colCurrency].toUpperCase().trim() as CurrencyCode;
          if (candidate in CURRENCY_META) curr = candidate;
        }

        const ticker =
          entry.colTicker >= 0 ? (row[entry.colTicker] || '').toUpperCase().trim() : '';
        const sideRaw =
          entry.colSide >= 0 ? (row[entry.colSide] || '').toUpperCase().trim() : '';
        const shares =
          entry.colQty >= 0 ? Math.abs(parseNumericAmount(row[entry.colQty] || '0')) : 0;
        const price =
          entry.colPrice >= 0 ? Math.abs(parseNumericAmount(row[entry.colPrice] || '0')) : 0;

        let moomooAction: 'BUY' | 'SELL' | 'DIVIDEND' | undefined;
        if (isMoomooMode && ticker) {
          if (sideRaw.includes('DIV')) moomooAction = 'DIVIDEND';
          else if (sideRaw.includes('SELL') || sideRaw.includes('VENTA')) moomooAction = 'SELL';
          else moomooAction = 'BUY';
        }

        let computedAmount = Math.abs(signedAmount);
        if (computedAmount === 0 && shares > 0 && price > 0) {
          computedAmount = Number((shares * price).toFixed(2));
        }
        if (computedAmount <= 0) continue;

        let txType: TransactionType = signedAmount >= 0 ? 'income' : 'expense';
        if (moomooAction === 'DIVIDEND') txType = 'income';
        else if (moomooAction === 'BUY') txType = 'expense';
        else if (moomooAction === 'SELL') txType = 'income';

        const description =
          (isMoomooMode && ticker
            ? `${
                moomooAction === 'DIVIDEND'
                  ? 'Dividendo'
                  : moomooAction === 'SELL'
                  ? 'Venta'
                  : 'Compra'
              } ${ticker}${rawDesc ? ` · ${rawDesc}` : ''}`
            : rawDesc || tr('Movimiento importado', 'Imported transaction'));

        const duplicateSource = dedup.checkCandidate({
          date,
          amount: computedAmount,
          currency: curr,
          accountId,
          description,
        });
        const isDuplicate = duplicateSource !== null;

        const override = entry.rowOverrides[idx];
        const finalType = override?.type || txType;
        const defaultCat =
          (moomooAction === 'DIVIDEND'
            ? 'cat_dividendos'
            : guessCategoryId(description, finalType));

        previewRows.push({
          rowIndex: idx,
          isInflow: signedAmount > 0 || (signedAmount === 0 && txType === 'income'),
          selected: override?.selected ?? !isDuplicate,
          isDuplicate,
          duplicateSource,
          date,
          description,
          amount: computedAmount,
          type: finalType,
          currency: curr,
          categoryId: override?.categoryId || defaultCat,
          ticker,
          moomooAction,
          shares,
          price,
          assetType:
            ((description.toUpperCase().includes('ETF') ? 'ETF' : 'Acción') as
                  | 'ETF'
                  | 'Acción'),
        });
      }

      const selectedRows = previewRows.filter((r) => r.selected);
      const duplicateCount = previewRows.filter((r) => r.isDuplicate).length;
      const newCount = previewRows.length - duplicateCount;

      // Register selected rows from this file so subsequent files in the batch catch overlaps
      dedup.recordAcceptedFromBatchFile(
        selectedRows.map((r) => ({
          date: r.date,
          amount: r.amount,
          currency: r.currency,
          description: r.description,
        }))
      );

      // Savings statement: its closing balance can update the linked "savings with interest" settings.
      const isGoalSaverContext = entry.preset === 'goalsaver' || targetAcc?.kind === 'ahorro';
      const savingsTarget = isGoalSaverContext
        ? savingsConfigs.find((c) => c.accountId && c.accountId === targetAcc?.id) ||
          savingsConfigs.find((c) => !c.accountId && c.owner === entry.owner)
        : undefined;

      return {
        entry,
        targetAccount: targetAcc,
        isMoomooMode,
        isGoalSaverContext: Boolean(savingsTarget) && !savingsTarget?.useAccountBalance,
        savingsTarget,
        previewRows,
        selectedRows,
        duplicateCount,
        newCount,
      };
    });
  }, [files, existingTransactions, accounts, savingsConfigs, tr]);

  const activeComputed = useMemo(() => {
    if (computedFiles.length === 0) return null;
    return (
      computedFiles.find((cf) => cf.entry.id === activeFileId) || computedFiles[0]
    );
  }, [computedFiles, activeFileId]);

  if (!isOpen) return null;

  const isParsing = parsingCount > 0;

  const batchStats = computedFiles.reduce(
    (acc, cf) => {
      acc.totalRows += cf.previewRows.length;
      acc.selectedRows += cf.selectedRows.length;
      acc.duplicates += cf.duplicateCount;
      if (
        cf.selectedRows.length > 0 ||
        (cf.isGoalSaverContext && cf.entry.syncGoalSaverBalance && cf.entry.detectedClosingBalance)
      ) {
        acc.activeFiles += 1;
      }
      if (
        cf.isGoalSaverContext &&
        cf.entry.syncGoalSaverBalance &&
        cf.entry.detectedClosingBalance
      ) {
        acc.goalSaverSyncs += 1;
      }
      return acc;
    },
    { totalRows: 0, selectedRows: 0, duplicates: 0, activeFiles: 0, goalSaverSyncs: 0 }
  );

  const defaultPrimaryOwner: ProfileId =
    activeProfile !== 'all' && profiles.some((p) => p.id === activeProfile)
      ? activeProfile
      : profiles[0]?.id || '';
  const secondOwner: ProfileId = profiles[1]?.id || defaultPrimaryOwner;

  const presetToKind = (p: Exclude<CsvPreset, 'auto'>): AccountKind => suggestedKindForFormat(p);

  const buildNewAccountDraft = (
    suggestion: SuggestedNewAccount | null | undefined,
    owner: ProfileId,
    preset: Exclude<CsvPreset, 'auto'>,
    currency: CurrencyCode
  ) => ({
    name: suggestion?.name || `${tr('Cuenta nueva', 'New account')} (${currency})`,
    owner: suggestion?.owner || owner,
    kind: suggestion?.kind || presetToKind(preset),
    institution: suggestion?.institution || '',
    currency: suggestion?.currency || currency,
    notes: suggestion?.notes || tr('Cuenta creada al importar statement', 'Created from imported statement'),
  });

  const knownProfileIds = new Set(profiles.map((p) => p.id));
  const orphanAccounts = accounts.filter((a) => !knownProfileIds.has(a.owner));

  const updateFileEntry = (
    fileId: string,
    updater: (prev: ImportedFileEntry) => ImportedFileEntry
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? updater(f) : f)));
  };

  const buildCsvEntry = (
    text: string,
    name: string,
    fileSize: number,
    forcedPreset?: CsvPreset
  ): ImportedFileEntry => {
    const parsed = parseCsvText(text);
    const basePreset: Exclude<CsvPreset, 'auto'> =
      forcedPreset && forcedPreset !== 'auto'
        ? forcedPreset
        : parsed.detectedPreset === 'generic' && initialPreset !== 'auto'
        ? initialPreset
        : parsed.detectedPreset;

    const detection = detectStatementOwnerAndAccount({
      fileName: name,
      rawText: text,
      detectedPreset: basePreset,
      accounts,
      profiles,
      activeProfile,
    });

    const matchedAccount =
      accounts.find((a) => a.id === detection.accountId) || accounts[0];
    const cols = computeColumnIndices(parsed.headers);
    const effectivePreset = forcedPreset && forcedPreset !== 'auto' ? forcedPreset : detection.preset;
    const effectiveCurrency = matchedAccount?.currency || detection.suggestedNewAccount?.currency || 'AUD';

    return {
      id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: name,
      fileSize,
      fileFormat: 'csv',
      mimeType: 'text/csv',
      rawText: text,
      detectedPreset: detection.preset,
      preset: effectivePreset,
      owner: detection.owner,
      detectedOwner: detection.owner,
      detectionConfidence: detection.confidence,
      detectionReasonEs: detection.reasonEs,
      detectionReasonEn: detection.reasonEn,
      manuallyCorrected: false,
      targetAccountId: matchedAccount?.id || '',
      defaultCurrency: effectiveCurrency,
      headers: parsed.headers,
      rawRows: parsed.rows,
      ...cols,
      rowOverrides: {},
      pdfMeta: null,
      detectedClosingBalance: parsed.detectedClosingBalance || null,
      syncGoalSaverBalance: true,
      importMoomooToPortfolio: true,
      parseError:
        parsed.rows.length === 0
          ? tr(
              'El archivo CSV no contiene filas de movimientos válidas.',
              'The CSV file does not contain any valid transaction rows.'
            )
          : '',
      showRawPdfText: false,
      showColumnMapping: parsed.rows.length === 0,
      matchedExistingAccount: detection.matchedExistingAccount && Boolean(matchedAccount),
      suggestedNewAccount: detection.suggestedNewAccount || null,
      showCreateAccountForm: !detection.matchedExistingAccount || !matchedAccount,
      newAccDraft: buildNewAccountDraft(
        detection.suggestedNewAccount,
        detection.owner,
        effectivePreset,
        effectiveCurrency
      ),
    };
  };

  const buildPdfEntry = async (
    buffer: ArrayBuffer,
    name: string,
    fileSize: number,
    forcedPreset?: CsvPreset
  ): Promise<ImportedFileEntry> => {
    try {
      const parsed = await parsePdfStatement(buffer, forcedPreset || 'auto');
      const basePreset: Exclude<CsvPreset, 'auto'> =
        forcedPreset && forcedPreset !== 'auto'
          ? forcedPreset
          : parsed.detectedPreset === 'generic' && initialPreset !== 'auto'
          ? initialPreset
          : parsed.detectedPreset;

      const detection = detectStatementOwnerAndAccount({
        fileName: name,
        rawText: parsed.fullText,
        detectedPreset: basePreset,
        detectedCurrency: parsed.detectedCurrency,
        accounts,
        profiles,
        activeProfile,
      });

      const matchedAccount =
        accounts.find((a) => a.id === detection.accountId) || accounts[0];
      const cols = computeColumnIndices(parsed.headers);
      const effectivePreset = forcedPreset && forcedPreset !== 'auto' ? forcedPreset : detection.preset;
      const effectiveCurrency =
        parsed.detectedCurrency ||
        detection.suggestedNewAccount?.currency ||
        matchedAccount?.currency ||
        'AUD';

      return {
        id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fileName: name,
        fileSize,
        fileFormat: 'pdf',
        mimeType: 'application/pdf',
        rawText: parsed.fullText,
        detectedPreset: detection.preset,
        preset: effectivePreset,
        owner: detection.owner,
        detectedOwner: detection.owner,
        detectionConfidence: detection.confidence,
        detectionReasonEs: detection.reasonEs,
        detectionReasonEn: detection.reasonEn,
        manuallyCorrected: false,
        targetAccountId: matchedAccount?.id || '',
        defaultCurrency: effectiveCurrency,
        headers: parsed.headers,
        rawRows: parsed.rows,
        ...cols,
        rowOverrides: {},
        pdfMeta: {
          pageCount: parsed.pageCount,
          rawPreviewLines: parsed.rawPreviewLines,
        },
        detectedClosingBalance: parsed.detectedClosingBalance || null,
        syncGoalSaverBalance: true,
        importMoomooToPortfolio: true,
        parseError:
          parsed.rows.length === 0
            ? tr(
                'No se encontraron movimientos en este PDF. Si es un escaneo o una imagen, descarga el extracto en CSV desde tu banco, o ajusta las columnas manualmente.',
                'No transactions were found in this PDF. If it is a scan or an image, download the CSV statement from your bank, or map the columns manually.'
              )
            : '',
        showRawPdfText: false,
        showColumnMapping: false,
        matchedExistingAccount: detection.matchedExistingAccount && Boolean(matchedAccount),
        suggestedNewAccount: detection.suggestedNewAccount || null,
        showCreateAccountForm: !detection.matchedExistingAccount || !matchedAccount,
        newAccDraft: buildNewAccountDraft(
          detection.suggestedNewAccount,
          detection.owner,
          effectivePreset,
          effectiveCurrency
        ),
      };
    } catch {
      const fallbackOwner: ProfileId = defaultPrimaryOwner;
      const fallbackAcc = pickAccountForOwnerAndPreset(accounts, fallbackOwner, 'generic');

      return {
        id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fileName: name,
        fileSize,
        fileFormat: 'pdf',
        mimeType: 'application/pdf',
        rawText: '',
        detectedPreset: 'generic',
        preset: 'generic',
        owner: fallbackOwner,
        detectedOwner: fallbackOwner,
        detectionConfidence: 'fallback',
        detectionReasonEs: 'No se pudo leer el PDF en el navegador',
        detectionReasonEn: 'The PDF could not be read in the browser',
        manuallyCorrected: false,
        targetAccountId: fallbackAcc?.id || '',
        defaultCurrency: fallbackAcc?.currency || 'AUD',
        headers: [],
        rawRows: [],
        colDate: 0,
        colDesc: 2,
        colAmount: 1,
        colDebit: -1,
        colCredit: -1,
        colCurrency: -1,
        colTicker: -1,
        colSide: -1,
        colQty: -1,
        colPrice: -1,
        rowOverrides: {},
        pdfMeta: null,
        detectedClosingBalance: null,
        syncGoalSaverBalance: false,
        importMoomooToPortfolio: true,
        parseError: tr(
          'PDF escaneado o protegido: no se puede leer como texto. Descarga el extracto en CSV (o PDF digital) desde tu banco.',
          'Scanned or protected PDF: it cannot be read as text. Download the CSV (or digital PDF) statement from your bank.'
        ),
        showRawPdfText: false,
        showColumnMapping: false,
        matchedExistingAccount: Boolean(fallbackAcc),
        suggestedNewAccount: null,
        showCreateAccountForm: !fallbackAcc,
        newAccDraft: buildNewAccountDraft(null, fallbackOwner, 'generic', fallbackAcc?.currency || 'AUD'),
      };
    }
  };

  const processMultipleFiles = async (selectedList: File[]) => {
    if (selectedList.length === 0) return;
    setImportSuccessMsg('');
    setBatchNotice('');

    const existingKeys = new Set(files.map((f) => `${f.fileName.toLowerCase()}::${f.fileSize}`));
    const validFiles: File[] = [];
    let skippedUnsupported = 0;
    let skippedDuplicateFiles = 0;

    for (const file of selectedList) {
      const lowerName = file.name.toLowerCase();
      const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
      const isCsv =
        lowerName.endsWith('.csv') ||
        file.type === 'text/csv' ||
        file.type === 'application/vnd.ms-excel';
      if (!isPdf && !isCsv) {
        skippedUnsupported++;
        continue;
      }

      const fileKey = `${lowerName}::${file.size}`;
      if (existingKeys.has(fileKey)) {
        skippedDuplicateFiles++;
        continue;
      }
      existingKeys.add(fileKey);
      validFiles.push(file);
    }

    if (skippedUnsupported > 0 || skippedDuplicateFiles > 0) {
      const notes: string[] = [];
      if (skippedDuplicateFiles > 0) {
        notes.push(
          tr(
            `${skippedDuplicateFiles} archivo(s) repetido(s) en la cola fueron omitidos`,
            `${skippedDuplicateFiles} duplicate file(s) already in queue were skipped`
          )
        );
      }
      if (skippedUnsupported > 0) {
        notes.push(
          tr(
            `${skippedUnsupported} archivo(s) no soportado(s) (usa .PDF o .CSV)`,
            `${skippedUnsupported} unsupported file(s) (use .PDF or .CSV)`
          )
        );
      }
      setBatchNotice(notes.join(' · '));
    }

    if (validFiles.length === 0) return;

    setParsingCount((c) => c + validFiles.length);
    let createdEntries: ImportedFileEntry[] = [];
    try {
      createdEntries = await Promise.all(
        validFiles.map(async (file) => {
          const lowerName = file.name.toLowerCase();
          const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
          if (isPdf) {
            return buildPdfEntry(await file.arrayBuffer(), file.name, file.size);
          }
          const text = await file.text();
          return buildCsvEntry(text, file.name, file.size);
        })
      );

      setFiles((prev) => [...prev, ...createdEntries]);
      if (createdEntries.length > 0) {
        setActiveFileId((prevId) => prevId || createdEntries[0].id);
      }
    } finally {
      setParsingCount((c) => Math.max(0, c - validFiles.length));
    }

  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (fileList.length === 0) return;
    await processMultipleFiles(fileList);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (dropped.length === 0) return;
    await processMultipleFiles(dropped);
  };

  const handleDownloadSampleCsv = (kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo') => {
    const csv = getSampleCsvContent(kind);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `ejemplo_${kind}.csv`);
  };

  const handleDownloadSamplePdf = (kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo') => {
    const sampleOwner: ProfileId = defaultPrimaryOwner;
    const holderName = getProfileLabel(sampleOwner, profiles);
    const bytes = generateSamplePdfStatementBytes(kind, sampleOwner, holderName);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    downloadBlob(blob, `statement_${sampleOwner}_${kind}.pdf`);
  };

  const appendEntryIfNotLoaded = (entry: ImportedFileEntry) => {
    setImportSuccessMsg('');
    setBatchNotice('');
    setFiles((prev) => [...prev, entry]);
    setActiveFileId(entry.id);
  };

  const handleLoadSampleCsvDirectly = (
    kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo',
    ownerHint?: ProfileId
  ) => {
    const effectiveOwner: ProfileId = ownerHint || defaultPrimaryOwner;
    const csv = getSampleCsvContent(kind);
    const fileName = `${getProfileLabel(effectiveOwner, profiles).toLowerCase().replace(/\s+/g, '_')}_${kind}_ejemplo.csv`;
    const entry = buildCsvEntry(csv, fileName, csv.length, kind);
    appendEntryIfNotLoaded(entry);
  };

  const handleLoadSamplePdfDirectly = async (
    kind: 'commbank' | 'goalsaver' | 'revolut' | 'moomoo',
    ownerHint?: ProfileId
  ) => {
    const effectiveOwner: ProfileId = ownerHint || defaultPrimaryOwner;
    const holderName = getProfileLabel(effectiveOwner, profiles);
    const bytes = generateSamplePdfStatementBytes(kind, effectiveOwner, holderName);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    setParsingCount((c) => c + 1);
    try {
      const entry = await buildPdfEntry(
        buffer as ArrayBuffer,
        `${holderName.toLowerCase().replace(/\s+/g, '_')}_${kind}_statement.pdf`,
        bytes.byteLength,
        kind
      );
      appendEntryIfNotLoaded(entry);
    } finally {
      setParsingCount((c) => Math.max(0, c - 1));
    }
  };

  const handleLoadSampleBulkMixed = async () => {
    setImportSuccessMsg('');
    setBatchNotice('');
    setParsingCount((c) => c + 2);
    try {
      const primaryName = getProfileLabel(defaultPrimaryOwner, profiles);
      const secondaryName = getProfileLabel(secondOwner, profiles);
      const p1CommBytes = generateSamplePdfStatementBytes('commbank', defaultPrimaryOwner, primaryName);
      const p2GoalBytes = generateSamplePdfStatementBytes('goalsaver', secondOwner, secondaryName);
      const p2RevCsv = getSampleCsvContent('revolut');

      const [e1, e2] = await Promise.all([
        buildPdfEntry(
          p1CommBytes.buffer.slice(
            p1CommBytes.byteOffset,
            p1CommBytes.byteOffset + p1CommBytes.byteLength
          ) as ArrayBuffer,
          `${primaryName.toLowerCase().replace(/\s+/g, '_')}_commbank_statement.pdf`,
          p1CommBytes.byteLength
        ),
        buildPdfEntry(
          p2GoalBytes.buffer.slice(
            p2GoalBytes.byteOffset,
            p2GoalBytes.byteOffset + p2GoalBytes.byteLength
          ) as ArrayBuffer,
          `${secondaryName.toLowerCase().replace(/\s+/g, '_')}_goalsaver_statement.pdf`,
          p2GoalBytes.byteLength
        ),
      ]);
      const e3 = buildCsvEntry(
        p2RevCsv,
        `${secondaryName.toLowerCase().replace(/\s+/g, '_')}_revolut_card.csv`,
        p2RevCsv.length
      );

      setFiles((prev) => [...prev, e1, e2, e3]);
      setActiveFileId(e1.id);
    } finally {
      setParsingCount((c) => Math.max(0, c - 2));
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(next[0]?.id || '');
      }
      return next;
    });
  };

  const handleConfirmImport = () => {
    if (batchStats.selectedRows === 0 && batchStats.goalSaverSyncs === 0) return;

    const allTransactionsToInsert: Omit<Transaction, 'id'>[] = [];
    const allMoomooTrades: Array<{
      owner: ProfileId;
      accountId?: string;
      ticker: string;
      name: string;
      assetType: 'ETF' | 'Acción' | 'Fondo';
      side: 'BUY' | 'SELL';
      shares: number;
      price: number;
      currency: CurrencyCode;
    }> = [];
    const goalSaverUpdates: Array<{ owner: ProfileId; name: string; amount: number; currency: CurrencyCode }> = [];

    for (const cf of computedFiles) {
      const { entry, targetAccount, isMoomooMode, isGoalSaverContext, selectedRows } = cf;

      if (selectedRows.length > 0) {
        const sourceTag: Transaction['source'] = entry.fileFormat === 'pdf'
          ? entry.preset === 'commbank'
            ? 'pdf_commbank'
            : entry.preset === 'goalsaver'
            ? 'pdf_goalsaver'
            : entry.preset === 'revolut'
            ? 'pdf_revolut'
            : entry.preset === 'moomoo'
            ? 'pdf_moomoo'
            : 'pdf_other'
          : entry.preset === 'commbank' || entry.preset === 'goalsaver'
          ? 'csv_commbank'
          : entry.preset === 'revolut'
          ? 'csv_revolut'
          : entry.preset === 'moomoo'
          ? 'csv_moomoo'
          : 'csv_other';

        if (isMoomooMode && entry.importMoomooToPortfolio) {
          const trades = selectedRows
            .filter(
              (r) =>
                r.ticker &&
                (r.moomooAction === 'BUY' || r.moomooAction === 'SELL') &&
                (r.shares || 0) > 0
            )
            .map((r) => ({
              owner: entry.owner,
              accountId: targetAccount?.kind === 'inversion' ? targetAccount.id : undefined,
              ticker: r.ticker!,
              name:
                r.description.replace(/^(Compra|Venta)\s+[A-Z0-9.]+\s*·?\s*/i, '') || r.ticker!,
              assetType: (r.assetType || 'ETF') as 'ETF' | 'Acción' | 'Fondo',
              side: r.moomooAction as 'BUY' | 'SELL',
              shares: r.shares || 0,
              price: r.price || (r.shares ? r.amount / r.shares : 0),
              currency: r.currency,
            }));
          allMoomooTrades.push(...trades);
        }

        // BUY/SELL rows go to the portfolio; if the user turned that off they are kept as movements
        // instead of being silently dropped.
        const txRows =
          isMoomooMode && entry.importMoomooToPortfolio
            ? selectedRows.filter((r) => !r.ticker || r.moomooAction === 'DIVIDEND')
            : selectedRows;

        if (txRows.length > 0 && targetAccount) {
          for (const r of txRows) {
            const isIncomingTransfer = r.type === 'transfer' && r.isInflow;
            allTransactionsToInsert.push({
              owner: entry.owner,
              type: r.type,
              date: r.date,
              amount: r.amount,
              currency: r.currency,
              categoryId: r.categoryId,
              // Incoming transfer from another own account: credit this account (source unknown).
              accountId: isIncomingTransfer ? '' : targetAccount.id,
              ...(isIncomingTransfer ? { toAccountId: targetAccount.id } : {}),
              description: r.description,
              source: sourceTag,
            });
          }
        }
      }

      if (
        isGoalSaverContext &&
        cf.savingsTarget &&
        entry.syncGoalSaverBalance &&
        entry.detectedClosingBalance &&
        onUpdateSavingsConfig
      ) {
        onUpdateSavingsConfig(cf.savingsTarget.id, {
          currentBalance: entry.detectedClosingBalance.amount,
        });
        goalSaverUpdates.push({
          owner: entry.owner,
          name: cf.savingsTarget.name,
          amount: entry.detectedClosingBalance.amount,
          currency: entry.detectedClosingBalance.currency,
        });
      }
    }

    if (allMoomooTrades.length > 0) {
      onImportInvestmentTrades(allMoomooTrades);
    }

    const importedTxCount =
      allTransactionsToInsert.length > 0
        ? onImportTransactions(allTransactionsToInsert)
        : 0;

    const parts: string[] = [];
    if (importedTxCount > 0) {
      parts.push(
        tr(
          `${importedTxCount} movimiento(s) agregado(s) desde ${files.length} archivo(s)`,
          `${importedTxCount} transaction(s) imported across ${files.length} file(s)`
        )
      );
    }
    if (allMoomooTrades.length > 0) {
      parts.push(
        tr(
          `${allMoomooTrades.length} operación(es) sincronizada(s) en Moomoo`,
          `${allMoomooTrades.length} trade(s) synced to Moomoo`
        )
      );
    }
    if (goalSaverUpdates.length > 0) {
      parts.push(
        goalSaverUpdates
          .map((g) => {
            const ownerName = getProfileLabel(g.owner, profiles);
            return tr(
              `${g.name} (${ownerName}) actualizado a ${formatMoney(g.amount, g.currency)}`,
              `${g.name} (${ownerName}) updated to ${formatMoney(g.amount, g.currency)}`
            );
          })
          .join(' · ')
      );
    }

    setImportSuccessMsg(parts.join(' · ') || tr('Importación completada.', 'Import completed.'));
    setTimeout(() => {
      onClose();
      setImportSuccessMsg('');
      setFiles([]);
      setActiveFileId('');
      setBatchNotice('');
    }, 1250);
  };

  const presetLabel = (p: Exclude<CsvPreset, 'auto'>) => fileFormatLabel(p, lang);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-modal-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66] shrink-0">
          <div>
            <h2 id="csv-modal-title" className="text-lg font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {tr(
                'Importar extractos (PDF / CSV)',
                'Import statements (PDF / CSV)'
              )}
            </h2>
            <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-0.5">
              {tr(
                'Carga extractos en PDF digital o CSV. La app detecta el formato, el titular, la cuenta, los duplicados y sugiere categorías; todo se procesa en tu navegador.',
                'Upload digital PDF or CSV statements. The app detects the format, holder, account and duplicates and suggests categories; everything is processed in your browser.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
            aria-label={tr('Cerrar importador', 'Close importer')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Bulk Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
              isDragging
                ? 'border-[#499BED] bg-[#DAEAFF]/50 dark:bg-[#022E5B]/60'
                : 'border-[#C6DAF7] dark:border-[#1B4A7C] bg-[#EDF4FF]/60 dark:bg-[#041E32]'
            }`}
          >
            {isParsing ? (
              <div className="py-4 flex flex-col items-center gap-2 text-[#031725] dark:text-[#DAEAFF]">
                <Loader2 className="w-7 h-7 animate-spin text-[#499BED]" />
                <p className="text-sm font-medium">
                  {tr(
                    `Leyendo ${parsingCount} archivo(s)...`,
                    `Reading ${parsingCount} file(s)...`
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2.5 mb-2">
                  <FileText className="w-6 h-6 text-[#022E5B] dark:text-[#499BED]" />
                  <Layers className="w-6 h-6 text-[#499BED]" />
                  <FileSpreadsheet className="w-6 h-6 text-[#5A7694] dark:text-[#A1C6F6]" />
                  <FileImage className="w-6 h-6 text-[#499BED]" />
                </div>
                <p className="text-sm font-medium text-[#031725] dark:text-[#DAEAFF]">
                  {files.length > 0
                    ? tr(
                        `${files.length} archivo(s) en el lote · Arrastra o selecciona más PDF o CSV`,
                        `${files.length} file(s) in batch · Drag & drop or pick more PDF or CSV`
                      )
                    : tr(
                        'Arrastra o selecciona varios extractos (.PDF o .CSV)',
                        'Drag & drop or select multiple statements (.PDF or .CSV)'
                      )}
                </p>
                <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6] mt-1 mb-3.5">
                  {tr(
                    `Detecta titular (${profiles.map((p) => p.name).join('/')}), cuenta destino (o sugiere crear una nueva), evita duplicados y sugiere categorías.`,
                    `Detects holder (${profiles.map((p) => p.name).join('/')}), target account (or suggests creating a new one), avoids duplicates, and suggests categories.`
                  )}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    {files.length > 0
                      ? tr('Agregar más archivos', 'Add more files')
                      : tr('Elegir PDF, CSV o foto', 'Choose PDF, CSV, or photo')}
                    <input
                      type="file"
                      multiple
                      accept=".csv,.pdf,text/csv,application/pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleLoadSampleBulkMixed}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#022E5B] dark:text-[#DAEAFF] bg-[#DAEAFF]/80 dark:bg-[#022E5B] border border-[#A1C6F6] dark:border-[#1B4A7C] rounded-lg hover:bg-[#DAEAFF] dark:hover:bg-[#033A73]"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#499BED]" />
                    {tr('Probar lote mixto (3 archivos)', 'Try mixed batch (3 files)')}
                  </button>

                  {files.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFiles([]);
                        setActiveFileId('');
                        setBatchNotice('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6] hover:text-rose-600 dark:hover:text-rose-400 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {tr('Limpiar lote', 'Clear batch')}
                    </button>
                  )}
                </div>

                {/* Secondary single-sample links (examples of the file formats the importer recognises) */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                  <span>{tr('Probar con un archivo de ejemplo, por formato:', 'Try a sample file, by format:')}</span>
                  <button
                    type="button"
                    onClick={() => handleLoadSamplePdfDirectly('commbank')}
                    className="hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    PDF {presetLabel('commbank')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSamplePdfDirectly('goalsaver')}
                    className="hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    PDF {presetLabel('goalsaver')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSamplePdfDirectly('moomoo')}
                    className="hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    PDF {presetLabel('moomoo')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSampleCsvDirectly('revolut')}
                    className="hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    CSV {presetLabel('revolut')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadSampleCsvDirectly('moomoo')}
                    className="hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    CSV {presetLabel('moomoo')}
                  </button>
                  <span className="text-[#A1C6F6] dark:text-[#1B4A7C]">|</span>
                  <button
                    type="button"
                    onClick={() => handleDownloadSamplePdf('commbank')}
                    className="inline-flex items-center gap-1 hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    <Download className="w-3 h-3" /> {tr('Plantilla PDF', 'Sample PDF')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadSampleCsv('commbank')}
                    className="inline-flex items-center gap-1 hover:text-[#031725] dark:hover:text-[#DAEAFF] underline"
                  >
                    <Download className="w-3 h-3" /> {tr('Plantilla CSV', 'Sample CSV')}
                  </button>
                </div>
              </>
            )}
          </div>

          {batchNotice && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 rounded-xl text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{batchNotice}</span>
            </div>
          )}

          {/* Batch Queue & Per-File Auto-Detection + Manual Correction */}
          {computedFiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {tr(
                    `Documentos cargados (${computedFiles.length}) — Detección automática`,
                    `Loaded statements (${computedFiles.length}) — Auto-detection`
                  )}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6] font-mono-num">
                    <strong className="text-[#022E5B] dark:text-[#499BED]">
                      {batchStats.selectedRows}
                    </strong>{' '}
                    {tr('por importar', 'to import')} ·{' '}
                    <strong className="text-amber-700 dark:text-amber-400">
                      {batchStats.duplicates}
                    </strong>{' '}
                    {tr('duplicados omitidos', 'duplicates skipped')}
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                {computedFiles.map((cf) => {
                  const { entry, targetAccount, previewRows, selectedRows, duplicateCount } = cf;
                  const isActive = activeComputed?.entry.id === entry.id;

                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border transition-colors p-3.5 ${
                        isActive
                          ? 'border-[#499BED] bg-[#F5F9FF] dark:bg-[#041E32]'
                          : 'border-[#D3E3FA] dark:border-[#123B66] bg-white dark:bg-[#062035] hover:border-[#A1C6F6] dark:hover:border-[#1B4A7C]'
                      }`}
                    >
                      {/* File Header Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveFileId(entry.id)}
                          className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                        >
                          {entry.fileFormat === 'pdf' ? (
                            <FileText className="w-4 h-4 text-[#022E5B] dark:text-[#499BED] shrink-0" />
                          ) : (
                            <FileSpreadsheet className="w-4 h-4 text-[#496685] dark:text-[#A1C6F6] shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] truncate">
                            {entry.fileName}
                          </span>
                          <span className="text-[11px] font-mono-num uppercase text-[#5A7694] dark:text-[#A1C6F6] shrink-0">
                            {entry.fileFormat}
                          </span>
                        </button>

                        <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
                          {entry.parseError ? (
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              {tr('Requiere revisión', 'Needs review')}
                            </span>
                          ) : (
                            <span className="font-mono-num text-[#355170] dark:text-[#A1C6F6]">
                              <strong className="text-[#022E5B] dark:text-[#499BED]">
                                {selectedRows.length}
                              </strong>
                              /{previewRows.length} {tr('sel.', 'sel.')}
                              {duplicateCount > 0 && (
                                <span className="text-amber-700 dark:text-amber-400 ml-1.5">
                                  · {duplicateCount} {tr('dup.', 'dup.')}
                                </span>
                              )}
                            </span>
                          )}


                          <button
                            type="button"
                            onClick={() => setActiveFileId(entry.id)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                              isActive
                                ? 'bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725]'
                                : 'bg-[#EAF2FF] dark:bg-[#022E5B]/70 text-[#022E5B] dark:text-[#DAEAFF] hover:bg-[#DAEAFF]'
                            }`}
                          >
                            {isActive
                              ? tr('Inspeccionando', 'Inspecting')
                              : tr('Ver movimientos', 'Inspect rows')}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveFile(entry.id)}
                            className="p-1 text-[#5A7694] dark:text-[#A1C6F6] hover:text-rose-600 dark:hover:text-rose-400 rounded"
                            aria-label={tr('Quitar archivo', 'Remove file')}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>


                      {/* Detection hint line */}
                      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                        {entry.manuallyCorrected ? (
                          <span className="inline-flex items-center gap-1 text-[#022E5B] dark:text-[#499BED] font-medium">
                            <Check className="w-3.5 h-3.5" />
                            {tr(
                              'Titular / cuenta ajustados manualmente',
                              'Holder / target account manually adjusted'
                            )}
                          </span>
                        ) : entry.detectionConfidence === 'fallback' ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {tr(entry.detectionReasonEs, entry.detectionReasonEn)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#355170] dark:text-[#A1C6F6]">
                            <Sparkles className="w-3.5 h-3.5 text-[#499BED] shrink-0" />
                            {tr(entry.detectionReasonEs, entry.detectionReasonEn)}
                          </span>
                        )}
                      </div>

                      {/* Direct Correction Controls: Owner, Preset, Target Account */}
                      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6] mb-1">
                            {tr('Titular detectado (corregible)', 'Detected holder (editable)')}
                          </label>
                          <select
                            value={entry.owner}
                            onChange={(e) => {
                              const nextOwner = e.target.value as ProfileId;
                              updateFileEntry(entry.id, (prev) => {
                                const nextAcc = pickAccountForOwnerAndPreset(
                                  accounts,
                                  nextOwner,
                                  prev.preset,
                                  prev.defaultCurrency,
                                  `${prev.fileName} ${prev.rawText.slice(0, 1500)}`
                                );
                                return {
                                  ...prev,
                                  owner: nextOwner,
                                  manuallyCorrected: true,
                                  targetAccountId: nextAcc?.id || prev.targetAccountId,
                                  defaultCurrency: nextAcc?.currency || prev.defaultCurrency,
                                  newAccDraft: { ...prev.newAccDraft, owner: nextOwner },
                                };
                              });
                            }}
                            className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] font-medium"
                          >
                            {profiles.map((prof) => (
                              <option key={prof.id} value={prof.id}>
                                {prof.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6] mb-1">
                            {tr('Formato de archivo detectado', 'Detected file format')}
                          </label>
                          <select
                            value={entry.preset}
                            onChange={(e) => {
                              const nextPreset = e.target.value as Exclude<CsvPreset, 'auto'>;
                              updateFileEntry(entry.id, (prev) => {
                                const nextAcc = pickAccountForOwnerAndPreset(
                                  accounts,
                                  prev.owner,
                                  nextPreset,
                                  prev.defaultCurrency,
                                  `${prev.fileName} ${prev.rawText.slice(0, 1500)}`
                                );
                                return {
                                  ...prev,
                                  preset: nextPreset,
                                  manuallyCorrected: true,
                                  targetAccountId: nextAcc?.id || prev.targetAccountId,
                                  defaultCurrency: nextAcc?.currency || prev.defaultCurrency,
                                };
                              });
                            }}
                            className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                          >
                            {(Object.keys(FILE_FORMAT_LABELS) as Array<Exclude<CsvPreset, 'auto'>>).map((fmt) => (
                              <option key={fmt} value={fmt}>
                                {presetLabel(fmt)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6]">
                              {tr('Cuenta destino en la app', 'Target account')}
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  showCreateAccountForm: !prev.showCreateAccountForm,
                                }))
                              }
                              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#022E5B] dark:text-[#499BED] hover:underline"
                            >
                              <Plus className="w-3 h-3" />
                              {tr('Crear cuenta', 'New account')}
                            </button>
                          </div>
                          <select
                            value={targetAccount?.id || ''}
                            onChange={(e) => {
                              const pickedAcc = accounts.find((a) => a.id === e.target.value);
                              if (!pickedAcc) return;
                              updateFileEntry(entry.id, (prev) => ({
                                ...prev,
                                targetAccountId: pickedAcc.id,
                                owner: pickedAcc.owner,
                                defaultCurrency: pickedAcc.currency,
                                matchedExistingAccount: true,
                                showCreateAccountForm: false,
                                manuallyCorrected: true,
                              }));
                            }}
                            className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] font-medium"
                          >
                            {profiles.map((prof) => {
                              const profAccs = accounts.filter((a) => a.owner === prof.id);
                              if (profAccs.length === 0) return null;
                              return (
                                <optgroup key={prof.id} label={prof.name}>
                                  {profAccs.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {prof.name} · {acc.name} ({acc.currency})
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                            {orphanAccounts.length > 0 && (
                              <optgroup label={tr('Otras cuentas', 'Other accounts')}>
                                {orphanAccounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.name} ({acc.currency})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>

                      {/* Unmatched Statement / Inline New Account Creation */}
                      {(entry.showCreateAccountForm || !entry.matchedExistingAccount) && (
                        <div className="mt-2.5 p-3 rounded-lg bg-[#EDF4FF] dark:bg-[#022E5B]/55 border border-[#A1C6F6] dark:border-[#499BED]/50 space-y-2.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-[#022E5B] dark:text-[#DAEAFF] inline-flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-[#499BED]" />
                              {!entry.matchedExistingAccount
                                ? tr(
                                    'Este statement parece pertenecer a una cuenta nueva que aún no existe en Midas Tracker:',
                                    'This statement appears to belong to a new account not yet registered in Midas Tracker:'
                                  )
                                : tr(
                                    'Crear nueva cuenta y asignarla a este documento:',
                                    'Create a new account and assign it to this file:'
                                  )}
                            </span>
                            {entry.matchedExistingAccount && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateFileEntry(entry.id, (prev) => ({
                                    ...prev,
                                    showCreateAccountForm: false,
                                  }))
                                }
                                className="text-[11px] text-[#5A7694] dark:text-[#A1C6F6] hover:underline"
                              >
                                {tr('Ocultar', 'Hide')}
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <input
                              type="text"
                              value={entry.newAccDraft.name}
                              onChange={(e) =>
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  newAccDraft: { ...prev.newAccDraft, name: e.target.value },
                                }))
                              }
                              placeholder={tr('Nombre de la cuenta (ej. Cuenta sueldo)', 'Account name (e.g. Salary account)')}
                              className="px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] sm:col-span-2"
                            />
                            <select
                              value={entry.newAccDraft.owner}
                              onChange={(e) =>
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  newAccDraft: { ...prev.newAccDraft, owner: e.target.value },
                                }))
                              }
                              className="px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                            >
                              {profiles.map((prof) => (
                                <option key={prof.id} value={prof.id}>
                                  {prof.name}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <select
                                value={entry.newAccDraft.kind}
                                onChange={(e) =>
                                  updateFileEntry(entry.id, (prev) => ({
                                    ...prev,
                                    newAccDraft: {
                                      ...prev.newAccDraft,
                                      kind: e.target.value as AccountKind,
                                    },
                                  }))
                                }
                                className="flex-1 px-2 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                              >
                                {ACCOUNT_KINDS.map((k) => (
                                  <option key={k} value={k}>
                                    {accountKindLabel(k, lang)}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={entry.newAccDraft.currency}
                                onChange={(e) =>
                                  updateFileEntry(entry.id, (prev) => ({
                                    ...prev,
                                    newAccDraft: {
                                      ...prev.newAccDraft,
                                      currency: e.target.value as CurrencyCode,
                                    },
                                  }))
                                }
                                className="w-20 px-2 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] font-mono-num"
                              >
                                {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <input
                              type="text"
                              value={entry.newAccDraft.institution}
                              onChange={(e) =>
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  newAccDraft: { ...prev.newAccDraft, institution: e.target.value },
                                }))
                              }
                              placeholder={tr('Institución (opcional)', 'Institution (optional)')}
                              aria-label={tr('Institución (opcional)', 'Institution (optional)')}
                              className="w-44 px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                            />
                            <input
                              type="text"
                              value={entry.newAccDraft.notes}
                              onChange={(e) =>
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  newAccDraft: { ...prev.newAccDraft, notes: e.target.value },
                                }))
                              }
                              placeholder={tr('Notas (ej. últimos dígitos o alias)', 'Notes (e.g. last 4 digits or alias)')}
                              aria-label={tr('Notas', 'Notes')}
                              className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                            />
                            <button
                              type="button"
                              disabled={!entry.newAccDraft.name.trim()}
                              onClick={() => {
                                const draft = entry.newAccDraft;
                                if (!draft.name.trim()) return;
                                const newId = onAddAccount({
                                  name: draft.name.trim(),
                                  owner: draft.owner,
                                  kind: draft.kind,
                                  institution: draft.institution.trim() || undefined,
                                  currency: draft.currency,
                                  initialBalance: 0,
                                  notes: draft.notes.trim() || undefined,
                                });
                                updateFileEntry(entry.id, (prev) => ({
                                  ...prev,
                                  targetAccountId: newId,
                                  owner: draft.owner,
                                  defaultCurrency: draft.currency,
                                  matchedExistingAccount: true,
                                  showCreateAccountForm: false,
                                  manuallyCorrected: true,
                                  detectionReasonEs: `Cuenta "${draft.name.trim()}" creada y asignada automáticamente`,
                                  detectionReasonEn: `Account "${draft.name.trim()}" created and assigned`,
                                }));
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-45 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {tr('Crear y asignar cuenta', 'Create & assign account')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active File Inspector */}
          {activeComputed && (
            <div className="space-y-4 pt-2 border-t border-[#D3E3FA] dark:border-[#123B66]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[#355170] dark:text-[#A1C6F6]">
                  {tr('Detalle de:', 'Inspecting:')}{' '}
                  <strong className="text-[#031725] dark:text-[#DAEAFF]">
                    {activeComputed.entry.fileName}
                  </strong>{' '}
                  · {presetLabel(activeComputed.entry.preset)} →{' '}
                  <strong className="text-[#022E5B] dark:text-[#499BED]">
                    {getProfileLabel(activeComputed.entry.owner, profiles)} ·{' '}
                    {activeComputed.targetAccount?.name || tr('Sin cuenta asignada', 'Unassigned account')}
                  </strong>
                </div>

                {activeComputed.entry.headers.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateFileEntry(activeComputed.entry.id, (prev) => ({
                        ...prev,
                        showColumnMapping: !prev.showColumnMapping,
                      }))
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#022E5B] dark:text-[#499BED] hover:underline"
                  >
                    {activeComputed.entry.showColumnMapping ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        {tr('Ocultar columnas', 'Hide columns')}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        {tr('Ajustar columnas detectadas', 'Adjust detected columns')}
                      </>
                    )}
                  </button>
                )}
              </div>

              {activeComputed.entry.parseError && (
                <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 rounded-xl text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                  <div>{activeComputed.entry.parseError}</div>
                </div>
              )}

              {/* PDF diagnostics & savings closing-balance sync */}
              {(activeComputed.entry.pdfMeta ||
                (activeComputed.isGoalSaverContext &&
                  activeComputed.entry.detectedClosingBalance)) && (
                <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-3.5 space-y-2.5 bg-[#F8FBFF] dark:bg-[#041E32]">
                  {activeComputed.entry.pdfMeta && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[#355170] dark:text-[#A1C6F6]">
                        {tr('PDF leído correctamente', 'PDF parsed successfully')} (
                        {activeComputed.entry.pdfMeta.pageCount}{' '}
                        {activeComputed.entry.pdfMeta.pageCount === 1
                          ? tr('página', 'page')
                          : tr('páginas', 'pages')}
                        ).
                        {activeComputed.entry.detectedClosingBalance && (
                          <>
                            {' '}
                            {tr('Saldo final detectado:', 'Detected closing balance:')}{' '}
                            <strong className="font-mono-num text-[#031725] dark:text-[#DAEAFF]">
                              {formatMoney(
                                activeComputed.entry.detectedClosingBalance.amount,
                                activeComputed.entry.detectedClosingBalance.currency
                              )}
                            </strong>
                          </>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateFileEntry(activeComputed.entry.id, (prev) => ({
                            ...prev,
                            showRawPdfText: !prev.showRawPdfText,
                          }))
                        }
                        className="text-[#022E5B] dark:text-[#499BED] hover:underline font-medium"
                      >
                        {activeComputed.entry.showRawPdfText
                          ? tr('Ocultar texto del PDF', 'Hide extracted PDF text')
                          : tr('Ver texto detectado del PDF', 'View extracted PDF text')}
                      </button>
                    </div>
                  )}

                  {activeComputed.entry.showRawPdfText && activeComputed.entry.pdfMeta && (
                    <pre className="p-3 bg-white dark:bg-[#031725] border border-[#D3E3FA] dark:border-[#123B66] rounded-lg text-[11px] font-mono-num text-[#355170] dark:text-[#A1C6F6] max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {activeComputed.entry.pdfMeta.rawPreviewLines.join('\n')}
                    </pre>
                  )}

                  {activeComputed.isGoalSaverContext &&
                    activeComputed.entry.detectedClosingBalance &&
                    activeComputed.savingsTarget &&
                    onUpdateSavingsConfig && (
                      <label className="flex items-center gap-2 text-xs font-medium text-[#031725] dark:text-[#DAEAFF] cursor-pointer pt-0.5">
                        <input
                          type="checkbox"
                          checked={activeComputed.entry.syncGoalSaverBalance}
                          onChange={(e) =>
                            updateFileEntry(activeComputed.entry.id, (prev) => ({
                              ...prev,
                              syncGoalSaverBalance: e.target.checked,
                            }))
                          }
                          className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
                        />
                        <span>
                          {tr(
                            'Actualizar automáticamente el capital actual de',
                            'Automatically update current capital for'
                          )}{' '}
                          <strong>
                            {activeComputed.savingsTarget.name} ({getProfileLabel(activeComputed.entry.owner, profiles)})
                          </strong>{' '}
                          {tr('a', 'to')}{' '}
                          <strong className="font-mono-num text-[#022E5B] dark:text-[#499BED]">
                            {formatMoney(
                              activeComputed.entry.detectedClosingBalance.amount,
                              activeComputed.entry.detectedClosingBalance.currency
                            )}
                          </strong>
                        </span>
                      </label>
                    )}
                </div>
              )}

              {/* Column Mapping (Collapsible) */}
              {activeComputed.entry.showColumnMapping && activeComputed.entry.headers.length > 0 && (
                <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl p-4 space-y-3 bg-[#F8FBFF] dark:bg-[#041E32]">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Columna Fecha', 'Date column')}
                      </label>
                      <select
                        value={activeComputed.entry.colDate}
                        onChange={(e) =>
                          updateFileEntry(activeComputed.entry.id, (prev) => ({
                            ...prev,
                            colDate: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                      >
                        {activeComputed.entry.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Columna Monto', 'Amount column')}
                      </label>
                      <select
                        value={
                          activeComputed.entry.colDebit >= 0 || activeComputed.entry.colCredit >= 0
                            ? -2
                            : activeComputed.entry.colAmount
                        }
                        onChange={(e) =>
                          updateFileEntry(activeComputed.entry.id, (prev) => {
                            const v = Number(e.target.value);
                            if (v === -2) {
                              const lowerHdrs = prev.headers.map((h) => h.toLowerCase());
                              const debit = lowerHdrs.findIndex((h) => /debit|withdrawal|money out|cargo|d[eé]bito/.test(h));
                              const credit = lowerHdrs.findIndex((h) => /credit|deposit|money in|abono|cr[eé]dito/.test(h));
                              return { ...prev, colDebit: debit, colCredit: credit };
                            }
                            return { ...prev, colAmount: v, colDebit: -1, colCredit: -1 };
                          })
                        }
                        className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                      >
                        {activeComputed.entry.headers.some((h) =>
                          /debit|credit|withdrawal|deposit|cargo|abono|d[eé]bito|cr[eé]dito/i.test(h)
                        ) && (
                          <option value={-2}>
                            {tr('Débito / Crédito (columnas separadas)', 'Debit / Credit (separate columns)')}
                          </option>
                        )}
                        {activeComputed.entry.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Columna Descripción', 'Description column')}
                      </label>
                      <select
                        value={activeComputed.entry.colDesc}
                        onChange={(e) =>
                          updateFileEntry(activeComputed.entry.id, (prev) => ({
                            ...prev,
                            colDesc: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                      >
                        {activeComputed.entry.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#355170] dark:text-[#A1C6F6] mb-1">
                        {tr('Columna Moneda (opcional)', 'Currency column (optional)')}
                      </label>
                      <select
                        value={activeComputed.entry.colCurrency}
                        onChange={(e) =>
                          updateFileEntry(activeComputed.entry.id, (prev) => ({
                            ...prev,
                            colCurrency: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                      >
                        <option value={-1}>
                          {tr(
                            `Usar ${activeComputed.entry.defaultCurrency}`,
                            `Use ${activeComputed.entry.defaultCurrency}`
                          )}
                        </option>
                        {activeComputed.entry.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Portfolio sync toggle (broker statements) */}
              {activeComputed.isMoomooMode && (
                <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl px-4 py-3 bg-[#F8FBFF] dark:bg-[#041E32] flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-[#031725] dark:text-[#DAEAFF] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeComputed.entry.importMoomooToPortfolio}
                      onChange={(e) =>
                        updateFileEntry(activeComputed.entry.id, (prev) => ({
                          ...prev,
                          importMoomooToPortfolio: e.target.checked,
                        }))
                      }
                      className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
                    />
                    {tr(
                      `Actualizar automáticamente acciones y ETFs de ${getProfileLabel(
                        activeComputed.entry.owner,
                        profiles
                      )} en el portafolio de inversiones`,
                      `Automatically sync ${getProfileLabel(
                        activeComputed.entry.owner,
                        profiles
                      )}'s stocks & ETFs in the investment portfolio`
                    )}
                  </label>
                  <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                    {tr(
                      'Los dividendos se registrarán como ingresos en el historial.',
                      'Dividends will be logged as income in transaction history.'
                    )}
                  </span>
                </div>
              )}

              {/* Preview Table */}
              {activeComputed.previewRows.length > 0 && (
                <div className="border border-[#D3E3FA] dark:border-[#123B66] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#EAF2FF]/80 dark:bg-[#022E5B]/55 border-b border-[#D3E3FA] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#031725] dark:text-[#DAEAFF]">
                      {tr('Vista previa', 'Preview')} ({activeComputed.selectedRows.length}{' '}
                      {tr('de', 'of')} {activeComputed.previewRows.length}{' '}
                      {tr('seleccionadas', 'selected')})
                      {activeComputed.duplicateCount > 0 && (
                        <span className="ml-2 text-amber-700 dark:text-amber-300 font-normal">
                          · {activeComputed.duplicateCount}{' '}
                          {tr('duplicado(s) desmarcados automáticamente', 'duplicate(s) auto-skipped')}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          updateFileEntry(activeComputed.entry.id, (prev) => {
                            const nextOverrides = { ...prev.rowOverrides };
                            activeComputed.previewRows.forEach((r) => {
                              nextOverrides[r.rowIndex] = {
                                ...nextOverrides[r.rowIndex],
                                selected: !r.isDuplicate,
                              };
                            });
                            return { ...prev, rowOverrides: nextOverrides };
                          });
                        }}
                        className="text-[#022E5B] dark:text-[#499BED] hover:underline font-medium"
                      >
                        {tr('Solo nuevos', 'New only')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateFileEntry(activeComputed.entry.id, (prev) => {
                            const nextOverrides = { ...prev.rowOverrides };
                            activeComputed.previewRows.forEach((r) => {
                              nextOverrides[r.rowIndex] = {
                                ...nextOverrides[r.rowIndex],
                                selected: true,
                              };
                            });
                            return { ...prev, rowOverrides: nextOverrides };
                          });
                        }}
                        className="text-[#022E5B] dark:text-[#499BED] hover:underline font-medium"
                      >
                        {tr('Todas', 'All')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateFileEntry(activeComputed.entry.id, (prev) => {
                            const nextOverrides = { ...prev.rowOverrides };
                            activeComputed.previewRows.forEach((r) => {
                              nextOverrides[r.rowIndex] = {
                                ...nextOverrides[r.rowIndex],
                                selected: false,
                              };
                            });
                            return { ...prev, rowOverrides: nextOverrides };
                          });
                        }}
                        className="text-[#5A7694] dark:text-[#A1C6F6] hover:underline"
                      >
                        {tr('Ninguna', 'None')}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-white dark:bg-[#062035] sticky top-0 border-b border-[#D3E3FA] dark:border-[#123B66] text-[#355170] dark:text-[#A1C6F6]">
                        <tr>
                          <th className="py-2 px-3 w-8">{tr('Inc.', 'Inc.')}</th>
                          <th className="py-2 px-3">{tr('Fecha', 'Date')}</th>
                          <th className="py-2 px-3">{tr('Descripción', 'Description')}</th>
                          <th className="py-2 px-3">{tr('Tipo', 'Type')}</th>
                          <th className="py-2 px-3">{tr('Categoría', 'Category')}</th>
                          <th className="py-2 px-3 text-right">{tr('Monto', 'Amount')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EFFB] dark:divide-[#123B66]">
                        {activeComputed.previewRows.map((row) => (
                          <tr
                            key={row.rowIndex}
                            className={`hover:bg-[#F5F9FF] dark:hover:bg-[#082A46] ${
                              row.isDuplicate && !row.selected ? 'opacity-60' : ''
                            }`}
                          >
                            <td className="py-2 px-3">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={(e) =>
                                  updateFileEntry(activeComputed.entry.id, (prev) => ({
                                    ...prev,
                                    rowOverrides: {
                                      ...prev.rowOverrides,
                                      [row.rowIndex]: {
                                        ...prev.rowOverrides[row.rowIndex],
                                        selected: e.target.checked,
                                      },
                                    },
                                  }))
                                }
                                className="rounded border-[#C6DAF7] dark:border-[#1B4A7C] accent-[#499BED]"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono-num text-[#5A7694] dark:text-[#A1C6F6] whitespace-nowrap">
                              {row.date}
                            </td>
                            <td className="py-2 px-3 text-[#031725] dark:text-[#DAEAFF] max-w-[280px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate">{row.description}</span>
                                {row.isDuplicate && (
                                  <span
                                    title={
                                      row.duplicateSource === 'batch'
                                        ? tr(
                                            'Ya incluido en otro documento de este mismo lote',
                                            'Already included in an earlier document in this batch'
                                          )
                                        : tr(
                                            'Ya existe en tu historial guardado',
                                            'Already exists in your saved history'
                                          )
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 shrink-0"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    {row.duplicateSource === 'batch'
                                      ? tr('Duplicado en lote', 'Batch duplicate')
                                      : tr('Ya importado', 'Already imported')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={row.type}
                                onChange={(e) =>
                                  updateFileEntry(activeComputed.entry.id, (prev) => ({
                                    ...prev,
                                    rowOverrides: {
                                      ...prev.rowOverrides,
                                      [row.rowIndex]: {
                                        ...prev.rowOverrides[row.rowIndex],
                                        type: e.target.value as TransactionType,
                                      },
                                    },
                                  }))
                                }
                                className="px-2 py-1 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF]"
                              >
                                <option value="expense">{tr('Gasto', 'Expense')}</option>
                                <option value="income">{tr('Ingreso', 'Income')}</option>
                                <option value="transfer">{tr('Transferencia', 'Transfer')}</option>
                              </select>
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={row.categoryId}
                                onChange={(e) =>
                                  updateFileEntry(activeComputed.entry.id, (prev) => ({
                                    ...prev,
                                    rowOverrides: {
                                      ...prev.rowOverrides,
                                      [row.rowIndex]: {
                                        ...prev.rowOverrides[row.rowIndex],
                                        categoryId: e.target.value,
                                      },
                                    },
                                  }))
                                }
                                className="px-2 py-1 border border-[#C6DAF7] dark:border-[#1B4A7C] rounded bg-white dark:bg-[#031725] text-[#031725] dark:text-[#DAEAFF] max-w-[160px]"
                              >
                                {categories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>
                                    {catName(cat)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                                row.type === 'income'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : row.type === 'transfer'
                                  ? 'text-[#5A7694] dark:text-[#A1C6F6]'
                                  : 'text-[#031725] dark:text-[#DAEAFF]'
                              }`}
                            >
                              {row.type === 'income' ? '+' : row.type === 'expense' ? '-' : ''}
                              {formatMoney(row.amount, row.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {importSuccessMsg && (
            <div className="flex items-center gap-2 p-3.5 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200 rounded-xl text-sm font-medium">
              <Check className="w-4 h-4 shrink-0" />
              {importSuccessMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#EAF2FF]/50 dark:bg-[#041E32] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
            {files.length > 0 ? (
              <span>
                {tr('Lote listo:', 'Batch ready:')}{' '}
                <strong className="text-[#031725] dark:text-[#DAEAFF] font-mono-num">
                  {batchStats.selectedRows}
                </strong>{' '}
                {tr('movimiento(s) nuevos de', 'new transaction(s) from')}{' '}
                <strong className="text-[#031725] dark:text-[#DAEAFF] font-mono-num">
                  {files.length}
                </strong>{' '}
                {tr('archivo(s)', 'file(s)')}
                {batchStats.duplicates > 0 && (
                  <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                    ({batchStats.duplicates} {tr('duplicados omitidos', 'duplicates skipped')})
                  </span>
                )}
              </span>
            ) : (
              <span>
                {tr(
                  'Soporta carga múltiple simultánea de PDF y CSV.',
                  'Supports simultaneous multi-file PDF and CSV upload.'
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[#355170] dark:text-[#A1C6F6] hover:bg-[#DAEAFF]/60 dark:hover:bg-[#022E5B] rounded-lg transition-colors"
            >
              {tr('Cancelar', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={
                (batchStats.selectedRows === 0 && batchStats.goalSaverSyncs === 0) ||
                isParsing
              }
              onClick={handleConfirmImport}
              className="px-5 py-2 text-sm font-semibold text-white dark:text-[#031725] bg-[#022E5B] dark:bg-[#499BED] hover:bg-[#031725] dark:hover:bg-[#6EB1F5] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {files.length > 1
                ? tr(
                    `Importar lote (${batchStats.selectedRows})`,
                    `Import batch (${batchStats.selectedRows})`
                  )
                : tr(
                    `Importar ${batchStats.selectedRows > 0 ? `(${batchStats.selectedRows})` : ''}`,
                    `Import ${batchStats.selectedRows > 0 ? `(${batchStats.selectedRows})` : ''}`
                  )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
