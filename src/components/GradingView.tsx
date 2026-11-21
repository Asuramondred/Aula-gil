import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Calculator,
  Edit3,
  FileDown,
  Printer,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { formatAiUsageNotice, localApi, toValidPeriodId } from '../lib/api';
import {
  exportSingleReportCardDocx,
  exportTrimesterGradesDocx,
} from '../lib/docxExport';
import {
  computeAttendanceStats,
  computeStudentTrimesterGrade,
} from '../lib/grading';
import type {
  Assignment,
  AttendanceDay,
  Classroom,
  GradingPeriod,
  Incident,
  LocalDatabase,
  Student,
  StudentGrade,
  TrimesterPeriod,
} from '../types';

interface GradingViewProps {
  classroom: Classroom;
  students: Student[];
  assignments: Assignment[];
  attendanceDays: AttendanceDay[];
  incidents: Incident[];
  gradingPeriods: GradingPeriod[];
  grades: StudentGrade[];
  onDbUpdate: (db: LocalDatabase) => void;
}

const PERIOD_OPTIONS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

export function GradingView({
  classroom,
  students,
  assignments,
  attendanceDays,
  incidents,
  gradingPeriods,
  grades,
  onDbUpdate,
}: GradingViewProps) {
  const [selectedPeriodName, setSelectedPeriodName] = useState<TrimesterPeriod>(
    classroom.activePeriod || 'Trimestre 1'
  );
  const periodId = `${classroom.id}_${toValidPeriodId(selectedPeriodName)}`;

  const existingPeriodConfig = gradingPeriods.find(
    (p) => p.id === periodId || (p.classroomId === classroom.id && p.periodName === selectedPeriodName)
  );

  const [configForm, setConfigForm] = useState<{
    trabajosWeight: number;
    tareasWeight: number;
    examenWeight: number;
    asistenciaWeight: number;
    conductaWeight: number;
    examTotalQuestions: number;
    useActivityExamAverage: boolean;
    scaleMax: 10 | 100;
  }>({
    trabajosWeight: 40,
    tareasWeight: 20,
    examenWeight: 10,
    asistenciaWeight: 10,
    conductaWeight: 20,
    examTotalQuestions: 25,
    useActivityExamAverage: true,
    scaleMax: 10,
  });

  useEffect(() => {
    if (existingPeriodConfig) {
      setConfigForm({
        trabajosWeight: existingPeriodConfig.trabajosWeight ?? 40,
        tareasWeight: existingPeriodConfig.tareasWeight ?? 20,
        examenWeight: existingPeriodConfig.examenWeight ?? 10,
        asistenciaWeight: existingPeriodConfig.asistenciaWeight ?? 10,
        conductaWeight: existingPeriodConfig.conductaWeight ?? 20,
        examTotalQuestions: existingPeriodConfig.examTotalQuestions ?? 25,
        useActivityExamAverage: existingPeriodConfig.useActivityExamAverage ?? true,
        scaleMax: existingPeriodConfig.scaleMax === 100 ? 100 : 10,
      });
    } else {
      setConfigForm({
        trabajosWeight: 40,
        tareasWeight: 20,
        examenWeight: 10,
        asistenciaWeight: 10,
        conductaWeight: 20,
        examTotalQuestions: 25,
        useActivityExamAverage: true,
        scaleMax: 10,
      });
    }
    setConfigNotice('');
    setConfigError('');
  }, [periodId, existingPeriodConfig?.id]);

  const effectivePeriodConfig: GradingPeriod = useMemo(
    () => ({
      id: periodId,
      classroomId: classroom.id,
      periodName: selectedPeriodName,
      ...configForm,
      updatedAt: '',
    }),
    [periodId, classroom.id, selectedPeriodName, configForm]
  );

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.listNumber - b.listNumber),
    [students]
  );

  const [savingConfig, setSavingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState('');
  const [configError, setConfigError] = useState('');
  const [aiBatchLoading, setAiBatchLoading] = useState(false);
  const [showAiConfirmModal, setShowAiConfirmModal] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNotice, setAiNotice] = useState('');

  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [modalDraft, setModalDraft] = useState<StudentGrade | null>(null);
  const [savingStudentGrade, setSavingStudentGrade] = useState(false);
  const [draftingComment, setDraftingComment] = useState(false);

  const [printMode, setPrintMode] = useState<'none' | 'single' | 'all'>('none');
  const [printStudentId, setPrintStudentId] = useState<string>('');

  const weightSum =
    Number(configForm.trabajosWeight) +
    Number(configForm.tareasWeight) +
    Number(configForm.examenWeight) +
    Number(configForm.asistenciaWeight) +
    Number(configForm.conductaWeight);

  const getStudentGradeDoc = (studentId: string): StudentGrade | undefined =>
    grades.find((g) => g.periodId === periodId && g.studentId === studentId);

  const buildDefaultGradeDoc = (studentId: string): StudentGrade => ({
    id: `${periodId}_${studentId}`,
    classroomId: classroom.id,
    periodId,
    studentId,
    examCorrectAnswers: 0,
    manualTrabajosScore: 0,
    hasManualTrabajosScore: false,
    manualTareasScore: 0,
    hasManualTareasScore: false,
    manualExamenScore: 0,
    hasManualExamenScore: false,
    manualAsistenciaScore: 0,
    hasManualAsistenciaScore: false,
    aiConductBase10: 10,
    hasAiConductScore: false,
    aiConductReason: '',
    manualConductScore: 0,
    hasManualConductScore: false,
    manualFinalGrade: 0,
    hasManualFinalGrade: false,
    customComment: '',
    updatedAt: '',
  });

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigNotice('');
    setConfigError('');
    if (weightSum !== 100) {
      setConfigError(
        `Los porcentajes de ${selectedPeriodName} deben sumar exactamente 100% (actualmente suman ${weightSum}%).`
      );
      return;
    }
    setSavingConfig(true);
    try {
      const { db } = await localApi.saveGradingPeriod(periodId, {
        classroomId: classroom.id,
        periodName: selectedPeriodName,
        ...configForm,
      });
      onDbUpdate(db);
      setConfigNotice(`Ponderación de ${selectedPeriodName} guardada (100%).`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCorrectAnswersChange = async (studentId: string, val: string) => {
    const num = Math.max(0, Math.min(configForm.examTotalQuestions, Number(val) || 0));
    const current = getStudentGradeDoc(studentId) || buildDefaultGradeDoc(studentId);
    const { db } = await localApi.saveStudentGrade(current.id, {
      ...current,
      examCorrectAnswers: num,
    });
    onDbUpdate(db);
  };

  const manualOrCommentedCount = useMemo(() => {
    return sortedStudents.filter((st) => {
      const g = getStudentGradeDoc(st.id);
      return Boolean(
        g?.hasManualConductScore ||
          g?.hasAiConductScore ||
          (g?.customComment && g.customComment.trim().length > 0)
      );
    }).length;
  }, [sortedStudents, grades, periodId]);

  const handleEvaluateConductWithAI = async (mode: 'only_empty' | 'overwrite_all') => {
    if (sortedStudents.length === 0) return;

    const targetStudents =
      mode === 'only_empty'
        ? sortedStudents.filter((st) => {
            const g = getStudentGradeDoc(st.id);
            const hasManual = Boolean(g?.hasManualConductScore);
            const hasObs = Boolean(g?.customComment && g.customComment.trim().length > 0);
            const hasAi = Boolean(g?.hasAiConductScore);
            return !hasManual && !hasObs && !hasAi;
          })
        : sortedStudents;

    setShowAiConfirmModal(false);

    if (targetStudents.length === 0) {
      setAiNotice('Todos los alumnos ya cuentan con observación o calificación de conducta.');
      return;
    }

    setAiBatchLoading(true);
    setAiError('');
    setAiNotice('');
    try {
      const payloadStudents = targetStudents.map((st) => {
        const stIncidents = incidents
          .filter((i) => i.studentId === st.id && i.period === selectedPeriodName)
          .map((i) => ({
            date: i.date,
            category: i.category,
            severity: i.severity,
            description: i.description,
          }));
        const att = computeAttendanceStats(st.id, attendanceDays, selectedPeriodName);
        return {
          studentId: st.id,
          studentName: st.fullName,
          incidents: stIncidents,
          attendanceStats: att,
        };
      });

      const data = await localApi.evaluateConduct({
        periodName: selectedPeriodName,
        students: payloadStudents,
      });

      const evaluations: Array<{
        studentId: string;
        conductBase10: number;
        reason: string;
        suggestedComment: string;
      }> = data.evaluations || [];

      let latestDb: LocalDatabase | null = null;
      for (const ev of evaluations) {
        const existing = getStudentGradeDoc(ev.studentId) || buildDefaultGradeDoc(ev.studentId);
        const { db } = await localApi.saveStudentGrade(existing.id, {
          ...existing,
          aiConductBase10: Math.max(0, Math.min(10, Number(ev.conductBase10))),
          hasAiConductScore: true,
          hasManualConductScore: mode === 'overwrite_all' ? false : existing.hasManualConductScore,
          aiConductReason: ev.reason || '',
          customComment:
            mode === 'overwrite_all'
              ? ev.suggestedComment || existing.customComment
              : existing.customComment || ev.suggestedComment || '',
        });
        latestDb = db;
      }
      if (latestDb) onDbUpdate(latestDb);
      setAiNotice(
        formatAiUsageNotice(
          data._aiMeta,
          `Conducta base 10 calculada por IA para ${evaluations.length} alumno(s) en ${selectedPeriodName}`
        )
      );
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Error al evaluar conducta.');
    } finally {
      setAiBatchLoading(false);
    }
  };

  const openStudentModal = (student: Student) => {
    const current = getStudentGradeDoc(student.id) || buildDefaultGradeDoc(student.id);
    setEditingStudent(student);
    setModalDraft({ ...current });
  };

  const handleSaveStudentModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalDraft) return;
    setSavingStudentGrade(true);
    try {
      const { db } = await localApi.saveStudentGrade(modalDraft.id, modalDraft as unknown as Record<string, unknown>);
      onDbUpdate(db);
      setEditingStudent(null);
      setModalDraft(null);
    } finally {
      setSavingStudentGrade(false);
    }
  };

  const handleDraftCommentWithAI = async () => {
    if (!editingStudent || !modalDraft) return;
    setDraftingComment(true);
    try {
      const computed = computeStudentTrimesterGrade(
        editingStudent.id,
        effectivePeriodConfig,
        modalDraft,
        assignments,
        attendanceDays,
        incidents
      );
      const data = await localApi.draftGradeComment({
        studentName: editingStudent.fullName,
        periodName: selectedPeriodName,
        finalGrade: computed.finalGrade,
        scaleMax: effectivePeriodConfig.scaleMax,
        summary: `Trabajos ${computed.trabajosAvg10 !== null ? `${computed.trabajosAvg10}/10` : 'Sin datos'}, Tareas ${computed.tareasAvg10 !== null ? `${computed.tareasAvg10}/10` : 'Sin datos'}, Examen ${computed.examenAvg10 !== null ? `${computed.examenAvg10}/10` : 'Sin datos'}, Asistencia ${computed.asistenciaPct !== null ? `${computed.asistenciaPct}%` : 'Sin datos'}, Conducta ${computed.conductBase10}/10. ${modalDraft.aiConductReason}`,
      });
      setModalDraft((prev) => (prev ? { ...prev, customComment: data.comment || '' } : prev));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Error al redactar comentario.');
    } finally {
      setDraftingComment(false);
    }
  };

  const triggerPrintSingle = (studentId: string) => {
    setPrintStudentId(studentId);
    setPrintMode('single');
    setTimeout(() => window.print(), 80);
  };

  const triggerPrintAll = () => {
    setPrintMode('all');
    setTimeout(() => window.print(), 80);
  };

  const studentsToPrint =
    printMode === 'single'
      ? sortedStudents.filter((s) => s.id === printStudentId)
      : printMode === 'all'
      ? sortedStudents
      : [];

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Ponderación independiente por trimestre · Sincronizado con Asistencia, Trabajos, Tareas y Conducta IA
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Evaluación trimestral y concentrado de calificaciones
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelectedPeriodName(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  selectedPeriodName === p
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={sortedStudents.length === 0}
            onClick={() =>
              exportTrimesterGradesDocx(
                classroom,
                effectivePeriodConfig,
                sortedStudents,
                grades,
                assignments,
                attendanceDays,
                incidents
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <FileDown className="w-4 h-4" />
            Concentrado Word (.docx)
          </button>

          <button
            type="button"
            disabled={sortedStudents.length === 0}
            onClick={triggerPrintAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            Imprimir boletas
          </button>
        </div>
      </div>

      {/* Rubric Configuration */}
      <form
        onSubmit={handleSaveConfig}
        className="no-print bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Ponderación configurable — {selectedPeriodName}
            </h2>
            <p className="text-xs text-slate-500">
              Asigna el porcentaje de cada rubro para este trimestre. La suma debe ser exactamente 100%.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-xs font-semibold tabular-nums ${
                weightSum === 100 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              Total: {weightSum}% {weightSum === 100 ? '(Válido)' : '(Debe sumar 100%)'}
            </span>
            <button
              type="submit"
              disabled={savingConfig}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {savingConfig ? 'Guardando...' : 'Guardar ponderación'}
            </button>
          </div>
        </div>

        {configError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {configError}
          </p>
        )}
        {configNotice && (
          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {configNotice}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Trabajos en clase (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={configForm.trabajosWeight}
              onChange={(e) =>
                setConfigForm((p) => ({ ...p, trabajosWeight: Number(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Tareas (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={configForm.tareasWeight}
              onChange={(e) =>
                setConfigForm((p) => ({ ...p, tareasWeight: Number(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Exámenes / Proy. (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={configForm.examenWeight}
              onChange={(e) =>
                setConfigForm((p) => ({ ...p, examenWeight: Number(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Asistencia (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={configForm.asistenciaWeight}
              onChange={(e) =>
                setConfigForm((p) => ({ ...p, asistenciaWeight: Number(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Conducta (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={configForm.conductaWeight}
              onChange={(e) =>
                setConfigForm((p) => ({ ...p, conductaWeight: Number(e.target.value) || 0 }))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Escala final
            </label>
            <select
              value={configForm.scaleMax}
              onChange={(e) =>
                setConfigForm((p) => ({
                  ...p,
                  scaleMax: Number(e.target.value) === 100 ? 100 : 10,
                }))
              }
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value={10}>0 a 10</option>
              <option value={100}>0 a 100</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={configForm.useActivityExamAverage}
                onChange={(e) =>
                  setConfigForm((p) => ({
                    ...p,
                    useActivityExamAverage: e.target.checked,
                  }))
                }
              />
              <span>Usar promedio de Exámenes/Proyectos registrados</span>
            </label>
            {!configForm.useActivityExamAverage && (
              <label className="flex items-center gap-2">
                <span>Preguntas del examen:</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={configForm.examTotalQuestions}
                  onChange={(e) =>
                    setConfigForm((p) => ({
                      ...p,
                      examTotalQuestions: Number(e.target.value) || 1,
                    }))
                  }
                  className="w-20 px-2 py-1 text-xs font-mono border border-slate-200 rounded-md"
                />
              </label>
            )}
          </div>

          <button
            type="button"
            disabled={aiBatchLoading || sortedStudents.length === 0}
            onClick={() => setShowAiConfirmModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
          >
            <Bot className="w-4 h-4" />
            {aiBatchLoading ? 'Evaluando conducta...' : 'Calcular conducta con IA (Todo el grupo)'}
          </button>
        </div>

        {aiError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {aiError}
          </p>
        )}
        {aiNotice && (
          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {aiNotice}
          </p>
        )}
      </form>

      {/* Grades Table */}
      <div className="no-print bg-white border border-slate-200 rounded-xl overflow-hidden">
        {sortedStudents.length === 0 ? (
          <div className="p-12 text-center">
            <Calculator className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              Agrega alumnos en Lista y Asistencia para generar el concentrado de calificaciones.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <th className="py-3 px-4 w-12 font-mono text-center tabular-nums">#</th>
                  <th className="py-3 px-4 min-w-[200px]">Estudiante</th>
                  <th className="py-3 px-3 text-center tabular-nums whitespace-nowrap">
                    Trabajos ({configForm.trabajosWeight}%)
                  </th>
                  <th className="py-3 px-3 text-center tabular-nums whitespace-nowrap">
                    Tareas ({configForm.tareasWeight}%)
                  </th>
                  <th className="py-3 px-3 text-center tabular-nums whitespace-nowrap">
                    {configForm.useActivityExamAverage
                      ? `Examen (${configForm.examenWeight}%)`
                      : `Aciertos /${configForm.examTotalQuestions}`}
                  </th>
                  <th className="py-3 px-3 text-center tabular-nums whitespace-nowrap">
                    Asist. ({configForm.asistenciaWeight}%)
                  </th>
                  <th className="py-3 px-3 text-center tabular-nums whitespace-nowrap">
                    Conducta ({configForm.conductaWeight}%)
                  </th>
                  <th className="py-3 px-4 text-center font-bold text-slate-900 tabular-nums whitespace-nowrap">
                    Final (/{configForm.scaleMax})
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Ajustes / Boleta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {sortedStudents.map((st) => {
                  const gradeDoc = getStudentGradeDoc(st.id);
                  const computed = computeStudentTrimesterGrade(
                    st.id,
                    effectivePeriodConfig,
                    gradeDoc,
                    assignments,
                    attendanceDays,
                    incidents
                  );
                  return (
                    <tr key={st.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 text-center tabular-nums">
                        {String(st.listNumber).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{st.fullName}</p>
                        {gradeDoc?.customComment && (
                          <p className="text-xs text-slate-500 truncate max-w-[210px]">
                            “{gradeDoc.customComment}”
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-xs text-slate-700 tabular-nums">
                        {computed.trabajosHasData && computed.trabajosAvg10 !== null ? (
                          <>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {computed.trabajosPoints.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-500 tabular-nums">
                              Prom {computed.trabajosAvg10.toFixed(1)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-400">—</span>
                            <span className="block text-[10px] text-slate-400 font-sans">
                              Sin datos
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-xs text-slate-700 tabular-nums">
                        {computed.tareasHasData && computed.tareasAvg10 !== null ? (
                          <>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {computed.tareasPoints.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-500 tabular-nums">
                              Prom {computed.tareasAvg10.toFixed(1)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-400">—</span>
                            <span className="block text-[10px] text-slate-400 font-sans">
                              Sin datos
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-xs text-slate-700 tabular-nums">
                        {!configForm.useActivityExamAverage ? (
                          <div className="inline-flex flex-col items-center">
                            <input
                              type="number"
                              min={0}
                              max={configForm.examTotalQuestions}
                              step="0.5"
                              value={gradeDoc?.examCorrectAnswers ?? 0}
                              onChange={(e) => handleCorrectAnswersChange(st.id, e.target.value)}
                              className="w-16 px-2 py-1 text-xs font-mono text-center border border-slate-200 rounded tabular-nums"
                            />
                            <span className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                              {computed.examenHasData
                                ? `${computed.examenPoints.toFixed(2)} pts`
                                : 'Sin datos'}
                            </span>
                          </div>
                        ) : computed.examenHasData && computed.examenAvg10 !== null ? (
                          <>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {computed.examenPoints.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-500 tabular-nums">
                              Prom {computed.examenAvg10.toFixed(1)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-400">—</span>
                            <span className="block text-[10px] text-slate-400 font-sans">
                              Sin datos
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-xs text-slate-700 tabular-nums">
                        {computed.asistenciaHasData && computed.asistenciaPct !== null ? (
                          <>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              {computed.asistenciaPoints.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-500 tabular-nums">
                              {computed.asistenciaPct}%
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-400">—</span>
                            <span className="block text-[10px] text-slate-400 font-sans">
                              Sin datos
                            </span>
                          </>
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-center font-mono text-xs text-slate-700 tabular-nums"
                        title={gradeDoc?.aiConductReason || 'Calculado automáticamente de bitácora'}
                      >
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {computed.conductaPoints.toFixed(2)}
                        </span>
                        <span className="block text-[10px] text-emerald-700 tabular-nums">
                          Base {computed.conductBase10}/10
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-base font-bold text-slate-900 tabular-nums">
                        <span>{computed.finalGrade}</span>
                        {computed.isPartial && !gradeDoc?.hasManualFinalGrade && (
                          <span className="block text-[10px] font-medium text-amber-700 font-sans">
                            Cálculo parcial
                          </span>
                        )}
                        {computed.hasAnyManualOverride && (
                          <span className="block text-[10px] font-normal text-blue-700 font-sans">
                            Ajustado
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openStudentModal(st)}
                            title="Ajustes manuales y comentario"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md whitespace-nowrap"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              exportSingleReportCardDocx(
                                classroom,
                                effectivePeriodConfig,
                                st,
                                gradeDoc,
                                assignments,
                                attendanceDays,
                                incidents
                              )
                            }
                            title="Descargar boleta en Word (.docx)"
                            className="p-1.5 text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => triggerPrintSingle(st.id)}
                            title="Imprimir boleta"
                            className="p-1.5 text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-md"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Override & Comment Modal */}
      {editingStudent && modalDraft && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4 mb-5">
              <div>
                <p className="text-xs text-slate-500">
                  {selectedPeriodName} · Ajustes manuales (base 10) y comentario de boleta
                </p>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  {editingStudent.listNumber}. {editingStudent.fullName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingStudent(null);
                  setModalDraft(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentModal} className="space-y-4">
              {modalDraft.aiConductReason && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
                  <strong>Justificación IA de Conducta:</strong> {modalDraft.aiConductReason}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Trabajos en clase (0–10)</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={modalDraft.hasManualTrabajosScore}
                        onChange={(e) =>
                          setModalDraft((p) =>
                            p ? { ...p, hasManualTrabajosScore: e.target.checked } : p
                          )
                        }
                      />
                      Manual
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={10}
                    disabled={!modalDraft.hasManualTrabajosScore}
                    value={modalDraft.manualTrabajosScore}
                    onChange={(e) =>
                      setModalDraft((p) =>
                        p ? { ...p, manualTrabajosScore: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Tareas (0–10)</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={modalDraft.hasManualTareasScore}
                        onChange={(e) =>
                          setModalDraft((p) =>
                            p ? { ...p, hasManualTareasScore: e.target.checked } : p
                          )
                        }
                      />
                      Manual
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={10}
                    disabled={!modalDraft.hasManualTareasScore}
                    value={modalDraft.manualTareasScore}
                    onChange={(e) =>
                      setModalDraft((p) =>
                        p ? { ...p, manualTareasScore: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Examen / Proyecto (0–10)</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={modalDraft.hasManualExamenScore}
                        onChange={(e) =>
                          setModalDraft((p) =>
                            p ? { ...p, hasManualExamenScore: e.target.checked } : p
                          )
                        }
                      />
                      Manual
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={10}
                    disabled={!modalDraft.hasManualExamenScore}
                    value={modalDraft.manualExamenScore}
                    onChange={(e) =>
                      setModalDraft((p) =>
                        p ? { ...p, manualExamenScore: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">Conducta (0–10)</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={modalDraft.hasManualConductScore}
                        onChange={(e) =>
                          setModalDraft((p) =>
                            p ? { ...p, hasManualConductScore: e.target.checked } : p
                          )
                        }
                      />
                      Manual
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={10}
                    disabled={!modalDraft.hasManualConductScore}
                    value={modalDraft.manualConductScore}
                    onChange={(e) =>
                      setModalDraft((p) =>
                        p ? { ...p, manualConductScore: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="sm:col-span-2 border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">
                      Calificación final directa (0–{configForm.scaleMax})
                    </span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={modalDraft.hasManualFinalGrade}
                        onChange={(e) =>
                          setModalDraft((p) =>
                            p ? { ...p, hasManualFinalGrade: e.target.checked } : p
                          )
                        }
                      />
                      Sobrescribir final
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={configForm.scaleMax}
                    disabled={!modalDraft.hasManualFinalGrade}
                    value={modalDraft.manualFinalGrade}
                    onChange={(e) =>
                      setModalDraft((p) =>
                        p ? { ...p, manualFinalGrade: Number(e.target.value) || 0 } : p
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-800">
                    Comentario personalizado del docente
                  </label>
                  <button
                    type="button"
                    disabled={draftingComment}
                    onClick={handleDraftCommentWithAI}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {draftingComment ? 'Redactando...' : 'Sugerir con IA'}
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={modalDraft.customComment}
                  onChange={(e) =>
                    setModalDraft((p) =>
                      p ? { ...p, customComment: e.target.value } : p
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() =>
                    setModalDraft((p) =>
                      p
                        ? {
                            ...p,
                            hasManualTrabajosScore: false,
                            hasManualTareasScore: false,
                            hasManualExamenScore: false,
                            hasManualAsistenciaScore: false,
                            hasManualConductScore: false,
                            hasManualFinalGrade: false,
                          }
                        : p
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restaurar cálculo automático
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStudent(null);
                      setModalDraft(null);
                    }}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingStudentGrade}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                  >
                    {savingStudentGrade ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Conduct Confirmation Modal */}
      {showAiConfirmModal && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Confirmar evaluación de conducta con IA
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {manualOrCommentedCount > 0
                    ? `Hay ${manualOrCommentedCount} alumno(s) con calificación u observación de conducta registrada en ${selectedPeriodName}. Elige cómo deseas proceder para evitar perder ediciones manuales.`
                    : `Se calculará la calificación base 10 de conducta y sugerencia de observación para todo el grupo en ${selectedPeriodName}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAiConfirmModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleEvaluateConductWithAI('only_empty')}
                className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg text-left"
              >
                Solo alumnos sin observación
                <span className="block text-[11px] font-normal text-blue-100">
                  Conserva ajustes manuales y comentarios que ya hayas redactado.
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleEvaluateConductWithAI('overwrite_all')}
                className="w-full px-4 py-2.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg text-left"
              >
                Sobrescribir todo
                <span className="block text-[11px] font-normal text-amber-800">
                  Recalcula conducta y reemplaza observaciones para todo el grupo.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowAiConfirmModal(false)}
                className="w-full px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Report Cards */}
      {printMode !== 'none' && studentsToPrint.length > 0 && (
        <div className="hidden print-only">
          {studentsToPrint.map((st, idx) => {
            const gradeDoc = getStudentGradeDoc(st.id);
            const computed = computeStudentTrimesterGrade(
              st.id,
              effectivePeriodConfig,
              gradeDoc,
              assignments,
              attendanceDays,
              incidents
            );
            const att = computeAttendanceStats(st.id, attendanceDays, selectedPeriodName);
            return (
              <div
                key={st.id}
                className={`space-y-4 ${
                  idx < studentsToPrint.length - 1 ? 'print-page-break' : ''
                }`}
              >
                <div className="border-b-2 border-slate-900 pb-3 flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase text-slate-600">{classroom.schoolName}</p>
                    <h1 className="font-display text-xl font-bold text-slate-900">
                      Boleta e Informe Trimestral — {selectedPeriodName}
                    </h1>
                  </div>
                  <div className="text-right text-xs font-mono">
                    <p>Grupo: {classroom.name}</p>
                    <p>Ciclo: {classroom.cycle}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs border border-slate-300 rounded-lg p-3 bg-slate-50">
                  <p><strong>Alumno(a):</strong> {st.fullName}</p>
                  <p><strong>No. Lista:</strong> {st.listNumber}</p>
                  <p><strong>Tutor:</strong> {st.guardianName || 'N/A'}</p>
                  <p><strong>Docente:</strong> {classroom.teacherName}</p>
                </div>
                <table className="w-full text-left border border-slate-300 border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className="py-2 px-3">Rubro</th>
                      <th className="py-2 px-3">Detalle</th>
                      <th className="py-2 px-3 text-right font-mono">Máx</th>
                      <th className="py-2 px-3 text-right font-mono">Obtenido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="py-2 px-3 font-medium">Trabajos en clase ({configForm.trabajosWeight}%)</td>
                      <td className="py-2 px-3 font-mono">
                        {computed.trabajosHasData && computed.trabajosAvg10 !== null
                          ? `${computed.trabajosReviewedCount}/${computed.trabajosCount} rev. (Prom. ${computed.trabajosAvg10})`
                          : 'Sin actividades registradas'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{computed.maxTrabajosPoints.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {computed.trabajosHasData ? computed.trabajosPoints.toFixed(2) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">Tareas ({configForm.tareasWeight}%)</td>
                      <td className="py-2 px-3 font-mono">
                        {computed.tareasHasData && computed.tareasAvg10 !== null
                          ? `${computed.tareasReviewedCount}/${computed.tareasCount} ent. (Prom. ${computed.tareasAvg10})`
                          : 'Sin actividades registradas'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{computed.maxTareasPoints.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {computed.tareasHasData ? computed.tareasPoints.toFixed(2) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">Exámenes / Proyectos ({configForm.examenWeight}%)</td>
                      <td className="py-2 px-3 font-mono">
                        {computed.examenHasData && computed.examenAvg10 !== null
                          ? `Promedio ${computed.examenAvg10}/10`
                          : 'Sin exámenes registrados'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{computed.maxExamenPoints.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {computed.examenHasData ? computed.examenPoints.toFixed(2) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">Asistencia ({configForm.asistenciaWeight}%)</td>
                      <td className="py-2 px-3 font-mono">
                        {computed.asistenciaHasData && computed.asistenciaPct !== null
                          ? `${computed.asistenciaPct}% (${att.presentes}P · ${att.retardos}R · ${att.faltas}F)`
                          : 'Sin pases de lista registrados'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{computed.maxAsistenciaPoints.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {computed.asistenciaHasData ? computed.asistenciaPoints.toFixed(2) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">Conducta ({configForm.conductaWeight}%)</td>
                      <td className="py-2 px-3">Base {computed.conductBase10}/10 {gradeDoc?.aiConductReason ? `· ${gradeDoc.aiConductReason}` : ''}</td>
                      <td className="py-2 px-3 text-right font-mono">{computed.maxConductaPoints.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">{computed.conductaPoints.toFixed(2)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-900 font-bold">
                      <td colSpan={2} className="py-2 px-3 text-sm">
                        Calificación Final {computed.isPartial && !gradeDoc?.hasManualFinalGrade ? '(Cálculo parcial)' : ''}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-sm">{configForm.scaleMax}</td>
                      <td className="py-2 px-3 text-right font-mono text-base">{computed.finalGrade}</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="text-xs border border-slate-300 rounded-lg p-3">
                  <p className="font-semibold mb-1">Observaciones del docente:</p>
                  <p>{gradeDoc?.customComment || 'Sin observaciones adicionales.'}</p>
                </div>
                <div className="pt-10 grid grid-cols-3 gap-6 text-center text-xs">
                  <div className="border-t border-slate-800 pt-2">{classroom.teacherName} (Docente)</div>
                  <div className="border-t border-slate-800 pt-2">Dirección Escolar</div>
                  <div className="border-t border-slate-800 pt-2">Padre / Tutor</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
