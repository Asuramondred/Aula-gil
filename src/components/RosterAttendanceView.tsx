import { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  FileDown,
  FolderOpen,
  ListPlus,
  Printer,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import { exportAttendanceRosterDocx } from '../lib/docxExport';
import { computeAttendanceStats } from '../lib/grading';
import type {
  AttendanceDay,
  AttendanceStatus,
  Classroom,
  LocalDatabase,
  Student,
  TrimesterPeriod,
} from '../types';

interface RosterAttendanceViewProps {
  classroom: Classroom;
  students: Student[];
  attendanceDays: AttendanceDay[];
  onDbUpdate: (db: LocalDatabase) => void;
  onOpenDossier: (studentId: string) => void;
}

const TRIMESTERS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

const STATUS_OPTIONS: Array<{
  value: AttendanceStatus;
  label: string;
  shortLabel: string;
  activeClass: string;
}> = [
  {
    value: 'presente',
    label: 'Presente',
    shortLabel: 'P',
    activeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold',
  },
  {
    value: 'retardo',
    label: 'Retardo',
    shortLabel: 'R',
    activeClass: 'bg-amber-50 text-amber-800 border-amber-300 font-semibold',
  },
  {
    value: 'falta',
    label: 'Falta',
    shortLabel: 'F',
    activeClass: 'bg-red-50 text-red-800 border-red-300 font-semibold',
  },
  {
    value: 'justificada',
    label: 'Justificado',
    shortLabel: 'J',
    activeClass: 'bg-blue-50 text-blue-800 border-blue-300 font-semibold',
  },
];

export function RosterAttendanceView({
  classroom,
  students,
  attendanceDays,
  onDbUpdate,
  onOpenDossier,
}: RosterAttendanceViewProps) {
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [selectedPeriod, setSelectedPeriod] = useState<TrimesterPeriod>(
    classroom.activePeriod || 'Trimestre 1'
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | AttendanceStatus>('todos');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [listNumber, setListNumber] = useState<number>(students.length + 1);
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [curp, setCurp] = useState('');
  const [bulkText, setBulkText] = useState('');

  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => a.listNumber - b.listNumber || a.fullName.localeCompare(b.fullName)
      ),
    [students]
  );

  const currentDay = attendanceDays.find((d) => d.date === selectedDate);
  const records = currentDay?.records ?? {};
  const effectivePeriodForDay = currentDay?.period || selectedPeriod;

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedStudents
      .filter((s) => {
        if (!q) return true;
        return (
          s.fullName.toLowerCase().includes(q) ||
          String(s.listNumber).includes(q) ||
          s.guardianName.toLowerCase().includes(q)
        );
      })
      .filter((s) => {
        if (statusFilter === 'todos') return true;
        return records[s.id] === statusFilter;
      });
  }, [sortedStudents, search, statusFilter, records]);

  const daySummary = useMemo(() => {
    let presentes = 0;
    let retardos = 0;
    let faltas = 0;
    let justificadas = 0;
    sortedStudents.forEach((s) => {
      const st = records[s.id];
      if (st === 'presente') presentes += 1;
      else if (st === 'retardo') retardos += 1;
      else if (st === 'falta') faltas += 1;
      else if (st === 'justificada') justificadas += 1;
    });
    return { presentes, retardos, faltas, justificadas };
  }, [sortedStudents, records]);

  const handleSetAttendance = async (studentId: string, status: AttendanceStatus) => {
    const nextRecords: Record<string, AttendanceStatus> = {
      ...records,
      [studentId]: status,
    };
    const { db } = await localApi.saveAttendance({
      classroomId: classroom.id,
      date: selectedDate,
      period: effectivePeriodForDay,
      records: nextRecords,
    });
    onDbUpdate(db);
  };

  const handleMarkAllPresent = async () => {
    if (sortedStudents.length === 0) return;
    const nextRecords: Record<string, AttendanceStatus> = {};
    sortedStudents.forEach((s) => {
      nextRecords[s.id] = 'presente';
    });
    const { db } = await localApi.saveAttendance({
      classroomId: classroom.id,
      date: selectedDate,
      period: effectivePeriodForDay,
      records: nextRecords,
    });
    onDbUpdate(db);
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      const { db } = await localApi.createStudent({
        classroomId: classroom.id,
        listNumber: Math.max(1, Math.round(Number(listNumber) || students.length + 1)),
        fullName: fullName.trim(),
        curp: curp.trim(),
        guardianName: guardianName.trim(),
        guardianPhone: guardianPhone.trim(),
      });
      onDbUpdate(db);
      setFullName('');
      setGuardianName('');
      setGuardianPhone('');
      setCurp('');
      setListNumber(students.length + 2);
      setShowAddModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setSaving(true);
    try {
      const { db } = await localApi.bulkCreateStudents(classroom.id, lines);
      onDbUpdate(db);
      setBulkText('');
      setShowBulkModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    const { db } = await localApi.deleteStudent(student.id);
    onDbUpdate(db);
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Grupo {classroom.name} · {students.length} estudiantes · Vinculado al rubro Asistencia
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Lista de estudiantes y pase de lista
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={sortedStudents.length === 0}
            onClick={() =>
              exportAttendanceRosterDocx(
                classroom,
                sortedStudents,
                attendanceDays,
                selectedDate,
                selectedPeriod
              )
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <FileDown className="w-4 h-4 text-blue-700" />
            Word (.docx)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>
          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <ListPlus className="w-4 h-4" />
            Importar lista
          </button>
          <button
            type="button"
            onClick={() => {
              setListNumber(students.length + 1);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            Agregar alumno
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {TRIMESTERS.map((p) => (
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

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <span>Fecha:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-slate-50 text-slate-900"
            />
          </label>

          <button
            type="button"
            onClick={handleMarkAllPresent}
            disabled={sortedStudents.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <Check className="w-3.5 h-3.5" />
            Todos presentes
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === 'presente' ? 'todos' : 'presente'))
              }
              title="Filtrar presentes"
              className={`px-2.5 py-1 rounded-md border transition-colors font-semibold ${
                statusFilter === 'presente'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-white text-emerald-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {daySummary.presentes} P
            </button>
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === 'retardo' ? 'todos' : 'retardo'))
              }
              title="Filtrar retardos"
              className={`px-2.5 py-1 rounded-md border transition-colors font-semibold ${
                statusFilter === 'retardo'
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-white text-amber-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {daySummary.retardos} R
            </button>
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === 'falta' ? 'todos' : 'falta'))
              }
              title="Filtrar faltas"
              className={`px-2.5 py-1 rounded-md border transition-colors font-semibold ${
                statusFilter === 'falta'
                  ? 'bg-red-50 text-red-800 border-red-300'
                  : 'bg-white text-red-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {daySummary.faltas} F
            </button>
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) =>
                  prev === 'justificada' ? 'todos' : 'justificada'
                )
              }
              title="Filtrar justificados"
              className={`px-2.5 py-1 rounded-md border transition-colors font-semibold ${
                statusFilter === 'justificada'
                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                  : 'bg-white text-blue-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {daySummary.justificadas} J
            </button>
            {statusFilter !== 'todos' && (
              <button
                type="button"
                onClick={() => setStatusFilter('todos')}
                className="px-2.5 py-1 rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
              >
                Ver todos
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar alumno o tutor..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 w-52"
            />
          </div>
        </div>
      </div>

      {/* Print Header */}
      <div className="hidden print-only mb-4 border-b-2 border-slate-900 pb-3">
        <p className="text-xs uppercase tracking-wider text-slate-600">
          {classroom.schoolName || 'Escuela Primaria'}
        </p>
        <h1 className="font-display text-xl font-bold text-slate-900">
          Lista Oficial y Control de Asistencia — {classroom.name} ({selectedPeriod})
        </h1>
        <p className="text-xs text-slate-700 mt-1">
          Docente: {classroom.teacherName} · Ciclo: {classroom.cycle} · Fecha: {selectedDate}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print-container">
        {sortedStudents.length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Aún no hay alumnos en este grupo
            </h2>
            <p className="text-sm text-slate-500 mt-1 mb-5 max-w-md mx-auto">
              Agrega a tus estudiantes uno por uno o pega tu lista completa de nombres.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowBulkModal(true)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                Importar varios nombres
              </button>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                Agregar primer alumno
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-12 font-mono">#</th>
                  <th className="py-3 px-4">Nombre del estudiante</th>
                  <th className="py-3 px-4">Asistencia ({selectedDate})</th>
                  <th className="py-3 px-4 text-right tabular-nums">
                    % {selectedPeriod}
                  </th>
                  <th className="py-3 px-4 text-right tabular-nums hidden md:table-cell">
                    % Global (P/R/F)
                  </th>
                  <th className="no-print py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map((student) => {
                  const status = records[student.id];
                  const trimStats = computeAttendanceStats(
                    student.id,
                    attendanceDays,
                    selectedPeriod
                  );
                  const globalStats = computeAttendanceStats(student.id, attendanceDays);
                  return (
                    <tr key={student.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {String(student.listNumber).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{student.fullName}</p>
                        {student.guardianName && (
                          <p className="text-xs text-slate-500">
                            Tutor: {student.guardianName}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="no-print flex items-center gap-1">
                          {STATUS_OPTIONS.map((opt) => {
                            const isActive = status === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                title={opt.label}
                                onClick={() => handleSetAttendance(student.id, opt.value)}
                                className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                                  isActive
                                    ? opt.activeClass
                                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
                                }`}
                              >
                                <span className="hidden xl:inline">{opt.label}</span>
                                <span className="xl:hidden">{opt.shortLabel}</span>
                              </button>
                            );
                          })}
                        </div>
                        <span className="hidden print-only text-xs font-medium text-slate-800">
                          {STATUS_OPTIONS.find((o) => o.value === status)?.label || 'Sin registrar'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                        <span
                          className={`font-semibold ${
                            trimStats.percentage === null
                              ? 'text-slate-400'
                              : trimStats.percentage >= 90
                              ? 'text-emerald-700'
                              : trimStats.percentage >= 80
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {trimStats.percentage !== null ? `${trimStats.percentage}%` : '—'}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {trimStats.totalDays} días
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums hidden md:table-cell">
                        {globalStats.percentage !== null ? `${globalStats.percentage}%` : '—'} (
                        {globalStats.presentes}/{globalStats.retardos}/{globalStats.faltas})
                      </td>
                      <td className="no-print py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenDossier(student.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded-md whitespace-nowrap"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Expediente
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStudent(student)}
                            title="Eliminar alumno"
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Agregar estudiante
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    No. Lista
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    required
                    value={listNumber}
                    onChange={(e) => setListNumber(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Apellidos y nombre(s)"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  CURP o matrícula (opcional)
                </label>
                <input
                  type="text"
                  value={curp}
                  onChange={(e) => setCurp(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre del padre / tutor
                  </label>
                  <input
                    type="text"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Teléfono de contacto
                  </label>
                  <input
                    type="text"
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  {saving ? 'Guardando...' : 'Guardar alumno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Importar lista de alumnos
              </h2>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Pega un nombre por renglón (puedes copiarlo directo desde Excel o Word).
            </p>
            <form onSubmit={handleBulkImport} className="space-y-4">
              <textarea
                rows={8}
                required
                placeholder={'Pérez López Sofía\nGarcía Hernández Mateo\nRamírez Torres Valentina'}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Asignación automática de número de lista
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBulkModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                  >
                    {saving ? 'Importando...' : 'Importar lista'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
