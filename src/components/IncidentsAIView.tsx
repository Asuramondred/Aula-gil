import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  FileCheck2,
  FileDown,
  Plus,
  Printer,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { formatAiUsageNotice, localApi } from '../lib/api';
import { exportIncidentReportDocx } from '../lib/docxExport';
import { computeAutoConductBase10 } from '../lib/grading';
import type {
  Classroom,
  Incident,
  IncidentCategory,
  IncidentSeverity,
  LocalDatabase,
  Student,
  TrimesterPeriod,
} from '../types';

interface IncidentsAIViewProps {
  classroom: Classroom;
  students: Student[];
  incidents: Incident[];
  onDbUpdate: (db: LocalDatabase) => void;
}

const TRIMESTERS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  convivencia: 'Convivencia escolar',
  disciplina: 'Disciplina en aula',
  cumplimiento: 'Cumplimiento / Materiales',
  asistencia: 'Puntualidad / Asistencia',
  reconocimiento: 'Mérito / Reconocimiento positivo',
};

const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  positiva: 'Mérito positivo (+)',
  leve: 'Incidencia leve (-0.5)',
  moderada: 'Incidencia moderada (-1.2)',
  grave: 'Incidencia grave (-2.5)',
};

type PrintTarget = 'none' | 'parents' | 'direction' | 'both';

export function IncidentsAIView({
  classroom,
  students,
  incidents,
  onDbUpdate,
}: IncidentsAIViewProps) {
  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.listNumber - b.listNumber),
    [students]
  );
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const [selectedPeriod, setSelectedPeriod] = useState<TrimesterPeriod>(
    classroom.activePeriod || 'Trimestre 1'
  );
  const [filterStudentId, setFilterStudentId] = useState<string>('todos');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [showNewModal, setShowNewModal] = useState(false);

  // New incident form
  const [formStudentId, setFormStudentId] = useState<string>(sortedStudents[0]?.id || '');
  const [formPeriod, setFormPeriod] = useState<TrimesterPeriod>(selectedPeriod);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formCategory, setFormCategory] = useState<IncidentCategory>('convivencia');
  const [formSeverity, setFormSeverity] = useState<IncidentSeverity>('leve');
  const [formDescription, setFormDescription] = useState('');
  const [formActionTaken, setFormActionTaken] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  const filteredIncidents = useMemo(() => {
    return [...incidents]
      .filter((inc) => inc.period === selectedPeriod)
      .filter((inc) =>
        filterStudentId === 'todos' ? true : inc.studentId === filterStudentId
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [incidents, selectedPeriod, filterStudentId]);

  const activeIncident = useMemo(() => {
    const found = filteredIncidents.find((i) => i.id === selectedIncidentId);
    return found || filteredIncidents[0];
  }, [filteredIncidents, selectedIncidentId]);

  const [draftParents, setDraftParents] = useState<string>('');
  const [draftDirection, setDraftDirection] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [savingReports, setSavingReports] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [printTarget, setPrintTarget] = useState<PrintTarget>('none');

  useEffect(() => {
    if (activeIncident) {
      setDraftParents(activeIncident.aiReportParents || '');
      setDraftDirection(activeIncident.aiReportDirection || '');
      setAiError('');
      setSavedNotice('');
    }
  }, [activeIncident?.id]);

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetStudentId = formStudentId || sortedStudents[0]?.id;
    if (!targetStudentId || !formDescription.trim()) return;
    setSavingNew(true);
    try {
      const { incidentId, db } = await localApi.createIncident({
        classroomId: classroom.id,
        studentId: targetStudentId,
        period: formPeriod,
        date: formDate,
        category: formCategory,
        severity: formSeverity,
        description: formDescription.trim(),
        actionTaken: formActionTaken.trim(),
      });
      onDbUpdate(db);
      setSelectedPeriod(formPeriod);
      setSelectedIncidentId(incidentId);
      setFormDescription('');
      setFormActionTaken('');
      setShowNewModal(false);
    } finally {
      setSavingNew(false);
    }
  };

  const handleGenerateAiReports = async (incident: Incident) => {
    const student = studentMap.get(incident.studentId);
    if (!student) return;
    setAiLoading(true);
    setAiError('');
    setSavedNotice('');

    const recentSummary = incidents
      .filter((i) => i.studentId === incident.studentId && i.id !== incident.id)
      .slice(0, 4)
      .map((i) => `${i.date} (${SEVERITY_LABELS[i.severity]}): ${i.description}`)
      .join('\n');

    try {
      const data = await localApi.generateBehaviorReport({
        studentName: student.fullName,
        groupName: classroom.name,
        schoolName: classroom.schoolName,
        teacherName: classroom.teacherName,
        guardianName: student.guardianName,
        incidentDate: incident.date,
        category: CATEGORY_LABELS[incident.category],
        severity: SEVERITY_LABELS[incident.severity],
        description: incident.description,
        actionTaken: incident.actionTaken,
        recentIncidentsSummary: recentSummary,
      });

      const parentsText = [
        data.parentReport,
        data.suggestedAgreements ? `\nAcuerdos sugeridos:\n${data.suggestedAgreements}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const directionText = String(data.directionReport || '');

      setDraftParents(parentsText);
      setDraftDirection(directionText);

      const { db } = await localApi.updateIncident(incident.id, {
        aiReportParents: parentsText,
        aiReportDirection: directionText,
        reportGeneratedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      });
      onDbUpdate(db);
      setSavedNotice(
        formatAiUsageNotice(
          data._aiMeta,
          'Reportes redactados por IA y guardados localmente.'
        )
      );
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Error al generar reportes.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveReports = async () => {
    if (!activeIncident) return;
    setSavingReports(true);
    setSavedNotice('');
    try {
      const { db } = await localApi.updateIncident(activeIncident.id, {
        aiReportParents: draftParents,
        aiReportDirection: draftDirection,
        reportGeneratedAt:
          activeIncident.reportGeneratedAt || new Date().toISOString().slice(0, 16).replace('T', ' '),
      });
      onDbUpdate(db);
      setSavedNotice('Cambios guardados correctamente.');
    } finally {
      setSavingReports(false);
    }
  };

  const handleDeleteIncident = async (incident: Incident) => {
    const { db } = await localApi.deleteIncident(incident.id);
    onDbUpdate(db);
    if (selectedIncidentId === incident.id) {
      setSelectedIncidentId('');
    }
  };

  const triggerPrint = (target: PrintTarget) => {
    setPrintTarget(target);
    setTimeout(() => window.print(), 80);
  };

  const activeStudent = activeIncident ? studentMap.get(activeIncident.studentId) : undefined;
  const activeStudentConduct10 = activeStudent
    ? computeAutoConductBase10(activeStudent.id, incidents, selectedPeriod)
    : 10;

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Grupo {classroom.name} · Base 10.0 automática vinculada a boleta trimestral · Exportable a Word (.docx)
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Conducta con IA, incidencias y citatorios
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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

          <button
            type="button"
            disabled={sortedStudents.length === 0}
            onClick={() => {
              if (!formStudentId && sortedStudents[0]) {
                setFormStudentId(sortedStudents[0].id);
              }
              setFormPeriod(selectedPeriod);
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Registrar incidencia / mérito
          </button>
        </div>
      </div>

      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Registros ({filteredIncidents.length})
            </h2>
            <select
              value={filterStudentId}
              onChange={(e) => setFilterStudentId(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 max-w-[190px]"
            >
              <option value="todos">Todos los alumnos</option>
              {sortedStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.listNumber}. {s.fullName} ({computeAutoConductBase10(s.id, incidents, selectedPeriod)})
                </option>
              ))}
            </select>
          </div>

          {filteredIncidents.length === 0 ? (
            <div className="py-10 text-center border-t border-slate-100">
              <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600">
                No hay registros de conducta en {selectedPeriod}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100 max-h-[600px] overflow-y-auto">
              {filteredIncidents.map((inc) => {
                const st = studentMap.get(inc.studentId);
                const isSelected = activeIncident?.id === inc.id;
                return (
                  <div
                    key={inc.id}
                    onClick={() => setSelectedIncidentId(inc.id)}
                    className={`py-3.5 px-3 cursor-pointer rounded-lg transition-colors ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {st?.fullName || 'Alumno'}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteIncident(inc);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                      <span className="font-mono tabular-nums">{inc.date}</span>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[inc.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          inc.severity === 'positiva'
                            ? 'text-emerald-700 font-medium'
                            : inc.severity === 'grave'
                            ? 'text-red-700 font-medium'
                            : inc.severity === 'moderada'
                            ? 'text-amber-700 font-medium'
                            : 'text-slate-700 font-medium'
                        }
                      >
                        {SEVERITY_LABELS[inc.severity]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 line-clamp-2">{inc.description}</p>
                    {inc.aiReportParents && (
                      <p className="text-[11px] font-medium text-blue-700 mt-1.5 inline-flex items-center gap-1">
                        <FileCheck2 className="w-3 h-3" />
                        Acta / citatorio generado
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right AI Report Composer */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {!activeIncident ? (
            <div className="py-16 text-center">
              <Bot className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Selecciona o registra un hecho de conducta
              </h2>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Escribe los hechos de forma informal y la IA redactará los documentos formales editables en Word (.docx) para Padres y Dirección.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">
                    {activeIncident.date} · {activeIncident.period} ·{' '}
                    {SEVERITY_LABELS[activeIncident.severity]}
                  </p>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {activeStudent?.fullName || 'Estudiante'}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Conducta proyectada ({selectedPeriod}):{' '}
                    <span className="font-mono font-bold text-slate-900">
                      {activeStudentConduct10} / 10.0
                    </span>{' '}
                    · Tutor: {activeStudent?.guardianName || 'Sin tutor registrado'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={() => handleGenerateAiReports(activeIncident)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Bot className="w-4 h-4" />
                  {aiLoading ? 'Redactando con IA...' : 'Transformar a formal con IA'}
                </button>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-700 space-y-1">
                <p>
                  <strong className="text-slate-900">Narración del hecho:</strong>{' '}
                  {activeIncident.description}
                </p>
                {activeIncident.actionTaken && (
                  <p>
                    <strong className="text-slate-900">Acción docente:</strong>{' '}
                    {activeIncident.actionTaken}
                  </p>
                )}
              </div>

              {aiError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {aiError}
                </div>
              )}
              {savedNotice && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {savedNotice}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-800">
                      1. Citatorio / Reporte para Padres de Familia
                    </label>
                    <div className="flex items-center gap-1.5">
                      {activeStudent && (
                        <button
                          type="button"
                          disabled={!draftParents.trim()}
                          onClick={() =>
                            exportIncidentReportDocx(
                              classroom,
                              activeStudent,
                              { ...activeIncident, aiReportParents: draftParents, aiReportDirection: draftDirection },
                              'parents'
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-40 rounded-md"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          Word (.docx)
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!draftParents.trim()}
                        onClick={() => triggerPrint('parents')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-md"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Imprimir
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    value={draftParents}
                    onChange={(e) => setDraftParents(e.target.value)}
                    placeholder="Haz clic en 'Transformar a formal con IA' o redacta el comunicado..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg leading-relaxed"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-800">
                      2. Acta / Informe para Dirección Escolar
                    </label>
                    <div className="flex items-center gap-1.5">
                      {activeStudent && (
                        <button
                          type="button"
                          disabled={!draftDirection.trim()}
                          onClick={() =>
                            exportIncidentReportDocx(
                              classroom,
                              activeStudent,
                              { ...activeIncident, aiReportParents: draftParents, aiReportDirection: draftDirection },
                              'direction'
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-40 rounded-md"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          Word (.docx)
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!draftDirection.trim()}
                        onClick={() => triggerPrint('direction')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-md"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Imprimir
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    value={draftDirection}
                    onChange={(e) => setDraftDirection(e.target.value)}
                    placeholder="Haz clic en 'Transformar a formal con IA' o redacta el informe técnico..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg leading-relaxed"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  {activeStudent && (
                    <button
                      type="button"
                      disabled={!draftParents.trim() && !draftDirection.trim()}
                      onClick={() =>
                        exportIncidentReportDocx(
                          classroom,
                          activeStudent,
                          { ...activeIncident, aiReportParents: draftParents, aiReportDirection: draftDirection },
                          'both'
                        )
                      }
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-lg"
                    >
                      <FileDown className="w-4 h-4" />
                      Descargar ambos (.docx)
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!draftParents.trim() && !draftDirection.trim()}
                    onClick={() => triggerPrint('both')}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimir ambos
                  </button>
                </div>
                <button
                  type="button"
                  disabled={savingReports}
                  onClick={handleSaveReports}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingReports ? 'Guardando...' : 'Guardar edición'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Print Layout */}
      {activeIncident && activeStudent && printTarget !== 'none' && (
        <div className="hidden print-only">
          {(printTarget === 'parents' || printTarget === 'both') && (
            <div className={`space-y-6 ${printTarget === 'both' ? 'print-page-break' : ''}`}>
              <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase text-slate-600">{classroom.schoolName}</p>
                  <h1 className="font-display text-xl font-bold text-slate-900">
                    Reporte y Citatorio de Conducta — Padres de Familia
                  </h1>
                </div>
                <p className="text-xs font-mono">Fecha: {activeIncident.date}</p>
              </div>
              <div className="text-sm whitespace-pre-line leading-relaxed">{draftParents}</div>
              <div className="pt-14 grid grid-cols-3 gap-8 text-center text-xs">
                <div className="border-t border-slate-800 pt-2">{classroom.teacherName} (Docente)</div>
                <div className="border-t border-slate-800 pt-2">{activeStudent.guardianName || 'Padre / Tutor'}</div>
                <div className="border-t border-slate-800 pt-2">Dirección Escolar</div>
              </div>
            </div>
          )}
          {(printTarget === 'direction' || printTarget === 'both') && (
            <div className="space-y-6">
              <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase text-slate-600">{classroom.schoolName}</p>
                  <h1 className="font-display text-xl font-bold text-slate-900">
                    Informe Técnico de Conducta — Dirección Escolar
                  </h1>
                </div>
                <p className="text-xs font-mono">Fecha: {activeIncident.date}</p>
              </div>
              <div className="text-sm whitespace-pre-line leading-relaxed">{draftDirection}</div>
              <div className="pt-14 grid grid-cols-2 gap-12 text-center text-xs">
                <div className="border-t border-slate-800 pt-2">{classroom.teacherName} (Docente)</div>
                <div className="border-t border-slate-800 pt-2">Dirección Escolar (Vo. Bo.)</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Incident Modal */}
      {showNewModal && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Nuevo registro de conducta
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateIncident} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Estudiante
                  </label>
                  <select
                    required
                    value={formStudentId}
                    onChange={(e) => setFormStudentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {sortedStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.listNumber}. {s.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Trimestre
                  </label>
                  <select
                    value={formPeriod}
                    onChange={(e) => setFormPeriod(e.target.value as TrimesterPeriod)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {TRIMESTERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Categoría
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as IncidentCategory)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Impacto (Base 10)
                  </label>
                  <select
                    value={formSeverity}
                    onChange={(e) => setFormSeverity(e.target.value as IncidentSeverity)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(SEVERITY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Describe el hecho informalmente (la IA lo convertirá en reporte formal)
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Ej. Hoy en recreo empujó a su compañero y no quiso pedir disculpas al principio..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Acción inmediata tomada en aula
                </label>
                <input
                  type="text"
                  placeholder="Ej. Diálogo reflexivo"
                  value={formActionTaken}
                  onChange={(e) => setFormActionTaken(e.target.value)}
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
                  disabled={savingNew}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  {savingNew ? 'Guardando...' : 'Guardar registro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
