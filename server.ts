import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_NAME = 'gemini-4-hydrogen';

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

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, model: MODEL_NAME, configured: Boolean(process.env.GEMINI_API_KEY) });
  });

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
          currency: string;
          notes?: string;
        }>;
        categories: Array<{ id: string; name: string; type: string }>;
        activeProfile: string;
        lang: 'es' | 'en';
      };

      const ai = getAiClient();
      const effectiveProfiles =
        profiles.length > 0
          ? profiles
          : [
              { id: 'abdiel', name: 'Abdiel' },
              { id: 'lara', name: 'Lara' },
            ];
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
2. Detect bank/broker preset: "commbank", "goalsaver", "revolut", "moomoo", or "generic".
3. Check if the document belongs to one of the user's EXISTING accounts above:
   - If YES (same bank/institution, owner, and currency match an existing account), set "matchedExistingAccount": true, "targetAccountId" to that exact account id, and "suggestedNewAccount.shouldCreate": false.
   - If NO (for example: an external bank like ING, ANZ, NAB, Westpac, Up Bank, Macquarie, HSBC, Amex, PayPal, or a bank/currency/profile combination that is NOT in the existing accounts list), set "matchedExistingAccount": false, "targetAccountId": "", and fill "suggestedNewAccount" with shouldCreate: true, a clean descriptive "name" (e.g., "ING Everyday (AUD)", "ANZ Savings (AUD)"), valid "owner" ID, "kind" ("commbank" | "goalsaver" | "revolut" | "moomoo" | "wise" | "cash" | "other"), "currency", and short "notes".
4. Detect primary currency ("AUD", "USD", "EUR", "ARS", "MXN", "CLP") and closingBalance if printed (0 if not found).
5. Extract ALL real financial movements (skip running balance lines, headers, subtotals, opening/closing balance summary lines).
6. For each movement:
   - Normalize "date" to YYYY-MM-DD.
   - Clean "description" to a concise readable merchant/concept name.
   - Determine "type":
     * "transfer" ONLY when moving money between the user's own accounts (e.g., Transfer to Revolut, Transfer to/from GoalSaver, Internal Transfer) and set categoryId to "cat_transfer" if available.
     * "income" for salary, interest, dividends, refunds, deposits.
     * "expense" for purchases, bills, subscriptions, stock/ETF BUYs.
   - Always make "amount" a positive number (> 0).
   - For Moomoo broker rows, populate "ticker" (e.g., VOO, VAS, AAPL), "moomooAction" ("BUY" | "SELL" | "DIVIDEND"), "shares", "price", and "assetType" ("ETF" | "Acción" | "Fondo"). For non-Moomoo rows, leave ticker and moomooAction empty strings "".
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
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                owner: { type: Type.STRING, description: 'Exact profile id from context' },
                ownerReason: { type: Type.STRING },
                confidence: { type: Type.STRING, description: '"high" | "medium" | "fallback"' },
                preset: {
                  type: Type.STRING,
                  description: '"commbank" | "goalsaver" | "revolut" | "moomoo" | "generic"',
                },
                targetAccountId: { type: Type.STRING },
                matchedExistingAccount: { type: Type.BOOLEAN },
                suggestedNewAccount: {
                  type: Type.OBJECT,
                  properties: {
                    shouldCreate: { type: Type.BOOLEAN },
                    name: { type: Type.STRING },
                    owner: { type: Type.STRING },
                    kind: {
                      type: Type.STRING,
                      description: '"commbank" | "goalsaver" | "revolut" | "moomoo" | "wise" | "cash" | "other"',
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
                      currency: { type: Type.STRING },
                      categoryId: { type: Type.STRING },
                      classificationNote: { type: Type.STRING },
                      ticker: { type: Type.STRING },
                      moomooAction: { type: Type.STRING },
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
2. A transaction has the wrong type (for instance, an internal transfer like "Transfer to Revolut", "Transfer from CommBank", "Transfer to GoalSaver" currently tagged as "expense" or "income" should be type="transfer" and categoryId="cat_transfer").
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
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
You have full visibility into their current snapshot (profiles, transactions, budgets, fixed bills, bank/GoalSaver accounts, and Moomoo ETFs/stocks) and you actively improve every part of the app:
- Overview & Analytics: diagnose cashflow, savings rate, account-by-account performance, and spending spikes.
- Transactions: spot misclassified rows, duplicates, or hidden recurring expenses.
- Budgets: explain exceeded categories and propose realistic budget adjustments.
- Accounts & GoalSaver: create/delete accounts when requested or when an extra account is needed, and optimize cash allocation and bonus interest conditions.
- Moomoo Investments: analyze portfolio diversification, AUD/USD exposure, and dividend yield strategy.

RESPONSE RULES:
- Reply strictly in ${lang === 'en' ? 'English' : 'Spanish'}.
- Be concrete, data-backed (cite exact profile names, numbers, accounts, tickers, categories from the snapshot), concise, and practical.
- When the user asks to classify, create a budget, add a recurring fixed bill, log a transaction, or CREATE / DELETE an account — or when you see a clear opportunity to fix something in the snapshot — return actionable items in "proposedActions" using ONLY exact valid profile ids, categoryId, accountId, and txId values present in the snapshot! Never invent fake IDs.
- Valid actionType values: "reclassify_tx" | "upsert_budget" | "add_fixed_expense" | "add_transaction" | "create_account" | "delete_account".
- For "create_account": include "description" (account name), "owner" (exact profile id), "accountKind" ("commbank"|"goalsaver"|"revolut"|"moomoo"|"wise"|"cash"|"other"), "currency", "amount" (initialBalance, default 0), and optional "notes".
- For "delete_account": include exact "accountId" and "description" (account name).
- If no state change is needed, return proposedActions as an empty array [].`;

      const conversationText = messages
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
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
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

  let closeVite: (() => Promise<void>) | null = null;

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
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

  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`Midas Tracker server running on http://0.0.0.0:${port}`);
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
