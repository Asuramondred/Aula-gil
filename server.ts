import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  clearUsersTable,
  countUsers,
  createUser,
  getDriveConfig,
  getFirstUser,
  getUserById,
  getUserByUsername,
  initSqliteDb,
  saveDriveConfig,
  toPublicProfile,
  updateUserPassword,
  updateUserProfile,
} from './server/db.ts';
import {
  buildBackupZipBuffer,
  deleteDriveBackup,
  disconnectDriveAccount,
  getDrivePublicStatus,
  listDriveBackups,
  previewDriveBackup,
  restoreBackupZipBuffer,
  restoreDriveBackup,
  startDesktopOAuthFlow,
  syncFirebaseDriveProfile,
  uploadBackupToDrive,
} from './server/googleDriveBackup.ts';
import {
  clearFailedAttempts,
  checkRateLimit,
  createSession,
  extractBearerToken,
  generateRecoveryKey,
  getSessionFromHeader,
  hashSecret,
  normalizeRecoveryKey,
  normalizeSecurityAnswer,
  recordFailedAttempt,
  revokeAllSessions,
  revokeSession,
  sanitizeAvatarDataUrl,
  verifySecret,
} from './server/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getDataDir(): string {
  const defaultDir = fs.existsSync(path.resolve(__dirname, 'package.json'))
    ? path.resolve(__dirname, 'data')
    : path.resolve(__dirname, '..', 'data');
  const dir = process.env.LIBRETA_DATA_DIR || defaultDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDbFilePath(): string {
  return path.join(getDataDir(), 'libreta-db.json');
}

function getKeysFilePath(): string {
  return path.join(getDataDir(), 'libreta-keys.json');
}

type AiEngineKey =
  | 'ollama'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'custom_openai'
  | 'offline';

type AiProviderMode = 'auto' | AiEngineKey;

const ALL_AI_ENGINES: AiEngineKey[] = [
  'ollama',
  'gemini',
  'groq',
  'openrouter',
  'custom_openai',
  'offline',
];

const DEFAULT_AI_PRIORITY: AiEngineKey[] = [
  'ollama',
  'gemini',
  'groq',
  'openrouter',
  'custom_openai',
  'offline',
];

interface StoredKeys {
  aiProvider?: AiProviderMode;
  autoFailoverOnQuota?: boolean;
  aiPriorityOrder?: AiEngineKey[];
  enabledAiProviders?: AiEngineKey[];
  ollamaUrl?: string;
  ollamaModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  customOpenAiUrl?: string;
  customOpenAiKey?: string;
  customOpenAiModel?: string;
  lastBackupAt?: string;
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:3b';
const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const DEFAULT_CUSTOM_OPENAI_URL = 'https://api.deepseek.com/v1';
const DEFAULT_CUSTOM_OPENAI_MODEL = 'deepseek-chat';

const QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const providerCooldowns = new Map<AiEngineKey, { until: number; reason: string }>();

function readStoredKeys(): StoredKeys {
  try {
    const p = getKeysFilePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as StoredKeys;
  } catch {
    return {};
  }
}

function writeStoredKeys(keys: StoredKeys) {
  const p = getKeysFilePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(keys, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

function normalizePriorityOrder(raw?: unknown): AiEngineKey[] {
  const valid = new Set<AiEngineKey>(ALL_AI_ENGINES);
  const cleaned = Array.isArray(raw)
    ? raw
        .map((v) => String(v) as AiEngineKey)
        .filter((v, idx, arr) => valid.has(v) && arr.indexOf(v) === idx)
    : [];
  for (const engine of DEFAULT_AI_PRIORITY) {
    if (!cleaned.includes(engine)) cleaned.push(engine);
  }
  return cleaned;
}

function normalizeEnabledProviders(raw?: unknown): AiEngineKey[] {
  const valid = new Set<AiEngineKey>(ALL_AI_ENGINES);
  if (!Array.isArray(raw)) return [...DEFAULT_AI_PRIORITY];
  const cleaned = raw
    .map((v) => String(v) as AiEngineKey)
    .filter((v, idx, arr) => valid.has(v) && arr.indexOf(v) === idx);
  if (!cleaned.includes('offline')) cleaned.push('offline');
  return cleaned;
}

function splitApiKeys(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function getAiSettings() {
  const stored = readStoredKeys();
  const aiProvider: AiProviderMode = stored.aiProvider || 'auto';
  const autoFailoverOnQuota = stored.autoFailoverOnQuota !== false;
  const aiPriorityOrder = normalizePriorityOrder(stored.aiPriorityOrder);
  const enabledAiProviders = normalizeEnabledProviders(stored.enabledAiProviders);
  const ollamaUrl = (stored.ollamaUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  const ollamaModel = (stored.ollamaModel || DEFAULT_OLLAMA_MODEL).trim();
  const geminiModel = (stored.geminiModel || DEFAULT_GEMINI_MODEL).trim();
  const groqModel = (stored.groqModel || DEFAULT_GROQ_MODEL).trim();
  const openrouterModel = (stored.openrouterModel || DEFAULT_OPENROUTER_MODEL).trim();
  const customOpenAiUrl = (stored.customOpenAiUrl || DEFAULT_CUSTOM_OPENAI_URL)
    .trim()
    .replace(/\/+$/, '');
  const customOpenAiModel = (stored.customOpenAiModel || DEFAULT_CUSTOM_OPENAI_MODEL).trim();
  return {
    aiProvider,
    autoFailoverOnQuota,
    aiPriorityOrder,
    enabledAiProviders,
    ollamaUrl,
    ollamaModel,
    geminiModel,
    groqModel,
    openrouterModel,
    customOpenAiUrl,
    customOpenAiModel,
  };
}

function getEffectiveGeminiKeys(): { keys: string[]; source: 'env' | 'local' | 'none' } {
  const stored = readStoredKeys();
  const localKeys = splitApiKeys(stored.geminiApiKey);
  if (localKeys.length > 0) {
    return { keys: localKeys, source: 'local' };
  }
  const envKeys = splitApiKeys(process.env.GEMINI_API_KEY);
  if (envKeys.length > 0) {
    return { keys: envKeys, source: 'env' };
  }
  return { keys: [], source: 'none' };
}

function getEffectiveGroqKeys(): { keys: string[]; source: 'env' | 'local' | 'none' } {
  const stored = readStoredKeys();
  const localKeys = splitApiKeys(stored.groqApiKey);
  if (localKeys.length > 0) {
    return { keys: localKeys, source: 'local' };
  }
  const envKeys = splitApiKeys(process.env.GROQ_API_KEY);
  if (envKeys.length > 0) {
    return { keys: envKeys, source: 'env' };
  }
  return { keys: [], source: 'none' };
}

function getEffectiveOpenRouterKeys(): string[] {
  const stored = readStoredKeys();
  const localKeys = splitApiKeys(stored.openrouterApiKey);
  if (localKeys.length > 0) return localKeys;
  return splitApiKeys(process.env.OPENROUTER_API_KEY);
}

function getEffectiveCustomOpenAiKey(): string {
  const stored = readStoredKeys();
  return (stored.customOpenAiKey || '').trim();
}

function getActiveCooldowns() {
  const now = Date.now();
  const list: Array<{
    provider: AiEngineKey;
    until: string;
    remainingMinutes: number;
    reason: string;
  }> = [];
  for (const [provider, entry] of providerCooldowns.entries()) {
    if (entry.until <= now) {
      providerCooldowns.delete(provider);
    } else {
      list.push({
        provider,
        until: new Date(entry.until).toISOString(),
        remainingMinutes: Math.max(1, Math.ceil((entry.until - now) / 60000)),
        reason: entry.reason,
      });
    }
  }
  return list;
}

function buildKeyStatusPayload() {
  const g = getEffectiveGeminiKeys();
  const q = getEffectiveGroqKeys();
  const orKeys = getEffectiveOpenRouterKeys();
  const customKey = getEffectiveCustomOpenAiKey();
  const ai = getAiSettings();
  const stored = readStoredKeys();
  return {
    aiProvider: ai.aiProvider,
    autoFailoverOnQuota: ai.autoFailoverOnQuota,
    aiPriorityOrder: ai.aiPriorityOrder,
    enabledAiProviders: ai.enabledAiProviders,
    ollamaUrl: ai.ollamaUrl,
    ollamaModel: ai.ollamaModel,
    geminiModel: ai.geminiModel,
    groqModel: ai.groqModel,
    openrouterModel: ai.openrouterModel,
    customOpenAiUrl: ai.customOpenAiUrl,
    customOpenAiModel: ai.customOpenAiModel,
    hasGeminiKey: g.keys.length > 0,
    geminiKeyCount: g.keys.length,
    hasGroqKey: q.keys.length > 0,
    groqKeyCount: q.keys.length,
    hasOpenrouterKey: orKeys.length > 0,
    openrouterKeyCount: orKeys.length,
    hasCustomOpenAiKey: Boolean(customKey),
    geminiSource: g.source,
    groqSource: q.source,
    cooldowns: getActiveCooldowns(),
    dataDir: getDataDir(),
    lastBackupAt: stored.lastBackupAt || null,
  };
}

interface DbShape {
  classrooms: Array<Record<string, unknown>>;
  students: Array<Record<string, unknown>>;
  studentFiles: Array<Record<string, unknown>>;
  attendance: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  incidents: Array<Record<string, unknown>>;
  gradingPeriods: Array<Record<string, unknown>>;
  studentGrades: Array<Record<string, unknown>>;
  dailyLogs: Array<Record<string, unknown>>;
  lessonPlans: Array<Record<string, unknown>>;
}

function emptyDb(): DbShape {
  return {
    classrooms: [],
    students: [],
    studentFiles: [],
    attendance: [],
    assignments: [],
    incidents: [],
    gradingPeriods: [],
    studentGrades: [],
    dailyLogs: [],
    lessonPlans: [],
  };
}

function readDb(): DbShape {
  const p = getDbFilePath();
  if (!fs.existsSync(p)) {
    const initial = emptyDb();
    writeDb(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<DbShape>;
    return {
      classrooms: Array.isArray(parsed.classrooms) ? parsed.classrooms : [],
      students: Array.isArray(parsed.students) ? parsed.students : [],
      studentFiles: Array.isArray(parsed.studentFiles) ? parsed.studentFiles : [],
      attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      gradingPeriods: Array.isArray(parsed.gradingPeriods) ? parsed.gradingPeriods : [],
      studentGrades: Array.isArray(parsed.studentGrades) ? parsed.studentGrades : [],
      dailyLogs: Array.isArray(parsed.dailyLogs) ? parsed.dailyLogs : [],
      lessonPlans: Array.isArray(parsed.lessonPlans) ? parsed.lessonPlans : [],
    };
  } catch {
    return emptyDb();
  }
}

function writeDb(db: DbShape) {
  const p = getDbFilePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toValidPeriodId(periodName: string): string {
  const cleaned = periodName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'trimestre_1';
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('La respuesta del modelo no devolvió JSON válido.');
  }
}

const ENGINE_LABELS: Record<AiEngineKey, string> = {
  ollama: 'Ollama local',
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  custom_openai: 'API personalizada',
  offline: 'Modo básico offline',
};

function isQuotaOrTokenError(error: unknown): boolean {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : JSON.stringify(error ?? '');
  const msg = raw.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('insufficient_quota') ||
    msg.includes('tokens') ||
    msg.includes('token limit') ||
    msg.includes('credit') ||
    msg.includes('balance') ||
    msg.includes('exceeded') ||
    msg.includes('limit reached')
  );
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? [])
      .map((m) => m.name || '')
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function callOllamaJson(
  prompt: string,
  baseUrl: string,
  preferredModel: string
): Promise<Record<string, unknown>> {
  const installed = await listOllamaModels(baseUrl);
  if (installed.length === 0) {
    throw new Error(
      `No se detectó Ollama activo o modelos descargados en ${baseUrl}.`
    );
  }
  const modelToUse = installed.includes(preferredModel) ? preferredModel : installed[0];
  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelToUse,
      format: 'json',
      stream: false,
      options: { temperature: 0.3 },
      messages: [
        {
          role: 'system',
          content:
            'Eres un asesor técnico-pedagógico de primaria. Responde únicamente con un objeto JSON válido en español usando exactamente las llaves solicitadas.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const data = (await resp.json()) as {
    message?: { content?: string };
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || `Ollama HTTP ${resp.status}`);
  }
  return extractJsonObject(data.message?.content || '{}');
}

async function callOpenAiCompatibleJson(
  endpointBase: string,
  apiKey: string,
  model: string,
  prompt: string,
  providerLabel: string,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = endpointBase.endsWith('/chat/completions')
    ? endpointBase
    : `${endpointBase.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Responde únicamente con un objeto JSON válido en español, sin texto adicional.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string | number };
  };
  if (!resp.ok) {
    const errText = data.error?.message || `${providerLabel} HTTP ${resp.status}`;
    throw new Error(`[HTTP ${resp.status}] ${errText}`);
  }
  return extractJsonObject(data.choices?.[0]?.message?.content || '{}');
}

async function callGroqJson(prompt: string, model: string): Promise<Record<string, unknown>> {
  const { keys } = getEffectiveGroqKeys();
  if (keys.length === 0) {
    throw new Error('No hay llave de Groq configurada.');
  }
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await callOpenAiCompatibleJson(
        'https://api.groq.com/openai/v1',
        key,
        model || DEFAULT_GROQ_MODEL,
        prompt,
        'Groq'
      );
    } catch (err) {
      lastError = err;
      if (!isQuotaOrTokenError(err) || keys.length === 1) {
        if (!isQuotaOrTokenError(err)) throw err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Límite de tokens alcanzado en Groq.');
}

async function callOpenRouterJson(
  prompt: string,
  model: string
): Promise<Record<string, unknown>> {
  const keys = getEffectiveOpenRouterKeys();
  if (keys.length === 0) {
    throw new Error('No hay llave de OpenRouter configurada.');
  }
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await callOpenAiCompatibleJson(
        'https://openrouter.ai/api/v1',
        key,
        model || DEFAULT_OPENROUTER_MODEL,
        prompt,
        'OpenRouter',
        {
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'AulaAgil',
        }
      );
    } catch (err) {
      lastError = err;
      if (!isQuotaOrTokenError(err)) throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Límite de tokens alcanzado en OpenRouter.');
}

async function callCustomOpenAiJson(
  prompt: string,
  baseUrl: string,
  model: string
): Promise<Record<string, unknown>> {
  const key = getEffectiveCustomOpenAiKey();
  if (!baseUrl) {
    throw new Error('Falta configurar la URL de la API personalizada.');
  }
  return await callOpenAiCompatibleJson(
    baseUrl,
    key,
    model || DEFAULT_CUSTOM_OPENAI_MODEL,
    prompt,
    'API personalizada'
  );
}

async function callGeminiWithKey(
  key: string,
  model: string,
  prompt: string,
  responseSchema: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const modelsToTry =
    model === 'gemini-2.5-flash'
      ? ['gemini-2.5-flash', 'gemini-4-hydrogen']
      : [model || DEFAULT_GEMINI_MODEL, 'gemini-2.5-flash'];
  let lastErr: unknown;
  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      const response = await ai.models.generateContent({
        model: modelsToTry[i],
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      return extractJsonObject(response.text ?? '{}');
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isNotFound = msg.includes('404') || msg.includes('not_found') || msg.includes('not found');
      if (!isNotFound || i === modelsToTry.length - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function callGeminiJson(
  prompt: string,
  responseSchema: Record<string, unknown>,
  preferredModel: string
): Promise<Record<string, unknown>> {
  const { keys } = getEffectiveGeminiKeys();
  if (keys.length === 0) {
    throw new Error('No hay llave de Gemini configurada.');
  }
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await callGeminiWithKey(key, preferredModel, prompt, responseSchema);
    } catch (err) {
      lastError = err;
      if (!isQuotaOrTokenError(err)) throw err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Límite de tokens/cuota alcanzado en Google Gemini.');
}

type AttemptRecord = {
  provider: AiEngineKey;
  label: string;
  status: 'ok' | 'quota_exhausted' | 'cooldown' | 'unavailable' | 'error';
  detail?: string;
};

async function runSingleEngine(
  engine: AiEngineKey,
  prompt: string,
  responseSchema: Record<string, unknown>,
  offlineFallback: () => Record<string, unknown>,
  settings: ReturnType<typeof getAiSettings>
): Promise<Record<string, unknown>> {
  if (engine === 'offline') {
    return offlineFallback();
  }
  if (engine === 'ollama') {
    return await callOllamaJson(prompt, settings.ollamaUrl, settings.ollamaModel);
  }
  if (engine === 'gemini') {
    return await callGeminiJson(prompt, responseSchema, settings.geminiModel);
  }
  if (engine === 'groq') {
    return await callGroqJson(prompt, settings.groqModel);
  }
  if (engine === 'openrouter') {
    return await callOpenRouterJson(prompt, settings.openrouterModel);
  }
  return await callCustomOpenAiJson(
    prompt,
    settings.customOpenAiUrl,
    settings.customOpenAiModel
  );
}

function isEngineConfigured(engine: AiEngineKey, settings: ReturnType<typeof getAiSettings>): boolean {
  if (engine === 'offline') return true;
  if (engine === 'ollama') return Boolean(settings.ollamaUrl);
  if (engine === 'gemini') return getEffectiveGeminiKeys().keys.length > 0;
  if (engine === 'groq') return getEffectiveGroqKeys().keys.length > 0;
  if (engine === 'openrouter') return getEffectiveOpenRouterKeys().length > 0;
  if (engine === 'custom_openai') {
    return Boolean(settings.customOpenAiUrl && (getEffectiveCustomOpenAiKey() || settings.customOpenAiUrl.includes('127.0.0.1') || settings.customOpenAiUrl.includes('localhost')));
  }
  return false;
}

async function generateStructuredJson(
  prompt: string,
  responseSchema: Record<string, unknown>,
  offlineFallback: () => Record<string, unknown>
): Promise<Record<string, unknown>> {
  const settings = getAiSettings();
  const attempts: AttemptRecord[] = [];
  const now = Date.now();

  if (settings.aiProvider === 'offline') {
    const result = offlineFallback();
    attempts.push({ provider: 'offline', label: ENGINE_LABELS.offline, status: 'ok' });
    return {
      ...result,
      _aiMeta: {
        providerUsed: 'offline',
        providerLabel: ENGINE_LABELS.offline,
        failoverTriggered: false,
        attempts,
      },
    };
  }

  // Build ordered candidate chain
  let chain: AiEngineKey[] = [];
  if (settings.aiProvider === 'auto') {
    chain = settings.aiPriorityOrder.filter((eng) =>
      settings.enabledAiProviders.includes(eng)
    );
    if (!chain.includes('offline')) chain.push('offline');
  } else {
    chain = [settings.aiProvider];
    if (settings.autoFailoverOnQuota) {
      for (const eng of settings.aiPriorityOrder) {
        if (
          eng !== settings.aiProvider &&
          settings.enabledAiProviders.includes(eng)
        ) {
          chain.push(eng);
        }
      }
      if (!chain.includes('offline')) chain.push('offline');
    }
  }

  const shouldFailoverAnyError = settings.aiProvider === 'auto';
  let firstFailureReason = '';
  let hadFailure = false;

  for (let i = 0; i < chain.length; i++) {
    const engine = chain[i];
    const label = ENGINE_LABELS[engine];

    if (!isEngineConfigured(engine, settings)) {
      attempts.push({
        provider: engine,
        label,
        status: 'unavailable',
        detail: 'Sin llave o configuración activa',
      });
      continue;
    }

    const cooldown = providerCooldowns.get(engine);
    if (cooldown && cooldown.until > now && engine !== 'offline') {
      hadFailure = true;
      if (!firstFailureReason) firstFailureReason = cooldown.reason;
      attempts.push({
        provider: engine,
        label,
        status: 'cooldown',
        detail: cooldown.reason,
      });
      continue;
    } else if (cooldown && cooldown.until <= now) {
      providerCooldowns.delete(engine);
    }

    try {
      const result = await runSingleEngine(
        engine,
        prompt,
        responseSchema,
        offlineFallback,
        settings
      );
      attempts.push({ provider: engine, label, status: 'ok' });
      return {
        ...result,
        _aiMeta: {
          providerUsed: engine,
          providerLabel: label,
          failoverTriggered: hadFailure,
          failoverReason: hadFailure ? firstFailureReason : undefined,
          attempts,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error del proveedor de IA.';
      const quotaHit = isQuotaOrTokenError(err);

      if (quotaHit && engine !== 'offline') {
        const reasonText = `Límite de tokens o cuota alcanzado en ${label}`;
        providerCooldowns.set(engine, {
          until: Date.now() + QUOTA_COOLDOWN_MS,
          reason: reasonText,
        });
        attempts.push({
          provider: engine,
          label,
          status: 'quota_exhausted',
          detail: msg,
        });
        hadFailure = true;
        if (!firstFailureReason) firstFailureReason = reasonText;

        if (settings.autoFailoverOnQuota || shouldFailoverAnyError) {
          continue;
        }
        throw err;
      }

      attempts.push({
        provider: engine,
        label,
        status: 'error',
        detail: msg,
      });
      hadFailure = true;
      if (!firstFailureReason) firstFailureReason = `${label} no disponible (${msg})`;

      if (shouldFailoverAnyError) {
        continue;
      }
      throw err;
    }
  }

  const fallbackResult = offlineFallback();
  attempts.push({ provider: 'offline', label: ENGINE_LABELS.offline, status: 'ok' });
  return {
    ...fallbackResult,
    _aiMeta: {
      providerUsed: 'offline',
      providerLabel: ENGINE_LABELS.offline,
      failoverTriggered: true,
      failoverReason:
        firstFailureReason || 'Se cambió al respaldo offline por falta de motores activos.',
      attempts,
    },
  };
}

interface AuthenticatedRequest extends Request {
  authUserId?: string;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const session = getSessionFromHeader(req.headers.authorization);
  if (!session) {
    res.status(401).json({ error: 'Sesión bloqueada o expirada. Inicia sesión nuevamente.' });
    return;
  }
  const user = getUserById(session.userId);
  if (!user) {
    revokeSession(session.token);
    res.status(401).json({ error: 'Perfil no encontrado. Inicia sesión nuevamente.' });
    return;
  }
  req.authUserId = user.id;
  next();
}

export async function startServer(customPort = PORT) {
  await initSqliteDb(getDataDir());

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // --- Public Auth, Onboarding & Offline Recovery Routes ---
  app.get('/api/auth/status', (req: Request, res: Response) => {
    const total = countUsers();
    if (total === 0) {
      res.json({ hasUser: false, authenticated: false, profile: null });
      return;
    }
    const session = getSessionFromHeader(req.headers.authorization);
    if (session) {
      const user = getUserById(session.userId);
      if (user) {
        res.json({
          hasUser: true,
          authenticated: true,
          profile: toPublicProfile(user),
        });
        return;
      }
    }
    const primary = getFirstUser();
    res.json({
      hasUser: true,
      authenticated: false,
      profile: primary ? toPublicProfile(primary) : null,
    });
  });

  app.get('/api/auth/recovery-preview', (_req: Request, res: Response) => {
    if (countUsers() > 0) {
      res.status(409).json({ error: 'Ya existe un perfil configurado.' });
      return;
    }
    res.json({ recoveryKey: generateRecoveryKey() });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    if (countUsers() > 0) {
      res.status(409).json({
        error: 'Ya existe una cuenta registrada en esta computadora.',
      });
      return;
    }
    const {
      username,
      displayName,
      password,
      avatarDataUrl,
      recoveryKey,
      securityQ1,
      securityA1,
      securityQ2,
      securityA2,
    } = req.body ?? {};

    const cleanUsername = String(username || '').trim();
    const cleanDisplayName = String(displayName || '').trim() || cleanUsername;
    const rawPassword = String(password || '');
    const cleanQ1 = String(securityQ1 || '').trim();
    const cleanA1 = normalizeSecurityAnswer(String(securityA1 || ''));
    const cleanQ2 = String(securityQ2 || '').trim();
    const cleanA2 = normalizeSecurityAnswer(String(securityA2 || ''));
    const cleanRecoveryKey = normalizeRecoveryKey(
      String(recoveryKey || generateRecoveryKey())
    );

    if (cleanUsername.length < 3 || cleanUsername.length > 40) {
      res.status(400).json({ error: 'El usuario debe tener entre 3 y 40 caracteres.' });
      return;
    }
    if (rawPassword.length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }
    if (!cleanQ1 || cleanA1.length < 2 || !cleanQ2 || cleanA2.length < 2) {
      res.status(400).json({
        error: 'Completa las 2 preguntas de seguridad y sus respuestas (mínimo 2 caracteres).',
      });
      return;
    }
    if (cleanRecoveryKey.length < 10) {
      res.status(400).json({ error: 'Llave maestra de recuperación inválida.' });
      return;
    }

    const user = createUser({
      id: makeId('usr'),
      username: cleanUsername,
      displayName: cleanDisplayName.slice(0, 80),
      avatarDataUrl: sanitizeAvatarDataUrl(avatarDataUrl),
      passwordHash: hashSecret(rawPassword),
      recoveryKeyHash: hashSecret(cleanRecoveryKey),
      securityQ1: cleanQ1.slice(0, 160),
      securityA1Hash: hashSecret(cleanA1),
      securityQ2: cleanQ2.slice(0, 160),
      securityA2Hash: hashSecret(cleanA2),
    });

    const session = createSession(user.id, user.username);
    res.json({
      token: session.token,
      user: toPublicProfile(user),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const gate = checkRateLimit('login');
    if (!gate.allowed) {
      res.status(429).json({
        error: `Demasiados intentos fallidos. Espera ${gate.waitSeconds} segundos antes de intentar de nuevo.`,
      });
      return;
    }

    const { username, password } = req.body ?? {};
    const cleanUsername = String(username || '').trim();
    const rawPassword = String(password || '');

    if (!cleanUsername || !rawPassword) {
      res.status(400).json({ error: 'Ingresa tu usuario y contraseña.' });
      return;
    }

    const user = getUserByUsername(cleanUsername);
    if (!user || !verifySecret(rawPassword, user.password_hash)) {
      recordFailedAttempt('login');
      res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      return;
    }

    clearFailedAttempts('login');
    const session = createSession(user.id, user.username);
    res.json({
      token: session.token,
      user: toPublicProfile(user),
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractBearerToken(req.headers.authorization);
    revokeSession(token);
    res.json({ ok: true });
  });

  app.get('/api/auth/recovery-questions', (req: Request, res: Response) => {
    const requestedUser = String(req.query.username || '').trim();
    const user = requestedUser ? getUserByUsername(requestedUser) : getFirstUser();
    if (!user) {
      res.status(404).json({ error: 'No se encontró un perfil registrado.' });
      return;
    }
    res.json({
      username: user.username,
      securityQ1: user.security_q1,
      securityQ2: user.security_q2,
    });
  });

  app.post('/api/auth/recover/key', (req: Request, res: Response) => {
    const gate = checkRateLimit('recover_key');
    if (!gate.allowed) {
      res.status(429).json({
        error: `Demasiados intentos fallidos. Espera ${gate.waitSeconds} segundos.`,
      });
      return;
    }

    const { username, recoveryKey, newPassword } = req.body ?? {};
    const cleanUsername = String(username || '').trim();
    const cleanKey = normalizeRecoveryKey(String(recoveryKey || ''));
    const nextPassword = String(newPassword || '');

    if (nextPassword.length < 6) {
      res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres.',
      });
      return;
    }

    const user = cleanUsername ? getUserByUsername(cleanUsername) : getFirstUser();
    if (!user || !verifySecret(cleanKey, user.recovery_key_hash)) {
      recordFailedAttempt('recover_key');
      res.status(401).json({
        error: 'La Llave Maestra de Recuperación no coincide.',
      });
      return;
    }

    clearFailedAttempts('recover_key');
    const newRecoveryKey = generateRecoveryKey();
    const updated = updateUserPassword(
      user.id,
      hashSecret(nextPassword),
      hashSecret(normalizeRecoveryKey(newRecoveryKey))
    );
    if (!updated) {
      res.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
      return;
    }

    revokeAllSessions();
    const session = createSession(updated.id, updated.username);
    res.json({
      ok: true,
      newRecoveryKey,
      token: session.token,
      user: toPublicProfile(updated),
    });
  });

  app.post('/api/auth/recover/questions', (req: Request, res: Response) => {
    const gate = checkRateLimit('recover_questions');
    if (!gate.allowed) {
      res.status(429).json({
        error: `Demasiados intentos fallidos. Espera ${gate.waitSeconds} segundos.`,
      });
      return;
    }

    const { username, answer1, answer2, newPassword } = req.body ?? {};
    const cleanUsername = String(username || '').trim();
    const normA1 = normalizeSecurityAnswer(String(answer1 || ''));
    const normA2 = normalizeSecurityAnswer(String(answer2 || ''));
    const nextPassword = String(newPassword || '');

    if (nextPassword.length < 6) {
      res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres.',
      });
      return;
    }

    const user = cleanUsername ? getUserByUsername(cleanUsername) : getFirstUser();
    const validA1 = user ? verifySecret(normA1, user.security_a1_hash) : false;
    const validA2 = user ? verifySecret(normA2, user.security_a2_hash) : false;

    if (!user || !validA1 || !validA2) {
      recordFailedAttempt('recover_questions');
      res.status(401).json({
        error: 'Alguna de las respuestas de seguridad es incorrecta.',
      });
      return;
    }

    clearFailedAttempts('recover_questions');
    const updated = updateUserPassword(user.id, hashSecret(nextPassword));
    if (!updated) {
      res.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
      return;
    }

    revokeAllSessions();
    const session = createSession(updated.id, updated.username);
    res.json({
      ok: true,
      token: session.token,
      user: toPublicProfile(updated),
    });
  });

  app.post('/api/auth/factory-reset', (req: Request, res: Response) => {
    const { confirmation, doubleConfirmed } = req.body ?? {};
    if (
      doubleConfirmed !== true ||
      String(confirmation || '').trim().toUpperCase() !== 'RESTABLECER'
    ) {
      res.status(400).json({
        error: 'Debes confirmar escribiendo RESTABLECER para restablecer la aplicación.',
      });
      return;
    }

    revokeAllSessions();
    clearUsersTable();
    writeDb(emptyDb());
    const keysPath = getKeysFilePath();
    if (fs.existsSync(keysPath)) {
      fs.unlinkSync(keysPath);
    }
    clearFailedAttempts('login');
    clearFailedAttempts('recover_key');
    clearFailedAttempts('recover_questions');
    res.json({ ok: true });
  });

  // Protect all workspace, settings, backup, profile & AI routes
  app.use('/api', requireAuth);

  app.patch('/api/auth/profile', (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUserId;
    if (!userId) {
      res.status(401).json({ error: 'No autorizado.' });
      return;
    }
    const { username, displayName, avatarDataUrl } = req.body ?? {};
    const cleanUsername =
      typeof username === 'string' ? username.trim() : undefined;
    if (cleanUsername !== undefined && (cleanUsername.length < 3 || cleanUsername.length > 40)) {
      res.status(400).json({ error: 'El usuario debe tener entre 3 y 40 caracteres.' });
      return;
    }
    const sanitizedAvatar =
      avatarDataUrl === undefined ? undefined : sanitizeAvatarDataUrl(avatarDataUrl);

    const updated = updateUserProfile(userId, {
      username: cleanUsername,
      displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 80) : undefined,
      avatarDataUrl: sanitizedAvatar,
    });
    if (!updated) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    res.json({ user: toPublicProfile(updated) });
  });

  app.post('/api/auth/change-password', (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUserId;
    if (!userId) {
      res.status(401).json({ error: 'No autorizado.' });
      return;
    }
    const { currentPassword, newPassword } = req.body ?? {};
    const user = getUserById(userId);
    if (!user || !verifySecret(String(currentPassword || ''), user.password_hash)) {
      res.status(401).json({ error: 'La contraseña actual no es correcta.' });
      return;
    }
    const nextPassword = String(newPassword || '');
    if (nextPassword.length < 6) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }
    const updated = updateUserPassword(user.id, hashSecret(nextPassword));
    if (!updated) {
      res.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
      return;
    }
    res.json({ ok: true, user: toPublicProfile(updated) });
  });

  // --- Data & Backup REST API ---
  app.get('/api/data', (_req: Request, res: Response) => {
    res.json(readDb());
  });

  app.get('/api/backup/export', (_req: Request, res: Response) => {
    const db = readDb();
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const current = readStoredKeys();
    writeStoredKeys({ ...current, lastBackupAt: nowIso });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="respaldo_aula_agil_${today}.json"`
    );
    res.send(JSON.stringify(db, null, 2));
  });

  app.post('/api/backup/import', (req: Request, res: Response) => {
    const body = req.body as Partial<DbShape>;
    if (!body || !Array.isArray(body.classrooms) || !Array.isArray(body.students)) {
      res.status(400).json({ error: 'El archivo de respaldo no tiene el formato válido.' });
      return;
    }
    const restored: DbShape = {
      classrooms: Array.isArray(body.classrooms) ? body.classrooms : [],
      students: Array.isArray(body.students) ? body.students : [],
      studentFiles: Array.isArray(body.studentFiles) ? body.studentFiles : [],
      attendance: Array.isArray(body.attendance) ? body.attendance : [],
      assignments: Array.isArray(body.assignments) ? body.assignments : [],
      incidents: Array.isArray(body.incidents) ? body.incidents : [],
      gradingPeriods: Array.isArray(body.gradingPeriods) ? body.gradingPeriods : [],
      studentGrades: Array.isArray(body.studentGrades) ? body.studentGrades : [],
      dailyLogs: Array.isArray(body.dailyLogs) ? body.dailyLogs : [],
      lessonPlans: Array.isArray(body.lessonPlans) ? body.lessonPlans : [],
    };
    writeDb(restored);
    res.json({ db: restored });
  });

  // --- AI Settings, Failover Chain & Local Ollama Check ---
  app.get('/api/settings/keys', (_req: Request, res: Response) => {
    res.json(buildKeyStatusPayload());
  });

  app.post('/api/settings/keys', (req: Request, res: Response) => {
    const {
      aiProvider,
      autoFailoverOnQuota,
      aiPriorityOrder,
      enabledAiProviders,
      ollamaUrl,
      ollamaModel,
      geminiApiKey,
      geminiModel,
      groqApiKey,
      groqModel,
      openrouterApiKey,
      openrouterModel,
      customOpenAiUrl,
      customOpenAiKey,
      customOpenAiModel,
    } = req.body ?? {};
    const current = readStoredKeys();
    const next: StoredKeys = { ...current };
    const validModes = new Set<string>(['auto', ...ALL_AI_ENGINES]);

    if (typeof aiProvider === 'string' && validModes.has(aiProvider)) {
      next.aiProvider = aiProvider as AiProviderMode;
    }
    if (typeof autoFailoverOnQuota === 'boolean') {
      next.autoFailoverOnQuota = autoFailoverOnQuota;
    }
    if (Array.isArray(aiPriorityOrder)) {
      next.aiPriorityOrder = normalizePriorityOrder(aiPriorityOrder);
    }
    if (Array.isArray(enabledAiProviders)) {
      next.enabledAiProviders = normalizeEnabledProviders(enabledAiProviders);
    }
    if (typeof ollamaUrl === 'string' && ollamaUrl.trim()) {
      next.ollamaUrl = ollamaUrl.trim().replace(/\/+$/, '');
    }
    if (typeof ollamaModel === 'string' && ollamaModel.trim()) {
      next.ollamaModel = ollamaModel.trim();
    }
    if (typeof geminiApiKey === 'string') {
      next.geminiApiKey = geminiApiKey.trim();
      providerCooldowns.delete('gemini');
    }
    if (typeof geminiModel === 'string' && geminiModel.trim()) {
      next.geminiModel = geminiModel.trim();
    }
    if (typeof groqApiKey === 'string') {
      next.groqApiKey = groqApiKey.trim();
      providerCooldowns.delete('groq');
    }
    if (typeof groqModel === 'string' && groqModel.trim()) {
      next.groqModel = groqModel.trim();
    }
    if (typeof openrouterApiKey === 'string') {
      next.openrouterApiKey = openrouterApiKey.trim();
      providerCooldowns.delete('openrouter');
    }
    if (typeof openrouterModel === 'string' && openrouterModel.trim()) {
      next.openrouterModel = openrouterModel.trim();
    }
    if (typeof customOpenAiUrl === 'string') {
      next.customOpenAiUrl = customOpenAiUrl.trim().replace(/\/+$/, '');
      providerCooldowns.delete('custom_openai');
    }
    if (typeof customOpenAiKey === 'string') {
      next.customOpenAiKey = customOpenAiKey.trim();
      providerCooldowns.delete('custom_openai');
    }
    if (typeof customOpenAiModel === 'string' && customOpenAiModel.trim()) {
      next.customOpenAiModel = customOpenAiModel.trim();
    }

    writeStoredKeys(next);
    res.json(buildKeyStatusPayload());
  });

  app.post('/api/settings/ai-reset-cooldowns', (_req: Request, res: Response) => {
    providerCooldowns.clear();
    res.json(buildKeyStatusPayload());
  });

  app.post('/api/settings/ai-test-chain', async (_req: Request, res: Response) => {
    try {
      const testPrompt =
        'Responde únicamente con el JSON exacto {"ok": true, "message": "Conexión verificada"}';
      const result = await generateStructuredJson(
        testPrompt,
        {
          type: Type.OBJECT,
          properties: {
            ok: { type: Type.BOOLEAN },
            message: { type: Type.STRING },
          },
          required: ['ok', 'message'],
        },
        () => ({ ok: true, message: 'Respaldo offline operativo' })
      );
      res.json({
        ...result,
        status: buildKeyStatusPayload(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'No se pudo probar la cadena de IA.',
      });
    }
  });

  app.get('/api/settings/ollama-check', async (req: Request, res: Response) => {
    const ai = getAiSettings();
    const targetUrl = String(req.query.url || ai.ollamaUrl || DEFAULT_OLLAMA_URL)
      .trim()
      .replace(/\/+$/, '');
    try {
      const models = await listOllamaModels(targetUrl);
      if (models.length === 0) {
        res.json({
          ok: false,
          models: [],
          error: `No se encontraron modelos activos en ${targetUrl}. Verifica que Ollama esté abierto en Windows y ejecuta "ollama pull qwen2.5:3b".`,
        });
        return;
      }
      providerCooldowns.delete('ollama');
      res.json({ ok: true, models });
    } catch (err) {
      res.json({
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : 'No se pudo conectar con Ollama.',
      });
    }
  });

  // --- Classrooms ---
  app.post('/api/classrooms', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const classroomId = makeId('grupo');
    const activePeriod = String(req.body?.activePeriod || 'Trimestre 1');
    const classroom = {
      id: classroomId,
      name: String(req.body?.name || '4° A').trim().slice(0, 80),
      schoolName: String(req.body?.schoolName || 'Escuela Primaria').trim().slice(0, 120),
      teacherName: String(req.body?.teacherName || 'Docente Titular').trim().slice(0, 100),
      cycle: String(req.body?.cycle || '2026-2027').trim().slice(0, 40),
      activePeriod,
      createdAt: now,
      updatedAt: now,
    };
    db.classrooms.push(classroom);

    (['Trimestre 1', 'Trimestre 2', 'Trimestre 3'] as const).forEach((pName) => {
      db.gradingPeriods.push({
        id: `${classroomId}_${toValidPeriodId(pName)}`,
        classroomId,
        periodName: pName,
        trabajosWeight: 40,
        tareasWeight: 20,
        examenWeight: 10,
        asistenciaWeight: 10,
        conductaWeight: 20,
        examTotalQuestions: 25,
        useActivityExamAverage: true,
        scaleMax: 10,
        updatedAt: now,
      });
    });

    writeDb(db);
    res.json({ classroomId, db });
  });

  app.post('/api/classrooms/seed', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const classroomId = makeId('grupo');
    const teacherName = String(req.body?.teacherName || 'Mtra. Laura Hernández').trim();

    db.classrooms.push({
      id: classroomId,
      name: '4° A',
      schoolName: 'Escuela Primaria Benito Juárez',
      teacherName,
      cycle: '2026-2027',
      activePeriod: 'Trimestre 1',
      createdAt: now,
      updatedAt: now,
    });

    (['Trimestre 1', 'Trimestre 2', 'Trimestre 3'] as const).forEach((pName) => {
      db.gradingPeriods.push({
        id: `${classroomId}_${toValidPeriodId(pName)}`,
        classroomId,
        periodName: pName,
        trabajosWeight: 40,
        tareasWeight: 20,
        examenWeight: 10,
        asistenciaWeight: 10,
        conductaWeight: 20,
        examTotalQuestions: 25,
        useActivityExamAverage: true,
        scaleMax: 10,
        updatedAt: now,
      });
    });

    const sampleStudents = [
      {
        listNumber: 1,
        fullName: 'Aguilar Mendoza Sofía Valentina',
        curp: 'AUMS160412MDFRN01',
        birthDate: '2016-04-12',
        guardianName: 'Laura Mendoza Ríos',
        guardianPhone: '614-218-4490',
        guardianEmail: 'laura.mendoza@ejemplo.mx',
        medicalNotes: 'Sin alergias reportadas. Usa lentes para lectura.',
        pedagogicalNotes: 'Lectura fluida y excelente participación en cálculo mental.',
      },
      {
        listNumber: 2,
        fullName: 'Bautista Herrera Mateo Alejandro',
        curp: 'BAHM160821HDFNL04',
        birthDate: '2016-08-21',
        guardianName: 'Carlos Bautista Ponce',
        guardianPhone: '614-390-1122',
        guardianEmail: 'carlos.bautista@ejemplo.mx',
        medicalNotes: 'Alergia leve al polvo.',
        pedagogicalNotes: 'Requiere recordatorios visuales para concluir actividades.',
      },
      {
        listNumber: 3,
        fullName: 'Castillo Morales Camila Renata',
        curp: 'CAMC160119MCHLN07',
        birthDate: '2016-01-19',
        guardianName: 'Patricia Morales Vega',
        guardianPhone: '614-512-7731',
        guardianEmail: 'paty.morales@ejemplo.mx',
        medicalNotes: 'Ninguna.',
        pedagogicalNotes: 'Destaca en trabajo colaborativo y comprensión lectora.',
      },
      {
        listNumber: 4,
        fullName: 'Domínguez Silva Diego Sebastián',
        curp: 'DOSD161105HCHLR02',
        birthDate: '2016-11-05',
        guardianName: 'Rosa Elena Silva Ortiz',
        guardianPhone: '614-608-9034',
        guardianEmail: 'rosa.silva@ejemplo.mx',
        medicalNotes: 'Asma controlada (trae inhalador en temporada fría).',
        pedagogicalNotes: 'Mucha curiosidad en ciencias naturales.',
      },
      {
        listNumber: 5,
        fullName: 'Escobar Navarro Ximena Lucía',
        curp: 'ESNX160630MCHRR09',
        birthDate: '2016-06-30',
        guardianName: 'Miguel Escobar Trejo',
        guardianPhone: '614-741-2258',
        guardianEmail: 'miguel.escobar@ejemplo.mx',
        medicalNotes: 'Ninguna.',
        pedagogicalNotes: 'Excelente caligrafía y cumplimiento puntual de tareas.',
      },
      {
        listNumber: 6,
        fullName: 'Flores Ramírez Emiliano Gael',
        curp: 'FLRE160314HCHLN03',
        birthDate: '2016-03-14',
        guardianName: 'Adriana Ramírez Soto',
        guardianPhone: '614-823-6104',
        guardianEmail: 'adriana.ramirez@ejemplo.mx',
        medicalNotes: 'Ninguna.',
        pedagogicalNotes: 'Necesita refuerzo en fracciones y problemas verbales.',
      },
    ];

    const studentIds: string[] = [];
    const attRecords: Record<string, string> = {};

    sampleStudents.forEach((st, idx) => {
      const sid = makeId(`al${idx + 1}`);
      studentIds.push(sid);
      attRecords[sid] = idx === 3 ? 'retardo' : 'presente';
      db.students.push({
        id: sid,
        classroomId,
        ...st,
        createdAt: now,
        updatedAt: now,
      });
    });

    db.attendance.push({
      id: `${classroomId}_${today}`,
      classroomId,
      date: today,
      period: 'Trimestre 1',
      records: attRecords,
      updatedAt: now,
    });

    const acts = [
      { title: 'Práctica en clase: Fracciones equivalentes', type: 'trabajo' },
      { title: 'Mapa mental del ciclo del agua', type: 'trabajo' },
      { title: 'Tarea: Problemas de multiplicación', type: 'tarea' },
      { title: 'Evaluación parcial Bloque 1', type: 'examen' },
    ];

    acts.forEach((a, idx) => {
      const subs: Record<string, string> = {};
      const scores: Record<string, number> = {};
      studentIds.forEach((sid, sIdx) => {
        if (sIdx === 1 && idx === 2) {
          subs[sid] = 'incompleto';
          scores[sid] = 7;
        } else if (sIdx === 5 && idx >= 1) {
          subs[sid] = 'incompleto';
          scores[sid] = 7.5;
        } else {
          subs[sid] = 'revisado';
          scores[sid] = sIdx === 0 || sIdx === 4 ? 10 : 9;
        }
      });
      db.assignments.push({
        id: makeId(`act${idx + 1}`),
        classroomId,
        period: 'Trimestre 1',
        title: a.title,
        type: a.type,
        dueDate: today,
        description: 'Actividad registrada para evaluación trimestral.',
        maxScore: 10,
        submissions: subs,
        scores,
        createdAt: now,
        updatedAt: now,
      });
    });

    db.incidents.push(
      {
        id: makeId('inc1'),
        classroomId,
        studentId: studentIds[1],
        period: 'Trimestre 1',
        date: today,
        category: 'convivencia',
        severity: 'leve',
        description: 'Interrumpió la explicación grupal durante el trabajo en parejas.',
        actionTaken: 'Diálogo breve y acuerdo de turno de palabra.',
        aiReportParents: '',
        aiReportDirection: '',
        reportGeneratedAt: '',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: makeId('inc2'),
        classroomId,
        studentId: studentIds[0],
        period: 'Trimestre 1',
        date: today,
        category: 'reconocimiento',
        severity: 'positiva',
        description: 'Apoyó voluntariamente a sus compañeros durante la lectura en voz alta.',
        actionTaken: 'Reconocimiento frente al grupo.',
        aiReportParents: '',
        aiReportDirection: '',
        reportGeneratedAt: '',
        createdAt: now,
        updatedAt: now,
      }
    );

    db.dailyLogs.push({
      id: makeId('log'),
      classroomId,
      date: today,
      period: 'Trimestre 1',
      rawNarrative:
        'Hoy trabajamos fracciones equivalentes con material concreto. La mayoría comprendió el concepto y Sofía apoyó a su equipo en lectura.',
      topicsCovered: 'Matemáticas: Fracciones equivalentes con tiras de papel.\nEspañol: Lectura en voz alta y comprensión.',
      studentObservations: 'Sofía mostró gran disposición para apoyar a sus compañeros. Mateo requirió apoyo para mantener turnos de habla.',
      agreementsPending: 'Enviar ejercicio de refuerzo de multiplicación para la próxima sesión.',
      pedagogicalReflection: 'El uso de material concreto facilitó la comprensión visual de fracciones.',
      createdAt: now,
      updatedAt: now,
    });

    writeDb(db);
    res.json({ classroomId, db });
  });

  app.patch('/api/classrooms/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.classrooms.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Grupo no encontrado.' });
      return;
    }
    db.classrooms[idx] = {
      ...db.classrooms[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/classrooms/:id', (req: Request, res: Response) => {
    const db = readDb();
    const cid = req.params.id;
    db.classrooms = db.classrooms.filter((c) => c.id !== cid);
    db.students = db.students.filter((s) => s.classroomId !== cid);
    db.studentFiles = db.studentFiles.filter((f) => f.classroomId !== cid);
    db.attendance = db.attendance.filter((a) => a.classroomId !== cid);
    db.assignments = db.assignments.filter((a) => a.classroomId !== cid);
    db.incidents = db.incidents.filter((i) => i.classroomId !== cid);
    db.gradingPeriods = db.gradingPeriods.filter((g) => g.classroomId !== cid);
    db.studentGrades = db.studentGrades.filter((g) => g.classroomId !== cid);
    db.dailyLogs = db.dailyLogs.filter((l) => l.classroomId !== cid);
    db.lessonPlans = db.lessonPlans.filter((p) => p.classroomId !== cid);
    writeDb(db);
    res.json({ db });
  });

  // --- Students ---
  app.post('/api/students', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const student = {
      id: makeId('al'),
      classroomId: req.body.classroomId,
      listNumber: Number(req.body.listNumber) || 1,
      fullName: String(req.body.fullName || '').trim(),
      curp: String(req.body.curp || '').trim(),
      birthDate: String(req.body.birthDate || ''),
      guardianName: String(req.body.guardianName || '').trim(),
      guardianPhone: String(req.body.guardianPhone || '').trim(),
      guardianEmail: String(req.body.guardianEmail || '').trim(),
      medicalNotes: String(req.body.medicalNotes || '').trim(),
      pedagogicalNotes: String(req.body.pedagogicalNotes || '').trim(),
      createdAt: now,
      updatedAt: now,
    };
    db.students.push(student);
    writeDb(db);
    res.json({ db });
  });

  app.post('/api/students/bulk', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const { classroomId, names } = req.body ?? {};
    if (!classroomId || !Array.isArray(names)) {
      res.status(400).json({ error: 'Datos inválidos para importación.' });
      return;
    }
    const existing = db.students.filter((s) => s.classroomId === classroomId);
    let nextNum =
      existing.length > 0
        ? Math.max(...existing.map((s) => Number(s.listNumber) || 0)) + 1
        : 1;

    names.forEach((rawName: unknown) => {
      const name = String(rawName || '').trim();
      if (!name) return;
      db.students.push({
        id: makeId('al'),
        classroomId,
        listNumber: nextNum++,
        fullName: name,
        curp: '',
        birthDate: '',
        guardianName: '',
        guardianPhone: '',
        guardianEmail: '',
        medicalNotes: '',
        pedagogicalNotes: '',
        createdAt: now,
        updatedAt: now,
      });
    });
    writeDb(db);
    res.json({ db });
  });

  app.patch('/api/students/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.students.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Alumno no encontrado.' });
      return;
    }
    db.students[idx] = {
      ...db.students[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/students/:id', (req: Request, res: Response) => {
    const db = readDb();
    const sid = req.params.id;
    db.students = db.students.filter((s) => s.id !== sid);
    db.studentFiles = db.studentFiles.filter((f) => f.studentId !== sid);
    db.incidents = db.incidents.filter((i) => i.studentId !== sid);
    db.studentGrades = db.studentGrades.filter((g) => g.studentId !== sid);
    writeDb(db);
    res.json({ db });
  });

  // --- Student Files ---
  app.post('/api/student-files', (req: Request, res: Response) => {
    const db = readDb();
    db.studentFiles.push({
      id: makeId('doc'),
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/student-files/:id', (req: Request, res: Response) => {
    const db = readDb();
    db.studentFiles = db.studentFiles.filter((f) => f.id !== req.params.id);
    writeDb(db);
    res.json({ db });
  });

  // --- Attendance ---
  app.put('/api/attendance', (req: Request, res: Response) => {
    const db = readDb();
    const { classroomId, date, period, records } = req.body ?? {};
    const id = `${classroomId}_${date}`;
    const idx = db.attendance.findIndex(
      (a) => a.classroomId === classroomId && a.date === date
    );
    const entry = {
      id,
      classroomId,
      date,
      period: period || 'Trimestre 1',
      records: records || {},
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) db.attendance[idx] = entry;
    else db.attendance.push(entry);
    writeDb(db);
    res.json({ db });
  });

  // --- Assignments ---
  app.post('/api/assignments', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    db.assignments.push({
      id: makeId('act'),
      maxScore: 10,
      formativeField: 'general',
      scores: {},
      submissions: {},
      ...req.body,
      createdAt: now,
      updatedAt: now,
    });
    writeDb(db);
    res.json({ db });
  });

  app.patch('/api/assignments/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.assignments.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Actividad no encontrada.' });
      return;
    }
    db.assignments[idx] = {
      ...db.assignments[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/assignments/:id', (req: Request, res: Response) => {
    const db = readDb();
    db.assignments = db.assignments.filter((a) => a.id !== req.params.id);
    writeDb(db);
    res.json({ db });
  });

  // --- Incidents ---
  app.post('/api/incidents', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const incidentId = makeId('inc');
    db.incidents.push({
      id: incidentId,
      period: 'Trimestre 1',
      aiReportParents: '',
      aiReportDirection: '',
      reportGeneratedAt: '',
      ...req.body,
      createdAt: now,
      updatedAt: now,
    });
    writeDb(db);
    res.json({ incidentId, db });
  });

  app.patch('/api/incidents/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.incidents.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Incidencia no encontrada.' });
      return;
    }
    db.incidents[idx] = {
      ...db.incidents[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/incidents/:id', (req: Request, res: Response) => {
    const db = readDb();
    db.incidents = db.incidents.filter((i) => i.id !== req.params.id);
    writeDb(db);
    res.json({ db });
  });

  // --- Grading Periods & Student Grades ---
  app.put('/api/grading-periods/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.gradingPeriods.findIndex((g) => g.id === req.params.id);
    const entry = {
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) db.gradingPeriods[idx] = entry;
    else db.gradingPeriods.push(entry);
    writeDb(db);
    res.json({ db });
  });

  app.put('/api/student-grades/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.studentGrades.findIndex((g) => g.id === req.params.id);
    const entry = {
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) db.studentGrades[idx] = entry;
    else db.studentGrades.push(entry);
    writeDb(db);
    res.json({ db });
  });

  // --- Daily Logs (Bitácora Diaria del Docente) ---
  app.post('/api/daily-logs', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const logId = makeId('log');
    db.dailyLogs.push({
      id: logId,
      ...req.body,
      createdAt: now,
      updatedAt: now,
    });
    writeDb(db);
    res.json({ logId, db });
  });

  app.patch('/api/daily-logs/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.dailyLogs.findIndex((l) => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Bitácora no encontrada.' });
      return;
    }
    db.dailyLogs[idx] = {
      ...db.dailyLogs[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/daily-logs/:id', (req: Request, res: Response) => {
    const db = readDb();
    db.dailyLogs = db.dailyLogs.filter((l) => l.id !== req.params.id);
    writeDb(db);
    res.json({ db });
  });

  // --- Lesson Plans (Planeaciones Docentes) ---
  app.post('/api/lesson-plans', (req: Request, res: Response) => {
    const db = readDb();
    const now = new Date().toISOString();
    const planId = makeId('plan');
    db.lessonPlans.push({
      id: planId,
      source: 'cargada',
      formativeField: 'general',
      methodology: 'abp_proyectos',
      articulatingAxes: [],
      nonSchoolDays: [],
      sessions: [],
      pda: '',
      teacherNeeds: '',
      evaluationFormative: '',
      adjustments: '',
      fileName: '',
      mimeType: '',
      sizeBytes: 0,
      dataUrl: '',
      notes: '',
      ...req.body,
      createdAt: now,
      updatedAt: now,
    });
    writeDb(db);
    res.json({ planId, db });
  });

  app.patch('/api/lesson-plans/:id', (req: Request, res: Response) => {
    const db = readDb();
    const idx = db.lessonPlans.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Planeación no encontrada.' });
      return;
    }
    db.lessonPlans[idx] = {
      ...db.lessonPlans[idx],
      ...req.body,
      id: req.params.id,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    res.json({ db });
  });

  app.delete('/api/lesson-plans/:id', (req: Request, res: Response) => {
    const db = readDb();
    db.lessonPlans = db.lessonPlans.filter((p) => p.id !== req.params.id);
    writeDb(db);
    res.json({ db });
  });

  // --- AI Routes (Gemini 2.5 Flash Free Tier + Optional Groq Fallback) ---
  app.post('/api/ai/behavior-report', async (req: Request, res: Response) => {
    try {
      const {
        studentName,
        groupName,
        schoolName,
        teacherName,
        guardianName,
        incidentDate,
        category,
        severity,
        description,
        actionTaken,
        recentIncidentsSummary,
      } = req.body ?? {};

      if (!studentName || !description) {
        res.status(400).json({ error: 'Se requiere el nombre del estudiante y los hechos.' });
        return;
      }

      const prompt = [
        `Eres un asesor técnico-pedagógico experto en educación primaria en México y Latinoamérica.`,
        `Transforma la narración informal del docente en dos reportes formales y respetuosos:`,
        `- Escuela: ${schoolName || 'Escuela Primaria'}`,
        `- Grupo: ${groupName || 'Primaria'}`,
        `- Docente: ${teacherName || 'Docente titular'}`,
        `- Alumno(a): ${studentName}`,
        `- Padre / Tutor: ${guardianName || 'Padre de familia / Tutor'}`,
        `- Fecha: ${incidentDate || 'Reciente'}`,
        `- Categoría: ${category || 'Convivencia'}`,
        `- Tipo / Gravedad: ${severity || 'Leve'}`,
        `- Hechos descritos por el docente: ${description}`,
        `- Acción inmediata aplicada: ${actionTaken || 'Diálogo formativo en el aula'}`,
        recentIncidentsSummary ? `- Antecedentes:\n${recentIncidentsSummary}` : '',
        ``,
        `Devuelve JSON con estas 3 llaves exactas:`,
        `1. "parentReport": Comunicado formal, empático y constructivo dirigido a ${guardianName || 'la familia'}, sin etiquetas hirientes, explicando los hechos e invitando a acuerdos hogar-escuela. Sin encabezados de fecha ni líneas de firma.`,
        `2. "directionReport": Informe técnico-pedagógico objetivo dirigido a Dirección Escolar con antecedentes, hechos, intervención docente y seguimiento sugerido. Sin encabezados ni líneas de firma.`,
        `3. "suggestedAgreements": 2 a 3 acuerdos concretos separados por saltos de línea.`,
      ]
        .filter(Boolean)
        .join('\n');

      const parsed = await generateStructuredJson(
        prompt,
        {
          type: Type.OBJECT,
          properties: {
            parentReport: { type: Type.STRING },
            directionReport: { type: Type.STRING },
            suggestedAgreements: { type: Type.STRING },
          },
          required: ['parentReport', 'directionReport', 'suggestedAgreements'],
        },
        () => {
          const isPositive = severity === 'positiva';
          return {
            parentReport: isPositive
              ? `Estimado(a) ${guardianName || 'padre de familia o tutor'}: Por medio del presente le informamos con gusto que el/la alumno(a) ${studentName} destacó positivamente en el grupo ${groupName || 'de primaria'} el día ${incidentDate || 'reciente'}. Motivo: ${description}. Como docente titular reconozco su esfuerzo y le invito a felicitarle en casa para continuar fortaleciendo estos hábitos.`
              : `Estimado(a) ${guardianName || 'padre de familia o tutor'}: Por medio del presente le comunicamos de manera respetuosa una situación registrada con el/la alumno(a) ${studentName} del grupo ${groupName || 'de primaria'} el día ${incidentDate || 'reciente'} en el rubro de ${category || 'convivencia escolar'}. Descripción de los hechos: ${description}. En el aula se aplicó como medida formativa: ${actionTaken || 'diálogo reflexivo'}. Agradecemos su apoyo desde casa para dar seguimiento conjunto y favorecer su desarrollo integral.`,
            directionReport: `Se informa a la Dirección Escolar sobre el registro correspondiente al alumno(a) ${studentName} (${groupName || 'Primaria'}), con fecha ${incidentDate || 'reciente'}, clasificado en ${category || 'convivencia'} (${severity || 'leve'}). Hechos reportados: ${description}. Intervención docente inmediata: ${actionTaken || 'Diálogo formativo en el aula'}. Se mantiene seguimiento continuo en la bitácora grupal.`,
            suggestedAgreements: isPositive
              ? '1. Reconocer verbalmente los logros y actitudes solidarias del alumno.\n2. Mantener la comunicación constante hogar-escuela.'
              : '1. Conversar en casa sobre la importancia del respeto y los acuerdos del aula.\n2. Dar seguimiento semanal al cumplimiento y conducta del estudiante.\n3. Mantener comunicación abierta con el docente titular.',
          };
        }
      );

      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al generar el reporte con IA.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/evaluate-conduct', async (req: Request, res: Response) => {
    try {
      const { periodName, students } = req.body ?? {};
      if (!Array.isArray(students) || students.length === 0) {
        res.status(400).json({ error: 'Se requiere al menos un estudiante.' });
        return;
      }

      const typedStudents = students as Array<{
        studentId: string;
        studentName: string;
        incidents?: Array<{ date: string; category: string; severity: string; description: string }>;
        attendanceStats?: { presentes: number; retardos: number; faltas: number };
      }>;

      const summaries = typedStudents.map((st) => {
        const incList = (st.incidents ?? [])
          .map((inc) => `  * [${inc.date}] (${inc.severity} / ${inc.category}): ${inc.description}`)
          .join('\n');
        const att = st.attendanceStats
          ? `Asistencia: ${st.attendanceStats.presentes} presentes, ${st.attendanceStats.retardos} retardos, ${st.attendanceStats.faltas} faltas.`
          : '';
        return `ID: ${st.studentId} | Alumno: ${st.studentName}\n${att}\nRegistros del trimestre:\n${incList || '  * Sin incidencias negativas en este trimestre.'}`;
      });

      const prompt = [
        `Eres un docente de primaria evaluando la calificación trimestral de Conducta en escala base 10.0 (de 0.0 a 10.0) para "${periodName || 'Trimestre'}".`,
        `Criterios:`,
        `- Base inicial: 10.0. Sin incidencias negativas o con reconocimientos positivos: 10.0.`,
        `- 1 incidencia leve aislada: entre 9.0 y 9.5.`,
        `- Varias leves o 1 moderada: entre 7.8 y 8.8.`,
        `- Moderadas recurrentes o 1 grave: entre 6.0 y 7.5.`,
        `- Reconocimientos positivos compensan parcialmente faltas leves.`,
        `Devuelve JSON con "evaluations": arreglo de objetos { "studentId": string, "conductBase10": number (0.0 a 10.0), "reason": string (máx 25 palabras), "suggestedComment": string (1-2 oraciones constructivas para boleta) }.`,
        ``,
        summaries.join('\n\n'),
      ].join('\n');

      const parsed = await generateStructuredJson(
        prompt,
        {
          type: Type.OBJECT,
          properties: {
            evaluations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  studentId: { type: Type.STRING },
                  conductBase10: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                  suggestedComment: { type: Type.STRING },
                },
                required: ['studentId', 'conductBase10', 'reason', 'suggestedComment'],
              },
            },
          },
          required: ['evaluations'],
        },
        () => {
          const evaluations = typedStudents.map((st) => {
            let score = 10.0;
            let positives = 0;
            let negatives = 0;
            for (const inc of st.incidents ?? []) {
              if (inc.severity === 'positiva') {
                score += 0.3;
                positives++;
              } else if (inc.severity === 'leve') {
                score -= 0.5;
                negatives++;
              } else if (inc.severity === 'moderada') {
                score -= 1.2;
                negatives++;
              } else if (inc.severity === 'grave') {
                score -= 2.2;
                negatives++;
              }
            }
            const clamped = Math.max(5.0, Math.min(10.0, Math.round(score * 10) / 10));
            return {
              studentId: st.studentId,
              conductBase10: clamped,
              reason:
                negatives === 0
                  ? positives > 0
                    ? `Excelente disposición y ${positives} mérito(s) positivo(s) registrados.`
                    : 'Sin incidencias negativas registradas durante el trimestre.'
                  : `${negatives} incidencia(s) registrada(s) y ${positives} mérito(s) en ${periodName || 'el trimestre'}.`,
              suggestedComment:
                clamped >= 9.5
                  ? 'Mantiene una convivencia respetuosa y constante disposición para el trabajo en el aula.'
                  : 'Se recomienda continuar reforzando acuerdos de convivencia y seguimiento conjunto en casa.',
            };
          });
          return { evaluations };
        }
      );

      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al evaluar conducta con IA.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/draft-comment', async (req: Request, res: Response) => {
    try {
      const {
        studentName,
        periodName,
        finalGrade,
        scaleMax,
        summary,
      } = req.body ?? {};

      const prompt = [
        `Redacta un comentario breve, cálido y formativo (2 a 3 oraciones, máximo 65 palabras) para la boleta trimestral de primaria de ${studentName} (${periodName}).`,
        `Calificación final: ${finalGrade} / ${scaleMax}.`,
        `Resumen del estudiante: ${summary || 'Desempeño general del trimestre'}.`,
        `Devuelve JSON con la llave { "comment": string }.`,
      ].join('\n');

      const parsed = await generateStructuredJson(
        prompt,
        {
          type: Type.OBJECT,
          properties: {
            comment: { type: Type.STRING },
          },
          required: ['comment'],
        },
        () => ({
          comment: `Durante el ${periodName || 'trimestre'}, ${studentName || 'el/la estudiante'} obtuvo un desempeño de ${finalGrade} / ${scaleMax}. Se reconoce su esfuerzo cotidiano y se invita a continuar fortaleciendo sus hábitos de estudio y cumplimiento diario.`,
        })
      );

      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al redactar comentario.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/daily-log', async (req: Request, res: Response) => {
    try {
      const { date, groupName, period, rawNarrative } = req.body ?? {};
      if (!rawNarrative || !String(rawNarrative).trim()) {
        res.status(400).json({ error: 'Escribe o dicta primero cómo te fue en la jornada.' });
        return;
      }

      const prompt = [
        `Eres un asesor técnico-pedagógico de educación primaria.`,
        `El docente te cuenta de manera natural e informal cómo fue su jornada escolar:`,
        `- Fecha: ${date || 'Hoy'}`,
        `- Grupo: ${groupName || 'Primaria'}`,
        `- Periodo: ${period || 'Trimestre 1'}`,
        `- Relato del docente: "${rawNarrative}"`,
        ``,
        `Estructura ese relato en una Bitácora Docente formal y clara con estas 4 llaves JSON:`,
        `1. "topicsCovered": Temas, asignaturas o contenidos abordados en la jornada.`,
        `2. "studentObservations": Observaciones sobre el desempeño del grupo, alumnos mencionados o incidencias relevantes.`,
        `3. "agreementsPending": Acuerdos de junta, tareas encargadas o pendientes para las siguientes sesiones.`,
        `4. "pedagogicalReflection": Breve reflexión pedagógica constructiva sobre el avance del grupo y estrategias a reforzar.`,
      ].join('\n');

      const parsed = await generateStructuredJson(
        prompt,
        {
          type: Type.OBJECT,
          properties: {
            topicsCovered: { type: Type.STRING },
            studentObservations: { type: Type.STRING },
            agreementsPending: { type: Type.STRING },
            pedagogicalReflection: { type: Type.STRING },
          },
          required: [
            'topicsCovered',
            'studentObservations',
            'agreementsPending',
            'pedagogicalReflection',
          ],
        },
        () => {
          const text = String(rawNarrative).trim();
          const sentences = text
            .split(/(?<=[.!?])\s+|\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const pendingMatches = sentences.filter((s) =>
            /tarea|pendiente|junta|mañana|revisar|llevar|acuerdo|encargar|próxima/i.test(s)
          );
          const studentMatches = sentences.filter((s) =>
            /alumno|niñ|no trajo|trajeron|falt|conducta|particip|apoy|dificultad|equipo/i.test(s)
          );
          return {
            topicsCovered: `Jornada del ${date || 'día'} (${groupName || 'Primaria'} · ${period || 'Trimestre'}):\n${sentences[0] || text}`,
            studentObservations:
              studentMatches.length > 0
                ? studentMatches.join(' ')
                : text,
            agreementsPending:
              pendingMatches.length > 0
                ? pendingMatches.join(' ')
                : 'Dar seguimiento en la siguiente sesión a las actividades abordadas.',
            pedagogicalReflection:
              'Registro guardado localmente. Se continuará monitoreando el avance del grupo y la atención oportuna a los estudiantes que requieran refuerzo.',
          };
        }
      );

      res.json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al estructurar bitácora diaria.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/lesson-plan-nem', async (req: Request, res: Response) => {
    try {
      const {
        title,
        groupName,
        schoolName,
        period,
        planScope,
        formativeField,
        methodology,
        articulatingAxes,
        pda,
        teacherNeeds,
        weekStartDate,
        weekEndDate,
        nonSchoolDays,
      } = req.body ?? {};

      const topicTitle = String(title || '').trim();
      const needsText = String(teacherNeeds || '').trim();
      if (!topicTitle && !needsText) {
        res.status(400).json({
          error: 'Indica los temas o las necesidades del grupo para generar la planeación NEM.',
        });
        return;
      }

      const isIntegrated = planScope !== 'campo_unico' || formativeField === 'general';

      const FIELD_LABELS: Record<string, string> = {
        general: 'Planeación Integrada (Todos los Campos Formativos)',
        lenguajes: 'Lenguajes',
        saberes: 'Saberes y Pensamiento Científico',
        etica: 'Ética, Naturaleza y Sociedades',
        humano: 'De lo Humano y lo Comunitario',
      };

      const METHODOLOGY_LABELS: Record<string, string> = {
        abp_proyectos: 'Aprendizaje Basado en Proyectos Comunitarios (ABPC)',
        steam: 'Aprendizaje Basado en Indagación (STEAM)',
        problemas: 'Aprendizaje Basado en Problemas (ABP)',
        servicio: 'Aprendizaje Servicio (AS)',
      };

      const WEEKDAYS: Array<{ key: string; label: string }> = [
        { key: 'lunes', label: 'Lunes' },
        { key: 'martes', label: 'Martes' },
        { key: 'miercoles', label: 'Miércoles' },
        { key: 'jueves', label: 'Jueves' },
        { key: 'viernes', label: 'Viernes' },
      ];

      const rawNonSchool = Array.isArray(nonSchoolDays)
        ? (nonSchoolDays as Array<{ day?: string; reason?: string }>)
        : [];
      const nonSchoolMap = new Map<string, string>();
      for (const entry of rawNonSchool) {
        if (entry?.day) {
          nonSchoolMap.set(
            String(entry.day),
            String(entry.reason || 'Suspensión de labores docentes').trim()
          );
        }
      }

      const activeDaysLabels = WEEKDAYS.filter((w) => !nonSchoolMap.has(w.key))
        .map((w) => w.label)
        .join(', ');
      const suspendedDaysSummary = WEEKDAYS.filter((w) => nonSchoolMap.has(w.key))
        .map((w) => `- ${w.label}: SIN CLASES (Motivo: ${nonSchoolMap.get(w.key)})`)
        .join('\n');

      const axesStr =
        Array.isArray(articulatingAxes) && articulatingAxes.length > 0
          ? articulatingAxes.join(', ')
          : 'Inclusión, Pensamiento crítico';

      const prompt = [
        `Eres un asesor técnico-pedagógico experto en el Plan de Estudio 2022 de la Nueva Escuela Mexicana (NEM) para educación primaria en México.`,
        isIntegrated
          ? `El docente quiere UNA SOLA planeación semanal integrada donde TÚ separes y organices automáticamente los temas que mencionó dentro de los Campos Formativos correspondientes de la NEM (para que no tenga que hacer un documento separado por cada campo).`
          : `Diseña una planeación didáctica semanal enfocada en un solo Campo Formativo de la NEM.`,
        `Datos del grupo y semana:`,
        `- Escuela: ${schoolName || 'Escuela Primaria'}`,
        `- Grado y grupo: ${groupName || 'Primaria'}`,
        `- Periodo: ${period || 'Trimestre 1'}`,
        `- Semana: ${weekStartDate || 'Actual'} al ${weekEndDate || 'Viernes'}`,
        topicTitle ? `- Título / Eje semanal: ${topicTitle}` : '',
        !isIntegrated
          ? `- Campo Formativo NEM: ${FIELD_LABELS[String(formativeField || 'lenguajes')] || 'Lenguajes'}`
          : `- Alcance: Integrada (separa automáticamente en "lenguajes", "saberes", "etica", "humano" según los temas indicados por el docente).`,
        `- Metodología sociocrítica NEM: ${METHODOLOGY_LABELS[String(methodology || 'abp_proyectos')] || 'ABPC'}`,
        `- Ejes Articuladores: ${axesStr}`,
        pda ? `- Contenido / PDA adicional indicado por el docente: ${pda}` : '',
        `- Temas y necesidades específicas descritas por el maestro en un solo texto:\n"${needsText || topicTitle}"`,
        `- Días CON clases presenciales esta semana: ${activeDaysLabels || 'Ninguno'}`,
        suspendedDaysSummary
          ? `- Días SIN clases (NO planificar actividades presenciales esos días, respetar motivo):\n${suspendedDaysSummary}`
          : '- Todos los días de lunes a viernes tienen clases regulares.',
        ``,
        `IMPORTANTE:`,
        `1. Distribuye las actividades únicamente en los días CON clases.`,
        `2. En cada día con clases de una planeación integrada, separa claramente con etiquetas (ej. [Lenguajes], [Saberes y Pensamiento Científico], etc.) qué actividades se trabajan ese día.`,
        `3. Para los días marcados SIN clases, establece active=false, suspensionReason con el motivo exacto, activities indicando "Sin clases presenciales por: [motivo]" y materials="—".`,
        `4. Devuelve un objeto JSON válido con las llaves exactas:`,
        `   - "title": string (título claro de la planeación semanal)`,
        `   - "pda": string (resumen integrador de los Procesos de Desarrollo de Aprendizaje)`,
        `   - "evaluationFormative": string (criterios, evidencias e instrumento de evaluación formativa)`,
        `   - "adjustments": string (ajustes razonables e inclusión atendiendo las necesidades indicadas por el maestro)`,
        isIntegrated
          ? `   - "fieldBlocks": arreglo de los Campos Formativos detectados o pertinentes (valores válidos para field: "lenguajes" | "saberes" | "etica" | "humano"), cada uno con { "field": string, "fieldLabel": string, "topic": string (temas extraídos/asignados a ese campo), "pda": string, "activitiesSummary": string }.`
          : `   - "fieldBlocks": arreglo vacío [].`,
        `   - "sessions": arreglo de exactamente 5 objetos en orden ["lunes","martes","miercoles","jueves","viernes"], cada uno con { "day": string, "active": boolean, "suspensionReason": string, "activities": string, "materials": string }`,
      ]
        .filter(Boolean)
        .join('\n');

      const parsed = await generateStructuredJson(
        prompt,
        {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            pda: { type: Type.STRING },
            evaluationFormative: { type: Type.STRING },
            adjustments: { type: Type.STRING },
            fieldBlocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  field: { type: Type.STRING },
                  fieldLabel: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  pda: { type: Type.STRING },
                  activitiesSummary: { type: Type.STRING },
                },
                required: ['field', 'fieldLabel', 'topic', 'pda', 'activitiesSummary'],
              },
            },
            sessions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  active: { type: Type.BOOLEAN },
                  suspensionReason: { type: Type.STRING },
                  activities: { type: Type.STRING },
                  materials: { type: Type.STRING },
                },
                required: ['day', 'active', 'suspensionReason', 'activities', 'materials'],
              },
            },
          },
          required: ['title', 'pda', 'evaluationFormative', 'adjustments', 'fieldBlocks', 'sessions'],
        },
        () => {
          const combinedSource = `${topicTitle}. ${needsText}`.trim();
          const clauses = combinedSource
            .split(/[,;\n.]+/)
            .map((s) => s.trim())
            .filter(Boolean);

          const buckets: Record<'lenguajes' | 'saberes' | 'etica' | 'humano', string[]> = {
            lenguajes: [],
            saberes: [],
            etica: [],
            humano: [],
          };

          for (const c of clauses) {
            if (/español|lectura|leer|escritura|escrib|cuento|instructivo|carta|texto|ortograf|redacci|exposici|debate|lengua|vocabulario|comprensi[oó]n lectora/i.test(c)) {
              buckets.lenguajes.push(c);
            } else if (/matem|fracci|suma|resta|multip|divis|n[uú]mero|c[aá]lculo|geometr|figura|ciencia|agua|energ[ií]a|experimento|ecosistema|cuerpo|planta|naturaleza viva|indagaci/i.test(c)) {
              buckets.saberes.push(c);
            } else if (/historia|geograf|comunidad|derecho|c[ií]vic|cultura|tradici|identidad|medio ambiente|recicl|patrimonio|democracia|norma|regla/i.test(c)) {
              buckets.etica.push(c);
            } else if (/socioemocional|emoci[oó]n|salud|higiene|alimentaci|educaci[oó]n f[ií]sica|equipo|convivencia|juego|arte|m[uú]sica|deporte|vida saludable|inclusi/i.test(c)) {
              buckets.humano.push(c);
            }
          }

          const fieldCatalog: Array<{
            field: 'lenguajes' | 'saberes' | 'etica' | 'humano';
            fieldLabel: string;
            defaultTopic: string;
            defaultPda: string;
          }> = [
            {
              field: 'lenguajes',
              fieldLabel: 'Lenguajes',
              defaultTopic: 'Comprensión y producción de textos del aula',
              defaultPda: 'Expresa ideas, lee y produce textos breves con propósito comunicativo claro en comunidad.',
            },
            {
              field: 'saberes',
              fieldLabel: 'Saberes y Pensamiento Científico',
              defaultTopic: 'Resolución de problemas matemáticos y exploración del entorno',
              defaultPda: 'Resuelve situaciones problemáticas cotidianas empleando cálculo, medición y observación científica.',
            },
            {
              field: 'etica',
              fieldLabel: 'Ética, Naturaleza y Sociedades',
              defaultTopic: 'Cuidado del entorno escolar y convivencia responsable',
              defaultPda: 'Reconoce acciones colectivas para el cuidado de su comunidad y el respeto a los acuerdos.',
            },
            {
              field: 'humano',
              fieldLabel: 'De lo Humano y lo Comunitario',
              defaultTopic: 'Colaboración, hábitos saludables y autorregulación',
              defaultPda: 'Participa de forma solidaria en actividades grupales respetando ritmos y diversidad.',
            },
          ];

          const generatedBlocks = isIntegrated
            ? fieldCatalog
                .filter((fc) => {
                  const anySpecific =
                    buckets.lenguajes.length +
                      buckets.saberes.length +
                      buckets.etica.length +
                      buckets.humano.length >
                    0;
                  return !anySpecific || buckets[fc.field].length > 0;
                })
                .map((fc) => {
                  const matchedTopics = buckets[fc.field];
                  const topic =
                    matchedTopics.length > 0 ? matchedTopics.join(' · ') : fc.defaultTopic;
                  return {
                    field: fc.field,
                    fieldLabel: fc.fieldLabel,
                    topic,
                    pda: fc.defaultPda,
                    activitiesSummary: `Actividades guiadas y en equipo sobre: ${topic}.`,
                  };
                })
            : [];

          const methLabel =
            METHODOLOGY_LABELS[String(methodology || 'abp_proyectos')] ||
            'Aprendizaje Basado en Proyectos Comunitarios';
          const activeDays = WEEKDAYS.filter((w) => !nonSchoolMap.has(w.key));
          const activeTotal = activeDays.length;
          let activeIdx = 0;

          const sessions = WEEKDAYS.map((w) => {
            if (nonSchoolMap.has(w.key)) {
              const reason = nonSchoolMap.get(w.key) || 'Sin asistencia escolar';
              return {
                day: w.key,
                active: false,
                suspensionReason: reason,
                activities: `Sin actividades presenciales. Motivo: ${reason}.`,
                materials: '—',
              };
            }
            activeIdx++;
            if (isIntegrated && generatedBlocks.length > 0) {
              const phase =
                activeTotal <= 1
                  ? 'Sesión integral (Inicio, Desarrollo y Cierre)'
                  : activeIdx === 1
                  ? 'Apertura semanal y recuperación de saberes previos'
                  : activeIdx === activeTotal
                  ? 'Socialización de productos, repaso e integración semanal'
                  : `Desarrollo y práctica guiada (Día ${activeIdx} de ${activeTotal})`;
              const perFieldLines = generatedBlocks.map(
                (b) => `• [${b.fieldLabel}] Trabajar "${b.topic}" mediante ejercicios breves y puesta en común.`
              );
              return {
                day: w.key,
                active: true,
                suspensionReason: '',
                activities: `${phase} (${methLabel}):\n${perFieldLines.join('\n')}`,
                materials: 'Cuadernos de trabajo, libros de texto gratuitos SEP, material concreto y pizarrón.',
              };
            }

            const fieldLabel = FIELD_LABELS[String(formativeField || 'lenguajes')] || 'Lenguajes';
            const phaseLabel =
              activeTotal <= 1
                ? 'Apertura, desarrollo guiado y cierre integrador'
                : activeIdx === 1
                ? 'Fase de planeación y recuperación de saberes previos'
                : activeIdx === activeTotal
                ? 'Socialización de producciones, retroalimentación y cierre formativo'
                : `Desarrollo de actividades colaborativas (Sesión ${activeIdx} de ${activeTotal})`;
            return {
              day: w.key,
              active: true,
              suspensionReason: '',
              activities: `${phaseLabel} sobre "${topicTitle || fieldLabel}" (${methLabel}).\n• Inicio: Dialogar en comunidad de aula.\n• Desarrollo: Actividades prácticas atendiendo ${needsText || 'distintos ritmos de aprendizaje'}.\n• Cierre: Puesta en común.`,
              materials: 'Cuaderno del alumno, libros de texto gratuitos SEP y material concreto.',
            };
          });

          return {
            title:
              topicTitle ||
              (isIntegrated
                ? `Planeación Semanal Integrada NEM (${groupName || 'Primaria'})`
                : `Proyecto NEM — ${FIELD_LABELS[String(formativeField || 'lenguajes')]}`),
            pda:
              pda ||
              (isIntegrated
                ? 'Integración semanal de Procesos de Desarrollo de Aprendizaje en los Campos Formativos vinculados a las necesidades del grupo.'
                : `Analiza, dialoga y resuelve situaciones de su contexto escolar en ${FIELD_LABELS[String(formativeField || 'lenguajes')]}.`),
            evaluationFormative:
              'Observación directa, lista de cotejo por campo formativo y revisión formativa de cuadernos y productos finales.',
            adjustments: needsText
              ? `Atención diferenciada conforme a lo indicado por el docente: ${needsText}. Uso de apoyos visuales, consignas claras y acompañamiento en equipo.`
              : 'Instrucciones segmentadas, apoyos visuales y trabajo colaborativo entre pares.',
            fieldBlocks: generatedBlocks,
            sessions,
          };
        }
      );

      // Normalize sessions strictly to Lunes..Viernes respecting nonSchoolMap
      const rawSessions = Array.isArray(parsed.sessions)
        ? (parsed.sessions as Array<Record<string, unknown>>)
        : [];
      const normalizedSessions = WEEKDAYS.map((w) => {
        if (nonSchoolMap.has(w.key)) {
          const reason = nonSchoolMap.get(w.key) || 'Sin clases';
          return {
            day: w.key,
            active: false,
            suspensionReason: reason,
            activities: `Sin clases presenciales. Motivo: ${reason}.`,
            materials: '—',
          };
        }
        const matched = rawSessions.find(
          (s) =>
            String(s.day || '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '') === w.key
        );
        return {
          day: w.key,
          active: true,
          suspensionReason: '',
          activities: String(
            matched?.activities ||
              `Actividades formativas de ${w.label} para ${topicTitle || 'la semana'}.`
          ),
          materials: String(
            matched?.materials || 'Cuaderno, libros de texto SEP y material del aula.'
          ),
        };
      });

      const validFields = new Set(['lenguajes', 'saberes', 'etica', 'humano']);
      const rawBlocks = Array.isArray(parsed.fieldBlocks)
        ? (parsed.fieldBlocks as Array<Record<string, unknown>>)
        : [];
      const normalizedBlocks = isIntegrated
        ? rawBlocks
            .map((b) => {
              const rawKey = String(b.field || 'lenguajes').toLowerCase();
              const fieldKey = (validFields.has(rawKey) ? rawKey : 'lenguajes') as
                | 'lenguajes'
                | 'saberes'
                | 'etica'
                | 'humano';
              return {
                field: fieldKey,
                fieldLabel: String(b.fieldLabel || FIELD_LABELS[fieldKey]),
                topic: String(b.topic || ''),
                pda: String(b.pda || ''),
                activitiesSummary: String(b.activitiesSummary || ''),
              };
            })
            .filter((b) => b.topic || b.activitiesSummary)
        : [];

      res.json({
        title: String(parsed.title || topicTitle || 'Planeación Didáctica NEM'),
        pda: String(parsed.pda || pda || ''),
        evaluationFormative: String(parsed.evaluationFormative || ''),
        adjustments: String(parsed.adjustments || ''),
        fieldBlocks: normalizedBlocks,
        sessions: normalizedSessions,
        _aiMeta: parsed._aiMeta,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error al generar planeación NEM con IA.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/updates/check-github', async (_req: Request, res: Response) => {
    try {
      const pkgFile = path.resolve(__dirname, 'package.json');
      const altPkgFile = path.resolve(__dirname, '..', 'package.json');
      const resolvedPkg = fs.existsSync(pkgFile) ? pkgFile : altPkgFile;
      const currentVersion = fs.existsSync(resolvedPkg)
        ? String(JSON.parse(fs.readFileSync(resolvedPkg, 'utf-8')).version || '1.0.0')
        : '1.0.0';

      const ymlCandidates = [
        path.resolve(__dirname, 'electron-builder.yml'),
        path.resolve(__dirname, '..', 'electron-builder.yml'),
      ];
      let owner = 'TU_USUARIO_GITHUB';
      let repo = 'NOMBRE_DEL_REPO';
      for (const cand of ymlCandidates) {
        if (!fs.existsSync(cand)) continue;
        const yml = fs.readFileSync(cand, 'utf-8');
        const ownerM = yml.match(/^\s*(?:-\s*)?owner:\s*["']?([^"'\r\n#]+)["']?/m);
        const repoM = yml.match(/^\s*(?:-\s*)?repo:\s*["']?([^"'\r\n#]+)["']?/m);
        if (ownerM?.[1]) owner = ownerM[1].trim();
        if (repoM?.[1]) repo = repoM[1].trim();
        break;
      }

      const repoSlug = `${owner}/${repo}`;
      const isPlaceholder =
        !owner ||
        !repo ||
        owner === 'TU_USUARIO_GITHUB' ||
        repo === 'NOMBRE_DEL_REPO';

      if (isPlaceholder) {
        res.json({
          currentVersion,
          status: 'unconfigured',
          repoSlug,
          availableVersion: null,
          releaseNotes: '',
          directDownloadUrl: null,
          requiresManualDownload: true,
          lastCheckedAt: new Date().toISOString(),
          error: null,
          message:
            'Configura tu usuario y repositorio de GitHub en electron-builder.yml para verificar versiones.',
        });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
          )}/releases/latest`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': `AulaAgil/${currentVersion}`,
            },
            signal: controller.signal,
          }
        );
        if (ghRes.status === 404) {
          res.json({
            currentVersion,
            status: 'up-to-date',
            repoSlug,
            availableVersion: null,
            releaseNotes: '',
            directDownloadUrl: null,
            requiresManualDownload: true,
            lastCheckedAt: new Date().toISOString(),
            error: null,
            message: 'Aún no hay versiones publicadas en GitHub Releases.',
          });
          return;
        }
        if (!ghRes.ok) {
          res.status(502).json({
            error: 'No se pudieron consultar las actualizaciones en GitHub.',
          });
          return;
        }
        const release = (await ghRes.json()) as {
          tag_name?: string;
          name?: string;
          body?: string;
          published_at?: string;
          html_url?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        const remote = String(release.tag_name || release.name || '').replace(/^v/i, '');
        const parseVer = (v: string) =>
          v
            .replace(/^v/i, '')
            .split('-')[0]
            .split('.')
            .map((n) => parseInt(n, 10) || 0);
        const pa = parseVer(remote);
        const pb = parseVer(currentVersion);
        let isNewer = false;
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) > (pb[i] || 0)) {
            isNewer = true;
            break;
          }
          if ((pa[i] || 0) < (pb[i] || 0)) break;
        }

        const safeNotes = String(release.body || '')
          .replace(/<[^>]+>/g, '')
          .trim();

        const exeAsset = (release.assets || []).find((a) =>
          String(a.name || '').toLowerCase().endsWith('.exe')
        );

        res.json({
          currentVersion,
          status: isNewer ? 'available' : 'up-to-date',
          repoSlug,
          availableVersion: isNewer ? remote : null,
          releaseNotes: isNewer ? safeNotes : '',
          releaseDate: release.published_at || null,
          directDownloadUrl: isNewer
            ? exeAsset?.browser_download_url || release.html_url || null
            : null,
          requiresManualDownload: true,
          lastCheckedAt: new Date().toISOString(),
          error: null,
          message: isNewer
            ? `Nueva versión ${remote} disponible en GitHub Releases.`
            : 'Ya cuentas con la última versión instalada.',
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      res.status(503).json({ error: 'Sin conexión para verificar actualizaciones' });
    }
  });

  // --- Google Drive Cloud Backup Routes ---
  const getDriveTokenHeader = (req: Request): string | undefined => {
    const raw = req.headers['x-drive-access-token'];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  };

  const getPkgVersion = (): string => {
    try {
      const p1 = path.resolve(__dirname, 'package.json');
      const p2 = path.resolve(__dirname, '..', 'package.json');
      const resolved = fs.existsSync(p1) ? p1 : p2;
      if (fs.existsSync(resolved)) {
        return String(JSON.parse(fs.readFileSync(resolved, 'utf-8')).version || '1.0.0');
      }
    } catch {
      // fallback
    }
    return '1.0.0';
  };

  app.get('/api/drive-backup/status', (_req: Request, res: Response) => {
    res.json(getDrivePublicStatus());
  });

  app.post('/api/drive-backup/firebase-sync', async (req: Request, res: Response) => {
    try {
      const token = getDriveTokenHeader(req);
      if (!token) {
        res.status(400).json({ error: 'Falta token de acceso de Google Drive.' });
        return;
      }
      const { email, name, avatar } = req.body ?? {};
      const status = await syncFirebaseDriveProfile(token, {
        email: typeof email === 'string' ? email : undefined,
        name: typeof name === 'string' ? name : undefined,
        avatar: typeof avatar === 'string' ? avatar : undefined,
      });
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo sincronizar la cuenta de Google Drive.',
      });
    }
  });

  app.patch('/api/drive-backup/settings', (req: Request, res: Response) => {
    const {
      autoSchedule,
      maxBackups,
      clientId,
      clientSecret,
      clearCustomCredentials,
    } = req.body ?? {};

    const patch: Parameters<typeof saveDriveConfig>[0] = {};
    if (
      autoSchedule === 'off' ||
      autoSchedule === 'on_close' ||
      autoSchedule === 'daily' ||
      autoSchedule === 'weekly'
    ) {
      patch.autoSchedule = autoSchedule;
    }
    if (maxBackups !== undefined) {
      patch.maxBackups = Math.min(20, Math.max(1, Number(maxBackups) || 5));
    }
    if (clearCustomCredentials === true) {
      patch.clientId = '';
      patch.clientSecret = '';
    } else {
      if (typeof clientId === 'string') patch.clientId = clientId.trim();
      if (typeof clientSecret === 'string' && clientSecret.trim()) {
        patch.clientSecret = clientSecret.trim();
      }
    }

    saveDriveConfig(patch);
    res.json(getDrivePublicStatus());
  });

  app.post('/api/drive-backup/oauth/start', async (_req: Request, res: Response) => {
    try {
      const result = await startDesktopOAuthFlow();
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo iniciar la autenticación de escritorio con Google Drive.',
      });
    }
  });

  app.post('/api/drive-backup/disconnect', async (_req: Request, res: Response) => {
    try {
      const status = await disconnectDriveAccount();
      res.json(status);
    } catch {
      res.json(getDrivePublicStatus());
    }
  });

  app.get('/api/drive-backup/files', async (req: Request, res: Response) => {
    try {
      const files = await listDriveBackups(getDriveTokenHeader(req));
      res.json({ files, status: getDrivePublicStatus() });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'No se pudieron consultar los respaldos en Google Drive.',
      });
    }
  });

  app.post('/api/drive-backup/backup-now', async (req: Request, res: Response) => {
    try {
      const result = await uploadBackupToDrive(
        getDataDir(),
        () => readDb() as unknown as Record<string, unknown>,
        getPkgVersion(),
        getDriveTokenHeader(req)
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo subir el respaldo comprimido a Google Drive.',
      });
    }
  });

  app.get(
    '/api/drive-backup/files/:fileId/preview',
    async (req: Request, res: Response) => {
      try {
        const manifest = await previewDriveBackup(
          req.params.fileId,
          getDriveTokenHeader(req)
        );
        res.json({ manifest });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo inspeccionar el respaldo de Google Drive.',
        });
      }
    }
  );

  app.post(
    '/api/drive-backup/files/:fileId/restore',
    async (req: Request, res: Response) => {
      try {
        const restored = await restoreDriveBackup(
          req.params.fileId,
          getDataDir(),
          (nextDb) => writeDb(nextDb as unknown as DbShape),
          getDriveTokenHeader(req)
        );
        const restoredUser = getFirstUser();
        res.json({
          db: restored.db,
          manifest: restored.manifest,
          user: restoredUser ? toPublicProfile(restoredUser) : null,
          status: getDrivePublicStatus(),
        });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo restaurar el respaldo desde Google Drive.',
        });
      }
    }
  );

  app.delete('/api/drive-backup/files/:fileId', async (req: Request, res: Response) => {
    try {
      await deleteDriveBackup(req.params.fileId, getDriveTokenHeader(req));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo eliminar el archivo de Google Drive.',
      });
    }
  });

  app.get('/api/drive-backup/download-zip', async (_req: Request, res: Response) => {
    try {
      const { fileName, zipBuffer } = await buildBackupZipBuffer(
        getDataDir(),
        () => readDb() as unknown as Record<string, unknown>,
        getPkgVersion()
      );
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error ? err.message : 'No se pudo generar el respaldo .zip.',
      });
    }
  });

  app.post('/api/drive-backup/restore-zip', async (req: Request, res: Response) => {
    try {
      const { zipBase64 } = req.body ?? {};
      if (typeof zipBase64 !== 'string' || !zipBase64.trim()) {
        res.status(400).json({ error: 'Archivo .zip vacío o inválido.' });
        return;
      }
      const buffer = Buffer.from(zipBase64, 'base64');
      const restored = await restoreBackupZipBuffer(buffer, getDataDir(), (nextDb) =>
        writeDb(nextDb as unknown as DbShape)
      );
      const restoredUser = getFirstUser();
      res.json({
        db: restored.db,
        manifest: restored.manifest,
        user: restoredUser ? toPublicProfile(restoredUser) : null,
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : 'No se pudo restaurar el archivo .zip.',
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'))
      ? path.resolve(__dirname, 'dist')
      : path.resolve(__dirname, '..', 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  return await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(customPort, '0.0.0.0', () => {
      console.log(`AulaÁgil local server listening on http://localhost:${customPort}`);
      resolve(server);
    });
  });
}

export async function triggerOnCloseDriveBackup(): Promise<boolean> {
  try {
    const cfg = getDriveConfig();
    if (
      cfg.autoSchedule !== 'on_close' ||
      cfg.authMode !== 'desktop_oauth' ||
      (!cfg.refreshToken && !cfg.accessToken)
    ) {
      return false;
    }
    await uploadBackupToDrive(
      getDataDir(),
      () => readDb() as unknown as Record<string, unknown>,
      '1.0.0'
    );
    return true;
  } catch {
    return false;
  }
}

if (process.env.LIBRETA_NO_AUTOSTART !== '1') {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
