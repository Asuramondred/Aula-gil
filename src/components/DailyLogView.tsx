import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  FileDown,
  Mic,
  MicOff,
  NotebookPen,
  Plus,
  Printer,
  Save,
  Trash2,
} from 'lucide-react';
import { formatAiUsageNotice, localApi } from '../lib/api';
import { exportDailyLogDocx } from '../lib/docxExport';
import type {
  Classroom,
  DailyLog,
  LocalDatabase,
  TrimesterPeriod,
} from '../types';

interface DailyLogViewProps {
  classroom: Classroom;
  dailyLogs: DailyLog[];
  onDbUpdate: (db: LocalDatabase) => void;
}

const TRIMESTERS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function DailyLogView({
  classroom,
  dailyLogs,
  onDbUpdate,
}: DailyLogViewProps) {
  const [selectedLogId, setSelectedLogId] = useState<string>('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState<TrimesterPeriod>(
    classroom.activePeriod || 'Trimestre 1'
  );
  const [rawNarrative, setRawNarrative] = useState('');
  const [topicsCovered, setTopicsCovered] = useState('');
  const [studentObservations, setStudentObservations] = useState('');
  const [agreementsPending, setAgreementsPending] = useState('');
  const [pedagogicalReflection, setPedagogicalReflection] = useState('');

  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Voice dictation state
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Date range export for weekly/monthly compiled Word report
  const [exportFilterMonth, setExportFilterMonth] = useState(() =>
    new Date().toISOString().slice(0, 7)
  );

  const sortedLogs = useMemo(
    () => [...dailyLogs].sort((a, b) => b.date.localeCompare(a.date)),
    [dailyLogs]
  );

  const loadLogIntoEditor = (log: DailyLog) => {
    setSelectedLogId(log.id);
    setDate(log.date);
    setPeriod(log.period);
    setRawNarrative(log.rawNarrative);
    setTopicsCovered(log.topicsCovered);
    setStudentObservations(log.studentObservations);
    setAgreementsPending(log.agreementsPending);
    setPedagogicalReflection(log.pedagogicalReflection);
    setStatusMsg('');
    setErrorMsg('');
  };

  const resetForNewDay = () => {
    setSelectedLogId('');
    setDate(new Date().toISOString().slice(0, 10));
    setPeriod(classroom.activePeriod || 'Trimestre 1');
    setRawNarrative('');
    setTopicsCovered('');
    setStudentObservations('');
    setAgreementsPending('');
    setPedagogicalReflection('');
    setStatusMsg('');
    setErrorMsg('');
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleVoiceDictation = () => {
    setErrorMsg('');
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setErrorMsg(
        'El dictado por voz no está disponible en este navegador. Puedes escribir tu relato directamente en el cuadro de texto.'
      );
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'es-MX';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let chunk = '';
      for (let i = 0; i < event.results.length; i += 1) {
        chunk += event.results[i][0].transcript + ' ';
      }
      setRawNarrative((prev) => {
        const cleanChunk = chunk.trim();
        if (!cleanChunk) return prev;
        return prev ? `${prev.trim()} ${cleanChunk}` : cleanChunk;
      });
    };
    rec.onerror = (ev) => {
      setListening(false);
      setErrorMsg(`No se pudo activar el micrófono (${ev.error}).`);
    };
    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const handleGenerateWithAI = async () => {
    if (!rawNarrative.trim()) {
      setErrorMsg('Escribe o dicta primero cómo te fue en tu jornada escolar.');
      return;
    }
    setAiLoading(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const resp = await fetch('/api/ai/daily-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          groupName: classroom.name,
          period,
          rawNarrative,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'No se pudo generar el reporte diario.');
      }
      setTopicsCovered(data.topicsCovered || '');
      setStudentObservations(data.studentObservations || '');
      setAgreementsPending(data.agreementsPending || '');
      setPedagogicalReflection(data.pedagogicalReflection || '');
      setStatusMsg(
        formatAiUsageNotice(
          data._aiMeta,
          'Bitácora estructurada por IA. Revisa o ajusta cualquier apartado antes de guardar'
        )
      );
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : 'Error al generar bitácora con IA.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const payload = {
        classroomId: classroom.id,
        date,
        period,
        rawNarrative: rawNarrative.trim(),
        topicsCovered: topicsCovered.trim(),
        studentObservations: studentObservations.trim(),
        agreementsPending: agreementsPending.trim(),
        pedagogicalReflection: pedagogicalReflection.trim(),
      };
      if (selectedLogId) {
        const { db } = await localApi.updateDailyLog(selectedLogId, payload);
        onDbUpdate(db);
      } else {
        const { logId, db } = await localApi.createDailyLog(payload);
        onDbUpdate(db);
        setSelectedLogId(logId);
      }
      setStatusMsg('Bitácora diaria guardada en el historial local.');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    const { db } = await localApi.deleteDailyLog(id);
    onDbUpdate(db);
    if (selectedLogId === id) {
      resetForNewDay();
    }
  };

  const handleExportCurrentDayDocx = async () => {
    const currentObj: DailyLog = {
      id: selectedLogId || 'actual',
      classroomId: classroom.id,
      date,
      period,
      rawNarrative,
      topicsCovered,
      studentObservations,
      agreementsPending,
      pedagogicalReflection,
      createdAt: '',
      updatedAt: '',
    };
    await exportDailyLogDocx(classroom, [currentObj], date);
  };

  const handleExportMonthDocx = async () => {
    const monthLogs = sortedLogs.filter((l) => l.date.startsWith(exportFilterMonth));
    const listToExport = monthLogs.length > 0 ? monthLogs : sortedLogs;
    if (listToExport.length === 0) return;
    await exportDailyLogDocx(
      classroom,
      listToExport,
      `Compilado_${exportFilterMonth || 'Completo'}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Grupo {classroom.name} · Narración natural o dictado por voz transformado a bitácora formal
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Bitácora diaria del docente
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
            <input
              type="month"
              value={exportFilterMonth}
              onChange={(e) => setExportFilterMonth(e.target.value)}
              className="text-xs font-mono text-slate-700 focus:outline-none"
            />
            <button
              type="button"
              disabled={sortedLogs.length === 0}
              onClick={handleExportMonthDocx}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 rounded-md whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              Compilado (.docx)
            </button>
          </div>
          <button
            type="button"
            onClick={resetForNewDay}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nueva jornada
          </button>
        </div>
      </div>

      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left History */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Historial por fecha ({sortedLogs.length})
          </h2>
          {sortedLogs.length === 0 ? (
            <div className="py-10 text-center border-t border-slate-100">
              <NotebookPen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600">
                Aún no hay bitácoras guardadas. Redacta la jornada de hoy a la derecha.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-t border-slate-100 max-h-[600px] overflow-y-auto">
              {sortedLogs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => loadLogIntoEditor(log)}
                  className={`py-3 px-3 cursor-pointer rounded-lg transition-colors ${
                    selectedLogId === log.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {log.date} · {log.period}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteLog(log.id);
                      }}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-700 line-clamp-2">
                    {log.topicsCovered || log.rawNarrative}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Composer */}
        <form
          onSubmit={handleSaveLog}
          className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Fecha de la jornada
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Trimestre
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as TrimesterPeriod)}
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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-800">
                1. Relato natural o dictado por voz de tu jornada
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleVoiceDictation}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    listening
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  {listening ? 'Detener dictado' : 'Dictar por voz'}
                </button>
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={handleGenerateWithAI}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  <Bot className="w-3.5 h-3.5" />
                  {aiLoading ? 'Estructurando...' : 'Generar Reporte Diario con IA'}
                </button>
              </div>
            </div>
            <textarea
              rows={3}
              placeholder='Ej. "Hoy vimos fracciones en 4°A, Juanito y María no trajeron tarea, tuvimos junta rápida en recreo y avanzamos bien en lectura..."'
              value={rawNarrative}
              onChange={(e) => setRawNarrative(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {errorMsg && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}
          {statusMsg && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {statusMsg}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Temas abordados
              </label>
              <textarea
                rows={2}
                value={topicsCovered}
                onChange={(e) => setTopicsCovered(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Observaciones de alumnos / incidencias relevantes
              </label>
              <textarea
                rows={2}
                value={studentObservations}
                onChange={(e) => setStudentObservations(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Acuerdos y pendientes
              </label>
              <textarea
                rows={2}
                value={agreementsPending}
                onChange={(e) => setAgreementsPending(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">
                Reflexión pedagógica
              </label>
              <textarea
                rows={2}
                value={pedagogicalReflection}
                onChange={(e) => setPedagogicalReflection(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCurrentDayDocx}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                <FileDown className="w-4 h-4 text-blue-700" />
                Descargar día (.docx)
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                <Printer className="w-4 h-4" />
                Imprimir
              </button>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Guardando...' : 'Guardar en bitácora'}
            </button>
          </div>
        </form>
      </div>

      {/* Print Layout for Daily Log */}
      <div className="hidden print-only space-y-5">
        <div className="border-b-2 border-slate-900 pb-3">
          <p className="text-xs uppercase text-slate-600">
            {classroom.schoolName || 'Escuela Primaria'}
          </p>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Bitácora Diaria del Docente — Grupo {classroom.name}
          </h1>
          <p className="text-xs text-slate-700 mt-1">
            Fecha: {date} · {period} · Docente: {classroom.teacherName}
          </p>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-bold text-slate-900">Temas abordados:</p>
            <p className="whitespace-pre-line text-slate-800">{topicsCovered || '—'}</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Observaciones de alumnos e incidencias:</p>
            <p className="whitespace-pre-line text-slate-800">{studentObservations || '—'}</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Acuerdos y pendientes:</p>
            <p className="whitespace-pre-line text-slate-800">{agreementsPending || '—'}</p>
          </div>
          <div>
            <p className="font-bold text-slate-900">Reflexión pedagógica:</p>
            <p className="whitespace-pre-line text-slate-800">{pedagogicalReflection || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
