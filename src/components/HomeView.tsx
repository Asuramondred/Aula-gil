import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  Calculator,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  NotebookPen,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type {
  AppSection,
  Assignment,
  AttendanceDay,
  Classroom,
  DailyLog,
  GradingPeriod,
  Incident,
  LessonPlan,
  Student,
  StudentFile,
  StudentGrade,
} from '../types';
import { computeStudentTrimesterGrade } from '../lib/grading';

type HomeTab = 'jornada' | 'evaluacion' | 'gestion';

interface HomeViewProps {
  classroom: Classroom;
  classroomCount: number;
  students: Student[];
  files: StudentFile[];
  attendanceDays: AttendanceDay[];
  assignments: Assignment[];
  incidents: Incident[];
  dailyLogs: DailyLog[];
  lessonPlans: LessonPlan[];
  gradingPeriod: GradingPeriod;
  grades: StudentGrade[];
  lastBackupAt: string | null;
  onNavigate: (section: AppSection) => void;
}

const HOME_TABS: Array<{ id: HomeTab; indexLabel: string; label: string }> = [
  { id: 'jornada', indexLabel: '01.', label: 'Jornada diaria' },
  { id: 'evaluacion', indexLabel: '02.', label: 'Evaluación y expedientes' },
  { id: 'gestion', indexLabel: '03.', label: 'Grupo y respaldo' },
];

export function HomeView({
  classroom,
  classroomCount,
  students,
  files,
  attendanceDays,
  assignments,
  incidents,
  dailyLogs,
  lessonPlans,
  gradingPeriod,
  grades,
  lastBackupAt,
  onNavigate,
}: HomeViewProps) {
  const [activeTab, setActiveTab] = useState<HomeTab>('jornada');

  const todayStr = new Date().toISOString().slice(0, 10);
  const formattedToday = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const todayAttendance = attendanceDays.find((d) => d.date === todayStr);
  const hasTodayAttendance =
    Boolean(todayAttendance) &&
    Object.keys(todayAttendance?.records || {}).length > 0;
  const presentCount = students.filter(
    (s) => todayAttendance?.records?.[s.id] === 'presente'
  ).length;
  const lateCount = students.filter(
    (s) => todayAttendance?.records?.[s.id] === 'retardo'
  ).length;
  const absentCount = students.filter(
    (s) => todayAttendance?.records?.[s.id] === 'falta'
  ).length;

  const periodAssignments = assignments.filter(
    (a) => a.period === classroom.activePeriod
  );
  const totalChecksExpected = periodAssignments.length * students.length;
  const totalReviewedChecks = periodAssignments.reduce((acc, a) => {
    const count = students.filter((s) => a.submissions?.[s.id] === 'revisado').length;
    return acc + count;
  }, 0);
  const reviewPct =
    totalChecksExpected > 0
      ? Math.round((totalReviewedChecks / totalChecksExpected) * 100)
      : 0;

  const gradeSummary = (() => {
    if (students.length === 0) {
      return { avg: null as number | null, isPartial: false, activeWeightPct: 0 };
    }
    let sum = 0;
    let anyPartial = false;
    let minActivePct = 100;
    students.forEach((s) => {
      const gDoc = grades.find(
        (g) => g.periodId === gradingPeriod.id && g.studentId === s.id
      );
      const computed = computeStudentTrimesterGrade(
        s.id,
        gradingPeriod,
        gDoc,
        assignments,
        attendanceDays,
        incidents
      );
      sum += computed.finalGrade;
      if (computed.isPartial && !gDoc?.hasManualFinalGrade) {
        anyPartial = true;
      }
      if (computed.activeWeightPct < minActivePct) {
        minActivePct = computed.activeWeightPct;
      }
    });
    return {
      avg: Math.round((sum / students.length) * 10) / 10,
      isPartial: anyPartial,
      activeWeightPct: minActivePct,
    };
  })();

  const periodIncidents = incidents.filter(
    (i) => i.period === classroom.activePeriod
  );
  const latestLog = [...dailyLogs].sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestIncident = [...incidents].sort((a, b) =>
    b.date.localeCompare(a.date)
  )[0];
  const studentNameMap = new Map(students.map((s) => [s.id, s.fullName]));

  const daysSinceBackup = lastBackupAt
    ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86400000)
    : null;
  const backupStatusText =
    daysSinceBackup === null
      ? 'Sin respaldo reciente (+15 días)'
      : daysSinceBackup > 15
      ? `Último respaldo hace ${daysSinceBackup} días`
      : `Respaldo al día (${lastBackupAt!.slice(0, 10)})`;

  return (
    <div className="space-y-8">
      {/* Focused Welcome Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{classroom.schoolName || 'Escuela Primaria'}</span>
            <span aria-hidden="true">·</span>
            <span>Ciclo {classroom.cycle}</span>
            <span aria-hidden="true">·</span>
            <span>{classroom.activePeriod}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{formattedToday}</span>
          </div>
          <h1
            className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
            style={{ textWrap: 'balance' }}
          >
            Inicio de AulaÁgil · Grupo {classroom.name}
          </h1>
          <p className="text-sm text-slate-600">
            {classroom.teacherName || 'Docente Titular'} — Elige una sección de trabajo para avanzar paso a paso sin saturar tu pantalla.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('planeaciones')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <BookMarked className="w-4 h-4 text-blue-700" />
            Planeaciones
          </button>
          <button
            type="button"
            onClick={() => onNavigate('lista')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ClipboardList className="w-4 h-4" />
            Pasar lista hoy
          </button>
        </div>
      </section>

      {/* Single-Row Clean Metric Strip (No Nested Cards) */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <button
          type="button"
          onClick={() => onNavigate('lista')}
          className="p-4 sm:p-5 text-left hover:bg-slate-50 transition-colors"
        >
          <p className="text-xs text-slate-500">Alumnos inscritos</p>
          <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
            {students.length}
          </p>
          <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
            {hasTodayAttendance
              ? `${presentCount} presentes hoy`
              : 'Pase de lista pendiente'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('trabajos')}
          className="p-4 sm:p-5 text-left hover:bg-slate-50 transition-colors"
        >
          <p className="text-xs text-slate-500">Trabajos y tareas</p>
          <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
            {periodAssignments.length}
          </p>
          <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
            {totalChecksExpected > 0
              ? `${reviewPct}% revisados en ${classroom.activePeriod}`
              : `Sin actividades en ${classroom.activePeriod}`}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('calificaciones')}
          className="p-4 sm:p-5 text-left hover:bg-slate-50 transition-colors"
        >
          <p className="text-xs text-slate-500">Promedio ({classroom.activePeriod})</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {gradeSummary.avg !== null
                ? `${gradeSummary.avg} / ${gradingPeriod.scaleMax}`
                : '—'}
            </p>
            {gradeSummary.isPartial && (
              <span className="text-xs font-medium text-amber-700">
                Cálculo parcial
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
            {gradeSummary.isPartial
              ? `${gradeSummary.activeWeightPct}% de rubros activos`
              : 'Todos los rubros evaluados'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('diario')}
          className="p-4 sm:p-5 text-left hover:bg-slate-50 transition-colors"
        >
          <p className="text-xs text-slate-500">Bitácora y conducta</p>
          <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
            {dailyLogs.length} / {periodIncidents.length}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            Diarios del aula / registros de conducta
          </p>
        </button>
      </section>

      {/* Sectioned Workspace Hub (One Area Visible at a Time) */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Áreas de trabajo
            </h2>
            <p className="text-sm text-slate-600">
              Selecciona una sección para ver únicamente las herramientas correspondientes.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Secciones de AulaÁgil"
            className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start"
          >
            {HOME_TABS.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    selected
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="font-mono text-slate-400 mr-1.5">
                    {tab.indexLabel}
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 01: Jornada diaria */}
        {activeTab === 'jornada' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => onNavigate('lista')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Asistencia diaria</span>
                    <Users className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Lista y asistencia
                  </h3>
                  <p className="text-sm text-slate-600">
                    {hasTodayAttendance
                      ? `Hoy (${todayStr}): ${presentCount} presentes, ${lateCount} retardos y ${absentCount} faltas.`
                      : `Aún no se ha pasado lista hoy (${todayStr}). Toma asistencia en segundos y exporta listas en Word.`}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Ir a pase de lista
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('planeaciones')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Nueva Escuela Mexicana</span>
                    <BookMarked className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Planeaciones
                  </h3>
                  <p className="text-sm text-slate-600">
                    {lessonPlans.length > 0
                      ? `${lessonPlans.length} planeación(es) guardada(s). Carga archivos propios o crea planeaciones NEM con IA en Word (.docx) ajustando días sin clases.`
                      : 'Carga tus planeaciones, guárdalas por trimestre o crea planeaciones NEM con IA en Word (.docx) marcando días sin asistencia.'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Abrir planeaciones
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('diario')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Crónica escolar</span>
                    <NotebookPen className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Bitácora diaria
                  </h3>
                  <p className="text-sm text-slate-600">
                    {latestLog
                      ? `Último registro el ${latestLog.date}. Redacta o dicta tu jornada para estructurarla con IA y descargarla en .docx.`
                      : 'Dicta por voz o escribe lo ocurrido en tu jornada y conviértelo en un reporte formal.'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Escribir bitácora
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('bitacora')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Seguimiento formativo</span>
                    <AlertTriangle className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Conducta e IA
                  </h3>
                  <p className="text-sm text-slate-600">
                    {latestIncident
                      ? `${periodIncidents.length} registro(s) en ${classroom.activePeriod}. Último: ${studentNameMap.get(latestIncident.studentId) || 'Alumno'} (${latestIncident.date}).`
                      : 'Registra méritos o incidencias y genera reportes formales en Word para padres y dirección.'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Abrir conducta
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Section 02: Evaluación y expedientes */}
        {activeTab === 'evaluacion' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => onNavigate('trabajos')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Campos Formativos SEP</span>
                    <BookOpenCheck className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Trabajos y tareas
                  </h3>
                  <p className="text-sm text-slate-600">
                    {periodAssignments.length > 0
                      ? `${periodAssignments.length} actividad(es) en ${classroom.activePeriod} con ${reviewPct}% de entregas revisadas.`
                      : 'Organiza trabajos en clase, tareas y exámenes por Campo Formativo y exporta concentrados Word.'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Gestionar actividades
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('calificaciones')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Evaluación trimestral</span>
                    <Calculator className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Calificaciones y boletas
                  </h3>
                  <p className="text-sm text-slate-600">
                    {gradeSummary.avg !== null
                      ? `Promedio grupal actual: ${gradeSummary.avg} / ${gradingPeriod.scaleMax}${gradeSummary.isPartial ? ' (cálculo parcial)' : ''}. Configura porcentajes e imprime boletas.`
                      : 'Define ponderaciones por trimestre, calcula conducta con IA y descarga boletas en Word (.docx).'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Ir a calificaciones
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('expedientes')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Archivo del alumno</span>
                    <FolderOpen className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Expediente digital
                  </h3>
                  <p className="text-sm text-slate-600">
                    {files.length > 0
                      ? `${files.length} documento(s) guardado(s) localmente para tus ${students.length} alumnos.`
                      : 'Resguarda actas, CURP, fichas médicas, evidencias y contactos de tutores de cada estudiante.'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Abrir expedientes
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Section 03: Grupo y respaldo */}
        {activeTab === 'gestion' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => onNavigate('resumen')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Panorama general</span>
                    <LayoutDashboard className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Resumen del grupo
                  </h3>
                  <p className="text-sm text-slate-600">
                    Consulta indicadores globales, incidencias recientes y bitácoras de {classroom.name} en una vista consolidada.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Abrir resumen del grupo
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('configuracion')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Grupos e IA local</span>
                    <Settings className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Configuración y grupos
                  </h3>
                  <p className="text-sm text-slate-600">
                    Tienes {classroomCount} grupo(s) configurado(s). Administra ciclos escolares, trimestres activos y motor de IA local (Ollama, Gemini o modo sin conexión).
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Ajustar grupo e IA
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('configuracion')}
                className="group text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-6 flex flex-col justify-between gap-4 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium">Seguridad local (.json)</span>
                    <ShieldCheck className="w-4 h-4 text-blue-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Respaldo de seguridad
                  </h3>
                  <p className="text-sm text-slate-600">
                    {backupStatusText}. Exporta o restaura tus datos en un archivo JSON para conservar tu trabajo seguro.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  Gestionar respaldo
                  <ArrowRight className="w-4 h-4" />
                </span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
