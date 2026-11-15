import 'dotenv/config';
import { verifyFirebaseIdToken } from './serverAuth.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { parseYahooChart, type MarketQuote, type YahooChartResponse } from './src/utils/marketData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Model can be overridden with GEMINI_MODEL in .env (e.g. "gemini-2.5-flash").
// "gemini-flash-latest" is Google's alias that always points to the current Flash model.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-flash-latest';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please verify your Settings > Secrets configuration.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 450 * attempt));
      }
    }
  }
  throw lastError;
}

function sendAiError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected AI service error';
  const status =
    message.includes('GEMINI_API_KEY') || message.includes('API_KEY')
      ? 400
      : message.includes('429') || message.includes('RESOURCE_EXHAUSTED')
      ? 429
      : message.includes('403') || message.includes('PERMISSION_DENIED')
      ? 403
      : 500;
  res.status(status).json({ error: message });
}

function safeJsonParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  }
}

const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

/** FIREBASE_X, also accepting the older VITE_FIREBASE_X name. */
function readEnv(name: string): string {
  return (process.env[name] || process.env[`VITE_${name}`] || '').trim();
}

const quoteCache = new Map<string, { at: number; quote: MarketQuote }>();

async function fetchYahooQuote(symbol: string, range = '10y', interval = '1mo'): Promise<MarketQuote> {
  const cacheKey = `${symbol}|${range}|${interval}`;
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.quote;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}&events=div`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MidasTracker/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    const json = (await r.json().catch(() => ({}))) as YahooChartResponse;
    const quote = parseYahooChart(symbol, json);
    if (quote.ok) quoteCache.set(cacheKey, { at: Date.now(), quote });
    return quote;
  } catch (err) {
    return {
      symbol,
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
      price: 0,
      currency: '',
      name: symbol,
      dividendYieldPct: 0,
      historicalCagrPct: null,
      historyYears: 0,
    };
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  // Cloud Run / proxies: trust the first proxy so req.ip is the real client address.
  app.set('trust proxy', 1);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Public Firebase web config, read at RUNTIME so hosting secrets (AI Studio / Cloud Run) work without
  // rebuilding. These values are not secret: access is enforced by the Firestore security rules.
  app.get('/api/config', (_req: Request, res: Response) => {
    const apiKey = readEnv('FIREBASE_API_KEY');
    const projectId = readEnv('FIREBASE_PROJECT_ID');
    const authDomain = readEnv('FIREBASE_AUTH_DOMAIN') || (projectId ? `${projectId}.firebaseapp.com` : '');
    const emulatorHost =
      !isProduction && process.env.FIREBASE_AUTH_EMULATOR_HOST
        ? process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':')[0]
        : '';
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      firebase:
        apiKey && projectId
          ? {
              apiKey,
              authDomain,
              projectId,
              appId: readEnv('FIREBASE_APP_ID') || undefined,
              storageBucket: readEnv('FIREBASE_STORAGE_BUCKET') || undefined,
              messagingSenderId: readEnv('FIREBASE_MESSAGING_SENDER_ID') || undefined,
            }
          : null,
      householdId: readEnv('FIREBASE_HOUSEHOLD_ID') || 'hogar',
      emulatorHost,
    });
  });

  // A typical PDF statement (≈7 MB) is ≈10 MB once base64-encoded in JSON.
  app.use(express.json({ limit: '10mb' }));

  // --- Protection for the AI endpoints (they spend the Gemini key) ---
  // Only the signed-in Google accounts listed in ALLOWED_EMAILS can use them: the client sends its
  // Firebase ID token and the server verifies it (signature, project, expiry, verified email).
  const firebaseProjectId = readEnv('FIREBASE_PROJECT_ID');
  const allowedEmails = new Set(
    (process.env.ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  const aiAuthConfigured = Boolean(firebaseProjectId && allowedEmails.size > 0);
  if (!aiAuthConfigured) {
    console.warn(
      isProduction
        ? 'Falta FIREBASE_PROJECT_ID o ALLOWED_EMAILS: las funciones de IA quedan DESACTIVADAS en producción.'
        : 'Sin FIREBASE_PROJECT_ID / ALLOWED_EMAILS: la IA no verifica usuario (solo desarrollo local).'
    );
  }

  // Simple in-memory fixed-window rate limit per client IP (good enough for a single small instance).
  const AI_RATE_LIMIT_PER_MINUTE = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 20;
  const rateWindows = new Map<string, { windowStart: number; count: number }>();
  const aiRateLimit = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const entry = rateWindows.get(key);
    if (!entry || now - entry.windowStart >= 60_000) {
      rateWindows.set(key, { windowStart: now, count: 1 });
    } else if (entry.count >= AI_RATE_LIMIT_PER_MINUTE) {
      const retryAfter = Math.ceil((entry.windowStart + 60_000 - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: `Demasiadas solicitudes de IA. Espera ${retryAfter} s e inténtalo de nuevo.` });
      return;
    } else {
      entry.count += 1;
    }
    if (rateWindows.size > 5000) {
      for (const [k, v] of rateWindows) if (now - v.windowStart >= 60_000) rateWindows.delete(k);
    }
    next();
  };

  const requireAllowedUser = async (req: Request, res: Response, next: NextFunction) => {
    if (!aiAuthConfigured) {
      if (isProduction) {
        res.status(503).json({ error: 'La IA está desactivada: configura FIREBASE_PROJECT_ID y ALLOWED_EMAILS en el servidor.' });
        return;
      }
      next();
      return;
    }
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Inicia sesión para usar la IA.' });
      return;
    }
    try {
      const user = await verifyFirebaseIdToken(token, firebaseProjectId);
      if (!user.emailVerified || !allowedEmails.has(user.email)) {
        res.status(403).json({ error: 'Esta cuenta no está autorizada para usar la IA.' });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: 'Sesión inválida o vencida. Vuelve a iniciar sesión.' });
    }
  };

  // Rate limit first (also throttles token guessing), then the user check.
  app.use('/api/ai', aiRateLimit, requireAllowedUser);

  // 1. Document Reading & Multimodal Recognition + Post-Extraction Classification
  app.post('/api/ai/analyze-document', async (req: Request, res: Response) => {
    try {
      const {
        fileName,
        mimeType,
        base64Data,
        textContent,
        profiles = [],
        accounts = [],
        categories = [],
        activeProfile = 'all',
        lang = 'es',
      } = req.body as {
        fileName: string;
        mimeType: string;
        base64Data?: string;
        textContent?: string;
        profiles?: Array<{ id: string; name: string; role?: string; email?: string }>;
        accounts: Array<{
          id: string;
          name: string;
          owner: string;
          kind: string;
          institution?: string;
          currency: string;
          notes?: string;
        }>;
        categories: Array<{ id: string; name: string; type: string }>;
        activeProfile: string;
        lang: 'es' | 'en';
      };

      // Profiles always come from the app; never assume who the household is.
      if (!Array.isArray(profiles) || profiles.length === 0) {
        res.status(400).json({ error: 'No se recibieron perfiles. Crea al menos un perfil en la app antes de usar la IA.' });
        return;
      }
      const ai = getAiClient();
      const effectiveProfiles = profiles;
      const fallbackOwner =
        activeProfile !== 'all' && effectiveProfiles.some((p) => p.id === activeProfile)
          ? activeProfile
          : effectiveProfiles[0].id;

      const promptText = `You are the Midas Tracker AI Financial Document Agent.
Analyze the provided financial statement, bank export, broker report, or receipt (${fileName || 'document'}) and extract every transaction accurately.

CONTEXT:
- Household profiles / valid owner IDs:
${JSON.stringify(effectiveProfiles)}
- Active UI profile filter: "${activeProfile}".
- Available user accounts in Midas Tracker:
${JSON.stringify(accounts)}
- Available categories in Midas Tracker (classify EVERY transaction with the best matching categoryId):
${JSON.stringify(categories)}
- Output language for explanations ("ownerReason", "summary", "classificationNote"): ${lang === 'en' ? 'English' : 'Spanish'}.

INSTRUCTIONS:
1. Detect who owns this statement using one exact "id" from the household profiles list above (from account holder name, email, filename, account numbers, or context clues). If unsure, use "${fallbackOwner}" with confidence="fallback".
2. Detect the FILE FORMAT "preset" (how the document is laid out, not the account type): "commbank" | "goalsaver" | "revolut" | "moomoo" | "generic". Use "generic" when it doesn't match a known layout.
3. Check if the document belongs to one of the user's EXISTING accounts above:
   - If YES (same institution, owner, account type and currency match an existing account), set "matchedExistingAccount": true, "targetAccountId" to that exact account id, and "suggestedNewAccount.shouldCreate": false.
   - If NO (for example: an external bank like ING, ANZ, NAB, Westpac, Up Bank, Macquarie, HSBC, Amex, PayPal, or a bank/currency/profile combination that is NOT in the existing accounts list), set "matchedExistingAccount": false, "targetAccountId": "", and fill "suggestedNewAccount" with shouldCreate: true, a short descriptive "name" (e.g., "Everyday account (AUD)", "Savings (AUD)"), valid "owner" ID, generic account type "kind" ("transaccional" | "ahorro" | "inversion" | "tarjeta_credito" | "efectivo" | "otra"), "institution" (bank/broker name printed on the document, or ""), "currency", and short "notes".
4. Detect primary currency ("AUD", "USD", "EUR", "ARS", "MXN", "CLP") and closingBalance if printed (0 if not found).
5. Extract ALL real financial movements (skip running balance lines, headers, subtotals, opening/closing balance summary lines).
6. For each movement:
   - Normalize "date" to YYYY-MM-DD.
   - Clean "description" to a concise readable merchant/concept name.
   - Determine "type":
     * "transfer" ONLY when moving money between the user's own accounts (e.g., transfer to the savings account, transfer from the everyday account) and set categoryId to "cat_transfer" if available.
     * "income" for salary, interest, dividends, refunds, deposits.
     * "expense" for purchases, bills, subscriptions, stock/ETF BUYs.
   - Set "direction" to "in" when money ENTERS this statement's account (deposits, credits, incoming transfers) and "out" when it LEAVES it (debits, purchases, outgoing transfers).
   - Always make "amount" a positive number (> 0).
   - For broker / investment rows, populate "ticker" (e.g., VOO, AAPL), "tradeAction" ("BUY" | "SELL" | "DIVIDEND"), "shares", "price", and "assetType" ("ETF" | "Acción" | "Fondo"). For other rows, leave ticker and tradeAction as empty strings "".
   - Assign the most accurate "categoryId" from the provided categories list (avoid "cat_otros_gastos" unless truly unknown).
${textContent ? `\nEXTRACTED TEXT / CSV CONTENT:\n${textContent.slice(0, 48000)}` : ''}`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (base64Data && mimeType && (mimeType === 'application/pdf' || mimeType.startsWith('image/'))) {
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      }
      parts.push({ text: promptText });

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                owner: { type: Type.STRING, description: 'Exact profile id from context' },
                ownerReason: { type: Type.STRING },
                confidence: { type: Type.STRING, description: '"high" | "medium" | "fallback"' },
                preset: {
                  type: Type.STRING,
                  description: 'File format: "commbank" | "goalsaver" | "revolut" | "moomoo" | "generic"',
                },
                targetAccountId: { type: Type.STRING },
                matchedExistingAccount: { type: Type.BOOLEAN },
                suggestedNewAccount: {
                  type: Type.OBJECT,
                  properties: {
                    shouldCreate: { type: Type.BOOLEAN },
                    name: { type: Type.STRING },
                    owner: { type: Type.STRING },
                    institution: { type: Type.STRING },
                    kind: {
                      type: Type.STRING,
                      description: 'Generic account type: "transaccional" | "ahorro" | "inversion" | "tarjeta_credito" | "efectivo" | "otra"',
                    },
                    currency: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                },
                detectedCurrency: { type: Type.STRING },
                closingBalance: { type: Type.NUMBER },
                summary: { type: Type.STRING },
                transactions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      description: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      type: { type: Type.STRING, description: '"expense" | "income" | "transfer"' },
                      direction: { type: Type.STRING, description: '"in" | "out" relative to this statement account' },
                      currency: { type: Type.STRING },
                      categoryId: { type: Type.STRING },
                      classificationNote: { type: Type.STRING },
                      ticker: { type: Type.STRING },
                      tradeAction: { type: Type.STRING },
                      shares: { type: Type.NUMBER },
                      price: { type: Type.NUMBER },
                      assetType: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        })
      );

      const data = safeJsonParse(response.text, {
        owner: fallbackOwner,
        ownerReason: '',
        confidence: 'fallback',
        preset: 'generic',
        targetAccountId: accounts[0]?.id || '',
        matchedExistingAccount: accounts.length > 0,
        detectedCurrency: 'AUD',
        closingBalance: 0,
        summary: '',
        transactions: [],
      });

      res.json(data);
    } catch (err) {
      sendAiError(res, err);
    }
  });

  // 2. Post-Import ("A Posteriori") Smart Transaction Reclassification & Cleanup
  app.post('/api/ai/classify-transactions', async (req: Request, res: Response) => {
    try {
      const {
        transactions = [],
        categories = [],
        accounts = [],
        lang = 'es',
      } = req.body as {
        transactions: Array<{
          id: string;
          date: string;
          description: string;
          amount: number;
          currency: string;
          type: string;
          categoryId: string;
          accountId: string;
          owner: string;
        }>;
        categories: Array<{ id: string; name: string; type: string }>;
        accounts: Array<{ id: string; name: string; owner: string; kind: string }>;
        lang: 'es' | 'en';
      };

      const ai = getAiClient();
      const batch = transactions.slice(0, 120);

      const prompt = `You are the Midas Tracker Post-Import Classification Agent.
Review these already-recorded transactions and propose ONLY meaningful improvements (a posteriori classification) when:
1. A transaction is in a generic category (e.g. "cat_otros_gastos", "cat_otros_ingresos") or wrong category given its merchant/description.
2. A transaction has the wrong type (for instance, a movement between the user's own accounts such as "Transfer to savings" or "Transfer from everyday account" currently tagged as "expense" or "income" should be type="transfer" and categoryId="cat_transfer").
3. A raw bank description is messy/cryptic (e.g. "POS WOOLWORTHS 1042 SYDNEY AU 00412") and can be clarified slightly while preserving the merchant identity.

Do NOT include transactions whose categoryId, type, and description are already accurate.
Output language for "summary" and "reason": ${lang === 'en' ? 'English' : 'Spanish'}.

AVAILABLE CATEGORIES:
${JSON.stringify(categories)}

AVAILABLE ACCOUNTS:
${JSON.stringify(accounts)}

TRANSACTIONS TO AUDIT:
${JSON.stringify(batch)}`;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                suggestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      suggestedCategoryId: { type: Type.STRING },
                      suggestedType: { type: Type.STRING },
                      suggestedDescription: { type: Type.STRING },
                      confidence: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        })
      );

      const data = safeJsonParse(response.text, { summary: '', suggestions: [] });
      res.json(data);
    } catch (err) {
      sendAiError(res, err);
    }
  });

  // 3. Quick Natural-Language or Receipt-Image Entry Parser for TransactionModal
  app.post('/api/ai/parse-quick-entry', async (req: Request, res: Response) => {
    try {
      const {
        promptText = '',
        imageBase64,
        imageMimeType,
        profiles = [],
        accounts = [],
        categories = [],
        activeProfile = 'all',
        todayIso,
        lang = 'es',
      } = req.body as {
        promptText?: string;
        imageBase64?: string;
        imageMimeType?: string;
        profiles?: Array<{ id: string; name: string }>;
        accounts: Array<{ id: string; name: string; owner: string; kind: string; currency: string }>;
        categories: Array<{ id: string; name: string; type: string }>;
        activeProfile: string;
        todayIso: string;
        lang: 'es' | 'en';
      };

      if (!Array.isArray(profiles) || profiles.length === 0) {
        res.status(400).json({ error: 'No se recibieron perfiles. Crea al menos un perfil en la app antes de usar la IA.' });
        return;
      }
      const ai = getAiClient();

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageBase64 && imageMimeType) {
        parts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: imageBase64,
          },
        });
      }

      parts.push({
        text: `Parse the user's natural-language expense/income/transfer note or receipt image into structured fields for Midas Tracker.
Today's date is ${todayIso}. Active profile filter is "${activeProfile}".
Output language for "reasoning" and "description" (keep merchant names intact): ${lang === 'en' ? 'English' : 'Spanish'}.

PROFILES (return exact "owner" id from here):
${JSON.stringify(profiles)}

ACCOUNTS:
${JSON.stringify(accounts)}

CATEGORIES:
${JSON.stringify(categories)}

USER INPUT:
${promptText || '(See attached receipt/screenshot image)'}`,
      });

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                owner: { type: Type.STRING },
                type: { type: Type.STRING },
                date: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                currency: { type: Type.STRING },
                accountId: { type: Type.STRING },
                toAccountId: { type: Type.STRING },
                categoryId: { type: Type.STRING },
                description: { type: Type.STRING },
                reasoning: { type: Type.STRING },
              },
            },
          },
        })
      );

      const data = safeJsonParse(response.text, {});
      res.json(data);
    } catch (err) {
      sendAiError(res, err);
    }
  });

  // 4. Conversational & Actionable Household Financial AI Agent
  app.post('/api/ai/assistant', async (req: Request, res: Response) => {
    try {
      const {
        messages = [],
        activeTab = 'dashboard',
        activeProfile = 'all',
        selectedMonth,
        lang = 'es',
        financialSnapshot,
      } = req.body as {
        messages: Array<{ role: 'user' | 'model'; text: string }>;
        activeTab: string;
        activeProfile: string;
        selectedMonth: string;
        lang: 'es' | 'en';
        financialSnapshot: Record<string, unknown>;
      };

      const ai = getAiClient();

      const systemInstruction = `You are the Midas Tracker AI Financial Agent for the household finance app.
You receive a compact snapshot of the selected month (profiles, month summary, totals per category, budgets, account balances, savings accounts with interest, investment holdings, fixed bills and that month's movements, possibly capped) and you help improve every part of the app:
- Overview & Analytics: diagnose cashflow, savings rate, account-by-account performance, and spending spikes.
- Transactions: spot misclassified rows, duplicates, or hidden recurring expenses.
- Budgets: explain exceeded categories and propose realistic budget adjustments.
- Accounts & savings: create/delete accounts when requested or when an extra account is needed, and optimize cash allocation and bonus-interest conditions of savings accounts.
- Investments: analyze portfolio diversification, currency exposure, and dividend yield strategy.
- Only the selected month's movements are included; if the user asks about other periods, say what data you have.

RESPONSE RULES:
- Reply strictly in ${lang === 'en' ? 'English' : 'Spanish'}.
- Be concrete, data-backed (cite exact profile names, numbers, accounts, tickers, categories from the snapshot), concise, and practical.
- When the user asks to classify, create a budget, add a recurring fixed bill, log a transaction, or CREATE / DELETE an account — or when you see a clear opportunity to fix something in the snapshot — return actionable items in "proposedActions" using ONLY exact valid profile ids, categoryId, accountId, and txId values present in the snapshot! Never invent fake IDs.
- Valid actionType values: "reclassify_tx" | "upsert_budget" | "add_fixed_expense" | "add_transaction" | "create_account" | "delete_account".
- For "create_account": include "description" (account name), "owner" (exact profile id), "accountKind" (generic type: "transaccional"|"ahorro"|"inversion"|"tarjeta_credito"|"efectivo"|"otra"), optional "institution" (bank name), "currency", "amount" (initialBalance, default 0), and optional "notes".
- For "delete_account": include exact "accountId" and "description" (account name).
- If no state change is needed, return proposedActions as an empty array [].`;

      // Only the last 10 turns are used (the client already trims; this is a server-side guard).
      const conversationText = (Array.isArray(messages) ? messages : [])
        .slice(-10)
        .map((m) => ({ role: m.role, text: String(m.text || '').slice(0, 4000) }))
        .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
        .join('\n\n');

      const prompt = `ACTIVE VIEW: ${activeTab} | ACTIVE PROFILE: ${activeProfile} | MONTH: ${selectedMonth}

CURRENT FINANCIAL SNAPSHOT:
${JSON.stringify(financialSnapshot)}

CONVERSATION:
${conversationText}`;

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                highlights: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                proposedActions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      actionType: {
                        type: Type.STRING,
                        description:
                          '"reclassify_tx" | "upsert_budget" | "add_fixed_expense" | "add_transaction" | "create_account" | "delete_account"',
                      },
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      txId: { type: Type.STRING },
                      categoryId: { type: Type.STRING },
                      txType: { type: Type.STRING },
                      description: { type: Type.STRING },
                      owner: { type: Type.STRING },
                      monthlyLimit: { type: Type.NUMBER },
                      currency: { type: Type.STRING },
                      amount: { type: Type.NUMBER },
                      dueDay: { type: Type.NUMBER },
                      accountId: { type: Type.STRING },
                      accountKind: { type: Type.STRING },
                      institution: { type: Type.STRING },
                      notes: { type: Type.STRING },
                      date: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        })
      );

      const data = safeJsonParse(response.text, {
        reply:
          lang === 'en'
            ? 'I analyzed your financial data, please try asking again.'
            : 'Analicé tus datos financieros; por favor intenta formular tu consulta nuevamente.',
        highlights: [],
        proposedActions: [],
      });

      res.json(data);
    } catch (err) {
      sendAiError(res, err);
    }
  });

  // 5. Real market data (stock/ETF quotes, dividends, historical growth) and live FX rates.
  //    Uses Yahoo Finance public chart endpoint (no API key required).
  app.get('/api/market/quotes', async (req: Request, res: Response) => {
    const raw = String(req.query.symbols || '');
    const symbols = Array.from(
      new Set(
        raw
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z0-9.\-=^]{1,20}$/.test(s))
      )
    ).slice(0, 40);
    if (symbols.length === 0) {
      res.status(400).json({ error: 'No valid symbols provided' });
      return;
    }
    const results = await Promise.all(symbols.map((s) => fetchYahooQuote(s)));
    res.json({ quotes: results, fetchedAt: new Date().toISOString() });
  });

  app.get('/api/market/fx', async (_req: Request, res: Response) => {
    try {
      // Yahoo "XXX=X" symbols give how many XXX one USD buys.
      const codes = ['AUD', 'EUR', 'ARS', 'MXN', 'CLP'] as const;
      const quotes = await Promise.all(codes.map((c) => fetchYahooQuote(`${c}=X`, '5d', '1d')));
      const usdTo: Record<string, number> = { USD: 1 };
      codes.forEach((c, i) => {
        const q = quotes[i];
        if (q.ok && q.price > 0) usdTo[c] = q.price;
      });
      if (!usdTo.AUD) {
        res.status(502).json({ error: 'Could not fetch AUD exchange rate' });
        return;
      }
      // Express every rate as "value of 1 unit in AUD" (the app's internal convention).
      const rates: Record<string, number> = { AUD: 1 };
      for (const c of ['USD', 'EUR', 'ARS', 'MXN', 'CLP']) {
        if (usdTo[c]) rates[c] = usdTo.AUD / usdTo[c];
      }
      res.json({ rates, fetchedAt: new Date().toISOString() });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'FX fetch failed' });
    }
  });

  // JSON errors for oversized or malformed bodies (instead of Express' HTML error page).
  app.use((err: { type?: string; status?: number } & Error, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'El archivo es demasiado grande (máximo ~7 MB por documento).' });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Solicitud JSON inválida.' });
      return;
    }
    next(err);
  });

  let closeVite: (() => Promise<void>) | null = null;

  if (isProduction) {
    // Compiled frontend (npm run build). Resolved from the project root, where server.js lives.
    const distPath = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      throw new Error(`No existe ${distPath}/index.html. Ejecuta "npm run build" antes de "npm start".`);
    }
    app.use(express.static(distPath, { index: false, maxAge: '1h' }));
    // Hashed assets can be cached for a long time; index.html must always be fresh.
    app.use('/assets', express.static(path.join(distPath, 'assets'), { immutable: true, maxAge: '1y' }));
    // SPA fallback (Express 4 syntax). API routes are registered above, so they take precedence.
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    closeVite = () => vite.close();
    app.use(vite.middlewares);
  }

  // Cloud Run / AI Studio: listen on 0.0.0.0 and the PORT they provide (3000 by default).
  // AI endpoints are protected by Google sign-in, so listening on all interfaces is safe.
  const host = process.env.HOST || '0.0.0.0';
  const httpServer = app.listen(port, host, () => {
    const shownHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Midas Tracker listo en http://${shownHost}:${port} (${isProduction ? 'producción' : 'desarrollo'})`);
  });

  httpServer.on('error', (err) => {
    console.error('HTTP server error:', err);
  });

  const shutdown = () => {
    httpServer.close(() => {
      if (closeVite) {
        closeVite().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start Midas Tracker server:', err);
  process.exit(1);
});
