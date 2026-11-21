import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  clearGitHubLink,
  getGitHubConfig,
  saveGitHubConfig,
} from './db.ts';

const GITHUB_USER_AGENT = 'AulaAgil-Updater';
const SAFE_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const SAFE_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export interface GitHubUpdatePublicStatus {
  connected: boolean;
  authMode: 'none' | 'oauth' | 'pat' | 'public_repo';
  hasOAuthConfigured: boolean;
  oauthSource: 'env' | 'local' | 'none';
  oauthClientId: string;
  hasOAuthClientSecret: boolean;
  hasAccessToken: boolean;
  githubLogin: string;
  githubName: string;
  githubAvatar: string;
  owner: string;
  repo: string;
  repoSlug: string;
  repoPrivate: boolean;
  yamlConfigured: boolean;
  yamlRepoSlug: string;
  callbackUrlHint: string;
  updatedAt: string;
}

export interface GitHubRepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  description: string;
  updatedAt: string;
  htmlUrl: string;
}

interface PendingWebOAuth {
  redirectUri: string;
  expiresAt: number;
}

const pendingWebStates = new Map<string, PendingWebOAuth>();
let activeDesktopLoopback: http.Server | null = null;
let activeDesktopLoopbackTimer: ReturnType<typeof setTimeout> | null = null;

function cleanupExpiredWebStates() {
  const now = Date.now();
  for (const [k, v] of pendingWebStates.entries()) {
    if (v.expiresAt <= now) {
      pendingWebStates.delete(k);
    }
  }
}

export function parseGitHubRepoInput(raw: string): { owner: string; repo: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('Ingresa un repositorio válido (ej. usuario/aula-agil o URL de GitHub).');
  }

  let owner = '';
  let repo = '';

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('La URL de GitHub no tiene un formato válido.');
    }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Solo se permiten URLs oficiales de https://github.com/usuario/repo.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error('La URL debe incluir usuario y repositorio (github.com/usuario/repo).');
    }
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, '');
  } else {
    const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length !== 2) {
      throw new Error('Usa el formato "usuario/repositorio" (por ejemplo: docente/aula-agil).');
    }
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, '');
  }

  if (!SAFE_OWNER_RE.test(owner)) {
    throw new Error('El nombre de usuario u organización de GitHub contiene caracteres no válidos.');
  }
  if (!SAFE_REPO_RE.test(repo) || repo === '.' || repo === '..' || repo.includes('..')) {
    throw new Error('El nombre del repositorio de GitHub contiene caracteres no válidos.');
  }

  return { owner, repo };
}

export function readYamlPublishConfig(): {
  owner: string;
  repo: string;
  isConfigured: boolean;
} {
  const candidates = [
    path.resolve(process.cwd(), 'electron-builder.yml'),
    path.resolve(process.resourcesPath || '', 'app-update.yml'),
  ];
  for (const filePath of candidates) {
    try {
      if (!filePath || !fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      const ownerM = content.match(/^\s*(?:-\s*)?owner:\s*["']?([^"'\r\n#]+)["']?/m);
      const repoM = content.match(/^\s*(?:-\s*)?repo:\s*["']?([^"'\r\n#]+)["']?/m);
      const owner = ownerM?.[1]?.trim() || '';
      const repo = repoM?.[1]?.trim() || '';
      if (owner && repo) {
        const isPlaceholder =
          owner === 'TU_USUARIO_GITHUB' ||
          repo === 'NOMBRE_DEL_REPO' ||
          owner.includes('TU_USUARIO') ||
          repo.includes('NOMBRE_DEL_REPO');
        return { owner, repo, isConfigured: !isPlaceholder };
      }
    } catch {
      // Check next candidate
    }
  }
  return {
    owner: 'TU_USUARIO_GITHUB',
    repo: 'NOMBRE_DEL_REPO',
    isConfigured: false,
  };
}

function getRuntimeUpdaterFilePath(dataDir: string): string {
  return path.join(dataDir, 'github-updater.json');
}

export function syncRuntimeUpdaterFile(dataDir: string): void {
  const filePath = getRuntimeUpdaterFilePath(dataDir);
  const cfg = getGitHubConfig();
  if (!cfg.connected || !cfg.repoOwner || !cfg.repoName) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup failure
      }
    }
    return;
  }

  const payload = {
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    private: cfg.repoPrivate,
    token: cfg.repoPrivate && cfg.accessToken ? cfg.accessToken : '',
    updatedAt: cfg.updatedAt || new Date().toISOString(),
  };

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function resolveGitHubOAuthCreds(): {
  clientId: string;
  clientSecret: string;
  source: 'env' | 'local' | 'none';
} {
  const envId = String(process.env.GITHUB_CLIENT_ID || '').trim();
  const envSecret = String(process.env.GITHUB_CLIENT_SECRET || '').trim();
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: 'env' };
  }

  const cfg = getGitHubConfig();
  if (cfg.oauthClientId && cfg.oauthClientSecret) {
    return {
      clientId: cfg.oauthClientId,
      clientSecret: cfg.oauthClientSecret,
      source: 'local',
    };
  }

  return {
    clientId: cfg.oauthClientId || envId || '',
    clientSecret: '',
    source: 'none',
  };
}

function resolveCallbackUrlHint(): string {
  const rawAppUrl = String(process.env.APP_URL || '').trim();
  if (rawAppUrl && rawAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(rawAppUrl)) {
    return `${rawAppUrl.replace(/\/+$/, '')}/api/github-updates/oauth/callback`;
  }
  return '';
}

export function getGitHubUpdatePublicStatus(): GitHubUpdatePublicStatus {
  const cfg = getGitHubConfig();
  const yamlCfg = readYamlPublishConfig();
  const creds = resolveGitHubOAuthCreds();

  const hasLinkedRepo = Boolean(cfg.connected && cfg.repoOwner && cfg.repoName);
  const effectiveOwner = hasLinkedRepo
    ? cfg.repoOwner
    : yamlCfg.isConfigured
    ? yamlCfg.owner
    : '';
  const effectiveRepo = hasLinkedRepo
    ? cfg.repoName
    : yamlCfg.isConfigured
    ? yamlCfg.repo
    : '';
  const repoSlug =
    effectiveOwner && effectiveRepo ? `${effectiveOwner}/${effectiveRepo}` : '';

  return {
    connected: Boolean(cfg.connected),
    authMode: cfg.authMode,
    hasOAuthConfigured: Boolean(creds.clientId && creds.clientSecret),
    oauthSource: creds.source,
    oauthClientId: cfg.oauthClientId || '',
    hasOAuthClientSecret: Boolean(cfg.oauthClientSecret),
    hasAccessToken: Boolean(cfg.accessToken),
    githubLogin: cfg.githubLogin,
    githubName: cfg.githubName,
    githubAvatar: cfg.githubAvatar,
    owner: effectiveOwner,
    repo: effectiveRepo,
    repoSlug,
    repoPrivate: cfg.repoPrivate,
    yamlConfigured: yamlCfg.isConfigured,
    yamlRepoSlug: yamlCfg.isConfigured ? `${yamlCfg.owner}/${yamlCfg.repo}` : '',
    callbackUrlHint: resolveCallbackUrlHint(),
    updatedAt: cfg.updatedAt,
  };
}

export function saveGitHubOAuthCredentials(payload: {
  clientId?: string;
  clientSecret?: string;
  clearOAuthCredentials?: boolean;
}): GitHubUpdatePublicStatus {
  if (payload.clearOAuthCredentials) {
    saveGitHubConfig({
      oauthClientId: '',
      oauthClientSecret: '',
    });
    return getGitHubUpdatePublicStatus();
  }

  const current = getGitHubConfig();
  const nextId =
    typeof payload.clientId === 'string'
      ? payload.clientId.trim()
      : current.oauthClientId;
  const nextSecret =
    typeof payload.clientSecret === 'string' && payload.clientSecret.trim()
      ? payload.clientSecret.trim()
      : current.oauthClientSecret;

  if (!nextId) {
    throw new Error('Ingresa un Client ID válido de GitHub OAuth App.');
  }
  if (!nextSecret) {
    throw new Error('Ingresa el Client Secret de tu GitHub OAuth App.');
  }

  saveGitHubConfig({
    oauthClientId: nextId,
    oauthClientSecret: nextSecret,
  });
  return getGitHubUpdatePublicStatus();
}

async function fetchGitHubApiJson<T>(
  apiPath: string,
  token?: string
): Promise<{ status: number; ok: boolean; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': GITHUB_USER_AGENT,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`https://api.github.com${apiPath}`, {
      headers,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function linkGitHubRepo(
  input: { repoInput: string; accessToken?: string },
  dataDir: string
): Promise<GitHubUpdatePublicStatus> {
  const { owner, repo } = parseGitHubRepoInput(input.repoInput);
  const current = getGitHubConfig();
  const candidateToken =
    typeof input.accessToken === 'string' && input.accessToken.trim()
      ? input.accessToken.trim()
      : current.accessToken;

  const res = await fetchGitHubApiJson<{
    name?: string;
    private?: boolean;
    owner?: { login?: string; avatar_url?: string };
    message?: string;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    candidateToken || undefined
  );

  if (res.status === 404) {
    throw new Error(
      'No se encontró el repositorio en GitHub. Verifica el nombre o ingresa un token si es privado.'
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'GitHub rechazó el acceso al repositorio. Si es privado, verifica tu token de acceso.'
    );
  }
  if (!res.ok) {
    throw new Error('No se pudo validar el repositorio con GitHub en este momento.');
  }

  const nextAuthMode =
    current.authMode === 'oauth'
      ? 'oauth'
      : candidateToken
      ? 'pat'
      : 'public_repo';

  saveGitHubConfig({
    connected: true,
    authMode: nextAuthMode,
    accessToken: candidateToken || '',
    githubLogin: current.githubLogin || res.data.owner?.login || owner,
    githubName: current.githubName || res.data.owner?.login || owner,
    githubAvatar: current.githubAvatar || res.data.owner?.avatar_url || '',
    repoOwner: res.data.owner?.login || owner,
    repoName: res.data.name || repo,
    repoPrivate: Boolean(res.data.private),
  });

  syncRuntimeUpdaterFile(dataDir);
  return getGitHubUpdatePublicStatus();
}

export async function linkGitHubWithToken(
  accessToken: string,
  dataDir: string
): Promise<GitHubUpdatePublicStatus> {
  const clean = String(accessToken || '').trim();
  if (!clean) {
    throw new Error('Ingresa un Personal Access Token válido de GitHub.');
  }

  const userRes = await fetchGitHubApiJson<{
    login?: string;
    name?: string;
    avatar_url?: string;
  }>('/user', clean);

  if (!userRes.ok || !userRes.data.login) {
    throw new Error(
      'El token de GitHub es inválido o expiró. Genera un nuevo token e intenta otra vez.'
    );
  }

  saveGitHubConfig({
    connected: true,
    authMode: 'pat',
    accessToken: clean,
    githubLogin: userRes.data.login,
    githubName: userRes.data.name || userRes.data.login,
    githubAvatar: userRes.data.avatar_url || '',
  });
  syncRuntimeUpdaterFile(dataDir);
  return getGitHubUpdatePublicStatus();
}

export async function listGitHubUserRepos(): Promise<GitHubRepoSummary[]> {
  const cfg = getGitHubConfig();
  if (!cfg.accessToken) {
    return [];
  }

  const res = await fetchGitHubApiJson<
    Array<{
      id?: number;
      full_name?: string;
      name?: string;
      private?: boolean;
      description?: string | null;
      updated_at?: string;
      html_url?: string;
      owner?: { login?: string };
    }>
  >('/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator,organization_member', cfg.accessToken);

  if (!res.ok || !Array.isArray(res.data)) {
    throw new Error('No se pudieron obtener tus repositorios desde GitHub.');
  }

  return res.data
    .filter((r) => r.full_name && r.name && r.owner?.login)
    .map((r) => ({
      id: Number(r.id || 0),
      fullName: String(r.full_name),
      owner: String(r.owner?.login || ''),
      name: String(r.name),
      private: Boolean(r.private),
      description: String(r.description || ''),
      updatedAt: String(r.updated_at || ''),
      htmlUrl: String(r.html_url || ''),
    }));
}

async function exchangeGitHubOAuthCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': GITHUB_USER_AGENT,
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error('No se pudo obtener el permiso OAuth de GitHub.');
    }
    return tokenJson.access_token;
  } finally {
    clearTimeout(timer);
  }
}

async function saveGitHubOAuthUserSession(
  accessToken: string,
  dataDir: string
): Promise<void> {
  const userRes = await fetchGitHubApiJson<{
    login?: string;
    name?: string;
    avatar_url?: string;
  }>('/user', accessToken);

  if (!userRes.ok || !userRes.data.login) {
    throw new Error('No se pudo leer tu perfil de GitHub después de autorizar.');
  }

  saveGitHubConfig({
    connected: true,
    authMode: 'oauth',
    accessToken,
    githubLogin: userRes.data.login,
    githubName: userRes.data.name || userRes.data.login,
    githubAvatar: userRes.data.avatar_url || '',
  });
  syncRuntimeUpdaterFile(dataDir);
}

export function startGitHubWebOAuth(reqOriginFallback: string): {
  authUrl: string;
  redirectUri: string;
} {
  const creds = resolveGitHubOAuthCreds();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      'Faltan credenciales OAuth de GitHub (Client ID y Client Secret). Configúralas en el panel de credenciales o vincula el repositorio directamente.'
    );
  }

  cleanupExpiredWebStates();

  const rawAppUrl = String(process.env.APP_URL || '').trim();
  const baseUrl =
    rawAppUrl && rawAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(rawAppUrl)
      ? rawAppUrl.replace(/\/+$/, '')
      : reqOriginFallback.replace(/\/+$/, '');

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('No se pudo determinar la URL de callback para GitHub OAuth.');
  }

  const redirectUri = `${baseUrl}/api/github-updates/oauth/callback`;
  const state = crypto.randomBytes(24).toString('hex');
  pendingWebStates.set(state, {
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    scope: 'read:user repo',
    state,
  });

  return {
    authUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
    redirectUri,
  };
}

export async function handleGitHubWebOAuthCallback(
  code: string,
  state: string,
  dataDir: string
): Promise<void> {
  cleanupExpiredWebStates();
  const entry = pendingWebStates.get(state);
  if (!entry) {
    throw new Error('La solicitud de autorización expiró o no es válida.');
  }
  pendingWebStates.delete(state);

  const creds = resolveGitHubOAuthCreds();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Faltan credenciales OAuth de GitHub.');
  }

  const accessToken = await exchangeGitHubOAuthCode(
    code,
    entry.redirectUri,
    creds.clientId,
    creds.clientSecret
  );
  await saveGitHubOAuthUserSession(accessToken, dataDir);
}

function closeDesktopLoopback() {
  if (activeDesktopLoopbackTimer) {
    clearTimeout(activeDesktopLoopbackTimer);
    activeDesktopLoopbackTimer = null;
  }
  if (activeDesktopLoopback) {
    try {
      activeDesktopLoopback.close();
    } catch {
      // Ignore close error
    }
    activeDesktopLoopback = null;
  }
}

export async function startGitHubDesktopOAuth(dataDir: string): Promise<{
  authUrl: string;
  redirectUri: string;
}> {
  const creds = resolveGitHubOAuthCreds();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      'Faltan credenciales OAuth de GitHub (Client ID y Client Secret).'
    );
  }

  closeDesktopLoopback();
  const state = crypto.randomBytes(24).toString('hex');

  return await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsed = new URL(req.url || '/', 'http://127.0.0.1');
        if (parsed.pathname !== '/oauth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const incomingState = parsed.searchParams.get('state') || '';
        const code = parsed.searchParams.get('code') || '';
        const oauthErr = parsed.searchParams.get('error') || '';

        if (oauthErr || !code || incomingState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body style="font-family:sans-serif;padding:32px;text-align:center;"><h2>Autorización cancelada</h2><p>Puedes cerrar esta pestaña y volver a AulaÁgil.</p></body></html>'
          );
          closeDesktopLoopback();
          return;
        }

        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
        const accessToken = await exchangeGitHubOAuthCode(
          code,
          redirectUri,
          creds.clientId,
          creds.clientSecret
        );
        await saveGitHubOAuthUserSession(accessToken, dataDir);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;padding:32px;text-align:center;"><h2>GitHub vinculado correctamente</h2><p>Ya puedes cerrar esta pestaña y volver a AulaÁgil para elegir tu repositorio.</p></body></html>'
        );
        closeDesktopLoopback();
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;padding:32px;text-align:center;"><h2>Error al vincular GitHub</h2><p>Cierra esta pestaña e intenta nuevamente desde AulaÁgil.</p></body></html>'
        );
        closeDesktopLoopback();
      }
    });

    server.once('error', (err) => {
      closeDesktopLoopback();
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        closeDesktopLoopback();
        reject(new Error('No se pudo abrir puerto local temporal para GitHub OAuth.'));
        return;
      }
      activeDesktopLoopback = server;
      activeDesktopLoopbackTimer = setTimeout(closeDesktopLoopback, 5 * 60 * 1000);

      const redirectUri = `http://127.0.0.1:${addr.port}/oauth/callback`;
      const params = new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        scope: 'read:user repo',
        state,
      });

      resolve({
        authUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
        redirectUri,
      });
    });
  });
}

export function disconnectGitHub(dataDir: string): GitHubUpdatePublicStatus {
  clearGitHubLink();
  syncRuntimeUpdaterFile(dataDir);
  return getGitHubUpdatePublicStatus();
}

export async function checkGitHubUpdatesLive(currentVersion: string) {
  const cfg = getGitHubConfig();
  const yamlCfg = readYamlPublishConfig();

  const useLinked = Boolean(cfg.connected && cfg.repoOwner && cfg.repoName);
  const owner = useLinked ? cfg.repoOwner : yamlCfg.owner;
  const repo = useLinked ? cfg.repoName : yamlCfg.repo;
  const isConfigured = useLinked || yamlCfg.isConfigured;
  const repoSlug = owner && repo ? `${owner}/${repo}` : '';

  if (!isConfigured) {
    return {
      currentVersion,
      status: 'unconfigured',
      repoSlug,
      availableVersion: null,
      releaseNotes: '',
      releaseDate: null,
      directDownloadUrl: null,
      requiresManualDownload: true,
      lastCheckedAt: new Date().toISOString(),
      error: null,
      message:
        'Vincula tu cuenta o repositorio de GitHub para consultar nuevas versiones.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `AulaAgil/${currentVersion}`,
    };
    if (useLinked && cfg.accessToken) {
      headers.Authorization = `Bearer ${cfg.accessToken}`;
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/releases/latest`,
      { headers, signal: controller.signal }
    );

    if (ghRes.status === 404) {
      return {
        currentVersion,
        status: 'up-to-date',
        repoSlug,
        availableVersion: null,
        releaseNotes: '',
        releaseDate: null,
        directDownloadUrl: null,
        requiresManualDownload: true,
        lastCheckedAt: new Date().toISOString(),
        error: null,
        message: 'Aún no hay versiones publicadas en GitHub Releases para este repositorio.',
      };
    }

    if (!ghRes.ok) {
      throw new Error(`GitHub respondió con estado ${ghRes.status}`);
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
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const exeAsset = assets.find((a) =>
      String(a.name || '').toLowerCase().endsWith('.exe')
    );
    const dmgAsset = assets.find((a) =>
      String(a.name || '').toLowerCase().endsWith('.dmg')
    );

    const directUrl =
      exeAsset?.browser_download_url ||
      dmgAsset?.browser_download_url ||
      release.html_url ||
      null;

    return {
      currentVersion,
      status: isNewer ? 'available' : 'up-to-date',
      repoSlug,
      availableVersion: isNewer ? remote : null,
      releaseNotes: isNewer ? safeNotes : '',
      releaseDate: release.published_at || null,
      directDownloadUrl: isNewer ? directUrl : null,
      requiresManualDownload: true,
      lastCheckedAt: new Date().toISOString(),
      error: null,
      message: isNewer
        ? `Nueva versión ${remote} disponible en GitHub Releases.`
        : 'Ya cuentas con la última versión instalada.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
