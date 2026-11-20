import {
  AlertCircle,
  BookOpenCheck,
  Calculator,
  ClipboardList,
  FolderOpen,
  NotebookPen,
  Plus,
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
  Student,
  StudentFile,
  StudentGrade,
} from '../types';
import { computeStudentTrimesterGrade } from '../lib/grading';

interface OverviewViewProps {
  classroom: Classroom;
  students: Student[];
  files: StudentFile[];
  attendanceDays: AttendanceDay[];
  assignments: Assignment[];
  incidents: Incident[];
  dailyLogs: DailyLog[];
  gradingPeriod: GradingPeriod;
  grades: StudentGrade[];
  onNavigate: (section: AppSection) => void;
}

export function OverviewView({
  classroom,
  students,
  files,
  attendanceDays,
  assignments,
  incidents,
  dailyLogs,
  gradingPeriod,
  grades,
  onNavigate,
}: OverviewViewProps) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayAttendance = attendanceDays.find((d) => d.date === todayStr);
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

  const recentIncidents = [...incidents]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  const recentLogs = [...dailyLogs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  const studentNameMap = new Map(students.map((s) => [s.id, s.fullName]));

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            {classroom.schoolName || 'Escuela Primaria'} · Ciclo {classroom.cycle} ·{' '}
            {classroom.activePeriod} · Almacenamiento local
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Resumen del grupo {classroom.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('lista')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <ClipboardList className="w-4 h-4" />
            Pasar lista hoy
          </button>
          <button
            type="button"
            onClick={() => onNavigate('diario')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <NotebookPen className="w-4 h-4" />
            Bitácora diaria
          </button>
          <button
            type="button"
            onClick={() => onNavigate('bitacora')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Registrar conducta
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('lista')}
          className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Lista y asistencia ({todayStr})</span>
            <Users className="w-4 h-4 text-blue-700" />
          </div>
          <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {students.length} alumnos
          </p>
          <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
            {presentCount} presentes · {lateCount} retardos · {absentCount} faltas
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('expedientes')}
          className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Expediente digital</span>
            <FolderOpen className="w-4 h-4 text-blue-700" />
          </div>
          <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {files.length} documentos
          </p>
          <p className="text-xs text-slate-600 mt-1.5">
            Archivos y fichas médicas locales
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('trabajos')}
          className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Actividades ({classroom.activePeriod})</span>
            <BookOpenCheck className="w-4 h-4 text-blue-700" />
          </div>
          <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {periodAssignments.length} actividades
          </p>
          <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
            {reviewPct}% entregadas ({totalReviewedChecks}/{totalChecksExpected})
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('calificaciones')}
          className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Promedio ({classroom.activePeriod})</span>
            <Calculator className="w-4 h-4 text-blue-700" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {gradeSummary.avg !== null ? `${gradeSummary.avg} / ${gradingPeriod.scaleMax}` : '—'}
            </p>
            {gradeSummary.isPartial && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                Cálculo parcial
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
            {gradeSummary.isPartial
              ? `${gradeSummary.activeWeightPct}% de rubros con registros`
              : `Trab. ${gradingPeriod.trabajosWeight}% · Tar. ${gradingPeriod.tareasWeight}% · Cond. ${gradingPeriod.conductaWeight}%`}
          </p>
        </button>
      </div>

      {/* Main Two-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Bitácora de conducta reciente
              </h2>
              <p className="text-xs text-slate-500">
                Incidencias y méritos que alimentan la calificación trimestral de conducta
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('bitacora')}
              className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
            >
              Ver todo
            </button>
          </div>

          {recentIncidents.length === 0 ? (
            <div className="py-10 text-center border-t border-slate-100">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600">No hay registros de conducta aún.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {recentIncidents.map((inc) => (
                <div key={inc.id} className="py-3.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                      <span className="font-semibold text-slate-900">
                        {studentNameMap.get(inc.studentId) || 'Alumno'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{inc.date}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          inc.severity === 'positiva'
                            ? 'text-emerald-700 font-medium'
                            : inc.severity === 'grave'
                            ? 'text-red-700 font-medium'
                            : inc.severity === 'moderada'
                            ? 'text-amber-700 font-medium'
                            : 'text-slate-600 font-medium'
                        }
                      >
                        {inc.severity === 'positiva' ? 'Mérito' : `Incidencia ${inc.severity}`}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 line-clamp-2">{inc.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Bitácora diaria del docente
              </h2>
              <p className="text-xs text-slate-500">
                Últimas jornadas estructuradas y exportables a Word (.docx)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('diario')}
              className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
            >
              Escribir hoy
            </button>
          </div>

          {recentLogs.length === 0 ? (
            <div className="py-10 text-center border-t border-slate-100">
              <NotebookPen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600">
                Aún no has redactado bitácoras diarias de jornada.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {recentLogs.map((log) => (
                <div key={log.id} className="py-3.5">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {log.date}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{log.period}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-800 line-clamp-1">
                    {log.topicsCovered || log.rawNarrative}
                  </p>
                  {log.agreementsPending && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                      Pendientes: {log.agreementsPending}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
