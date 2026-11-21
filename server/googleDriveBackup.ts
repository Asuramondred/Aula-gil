import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { google, type drive_v3 } from 'googleapis';
import JSZip from 'jszip';
import {
  clearDriveTokens,
  exportSanitizedSqliteBuffer,
  getDriveConfig,
  getFirstUser,
  replaceSqliteFromBuffer,
  saveDriveConfig,
  type DriveAutoSchedule,
} from './db.ts';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export const DRIVE_FOLDER_NAME = 'AulaÁgil - Respaldos';

export interface DriveBackupManifest {
  app: string;
  version: string;
  createdAt: string;
  hasSqliteDb: boolean;
  classroomCount: number;
  studentCount: number;
  assignmentCount: number;
  incidentCount: number;
  dailyLogCount: number;
  lessonPlanCount: number;
  attachmentCount: number;
}

export interface DriveBackupFileItem {
  id: string;
  name: string;
  sizeBytes: number;
  createdTime: string;
  modifiedTime: string;
}

export interface DrivePublicStatus {
  connected: boolean;
  authMode: 'none' | 'desktop_oauth' | 'firebase';
  hasDesktopCredentials: boolean;
  desktopClientId: string;
  hasDesktopClientSecret: boolean;
  hasPersistentRefreshToken: boolean;
  userEmail: string;
  userName: string;
  userAvatar: string;
  autoSchedule: DriveAutoSchedule;
  maxBackups: number;
  lastBackupAt: string;
  lastBackupFile: string;
  folderName: string;
}

const VALID_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

export function assertValidDriveFileId(fileId: string): string {
  const cleaned = String(fileId || '').trim();
  if (!VALID_DRIVE_ID_RE.test(cleaned)) {
    throw new Error('Identificador de archivo de Google Drive inválido.');
  }
  return cleaned;
}

function formatBackupTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function sanitizeZipFileName(name: string, fallback: string): string {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || fallback;
}

function parseDataUrlBytes(
  dataUrl: string
): { mime: string; buffer: Buffer; ext: string } | null {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
  };
  return {
    mime,
    buffer: Buffer.from(m[2], 'base64'),
    ext: extMap[mime] || 'bin',
  };
}

function getEffectiveDesktopOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
  source: 'sqlite' | 'env' | 'none';
} {
  const cfg = getDriveConfig();
  if (cfg.clientId && cfg.clientSecret) {
    return {
      clientId: cfg.clientId.trim(),
      clientSecret: cfg.clientSecret.trim(),
      source: 'sqlite',
    };
  }
  const envId = (process.env.GOOGLE_DESKTOP_CLIENT_ID || '').trim();
  const envSecret = (process.env.GOOGLE_DESKTOP_CLIENT_SECRET || '').trim();
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: 'env' };
  }
  return { clientId: '', clientSecret: '', source: 'none' };
}

export function getDrivePublicStatus(): DrivePublicStatus {
  const cfg = getDriveConfig();
  const creds = getEffectiveDesktopOAuthCredentials();
  const connected =
    (cfg.authMode === 'desktop_oauth' && Boolean(cfg.refreshToken || cfg.accessToken)) ||
    (cfg.authMode === 'firebase' && Boolean(cfg.userEmail));

  return {
    connected,
    authMode: cfg.authMode,
    hasDesktopCredentials: Boolean(creds.clientId && creds.clientSecret),
    desktopClientId: cfg.clientId || '',
    hasDesktopClientSecret: Boolean(cfg.clientSecret),
    hasPersistentRefreshToken: Boolean(cfg.refreshToken),
    userEmail: cfg.userEmail,
    userName: cfg.userName,
    userAvatar: cfg.userAvatar,
    autoSchedule: cfg.autoSchedule,
    maxBackups: cfg.maxBackups,
    lastBackupAt: cfg.lastBackupAt,
    lastBackupFile: cfg.lastBackupFile,
    folderName: DRIVE_FOLDER_NAME,
  };
}

// Active loopback OAuth server cleanup handle (single concurrent flow max)
let activeOAuthServer: http.Server | null = null;

export async function startDesktopOAuthFlow(): Promise<{
  authUrl: string;
  redirectUri: string;
}> {
  const creds = getEffectiveDesktopOAuthCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      'Ingresa primero tu Client ID y Client Secret de Google Cloud (tipo Escritorio) en Configuración.'
    );
  }

  if (activeOAuthServer) {
    try {
      activeOAuthServer.close();
    } catch {
      // Ignore prior server close error
    }
    activeOAuthServer = null;
  }

  const stateToken = crypto.randomBytes(24).toString('hex');

  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    activeOAuthServer = server;

    let timeoutHandle: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (activeOAuthServer === server) activeOAuthServer = null;
      try {
        server.close();
      } catch {
        // Ignore close error
      }
    };

    server.on('request', async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/oauth2callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Ruta no encontrada.');
          return;
        }

        const errParam = reqUrl.searchParams.get('error');
        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');

        if (errParam) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Autorización cancelada</h2><p>Puedes cerrar esta pestaña y volver a AulaÁgil.</p></body></html>'
          );
          cleanup();
          return;
        }

        if (!code || returnedState !== stateToken) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Código de verificación inválido</h2><p>Intenta conectar nuevamente desde AulaÁgil.</p></body></html>'
          );
          cleanup();
          return;
        }

        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        const oauth2 = new google.auth.OAuth2(
          creds.clientId,
          creds.clientSecret,
          redirectUri
        );
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);

        const drive = google.drive({ version: 'v3', auth: oauth2 });
        const aboutRes = await drive.about.get({
          fields: 'user(displayName,emailAddress,photoLink)',
        });
        const driveUser = aboutRes.data.user;

        saveDriveConfig({
          authMode: 'desktop_oauth',
          accessToken: tokens.access_token || '',
          refreshToken: tokens.refresh_token || getDriveConfig().refreshToken || '',
          tokenExpiry: tokens.expiry_date || Date.now() + 3500 * 1000,
          userEmail: driveUser?.emailAddress || '',
          userName: driveUser?.displayName || '',
          userAvatar: driveUser?.photoLink || '',
        });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:system-ui,sans-serif;padding:48px;text-align:center;color:#0f172a;">' +
            '<h2 style="color:#1d4ed8;">Google Drive conectado a AulaÁgil</h2>' +
            '<p>Tus respaldos se subirán de forma directa y privada a tu cuenta.</p>' +
            '<p style="color:#475569;font-size:14px;">Ya puedes cerrar esta ventana y volver a la aplicación.</p>' +
            '</body></html>'
        );
        cleanup();
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Error al vincular Google Drive</h2><p>Cierra esta pestaña e inténtalo de nuevo en AulaÁgil.</p></body></html>'
        );
        cleanup();
      }
    });

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        cleanup();
        reject(new Error('No se pudo abrir puerto local temporal para OAuth2.'));
        return;
      }

      const redirectUri = `http://127.0.0.1:${addr.port}/oauth2callback`;
      const oauth2 = new google.auth.OAuth2(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: DRIVE_SCOPES,
        state: stateToken,
      });

      timeoutHandle = setTimeout(() => {
        cleanup();
      }, 3 * 60 * 1000);

      resolve({ authUrl, redirectUri });
    });
  });
}

async function resolveDriveClient(
  overrideAccessToken?: string
): Promise<{ drive: drive_v3.Drive; mode: 'desktop_oauth' | 'firebase' }> {
  const token = String(overrideAccessToken || '').trim();
  if (token) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const drive = google.drive({ version: 'v3', auth });
    return { drive, mode: 'firebase' };
  }

  const cfg = getDriveConfig();
  const creds = getEffectiveDesktopOAuthCredentials();
  if (
    cfg.authMode === 'desktop_oauth' &&
    creds.clientId &&
    creds.clientSecret &&
    (cfg.refreshToken || cfg.accessToken)
  ) {
    const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    oauth2.setCredentials({
      access_token: cfg.accessToken || undefined,
      refresh_token: cfg.refreshToken || undefined,
      expiry_date: cfg.tokenExpiry || undefined,
    });

    oauth2.on('tokens', (newTokens) => {
      saveDriveConfig({
        accessToken: newTokens.access_token || getDriveConfig().accessToken,
        refreshToken: newTokens.refresh_token || getDriveConfig().refreshToken,
        tokenExpiry: newTokens.expiry_date || Date.now() + 3500 * 1000,
      });
    });

    const drive = google.drive({ version: 'v3', auth: oauth2 });
    return { drive, mode: 'desktop_oauth' };
  }

  throw new Error(
    'No hay una cuenta de Google Drive vinculada o la sesión expiró. Vuelve a conectar tu cuenta.'
  );
}

export async function syncFirebaseDriveProfile(
  accessToken: string,
  profilePatch?: { email?: string; name?: string; avatar?: string }
): Promise<DrivePublicStatus> {
  const { drive } = await resolveDriveClient(accessToken);
  let email = profilePatch?.email || '';
  let name = profilePatch?.name || '';
  let avatar = profilePatch?.avatar || '';

  try {
    const about = await drive.about.get({
      fields: 'user(displayName,emailAddress,photoLink)',
    });
    if (about.data.user?.emailAddress) email = about.data.user.emailAddress;
    if (about.data.user?.displayName) name = about.data.user.displayName;
    if (about.data.user?.photoLink) avatar = about.data.user.photoLink;
  } catch {
    // Use profile details passed from Firebase user if Drive about fails
  }

  saveDriveConfig({
    authMode: 'firebase',
    userEmail: email,
    userName: name,
    userAvatar: avatar,
  });

  return getDrivePublicStatus();
}

export async function disconnectDriveAccount(): Promise<DrivePublicStatus> {
  const cfg = getDriveConfig();
  if (cfg.authMode === 'desktop_oauth' && (cfg.refreshToken || cfg.accessToken)) {
    try {
      const creds = getEffectiveDesktopOAuthCredentials();
      if (creds.clientId && creds.clientSecret) {
        const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
        await oauth2.revokeToken(cfg.refreshToken || cfg.accessToken);
      }
    } catch {
      // Ignore revocation errors if already expired/offline
    }
  }
  clearDriveTokens();
  return getDrivePublicStatus();
}

async function ensureBackupFolder(drive: drive_v3.Drive): Promise<string> {
  const cfg = getDriveConfig();
  if (cfg.folderId && VALID_DRIVE_ID_RE.test(cfg.folderId)) {
    try {
      const existing = await drive.files.get({
        fileId: cfg.folderId,
        fields: 'id,name,trashed,mimeType',
      });
      if (
        existing.data.id &&
        !existing.data.trashed &&
        existing.data.mimeType === 'application/vnd.google-apps.folder'
      ) {
        return existing.data.id;
      }
    } catch {
      // Folder may have been deleted; recreate or search below
    }
  }

  const escapedFolderName = DRIVE_FOLDER_NAME.replace(/'/g, "\\'");
  const search = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapedFolderName}' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 5,
  });

  const foundId = search.data.files?.[0]?.id;
  if (foundId) {
    saveDriveConfig({ folderId: foundId });
    return foundId;
  }

  const created = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  if (!created.data.id) {
    throw new Error('No se pudo crear la carpeta de respaldos en Google Drive.');
  }
  saveDriveConfig({ folderId: created.data.id });
  return created.data.id;
}

export async function buildBackupZipBuffer(
  dataDir: string,
  readDbFn: () => Record<string, unknown>,
  appVersion = '1.0.0'
): Promise<{
  fileName: string;
  zipBuffer: Buffer;
  manifest: DriveBackupManifest;
}> {
  const zip = new JSZip();
  const db = readDbFn();

  const sqliteBuffer = exportSanitizedSqliteBuffer();
  zip.file('aula-agil.sqlite', sqliteBuffer);
  zip.file('libreta-db.json', JSON.stringify(db, null, 2));

  const attachmentsFolder = zip.folder('attachments');
  let attachmentCount = 0;

  // 1. Export teacher profile avatar if configured
  const user = getFirstUser();
  if (user?.avatar_data_url && attachmentsFolder) {
    const parsedAvatar = parseDataUrlBytes(user.avatar_data_url);
    if (parsedAvatar) {
      attachmentsFolder.file(
        `docente-avatar.${parsedAvatar.ext}`,
        parsedAvatar.buffer
      );
      attachmentCount++;
    }
  }

  // 2. Materialize digital dossiers (studentFiles) into attachments/expedientes/
  const studentFiles = Array.isArray(db.studentFiles)
    ? (db.studentFiles as Array<Record<string, unknown>>)
    : [];
  for (let i = 0; i < studentFiles.length; i++) {
    const f = studentFiles[i];
    const parsed = parseDataUrlBytes(String(f.dataUrl || ''));
    if (parsed && attachmentsFolder) {
      const safeName = sanitizeZipFileName(
        String(f.fileName || ''),
        `documento_${i + 1}.${parsed.ext}`
      );
      attachmentsFolder.file(`expedientes/${String(f.id || i + 1)}_${safeName}`, parsed.buffer);
      attachmentCount++;
    }
  }

  // 3. Materialize uploaded lesson plan documents into attachments/planeaciones/
  const lessonPlans = Array.isArray(db.lessonPlans)
    ? (db.lessonPlans as Array<Record<string, unknown>>)
    : [];
  for (let i = 0; i < lessonPlans.length; i++) {
    const p = lessonPlans[i];
    const parsed = parseDataUrlBytes(String(p.dataUrl || ''));
    if (parsed && attachmentsFolder) {
      const safeName = sanitizeZipFileName(
        String(p.fileName || ''),
        `planeacion_${i + 1}.${parsed.ext}`
      );
      attachmentsFolder.file(
        `planeaciones/${String(p.id || i + 1)}_${safeName}`,
        parsed.buffer
      );
      attachmentCount++;
    }
  }

  // 4. Include any loose files under <dataDir>/attachments/
  const diskAttachmentsDir = path.resolve(dataDir, 'attachments');
  if (fs.existsSync(diskAttachmentsDir) && attachmentsFolder) {
    const walkDir = (dir: string, relPrefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkDir(full, rel);
        } else if (entry.isFile()) {
          attachmentsFolder.file(`locales/${rel}`, fs.readFileSync(full));
          attachmentCount++;
        }
      }
    };
    walkDir(diskAttachmentsDir, '');
  }

  const createdAt = new Date().toISOString();
  const manifest: DriveBackupManifest = {
    app: 'AulaÁgil',
    version: appVersion,
    createdAt,
    hasSqliteDb: true,
    classroomCount: Array.isArray(db.classrooms) ? db.classrooms.length : 0,
    studentCount: Array.isArray(db.students) ? db.students.length : 0,
    assignmentCount: Array.isArray(db.assignments) ? db.assignments.length : 0,
    incidentCount: Array.isArray(db.incidents) ? db.incidents.length : 0,
    dailyLogCount: Array.isArray(db.dailyLogs) ? db.dailyLogs.length : 0,
    lessonPlanCount: lessonPlans.length,
    attachmentCount,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const fileName = `Respaldo_AulaAgil_${formatBackupTimestamp()}.zip`;
  return { fileName, zipBuffer, manifest };
}

export async function listDriveBackups(
  overrideAccessToken?: string
): Promise<DriveBackupFileItem[]> {
  const { drive } = await resolveDriveClient(overrideAccessToken);
  const folderId = await ensureBackupFolder(drive);

  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,size,createdTime,modifiedTime)',
    pageSize: 50,
  });

  return (listRes.data.files || [])
    .filter((f) => f.id && f.name)
    .map((f) => ({
      id: String(f.id),
      name: String(f.name),
      sizeBytes: Number(f.size || 0),
      createdTime: String(f.createdTime || f.modifiedTime || ''),
      modifiedTime: String(f.modifiedTime || f.createdTime || ''),
    }));
}

async function pruneOldDriveBackups(
  drive: drive_v3.Drive,
  folderId: string,
  maxBackups: number
): Promise<void> {
  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
    orderBy: 'createdTime desc',
    fields: 'files(id,name,createdTime)',
    pageSize: 50,
  });
  const files = (listRes.data.files || []).filter((f) =>
    String(f.name || '').endsWith('.zip')
  );
  if (files.length <= maxBackups) return;

  const toDelete = files.slice(maxBackups);
  for (const oldFile of toDelete) {
    if (!oldFile.id) continue;
    try {
      await drive.files.delete({ fileId: oldFile.id });
    } catch {
      // Non-fatal if an older file could not be pruned
    }
  }
}

export async function uploadBackupToDrive(
  dataDir: string,
  readDbFn: () => Record<string, unknown>,
  appVersion: string,
  overrideAccessToken?: string
): Promise<{
  file: DriveBackupFileItem;
  manifest: DriveBackupManifest;
  status: DrivePublicStatus;
}> {
  const { drive } = await resolveDriveClient(overrideAccessToken);
  const folderId = await ensureBackupFolder(drive);

  const { fileName, zipBuffer, manifest } = await buildBackupZipBuffer(
    dataDir,
    readDbFn,
    appVersion
  );

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      description: `Respaldo automático de AulaÁgil (${manifest.classroomCount} grupos, ${manifest.studentCount} alumnos)`,
    },
    media: {
      mimeType: 'application/zip',
      body: Readable.from(zipBuffer),
    },
    fields: 'id,name,size,createdTime,modifiedTime',
  });

  const cfg = getDriveConfig();
  await pruneOldDriveBackups(drive, folderId, cfg.maxBackups);

  const now = new Date().toISOString();
  saveDriveConfig({
    lastBackupAt: now,
    lastBackupFile: fileName,
  });

  return {
    file: {
      id: String(created.data.id || ''),
      name: String(created.data.name || fileName),
      sizeBytes: Number(created.data.size || zipBuffer.length),
      createdTime: String(created.data.createdTime || now),
      modifiedTime: String(created.data.modifiedTime || now),
    },
    manifest,
    status: getDrivePublicStatus(),
  };
}

async function downloadDriveFileBuffer(
  drive: drive_v3.Drive,
  fileId: string
): Promise<Buffer> {
  const validId = assertValidDriveFileId(fileId);
  const res = await drive.files.get(
    { fileId: validId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function inspectBackupZipBuffer(
  zipBuffer: Buffer
): Promise<DriveBackupManifest> {
  const zip = await JSZip.loadAsync(zipBuffer);

  for (const entryName of Object.keys(zip.files)) {
    const normalized = entryName.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      entryName.includes('\\') ||
      entryName.includes('\0')
    ) {
      throw new Error('El respaldo .zip contiene rutas de archivo no permitidas.');
    }
  }

  const dbEntry = zip.file('libreta-db.json');
  if (!dbEntry) {
    throw new Error('El respaldo .zip no contiene libreta-db.json.');
  }
  const dbRaw = JSON.parse(await dbEntry.async('string')) as Record<string, unknown>;
  if (!Array.isArray(dbRaw.classrooms)) {
    throw new Error('El archivo libreta-db.json dentro del respaldo es inválido.');
  }

  const sqliteEntry =
    zip.file('aula-agil.sqlite') || zip.file('eduflow.db') || null;

  const manifestEntry = zip.file('manifest.json');
  if (manifestEntry) {
    try {
      const m = JSON.parse(await manifestEntry.async('string')) as Partial<DriveBackupManifest>;
      return {
        app: String(m.app || 'AulaÁgil'),
        version: String(m.version || '1.0.0'),
        createdAt: String(m.createdAt || ''),
        hasSqliteDb: Boolean(sqliteEntry),
        classroomCount: Array.isArray(dbRaw.classrooms) ? dbRaw.classrooms.length : 0,
        studentCount: Array.isArray(dbRaw.students) ? dbRaw.students.length : 0,
        assignmentCount: Array.isArray(dbRaw.assignments) ? dbRaw.assignments.length : 0,
        incidentCount: Array.isArray(dbRaw.incidents) ? dbRaw.incidents.length : 0,
        dailyLogCount: Array.isArray(dbRaw.dailyLogs) ? dbRaw.dailyLogs.length : 0,
        lessonPlanCount: Array.isArray(dbRaw.lessonPlans) ? dbRaw.lessonPlans.length : 0,
        attachmentCount: Number(m.attachmentCount || 0),
      };
    } catch {
      // Fallback below
    }
  }

  const attachmentEntries = Object.keys(zip.files).filter(
    (name) => name.startsWith('attachments/') && !zip.files[name].dir
  );

  return {
    app: 'AulaÁgil',
    version: '1.0.0',
    createdAt: '',
    hasSqliteDb: Boolean(sqliteEntry),
    classroomCount: Array.isArray(dbRaw.classrooms) ? dbRaw.classrooms.length : 0,
    studentCount: Array.isArray(dbRaw.students) ? dbRaw.students.length : 0,
    assignmentCount: Array.isArray(dbRaw.assignments) ? dbRaw.assignments.length : 0,
    incidentCount: Array.isArray(dbRaw.incidents) ? dbRaw.incidents.length : 0,
    dailyLogCount: Array.isArray(dbRaw.dailyLogs) ? dbRaw.dailyLogs.length : 0,
    lessonPlanCount: Array.isArray(dbRaw.lessonPlans) ? dbRaw.lessonPlans.length : 0,
    attachmentCount: attachmentEntries.length,
  };
}

export async function previewDriveBackup(
  fileId: string,
  overrideAccessToken?: string
): Promise<DriveBackupManifest> {
  const { drive } = await resolveDriveClient(overrideAccessToken);
  const zipBuffer = await downloadDriveFileBuffer(drive, fileId);
  return await inspectBackupZipBuffer(zipBuffer);
}

export async function restoreBackupZipBuffer(
  zipBuffer: Buffer,
  dataDir: string,
  writeDbFn: (db: Record<string, unknown>) => void
): Promise<{ db: Record<string, unknown>; manifest: DriveBackupManifest }> {
  const manifest = await inspectBackupZipBuffer(zipBuffer);
  const zip = await JSZip.loadAsync(zipBuffer);

  const dbEntry = zip.file('libreta-db.json');
  if (!dbEntry) {
    throw new Error('No se encontró libreta-db.json en el respaldo.');
  }
  const parsedDb = JSON.parse(await dbEntry.async('string')) as Record<string, unknown>;

  const sqliteEntry =
    zip.file('aula-agil.sqlite') || zip.file('eduflow.db') || null;
  if (sqliteEntry) {
    const sqliteBuf = await sqliteEntry.async('nodebuffer');
    replaceSqliteFromBuffer(sqliteBuf);
  }

  // Safely restore loose files from attachments/locales/* with strict path confinement
  const baseAttachmentsDir = path.resolve(dataDir, 'attachments');
  for (const [entryName, fileObj] of Object.entries(zip.files)) {
    if (fileObj.dir) continue;
    if (!entryName.startsWith('attachments/locales/')) continue;

    const relPath = entryName.slice('attachments/locales/'.length);
    if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) continue;

    const targetPath = path.resolve(baseAttachmentsDir, relPath);
    if (!targetPath.startsWith(baseAttachmentsDir + path.sep)) continue;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const content = await fileObj.async('nodebuffer');
    fs.writeFileSync(targetPath, content);
  }

  writeDbFn(parsedDb);
  return { db: parsedDb, manifest };
}

export async function restoreDriveBackup(
  fileId: string,
  dataDir: string,
  writeDbFn: (db: Record<string, unknown>) => void,
  overrideAccessToken?: string
): Promise<{ db: Record<string, unknown>; manifest: DriveBackupManifest }> {
  const { drive } = await resolveDriveClient(overrideAccessToken);
  const zipBuffer = await downloadDriveFileBuffer(drive, fileId);
  return await restoreBackupZipBuffer(zipBuffer, dataDir, writeDbFn);
}

export async function deleteDriveBackup(
  fileId: string,
  overrideAccessToken?: string
): Promise<void> {
  const { drive } = await resolveDriveClient(overrideAccessToken);
  const validId = assertValidDriveFileId(fileId);
  await drive.files.delete({ fileId: validId });
}
