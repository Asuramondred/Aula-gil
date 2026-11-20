export type AttendanceStatus = 'presente' | 'retardo' | 'falta' | 'justificada';
export type SubmissionStatus = 'revisado' | 'incompleto' | 'no_entregado';
export type AssignmentCategory = 'trabajo' | 'tarea' | 'examen';
export type FormativeField =
  | 'general'
  | 'lenguajes'
  | 'saberes'
  | 'etica'
  | 'humano';
export type FileCategory = 'acta' | 'curp' | 'boleta' | 'medica' | 'evidencia' | 'otro';
export type IncidentCategory =
  | 'convivencia'
  | 'disciplina'
  | 'cumplimiento'
  | 'asistencia'
  | 'reconocimiento';
export type IncidentSeverity = 'positiva' | 'leve' | 'moderada' | 'grave';

export type TrimesterPeriod = 'Trimestre 1' | 'Trimestre 2' | 'Trimestre 3';

export interface Classroom {
  id: string;
  name: string;
  schoolName: string;
  teacherName: string;
  cycle: string;
  activePeriod: TrimesterPeriod;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  classroomId: string;
  listNumber: number;
  fullName: string;
  curp: string;
  birthDate: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  medicalNotes: string;
  pedagogicalNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentFile {
  id: string;
  classroomId: string;
  studentId: string;
  title: string;
  category: FileCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageMode: 'inline' | 'link';
  dataUrl: string;
  externalUrl: string;
  notes: string;
  createdAt: string;
}

export interface AttendanceDay {
  id: string;
  classroomId: string;
  date: string;
  period: TrimesterPeriod;
  records: Record<string, AttendanceStatus>;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  classroomId: string;
  period: TrimesterPeriod;
  title: string;
  type: AssignmentCategory;
  formativeField?: FormativeField;
  dueDate: string;
  description: string;
  maxScore: number;
  submissions: Record<string, SubmissionStatus>;
  scores: Record<string, number | null>;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  classroomId: string;
  studentId: string;
  period: TrimesterPeriod;
  date: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  actionTaken: string;
  aiReportParents: string;
  aiReportDirection: string;
  reportGeneratedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradingPeriod {
  id: string;
  classroomId: string;
  periodName: TrimesterPeriod;
  trabajosWeight: number;
  tareasWeight: number;
  examenWeight: number;
  asistenciaWeight: number;
  conductaWeight: number;
  examTotalQuestions: number;
  useActivityExamAverage: boolean;
  scaleMax: 10 | 100;
  updatedAt: string;
}

export interface StudentGrade {
  id: string;
  classroomId: string;
  periodId: string;
  studentId: string;
  examCorrectAnswers: number;
  manualTrabajosScore: number;
  hasManualTrabajosScore: boolean;
  manualTareasScore: number;
  hasManualTareasScore: boolean;
  manualExamenScore: number;
  hasManualExamenScore: boolean;
  manualAsistenciaScore: number;
  hasManualAsistenciaScore: boolean;
  aiConductBase10: number;
  hasAiConductScore: boolean;
  aiConductReason: string;
  manualConductScore: number;
  hasManualConductScore: boolean;
  manualFinalGrade: number;
  hasManualFinalGrade: boolean;
  customComment: string;
  updatedAt: string;
}

export interface DailyLog {
  id: string;
  classroomId: string;
  date: string;
  period: TrimesterPeriod;
  rawNarrative: string;
  topicsCovered: string;
  studentObservations: string;
  agreementsPending: string;
  pedagogicalReflection: string;
  createdAt: string;
  updatedAt: string;
}

export type LessonPlanSource = 'cargada' | 'ia_nem';
export type WeekdayKey = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes';
export type NemMethodology =
  | 'abp_proyectos'
  | 'steam'
  | 'problemas'
  | 'servicio';

export interface NonSchoolDay {
  day: WeekdayKey;
  reason: string;
}

export type LessonPlanScope = 'integrada' | 'campo_unico';

export interface LessonPlanFieldBlock {
  field: Exclude<FormativeField, 'general'>;
  fieldLabel: string;
  topic: string;
  pda: string;
  activitiesSummary: string;
}

export interface LessonPlanDaySession {
  day: WeekdayKey;
  active: boolean;
  suspensionReason: string;
  activities: string;
  materials: string;
}

export interface LessonPlan {
  id: string;
  classroomId: string;
  period: TrimesterPeriod;
  title: string;
  source: LessonPlanSource;
  planScope?: LessonPlanScope;
  weekStartDate: string;
  weekEndDate: string;
  formativeField: FormativeField;
  methodology: NemMethodology;
  articulatingAxes: string[];
  pda: string;
  teacherNeeds: string;
  nonSchoolDays: NonSchoolDay[];
  fieldBlocks?: LessonPlanFieldBlock[];
  sessions: LessonPlanDaySession[];
  evaluationFormative: string;
  adjustments: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalDatabase {
  classrooms: Classroom[];
  students: Student[];
  studentFiles: StudentFile[];
  attendance: AttendanceDay[];
  assignments: Assignment[];
  incidents: Incident[];
  gradingPeriods: GradingPeriod[];
  studentGrades: StudentGrade[];
  dailyLogs: DailyLog[];
  lessonPlans: LessonPlan[];
}

export type AiEngineKey =
  | 'ollama'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'custom_openai'
  | 'offline';

export type AiProviderMode = 'auto' | AiEngineKey;

export interface AiProviderCooldown {
  provider: AiEngineKey;
  until: string;
  remainingMinutes: number;
  reason: string;
}

export interface AiExecutionAttempt {
  provider: AiEngineKey;
  label: string;
  status: 'ok' | 'quota_exhausted' | 'cooldown' | 'unavailable' | 'error';
  detail?: string;
}

export interface AiExecutionMeta {
  providerUsed: AiEngineKey;
  providerLabel: string;
  failoverTriggered: boolean;
  failoverReason?: string;
  attempts: AiExecutionAttempt[];
}

export interface ApiKeyStatus {
  aiProvider: AiProviderMode;
  autoFailoverOnQuota: boolean;
  aiPriorityOrder: AiEngineKey[];
  enabledAiProviders: AiEngineKey[];
  ollamaUrl: string;
  ollamaModel: string;
  geminiModel: string;
  groqModel: string;
  openrouterModel: string;
  customOpenAiUrl: string;
  customOpenAiModel: string;
  hasGeminiKey: boolean;
  geminiKeyCount: number;
  hasGroqKey: boolean;
  groqKeyCount: number;
  hasOpenrouterKey: boolean;
  openrouterKeyCount: number;
  hasCustomOpenAiKey: boolean;
  geminiSource: 'env' | 'local' | 'none';
  groqSource: 'env' | 'local' | 'none';
  cooldowns: AiProviderCooldown[];
  dataDir: string;
  lastBackupAt: string | null;
}

export type AppSection =
  | 'inicio'
  | 'resumen'
  | 'lista'
  | 'expedientes'
  | 'trabajos'
  | 'planeaciones'
  | 'bitacora'
  | 'diario'
  | 'calificaciones'
  | 'configuracion';
