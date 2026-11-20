import { useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Check,
  CheckCheck,
  FileDown,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import { exportAssignmentsDocx } from '../lib/docxExport';
import { computeCategoryAverage10 } from '../lib/grading';
import type {
  Assignment,
  AssignmentCategory,
  Classroom,
  FormativeField,
  LocalDatabase,
  Student,
  SubmissionStatus,
  TrimesterPeriod,
} from '../types';

interface AssignmentsViewProps {
  classroom: Classroom;
  students: Student[];
  assignments: Assignment[];
  onDbUpdate: (db: LocalDatabase) => void;
}

const PERIOD_OPTIONS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

const TYPE_LABELS: Record<AssignmentCategory, string> = {
  trabajo: 'Trabajos en clase',
  tarea: 'Tareas',
  examen: 'Exámenes / Proyectos',
};

const FORMATIVE_FIELD_OPTIONS: Array<{
  value: FormativeField;
  label: string;
  shortLabel: string;
  badgeClass: string;
}> = [
  {
    value: 'general',
    label: 'General / Sin especificar',
    shortLabel: 'General',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  {
    value: 'lenguajes',
    label: 'Lenguajes',
    shortLabel: 'Lenguajes',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    value: 'saberes',
    label: 'Saberes y Pensamiento Científico',
    shortLabel: 'Saberes y Pens. Cient.',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    value: 'etica',
    label: 'Ética, Naturaleza y Sociedades',
    shortLabel: 'Ética, Nat. y Soc.',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    value: 'humano',
    label: 'De lo Humano y lo Comunitario',
    shortLabel: 'Humano y Comunitario',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
];

function getFieldMeta(field?: FormativeField) {
  return (
    FORMATIVE_FIELD_OPTIONS.find((f) => f.value === (field || 'general')) ||
    FORMATIVE_FIELD_OPTIONS[0]
  );
}

export function AssignmentsView({
  classroom,
  students,
  assignments,
  onDbUpdate,
}: AssignmentsViewProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TrimesterPeriod>(
    classroom.activePeriod || 'Trimestre 1'
  );
  const [typeFilter, setTypeFilter] = useState<'todos' | AssignmentCategory>('todos');
  const [fieldFilter, setFieldFilter] = useState<'todos' | FormativeField>('todos');
  const [showNewModal, setShowNewModal] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<AssignmentCategory>('trabajo');
  const [newFormativeField, setNewFormativeField] = useState<FormativeField>('general');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newMaxScore, setNewMaxScore] = useState<number>(10);
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.listNumber - b.listNumber),
    [students]
  );

  const periodAssignments = useMemo(() => {
    return assignments
      .filter((a) => a.period === selectedPeriod)
      .filter((a) => (typeFilter === 'todos' ? true : a.type === typeFilter))
      .filter((a) =>
        fieldFilter === 'todos'
          ? true
          : (a.formativeField || 'general') === fieldFilter
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [assignments, selectedPeriod, typeFilter, fieldFilter]);

  const allPeriodAssignments = useMemo(
    () => assignments.filter((a) => a.period === selectedPeriod),
    [assignments, selectedPeriod]
  );

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    const initialSubs: Record<string, SubmissionStatus> = {};
    const initialScores: Record<string, number | null> = {};
    sortedStudents.forEach((s) => {
      initialSubs[s.id] = 'no_entregado';
      initialScores[s.id] = null;
    });
    try {
      const { db } = await localApi.createAssignment({
        classroomId: classroom.id,
        period: selectedPeriod,
        title: newTitle.trim(),
        type: newType,
        formativeField: newFormativeField,
        dueDate: newDate,
        description: newDesc.trim(),
        maxScore: Math.max(1, Number(newMaxScore) || 10),
        submissions: initialSubs,
        scores: initialScores,
      });
      onDbUpdate(db);
      setNewTitle('');
      setNewDesc('');
      setNewFormativeField('general');
      setShowNewModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCycleStatus = async (assignment: Assignment, studentId: string) => {
    const current = assignment.submissions?.[studentId] || 'no_entregado';
    const next: SubmissionStatus =
      current === 'no_entregado'
        ? 'revisado'
        : current === 'revisado'
        ? 'incompleto'
        : 'no_entregado';

    const nextScores = { ...(assignment.scores || {}) };
    const maxS = assignment.maxScore || 10;
    if (next === 'revisado' && (nextScores[studentId] === null || nextScores[studentId] === undefined)) {
      nextScores[studentId] = maxS;
    } else if (next === 'no_entregado') {
      nextScores[studentId] = 0;
    }

    const { db } = await localApi.updateAssignment(assignment.id, {
      submissions: {
        ...assignment.submissions,
        [studentId]: next,
      },
      scores: nextScores,
    });
    onDbUpdate(db);
  };

  const handleScoreChange = async (
    assignment: Assignment,
    studentId: string,
    rawVal: string
  ) => {
    const maxS = assignment.maxScore || 10;
    const numeric = rawVal.trim() === '' ? null : Math.max(0, Math.min(maxS, Number(rawVal) || 0));
    const nextStatus: SubmissionStatus =
      numeric === null
        ? assignment.submissions?.[studentId] || 'no_entregado'
        : numeric >= maxS * 0.7
        ? 'revisado'
        : numeric > 0
        ? 'incompleto'
        : 'no_entregado';

    const { db } = await localApi.updateAssignment(assignment.id, {
      submissions: {
        ...assignment.submissions,
        [studentId]: nextStatus,
      },
      scores: {
        ...(assignment.scores || {}),
        [studentId]: numeric,
      },
    });
    onDbUpdate(db);
  };

  const handleMarkColumnAllReviewed = async (assignment: Assignment) => {
    const updatedSubs: Record<string, SubmissionStatus> = { ...assignment.submissions };
    const updatedScores: Record<string, number | null> = { ...(assignment.scores || {}) };
    const maxS = assignment.maxScore || 10;
    sortedStudents.forEach((s) => {
      updatedSubs[s.id] = 'revisado';
      updatedScores[s.id] = maxS;
    });
    const { db } = await localApi.updateAssignment(assignment.id, {
      submissions: updatedSubs,
      scores: updatedScores,
    });
    onDbUpdate(db);
  };

  const handleDeleteAssignment = async (assignment: Assignment) => {
    const { db } = await localApi.deleteAssignment(assignment.id);
    onDbUpdate(db);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Sincronizado con Calificaciones · {allPeriodAssignments.length} actividades en{' '}
            {selectedPeriod}
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Trabajos en clase, tareas y exámenes
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={sortedStudents.length === 0}
            onClick={() =>
              exportAssignmentsDocx(
                classroom,
                selectedPeriod,
                sortedStudents,
                assignments,
                fieldFilter
              )
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <FileDown className="w-4 h-4 text-blue-700" />
            Concentrado Word (.docx)
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nueva actividad
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedPeriod === p
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['todos', 'trabajo', 'tarea', 'examen'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    typeFilter === t
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t === 'todos' ? 'Todos los rubros' : TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <span>Campo Formativo (SEP):</span>
              <select
                value={fieldFilter}
                onChange={(e) => setFieldFilter(e.target.value as 'todos' | FormativeField)}
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-900"
              >
                <option value="todos">Todos los campos</option>
                {FORMATIVE_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-xs text-slate-600 flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <Check className="w-3.5 h-3.5" /> Revisado
              </span>
              <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                <Minus className="w-3.5 h-3.5" /> Incompleto
              </span>
              <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                <X className="w-3.5 h-3.5" /> Pendiente
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {sortedStudents.length === 0 ? (
          <div className="p-12 text-center">
            <BookOpenCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600">
              Agrega estudiantes en Lista y Asistencia para registrar calificaciones rápidas.
            </p>
          </div>
        ) : periodAssignments.length === 0 ? (
          <div className="p-12 text-center">
            <BookOpenCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Sin actividades en este filtro ({selectedPeriod})
            </h2>
            <p className="text-sm text-slate-500 mt-1 mb-4">
              Crea trabajos en clase, tareas o exámenes/proyectos; los promedios alimentarán automáticamente la boleta trimestral.
            </p>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
            >
              Crear primera actividad
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <th className="py-3 px-4 w-12 font-mono">#</th>
                  <th className="py-3 px-4 min-w-[200px]">Estudiante</th>
                  <th className="py-3 px-3 text-center font-semibold text-blue-800 bg-blue-50/40 whitespace-nowrap">
                    Prom. Trab / Tar / Exam
                  </th>
                  {periodAssignments.map((asg) => {
                    const fieldMeta = getFieldMeta(asg.formativeField);
                    return (
                      <th key={asg.id} className="py-2.5 px-3 min-w-[175px] border-l border-slate-200 align-top">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <p className="font-semibold text-slate-900 truncate max-w-[130px]" title={asg.title}>
                              {asg.title}
                            </p>
                            <p className="text-[11px] text-slate-500 font-normal">
                              {TYPE_LABELS[asg.type]} · <span className="font-mono">{asg.dueDate}</span>
                            </p>
                            <span
                              title={fieldMeta.label}
                              className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${fieldMeta.badgeClass}`}
                            >
                              {fieldMeta.shortLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title="Calificar todos con 10 y Revisado"
                              onClick={() => handleMarkColumnAllReviewed(asg)}
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
                            >
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Eliminar actividad"
                              onClick={() => handleDeleteAssignment(asg)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {sortedStudents.map((student) => {
                  const trStats = computeCategoryAverage10(
                    student.id,
                    assignments,
                    selectedPeriod,
                    'trabajo'
                  );
                  const taStats = computeCategoryAverage10(
                    student.id,
                    assignments,
                    selectedPeriod,
                    'tarea'
                  );
                  const exStats = computeCategoryAverage10(
                    student.id,
                    assignments,
                    selectedPeriod,
                    'examen'
                  );
                  return (
                    <tr key={student.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {String(student.listNumber).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {student.fullName}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-xs text-blue-900 bg-blue-50/20 tabular-nums whitespace-nowrap">
                        {trStats.total > 0 && trStats.avg10 !== null ? trStats.avg10.toFixed(1) : '—'} /{' '}
                        {taStats.total > 0 && taStats.avg10 !== null ? taStats.avg10.toFixed(1) : '—'} /{' '}
                        {exStats.total > 0 && exStats.avg10 !== null ? exStats.avg10.toFixed(1) : '—'}
                      </td>
                      {periodAssignments.map((asg) => {
                        const status = asg.submissions?.[student.id] || 'no_entregado';
                        const scoreVal = asg.scores?.[student.id];
                        return (
                          <td
                            key={asg.id}
                            className="py-2 px-3 border-l border-slate-100"
                          >
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCycleStatus(asg, student.id)}
                                title="Clic para cambiar estado"
                                className={`flex-1 py-1 px-2 rounded-md border text-xs font-medium inline-flex items-center justify-center gap-1 transition-colors ${
                                  status === 'revisado'
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : status === 'incompleto'
                                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                                    : 'bg-white border-slate-200 text-slate-500'
                                }`}
                              >
                                {status === 'revisado' ? (
                                  <Check className="w-3 h-3" />
                                ) : status === 'incompleto' ? (
                                  <Minus className="w-3 h-3" />
                                ) : (
                                  <X className="w-3 h-3" />
                                )}
                                <span>
                                  {status === 'revisado'
                                    ? 'Rev.'
                                    : status === 'incompleto'
                                    ? 'Inc.'
                                    : 'Pend.'}
                                </span>
                              </button>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={asg.maxScore || 10}
                                placeholder={String(asg.maxScore || 10)}
                                value={scoreVal === null || scoreVal === undefined ? '' : scoreVal}
                                onChange={(e) =>
                                  handleScoreChange(asg, student.id, e.target.value)
                                }
                                title={`Calificación numérica (0 - ${asg.maxScore || 10})`}
                                className="w-14 px-1.5 py-1 text-xs font-mono text-right border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Assignment Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Nueva actividad ({selectedPeriod})
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAssignment} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Título de la actividad
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Cuaderno Matemáticas: Fracciones"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Rubro de evaluación
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as AssignmentCategory)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="trabajo">Trabajos en clase</option>
                    <option value="tarea">Tareas</option>
                    <option value="examen">Exámenes / Proyectos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Escala máx.
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newMaxScore}
                    onChange={(e) => setNewMaxScore(Number(e.target.value) || 10)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Campo Formativo (Nueva Escuela Mexicana - SEP)
                </label>
                <select
                  value={newFormativeField}
                  onChange={(e) => setNewFormativeField(e.target.value as FormativeField)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {FORMATIVE_FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fecha
                </label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Descripción breve (opcional)
                </label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  {saving ? 'Guardando...' : 'Crear actividad'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
