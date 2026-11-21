import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

const require = createRequire(import.meta.url);

export interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_data_url: string;
  password_hash: string;
  recovery_key_hash: string;
  security_q1: string;
  security_a1_hash: string;
  security_q2: string;
  security_a2_hash: string;
  created_at: string;
  updated_at: string;
}

export interface PublicUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarDataUrl: string;
  createdAt: string;
  updatedAt: string;
}

export type DriveAutoSchedule = 'off' | 'on_close' | 'daily' | 'weekly';

export interface DbGoogleDriveConfig {
  authMode: 'none' | 'desktop_oauth' | 'firebase';
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  userEmail: string;
  userName: string;
  userAvatar: string;
  folderId: string;
  autoSchedule: DriveAutoSchedule;
  maxBackups: number;
  lastBackupAt: string;
  lastBackupFile: string;
  updatedAt: string;
}

export interface DbGitHubUpdateConfig {
  connected: boolean;
  authMode: 'none' | 'oauth' | 'pat' | 'public_repo';
  oauthClientId: string;
  oauthClientSecret: string;
  accessToken: string;
  githubLogin: string;
  githubName: string;
  githubAvatar: string;
  repoOwner: string;
  repoName: string;
  repoPrivate: boolean;
  updatedAt: string;
}

let sqliteDb: Database | null = null;
let sqlJsEngine: SqlJsStatic | null = null;
let currentSqlitePath = '';

function resolveSqlWasmBinary(): ArrayBuffer | undefined {
  try {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    if (fs.existsSync(wasmPath)) {
      const buf = fs.readFileSync(wasmPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  } catch {
    // Fallback to locateFile below
  }
  return undefined;
}

function persistSqliteToDisk(): void {
  if (!sqliteDb || !currentSqlitePath) return;
  const exported = sqliteDb.export();
  const tmpPath = `${currentSqlitePath}.tmp`;
  fs.writeFileSync(tmpPath, Buffer.from(exported));
  fs.renameSync(tmpPath, currentSqlitePath);
}

export async function initSqliteDb(dataDir: string): Promise<void> {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  currentSqlitePath = path.join(dataDir, 'aula-agil.sqlite');

  const wasmBinary = resolveSqlWasmBinary();
  sqlJsEngine = await initSqlJs(
    wasmBinary
      ? { wasmBinary, useOldExtensionFunctions: false }
      : {
          useOldExtensionFunctions: false,
          locateFile: (file: string) =>
            path.join(path.dirname(require.resolve('sql.js')), file),
        }
  );

  if (fs.existsSync(currentSqlitePath)) {
    const fileBuf = fs.readFileSync(currentSqlitePath);
    sqliteDb = new sqlJsEngine.Database(fileBuf);
  } else {
    sqliteDb = new sqlJsEngine.Database();
  }

  ensureSqliteSchema(sqliteDb);
  persistSqliteToDisk();
}

function ensureSqliteSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      avatar_data_url TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      recovery_key_hash TEXT NOT NULL,
      security_q1 TEXT NOT NULL,
      security_a1_hash TEXT NOT NULL,
      security_q2 TEXT NOT NULL,
      security_a2_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS google_drive_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_mode TEXT NOT NULL DEFAULT 'none',
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      token_expiry INTEGER NOT NULL DEFAULT 0,
      user_email TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      user_avatar TEXT NOT NULL DEFAULT '',
      folder_id TEXT NOT NULL DEFAULT '',
      auto_schedule TEXT NOT NULL DEFAULT 'off',
      max_backups INTEGER NOT NULL DEFAULT 5,
      last_backup_at TEXT NOT NULL DEFAULT '',
      last_backup_file TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS github_update_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      connected INTEGER NOT NULL DEFAULT 0,
      auth_mode TEXT NOT NULL DEFAULT 'none',
      oauth_client_id TEXT NOT NULL DEFAULT '',
      oauth_client_secret TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      github_login TEXT NOT NULL DEFAULT '',
      github_name TEXT NOT NULL DEFAULT '',
      github_avatar TEXT NOT NULL DEFAULT '',
      repo_owner TEXT NOT NULL DEFAULT '',
      repo_name TEXT NOT NULL DEFAULT '',
      repo_private INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
}

function ensureDb(): Database {
  if (!sqliteDb) {
    throw new Error('La base de datos SQLite local aún no ha sido inicializada.');
  }
  return sqliteDb;
}

function rowToUser(row: Record<string, unknown>): DbUserRow {
  return {
    id: String(row.id || ''),
    username: String(row.username || ''),
    display_name: String(row.display_name || ''),
    avatar_data_url: String(row.avatar_data_url || ''),
    password_hash: String(row.password_hash || ''),
    recovery_key_hash: String(row.recovery_key_hash || ''),
    security_q1: String(row.security_q1 || ''),
    security_a1_hash: String(row.security_a1_hash || ''),
    security_q2: String(row.security_q2 || ''),
    security_a2_hash: String(row.security_a2_hash || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export function toPublicProfile(row: DbUserRow): PublicUserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarDataUrl: row.avatar_data_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function countUsers(): number {
  const db = ensureDb();
  const stmt = db.prepare('SELECT COUNT(*) AS total FROM users');
  try {
    if (stmt.step()) {
      const res = stmt.getAsObject();
      return Number(res.total || 0);
    }
    return 0;
  } finally {
    stmt.free();
  }
}

export function getFirstUser(): DbUserRow | null {
  const db = ensureDb();
  const stmt = db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 1');
  try {
    if (stmt.step()) {
      return rowToUser(stmt.getAsObject());
    }
    return null;
  } finally {
    stmt.free();
  }
}

export function getUserById(id: string): DbUserRow | null {
  const db = ensureDb();
  const stmt = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
  try {
    stmt.bind([id]);
    if (stmt.step()) {
      return rowToUser(stmt.getAsObject());
    }
    return null;
  } finally {
    stmt.free();
  }
}

export function getUserByUsername(username: string): DbUserRow | null {
  const db = ensureDb();
  const stmt = db.prepare(
    'SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1'
  );
  try {
    stmt.bind([username.trim()]);
    if (stmt.step()) {
      return rowToUser(stmt.getAsObject());
    }
    return null;
  } finally {
    stmt.free();
  }
}

export function createUser(input: {
  id: string;
  username: string;
  displayName: string;
  avatarDataUrl: string;
  passwordHash: string;
  recoveryKeyHash: string;
  securityQ1: string;
  securityA1Hash: string;
  securityQ2: string;
  securityA2Hash: string;
}): DbUserRow {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO users (
      id, username, display_name, avatar_data_url,
      password_hash, recovery_key_hash,
      security_q1, security_a1_hash,
      security_q2, security_a2_hash,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.username.trim(),
      input.displayName.trim(),
      input.avatarDataUrl,
      input.passwordHash,
      input.recoveryKeyHash,
      input.securityQ1.trim(),
      input.securityA1Hash,
      input.securityQ2.trim(),
      input.securityA2Hash,
      now,
      now,
    ]
  );
  persistSqliteToDisk();
  const created = getUserById(input.id);
  if (!created) throw new Error('Error al guardar el perfil de usuario en SQLite.');
  return created;
}

export function updateUserPassword(
  userId: string,
  newPasswordHash: string,
  newRecoveryKeyHash?: string
): DbUserRow | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (newRecoveryKeyHash) {
    db.run(
      `UPDATE users SET password_hash = ?, recovery_key_hash = ?, updated_at = ? WHERE id = ?`,
      [newPasswordHash, newRecoveryKeyHash, now, userId]
    );
  } else {
    db.run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
      newPasswordHash,
      now,
      userId,
    ]);
  }
  persistSqliteToDisk();
  return getUserById(userId);
}

export function updateUserProfile(
  userId: string,
  updates: {
    username?: string;
    displayName?: string;
    avatarDataUrl?: string;
  }
): DbUserRow | null {
  const existing = getUserById(userId);
  if (!existing) return null;
  const db = ensureDb();
  const now = new Date().toISOString();
  const nextUsername =
    typeof updates.username === 'string' && updates.username.trim()
      ? updates.username.trim()
      : existing.username;
  const nextDisplayName =
    typeof updates.displayName === 'string' && updates.displayName.trim()
      ? updates.displayName.trim()
      : existing.display_name;
  const nextAvatar =
    typeof updates.avatarDataUrl === 'string'
      ? updates.avatarDataUrl
      : existing.avatar_data_url;

  db.run(
    `UPDATE users SET username = ?, display_name = ?, avatar_data_url = ?, updated_at = ? WHERE id = ?`,
    [nextUsername, nextDisplayName, nextAvatar, now, userId]
  );
  persistSqliteToDisk();
  return getUserById(userId);
}

export function clearUsersTable(): void {
  const db = ensureDb();
  db.run('DELETE FROM users');
  persistSqliteToDisk();
}

const DEFAULT_DRIVE_CONFIG: DbGoogleDriveConfig = {
  authMode: 'none',
  clientId: '',
  clientSecret: '',
  accessToken: '',
  refreshToken: '',
  tokenExpiry: 0,
  userEmail: '',
  userName: '',
  userAvatar: '',
  folderId: '',
  autoSchedule: 'off',
  maxBackups: 5,
  lastBackupAt: '',
  lastBackupFile: '',
  updatedAt: '',
};

function normalizeSchedule(val: unknown): DriveAutoSchedule {
  if (val === 'on_close' || val === 'daily' || val === 'weekly') return val;
  return 'off';
}

export function getDriveConfig(): DbGoogleDriveConfig {
  const db = ensureDb();
  const stmt = db.prepare('SELECT * FROM google_drive_config WHERE id = 1 LIMIT 1');
  try {
    if (!stmt.step()) return { ...DEFAULT_DRIVE_CONFIG };
    const r = stmt.getAsObject();
    const mode =
      r.auth_mode === 'desktop_oauth' || r.auth_mode === 'firebase'
        ? r.auth_mode
        : 'none';
    return {
      authMode: mode,
      clientId: String(r.client_id || ''),
      clientSecret: String(r.client_secret || ''),
      accessToken: String(r.access_token || ''),
      refreshToken: String(r.refresh_token || ''),
      tokenExpiry: Number(r.token_expiry || 0),
      userEmail: String(r.user_email || ''),
      userName: String(r.user_name || ''),
      userAvatar: String(r.user_avatar || ''),
      folderId: String(r.folder_id || ''),
      autoSchedule: normalizeSchedule(r.auto_schedule),
      maxBackups: Math.min(20, Math.max(1, Number(r.max_backups || 5))),
      lastBackupAt: String(r.last_backup_at || ''),
      lastBackupFile: String(r.last_backup_file || ''),
      updatedAt: String(r.updated_at || ''),
    };
  } finally {
    stmt.free();
  }
}

export function saveDriveConfig(
  patch: Partial<DbGoogleDriveConfig>
): DbGoogleDriveConfig {
  const db = ensureDb();
  const current = getDriveConfig();
  const next: DbGoogleDriveConfig = {
    ...current,
    ...patch,
    autoSchedule:
      patch.autoSchedule !== undefined
        ? normalizeSchedule(patch.autoSchedule)
        : current.autoSchedule,
    maxBackups:
      patch.maxBackups !== undefined
        ? Math.min(20, Math.max(1, Number(patch.maxBackups) || 5))
        : current.maxBackups,
    updatedAt: new Date().toISOString(),
  };

  db.run(
    `INSERT INTO google_drive_config (
      id, auth_mode, client_id, client_secret,
      access_token, refresh_token, token_expiry,
      user_email, user_name, user_avatar,
      folder_id, auto_schedule, max_backups,
      last_backup_at, last_backup_file, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      auth_mode = excluded.auth_mode,
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expiry = excluded.token_expiry,
      user_email = excluded.user_email,
      user_name = excluded.user_name,
      user_avatar = excluded.user_avatar,
      folder_id = excluded.folder_id,
      auto_schedule = excluded.auto_schedule,
      max_backups = excluded.max_backups,
      last_backup_at = excluded.last_backup_at,
      last_backup_file = excluded.last_backup_file,
      updated_at = excluded.updated_at`,
    [
      next.authMode,
      next.clientId,
      next.clientSecret,
      next.accessToken,
      next.refreshToken,
      next.tokenExpiry,
      next.userEmail,
      next.userName,
      next.userAvatar,
      next.folderId,
      next.autoSchedule,
      next.maxBackups,
      next.lastBackupAt,
      next.lastBackupFile,
      next.updatedAt,
    ]
  );
  persistSqliteToDisk();
  return getDriveConfig();
}

export function clearDriveTokens(): DbGoogleDriveConfig {
  return saveDriveConfig({
    authMode: 'none',
    accessToken: '',
    refreshToken: '',
    tokenExpiry: 0,
    userEmail: '',
    userName: '',
    userAvatar: '',
    folderId: '',
  });
}

export function exportSanitizedSqliteBuffer(): Buffer {
  const db = ensureDb();
  const raw = Buffer.from(db.export());
  if (!sqlJsEngine) return raw;
  const clone = new sqlJsEngine.Database(raw);
  try {
    ensureSqliteSchema(clone);
    clone.run(
      `UPDATE google_drive_config
       SET access_token = '', refresh_token = '', client_secret = '', token_expiry = 0
       WHERE id = 1`
    );
    clone.run(
      `UPDATE github_update_config
       SET access_token = '', oauth_client_secret = ''
       WHERE id = 1`
    );
    return Buffer.from(clone.export());
  } finally {
    clone.close();
  }
}

export function replaceSqliteFromBuffer(buf: Buffer): void {
  if (!sqlJsEngine) {
    throw new Error('Motor SQLite no inicializado.');
  }
  const activeDrive = getDriveConfig();
  const activeGitHub = getGitHubConfig();
  const candidate = new sqlJsEngine.Database(buf);
  let valid = false;
  try {
    const stmt = candidate.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1"
    );
    try {
      valid = stmt.step();
    } finally {
      stmt.free();
    }
  } catch {
    candidate.close();
    throw new Error('El archivo SQLite dentro del respaldo no es válido.');
  }
  if (!valid) {
    candidate.close();
    throw new Error('El respaldo SQLite no contiene una tabla de perfil válida.');
  }

  ensureSqliteSchema(candidate);
  const old = sqliteDb;
  sqliteDb = candidate;
  if (old && old !== candidate) {
    old.close();
  }

  // Preserve current active Drive & GitHub credentials/tokens so the teacher stays linked
  saveDriveConfig(activeDrive);
  saveGitHubConfig(activeGitHub);
}

const DEFAULT_GITHUB_CONFIG: DbGitHubUpdateConfig = {
  connected: false,
  authMode: 'none',
  oauthClientId: '',
  oauthClientSecret: '',
  accessToken: '',
  githubLogin: '',
  githubName: '',
  githubAvatar: '',
  repoOwner: '',
  repoName: '',
  repoPrivate: false,
  updatedAt: '',
};

export function getGitHubConfig(): DbGitHubUpdateConfig {
  const db = ensureDb();
  const stmt = db.prepare('SELECT * FROM github_update_config WHERE id = 1 LIMIT 1');
  try {
    if (!stmt.step()) return { ...DEFAULT_GITHUB_CONFIG };
    const r = stmt.getAsObject();
    const mode =
      r.auth_mode === 'oauth' || r.auth_mode === 'pat' || r.auth_mode === 'public_repo'
        ? r.auth_mode
        : 'none';
    return {
      connected: Number(r.connected || 0) === 1,
      authMode: mode,
      oauthClientId: String(r.oauth_client_id || ''),
      oauthClientSecret: String(r.oauth_client_secret || ''),
      accessToken: String(r.access_token || ''),
      githubLogin: String(r.github_login || ''),
      githubName: String(r.github_name || ''),
      githubAvatar: String(r.github_avatar || ''),
      repoOwner: String(r.repo_owner || ''),
      repoName: String(r.repo_name || ''),
      repoPrivate: Number(r.repo_private || 0) === 1,
      updatedAt: String(r.updated_at || ''),
    };
  } finally {
    stmt.free();
  }
}

export function saveGitHubConfig(
  patch: Partial<DbGitHubUpdateConfig>
): DbGitHubUpdateConfig {
  const db = ensureDb();
  const current = getGitHubConfig();
  const next: DbGitHubUpdateConfig = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  db.run(
    `INSERT INTO github_update_config (
      id, connected, auth_mode, oauth_client_id, oauth_client_secret,
      access_token, github_login, github_name, github_avatar,
      repo_owner, repo_name, repo_private, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      connected = excluded.connected,
      auth_mode = excluded.auth_mode,
      oauth_client_id = excluded.oauth_client_id,
      oauth_client_secret = excluded.oauth_client_secret,
      access_token = excluded.access_token,
      github_login = excluded.github_login,
      github_name = excluded.github_name,
      github_avatar = excluded.github_avatar,
      repo_owner = excluded.repo_owner,
      repo_name = excluded.repo_name,
      repo_private = excluded.repo_private,
      updated_at = excluded.updated_at`,
    [
      next.connected ? 1 : 0,
      next.authMode,
      next.oauthClientId,
      next.oauthClientSecret,
      next.accessToken,
      next.githubLogin,
      next.githubName,
      next.githubAvatar,
      next.repoOwner,
      next.repoName,
      next.repoPrivate ? 1 : 0,
      next.updatedAt,
    ]
  );
  persistSqliteToDisk();
  return getGitHubConfig();
}

export function clearGitHubLink(): DbGitHubUpdateConfig {
  return saveGitHubConfig({
    connected: false,
    authMode: 'none',
    accessToken: '',
    githubLogin: '',
    githubName: '',
    githubAvatar: '',
    repoOwner: '',
    repoName: '',
    repoPrivate: false,
  });
}

