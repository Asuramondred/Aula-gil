import type {
  AiEngineKey,
  AiExecutionMeta,
  ApiKeyStatus,
  LocalDatabase,
} from '../types';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
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

  exportBackup: async (): Promise<LocalDatabase> => {
    const res = await fetch('/api/backup/export');
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
};
