import { getCachedDriveAccessToken } from './googleDriveAuth';
import type {
  AiEngineKey,
  AiExecutionMeta,
  ApiKeyStatus,
  AuthStatusResponse,
  DriveAutoSchedule,
  DriveBackupFile,
  DriveBackupManifest,
  DriveBackupStatus,
  GitHubRepoSummary,
  GitHubUpdateConfigStatus,
  LocalDatabase,
  RecoveryQuestionsResponse,
  UserProfile,
} from '../types';

let inMemoryAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(cb: (() => void) | null) {
  unauthorizedHandler = cb;
}

async function authorizedFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (inMemoryAuthToken) {
    headers['Authorization'] = `Bearer ${inMemoryAuthToken}`;
  }
  const driveToken = getCachedDriveAccessToken();
  if (driveToken && url.startsWith('/api/drive-backup')) {
    headers['X-Drive-Access-Token'] = driveToken;
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (
    res.status === 401 &&
    !url.startsWith('/api/auth/login') &&
    !url.startsWith('/api/auth/recover') &&
    !url.startsWith('/api/auth/change-password') &&
    unauthorizedHandler
  ) {
    inMemoryAuthToken = null;
    unauthorizedHandler();
  }
  return res;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await authorizedFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error en solicitud (${res.status})`);
  }
  return data as T;
}

export function toValidPeriodId(periodName: string): string {
  const cleaned = periodName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'trimestre_1';
}

export function formatAiUsageNotice(
  meta: AiExecutionMeta | undefined,
  baseMessage: string
): string {
  if (!meta) return baseMessage;
  if (meta.failoverTriggered && meta.failoverReason) {
    return `${baseMessage} (${meta.failoverReason}; se cambió directo a ${meta.providerLabel}).`;
  }
  return `${baseMessage} (Motor usado: ${meta.providerLabel}).`;
}

export const localApi = {
  getData: () => requestJson<LocalDatabase>('/api/data'),

  createClassroom: (payload: {
    name: string;
    schoolName: string;
    teacherName: string;
    cycle: string;
    activePeriod?: string;
  }) =>
    requestJson<{ classroomId: string; db: LocalDatabase }>('/api/classrooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  seedSampleClassroom: (teacherName?: string) =>
    requestJson<{ classroomId: string; db: LocalDatabase }>('/api/classrooms/seed', {
      method: 'POST',
      body: JSON.stringify({ teacherName }),
    }),

  updateClassroom: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/classrooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteClassroom: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/classrooms/${id}`, {
      method: 'DELETE',
    }),

  createStudent: (payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>('/api/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  bulkCreateStudents: (classroomId: string, names: string[]) =>
    requestJson<{ db: LocalDatabase }>('/api/students/bulk', {
      method: 'POST',
      body: JSON.stringify({ classroomId, names }),
    }),

  updateStudent: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteStudent: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/students/${id}`, {
      method: 'DELETE',
    }),

  createStudentFile: (payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>('/api/student-files', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteStudentFile: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/student-files/${id}`, {
      method: 'DELETE',
    }),

  saveAttendance: (payload: {
    classroomId: string;
    date: string;
    period: string;
    records: Record<string, string>;
  }) =>
    requestJson<{ db: LocalDatabase }>('/api/attendance', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  createAssignment: (payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>('/api/assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAssignment: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAssignment: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/assignments/${id}`, {
      method: 'DELETE',
    }),

  createIncident: (payload: Record<string, unknown>) =>
    requestJson<{ incidentId: string; db: LocalDatabase }>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateIncident: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteIncident: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/incidents/${id}`, {
      method: 'DELETE',
    }),

  saveGradingPeriod: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/grading-periods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  saveStudentGrade: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/student-grades/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  createDailyLog: (payload: Record<string, unknown>) =>
    requestJson<{ logId: string; db: LocalDatabase }>('/api/daily-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDailyLog: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/daily-logs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteDailyLog: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/daily-logs/${id}`, {
      method: 'DELETE',
    }),

  createLessonPlan: (payload: Record<string, unknown>) =>
    requestJson<{ planId: string; db: LocalDatabase }>('/api/lesson-plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLessonPlan: (id: string, payload: Record<string, unknown>) =>
    requestJson<{ db: LocalDatabase }>(`/api/lesson-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteLessonPlan: (id: string) =>
    requestJson<{ db: LocalDatabase }>(`/api/lesson-plans/${id}`, {
      method: 'DELETE',
    }),

  generateNemLessonPlan: (payload: {
    title: string;
    groupName: string;
    schoolName: string;
    period: string;
    planScope: 'integrada' | 'campo_unico';
    formativeField: string;
    methodology: string;
    articulatingAxes: string[];
    pda: string;
    teacherNeeds: string;
    weekStartDate: string;
    weekEndDate: string;
    nonSchoolDays: Array<{ day: string; reason: string }>;
  }) =>
    requestJson<{
      title: string;
      pda: string;
      evaluationFormative: string;
      adjustments: string;
      fieldBlocks: Array<{
        field: 'lenguajes' | 'saberes' | 'etica' | 'humano';
        fieldLabel: string;
        topic: string;
        pda: string;
        activitiesSummary: string;
      }>;
      sessions: Array<{
        day: string;
        active: boolean;
        suspensionReason: string;
        activities: string;
        materials: string;
      }>;
      _aiMeta?: AiExecutionMeta;
    }>('/api/ai/lesson-plan-nem', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateBehaviorReport: (payload: Record<string, unknown>) =>
    requestJson<{
      parentReport: string;
      directionReport: string;
      suggestedAgreements?: string;
      _aiMeta?: AiExecutionMeta;
    }>('/api/ai/behavior-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  evaluateConduct: (payload: Record<string, unknown>) =>
    requestJson<{
      evaluations: Array<{
        studentId: string;
        conductBase10: number;
        reason: string;
        suggestedComment: string;
      }>;
      _aiMeta?: AiExecutionMeta;
    }>('/api/ai/evaluate-conduct', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  draftGradeComment: (payload: Record<string, unknown>) =>
    requestJson<{
      comment: string;
      _aiMeta?: AiExecutionMeta;
    }>('/api/ai/draft-comment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateDailyLog: (payload: Record<string, unknown>) =>
    requestJson<{
      topicsCovered: string;
      studentObservations: string;
      agreementsPending: string;
      pedagogicalReflection: string;
      _aiMeta?: AiExecutionMeta;
    }>('/api/ai/daily-log', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAuthStatus: () => requestJson<AuthStatusResponse>('/api/auth/status'),

  getRecoveryPreview: () =>
    requestJson<{ recoveryKey: string }>('/api/auth/recovery-preview'),

  registerAccount: (payload: {
    username: string;
    displayName: string;
    password: string;
    avatarDataUrl: string;
    recoveryKey: string;
    securityQ1: string;
    securityA1: string;
    securityQ2: string;
    securityA2: string;
  }) =>
    requestJson<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { username: string; password: string }) =>
    requestJson<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    requestJson<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  getRecoveryQuestions: (username?: string) =>
    requestJson<RecoveryQuestionsResponse>(
      `/api/auth/recovery-questions${
        username ? `?username=${encodeURIComponent(username)}` : ''
      }`
    ),

  recoverWithKey: (payload: {
    username: string;
    recoveryKey: string;
    newPassword: string;
  }) =>
    requestJson<{
      ok: boolean;
      newRecoveryKey: string;
      token: string;
      user: UserProfile;
    }>('/api/auth/recover/key', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recoverWithQuestions: (payload: {
    username: string;
    answer1: string;
    answer2: string;
    newPassword: string;
  }) =>
    requestJson<{
      ok: boolean;
      token: string;
      user: UserProfile;
    }>('/api/auth/recover/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  factoryReset: (payload: { confirmation: string; doubleConfirmed: boolean }) =>
    requestJson<{ ok: boolean }>('/api/auth/factory-reset', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProfile: (payload: {
    username?: string;
    displayName?: string;
    avatarDataUrl?: string;
  }) =>
    requestJson<{ user: UserProfile }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    requestJson<{ ok: boolean; user: UserProfile }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportBackup: async (): Promise<LocalDatabase> => {
    const res = await authorizedFetch('/api/backup/export');
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error('No se pudo exportar la copia de seguridad.');
    }
    return data as LocalDatabase;
  },

  importBackup: (data: LocalDatabase) =>
    requestJson<{ db: LocalDatabase }>('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getKeyStatus: () => requestJson<ApiKeyStatus>('/api/settings/keys'),

  saveKeys: (payload: {
    aiProvider?: string;
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
  }) =>
    requestJson<ApiKeyStatus>('/api/settings/keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resetAiCooldowns: () =>
    requestJson<ApiKeyStatus>('/api/settings/ai-reset-cooldowns', {
      method: 'POST',
    }),

  testAiChain: () =>
    requestJson<{
      ok?: boolean;
      message?: string;
      _aiMeta?: AiExecutionMeta;
      status: ApiKeyStatus;
    }>('/api/settings/ai-test-chain', {
      method: 'POST',
    }),

  checkOllama: (url?: string) =>
    requestJson<{ ok: boolean; models: string[]; error?: string }>(
      `/api/settings/ollama-check${url ? `?url=${encodeURIComponent(url)}` : ''}`
    ),

  // Google Drive & Full ZIP Backup
  getDriveBackupStatus: () =>
    requestJson<DriveBackupStatus>('/api/drive-backup/status'),

  syncFirebaseDriveProfile: (payload: {
    email?: string;
    name?: string;
    avatar?: string;
  }) =>
    requestJson<DriveBackupStatus>('/api/drive-backup/firebase-sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveDriveBackupSettings: (payload: {
    autoSchedule?: DriveAutoSchedule;
    maxBackups?: number;
    clientId?: string;
    clientSecret?: string;
    clearCustomCredentials?: boolean;
  }) =>
    requestJson<DriveBackupStatus>('/api/drive-backup/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  startDesktopDriveOAuth: () =>
    requestJson<{ authUrl: string; redirectUri: string }>(
      '/api/drive-backup/oauth/start',
      { method: 'POST' }
    ),

  disconnectDriveBackup: () =>
    requestJson<DriveBackupStatus>('/api/drive-backup/disconnect', {
      method: 'POST',
    }),

  listDriveBackups: () =>
    requestJson<{ files: DriveBackupFile[]; status: DriveBackupStatus }>(
      '/api/drive-backup/files'
    ),

  backupNowToDrive: () =>
    requestJson<{
      file: DriveBackupFile;
      manifest: DriveBackupManifest;
      status: DriveBackupStatus;
    }>('/api/drive-backup/backup-now', {
      method: 'POST',
    }),

  previewDriveBackup: (fileId: string) =>
    requestJson<{ manifest: DriveBackupManifest }>(
      `/api/drive-backup/files/${encodeURIComponent(fileId)}/preview`
    ),

  restoreDriveBackup: (fileId: string) =>
    requestJson<{
      db: LocalDatabase;
      manifest: DriveBackupManifest;
      user: UserProfile | null;
      status: DriveBackupStatus;
    }>(`/api/drive-backup/files/${encodeURIComponent(fileId)}/restore`, {
      method: 'POST',
    }),

  deleteDriveBackup: (fileId: string) =>
    requestJson<{ ok: boolean }>(
      `/api/drive-backup/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' }
    ),

  downloadFullZipBackup: async (): Promise<{ blob: Blob; fileName: string }> => {
    const res = await authorizedFetch('/api/drive-backup/download-zip');
    if (!res.ok) {
      throw new Error('No se pudo generar el archivo de respaldo .zip.');
    }
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/i);
    const fileName = match?.[1] || 'Respaldo_AulaAgil.zip';
    const blob = await res.blob();
    return { blob, fileName };
  },

  restoreFullZipBackup: (zipBase64: string) =>
    requestJson<{
      db: LocalDatabase;
      manifest: DriveBackupManifest;
      user: UserProfile | null;
    }>('/api/drive-backup/restore-zip', {
      method: 'POST',
      body: JSON.stringify({ zipBase64 }),
    }),

  // GitHub Repository & OAuth Linking for Updates
  getGitHubUpdateStatus: () =>
    requestJson<GitHubUpdateConfigStatus>('/api/github-updates/status'),

  saveGitHubCredentials: (payload: {
    clientId?: string;
    clientSecret?: string;
    clearOAuthCredentials?: boolean;
  }) =>
    requestJson<GitHubUpdateConfigStatus>('/api/github-updates/credentials', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  linkGitHubRepo: (payload: { repoInput: string; accessToken?: string }) =>
    requestJson<GitHubUpdateConfigStatus>('/api/github-updates/link-repo', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  linkGitHubWithToken: (accessToken: string) =>
    requestJson<GitHubUpdateConfigStatus>('/api/github-updates/link-token', {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    }),

  listGitHubUserRepos: () =>
    requestJson<{ repos: GitHubRepoSummary[] }>('/api/github-updates/repos'),

  startGitHubWebOAuth: () =>
    requestJson<{ authUrl: string; redirectUri: string }>(
      '/api/github-updates/oauth/start-web',
      { method: 'POST' }
    ),

  startGitHubDesktopOAuth: () =>
    requestJson<{ authUrl: string; redirectUri: string }>(
      '/api/github-updates/oauth/start-desktop',
      { method: 'POST' }
    ),

  disconnectGitHubUpdates: () =>
    requestJson<GitHubUpdateConfigStatus>('/api/github-updates/disconnect', {
      method: 'POST',
    }),
};
