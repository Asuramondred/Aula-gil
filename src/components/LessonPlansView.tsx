import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  CalendarOff,
  Check,
  Download,
  FileDown,
  FileText,
  FolderCheck,
  Mic,
  MicOff,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { formatAiUsageNotice, localApi } from '../lib/api';
import { exportLessonPlanDocx } from '../lib/docxExport';
import { formatBytes, processLessonPlanFile } from '../lib/fileUtils';
import type {
  Classroom,
  FormativeField,
  LessonPlan,
  LessonPlanDaySession,
  LessonPlanFieldBlock,
  LessonPlanScope,
  LocalDatabase,
  NemMethodology,
  NonSchoolDay,
  TrimesterPeriod,
  WeekdayKey,
} from '../types';

interface LessonPlansViewProps {
  classroom: Classroom;
  lessonPlans: LessonPlan[];
  onDbUpdate: (db: LocalDatabase) => void;
}

type PlansTab = 'ia_nem' | 'cargar' | 'guardadas';

const WEEKDAYS: Array<{ key: WeekdayKey; label: string; shortLabel: string }> = [
  { key: 'lunes', label: 'Lunes', shortLabel: 'Lun' },
  { key: 'martes', label: 'Martes', shortLabel: 'Mar' },
  { key: 'miercoles', label: 'Miércoles', shortLabel: 'Mié' },
  { key: 'jueves', label: 'Jueves', shortLabel: 'Jue' },
  { key: 'viernes', label: 'Viernes', shortLabel: 'Vie' },
];

const NON_SCHOOL_REASON_PRESETS = [
  'Consejo Técnico Escolar (CTE)',
  'Día festivo oficial',
  'Descarga administrativa',
  'Taller intensivo docente',
  'Suspensión de labores / Evento escolar',
];

const FORMATIVE_FIELDS: Array<{ value: FormativeField; label: string }> = [
  { value: 'general', label: 'Planeación integrada (Todos los campos)' },
  { value: 'lenguajes', label: 'Lenguajes' },
  { value: 'saberes', label: 'Saberes y Pensamiento Científico' },
  { value: 'etica', label: 'Ética, Naturaleza y Sociedades' },
  { value: 'humano', label: 'De lo Humano y lo Comunitario' },
];

const NEM_METHODOLOGIES: Array<{ value: NemMethodology; label: string }> = [
  { value: 'abp_proyectos', label: 'Aprendizaje Basado en Proyectos Comunitarios (ABPC)' },
  { value: 'steam', label: 'Aprendizaje Basado en Indagación (STEAM)' },
  { value: 'problemas', label: 'Aprendizaje Basado en Problemas (ABP)' },
  { value: 'servicio', label: 'Aprendizaje Servicio (AS)' },
];

const ARTICULATING_AXES = [
  'Inclusión',
  'Pensamiento crítico',
  'Interculturalidad crítica',
  'Igualdad de género',
  'Vida saludable',
  'Apropiación de las culturas a través de la lectura y la escritura',
  'Artes y experiencias estéticas',
];

const TRIMESTERS: TrimesterPeriod[] = ['Trimestre 1', 'Trimestre 2', 'Trimestre 3'];

function getMondayAndFridayOfCurrentWeek(): { monday: string; friday: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return {
    monday: mon.toISOString().slice(0, 10),
    friday: fri.toISOString().slice(0, 10),
  };
}

function buildEmptySessions(nonSchoolDays: NonSchoolDay[]): LessonPlanDaySession[] {
  const map = new Map(nonSchoolDays.map((d) => [d.day, d.reason]));
  return WEEKDAYS.map((w) => {
    const suspended = map.has(w.key);
    const reason = map.get(w.key) || '';
    return {
      day: w.key,
      active: !suspended,
      suspensionReason: reason,
      activities: suspended ? `Sin clases presenciales. Motivo: ${reason || 'Ajuste escolar'}.` : '',
      materials: suspended ? '—' : '',
    };
  });
}

interface WeekdaySelectorProps {
  nonSchoolDays: NonSchoolDay[];
  onChange: (next: NonSchoolDay[]) => void;
}

function WeekdayNonSchoolSelector({ nonSchoolDays, onChange }: WeekdaySelectorProps) {
  const map = new Map(nonSchoolDays.map((d) => [d.day, d.reason]));

  const toggleDay = (dayKey: WeekdayKey) => {
    if (map.has(dayKey)) {
      onChange(nonSchoolDays.filter((d) => d.day !== dayKey));
    } else {
      onChange([
        ...nonSchoolDays,
        { day: dayKey, reason: NON_SCHOOL_REASON_PRESETS[0] },
      ]);
    }
  };

  const updateReason = (dayKey: WeekdayKey, reason: string) => {
    onChange(
      nonSchoolDays.map((d) => (d.day === dayKey ? { ...d, reason } : d))
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-slate-700 mb-1.5">
          Días de lunes a viernes sin asistencia a clases (opcional)
        </p>
        <p className="text-xs text-slate-500 mb-2">
          Marca únicamente los días en los que no habrá clases para ajustar las sesiones y registrar el motivo.
        </p>
        <div className="grid grid-cols-5 gap-2">
          {WEEKDAYS.map((w) => {
            const isOff = map.has(w.key);
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => toggleDay(w.key)}
                className={`px-2 py-2 text-xs font-medium rounded-lg border transition-colors text-center ${
                  isOff
                    ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="hidden sm:inline">{w.label}</span>
                <span className="sm:hidden">{w.shortLabel}</span>
                <span className="block text-[10px] font-normal mt-0.5">
                  {isOff ? 'Sin clases' : 'Con clases'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {nonSchoolDays.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3 space-y-2.5">
          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
            <CalendarOff className="w-3.5 h-3.5" />
            Motivo por día sin asistencia:
          </p>
          {WEEKDAYS.filter((w) => map.has(w.key)).map((w) => {
            const currentReason = map.get(w.key) || '';
            return (
              <div
                key={w.key}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
              >
                <span className="sm:col-span-2 text-xs font-semibold text-slate-800">
                  {w.label}:
                </span>
                <select
                  value={
                    NON_SCHOOL_REASON_PRESETS.includes(currentReason)
                      ? currentReason
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      updateReason(w.key, e.target.value);
                    }
                  }}
                  className="sm:col-span-5 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                >
                  {NON_SCHOOL_REASON_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value="__custom__">Motivo personalizado...</option>
                </select>
                <input
                  type="text"
                  value={currentReason}
                  onChange={(e) => updateReason(w.key, e.target.value)}
                  placeholder="Escribe o ajusta el motivo"
                  className="sm:col-span-5 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LessonPlansView({
  classroom,
  lessonPlans,
  onDbUpdate,
}: LessonPlansViewProps) {
  const defaultWeek = useMemo(() => getMondayAndFridayOfCurrentWeek(), []);
  const [activeTab, setActiveTab] = useState<PlansTab>('ia_nem');

  // --- Tab 1: Cargar planeación creada por el docente ---
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadPeriod, setUploadPeriod] = useState<TrimesterPeriod>(classroom.activePeriod);
  const [uploadField, setUploadField] = useState<FormativeField>('general');
  const [uploadWeekStart, setUploadWeekStart] = useState(defaultWeek.monday);
  const [uploadWeekEnd, setUploadWeekEnd] = useState(defaultWeek.friday);
  const [uploadNonSchoolDays, setUploadNonSchoolDays] = useState<NonSchoolDay[]>([]);
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  // --- Tab 2: Crear planeación con IA (NEM) ---
  const [aiScope, setAiScope] = useState<LessonPlanScope>('integrada');
  const [aiTitle, setAiTitle] = useState('');
  const [aiPeriod, setAiPeriod] = useState<TrimesterPeriod>(classroom.activePeriod);
  const [aiField, setAiField] = useState<FormativeField>('lenguajes');
  const [aiMethodology, setAiMethodology] = useState<NemMethodology>('abp_proyectos');
  const [aiAxes, setAiAxes] = useState<string[]>(['Inclusión', 'Pensamiento crítico']);
  const [aiWeekStart, setAiWeekStart] = useState(defaultWeek.monday);
  const [aiWeekEnd, setAiWeekEnd] = useState(defaultWeek.friday);
  const [aiPda, setAiPda] = useState('');
  const [aiNeeds, setAiNeeds] = useState('');
  const [aiNonSchoolDays, setAiNonSchoolDays] = useState<NonSchoolDay[]>([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState('');

  // Editable AI Draft before storing / downloading Word
  const [aiDraft, setAiDraft] = useState<{
    title: string;
    pda: string;
    evaluationFormative: string;
    adjustments: string;
    fieldBlocks: LessonPlanFieldBlock[];
    sessions: LessonPlanDaySession[];
  } | null>(null);
  const [savingAiPlan, setSavingAiPlan] = useState(false);
  const [aiSavedMsg, setAiSavedMsg] = useState('');

  // Voice dictation for teacherNeeds
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  // --- Tab 3: Repositorio de planeaciones guardadas ---
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPeriod, setFilterPeriod] = useState<string>('todos');
  const [filterField, setFilterField] = useState<string>('todos');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>('');
  const [editingPlan, setEditingPlan] = useState<LessonPlan | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSavedNotice, setEditSavedNotice] = useState('');

  useEffect(() => {
    setUploadPeriod(classroom.activePeriod);
    setAiPeriod(classroom.activePeriod);
  }, [classroom.id, classroom.activePeriod]);

  const sortedPlans = useMemo(
    () =>
      [...lessonPlans].sort((a, b) =>
        (b.weekStartDate || b.createdAt).localeCompare(a.weekStartDate || a.createdAt)
      ),
    [lessonPlans]
  );

  const filteredPlans = useMemo(() => {
    return sortedPlans.filter((p) => {
      if (filterPeriod !== 'todos' && p.period !== filterPeriod) return false;
      if (filterField !== 'todos' && p.formativeField !== filterField) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          p.title.toLowerCase().includes(q) ||
          (p.pda || '').toLowerCase().includes(q) ||
          (p.teacherNeeds || '').toLowerCase().includes(q) ||
          (p.fileName || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [sortedPlans, filterPeriod, filterField, searchQuery]);

  const selectedPlan =
    filteredPlans.find((p) => p.id === selectedPlanId) || filteredPlans[0] || null;

  useEffect(() => {
    if (selectedPlan) {
      setEditingPlan(structuredClone(selectedPlan));
      setEditSavedNotice('');
      setConfirmDeleteId('');
    } else {
      setEditingPlan(null);
    }
  }, [selectedPlan?.id]);

  const toggleVoiceNeeds = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRec = ((window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: (event: {
            results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
          }) => void;
          onerror: () => void;
          onend: () => void;
          start: () => void;
          stop: () => void;
        })
      | undefined;

    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'es-MX';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let finalChunk = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalChunk += `${event.results[i][0].transcript} `;
        }
      }
      if (finalChunk.trim()) {
        setAiNeeds((prev) => `${prev ? `${prev.trim()} ` : ''}${finalChunk.trim()}`);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const handleToggleAxis = (axis: string) => {
    setAiAxes((prev) =>
      prev.includes(axis) ? prev.filter((a) => a !== axis) : [...prev, axis]
    );
  };

  // --- Save Uploaded Teacher Plan ---
  const handleSaveUploadedPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    setUploadSuccess('');

    if (!uploadTitle.trim() && !uploadFile) {
      setUploadError('Escribe un título o selecciona el archivo de tu planeación.');
      return;
    }

    setUploading(true);
    try {
      let fileMeta = {
        fileName: '',
        mimeType: '',
        sizeBytes: 0,
        dataUrl: '',
      };
      if (uploadFile) {
        fileMeta = await processLessonPlanFile(uploadFile);
      }

      const finalTitle =
        uploadTitle.trim() ||
        fileMeta.fileName.replace(/\.[^.]+$/, '') ||
        'Planeación docente';

      const sessions = buildEmptySessions(uploadNonSchoolDays);

      const { planId, db } = await localApi.createLessonPlan({
        classroomId: classroom.id,
        period: uploadPeriod,
        title: finalTitle,
        source: 'cargada',
        weekStartDate: uploadWeekStart,
        weekEndDate: uploadWeekEnd,
        formativeField: uploadField,
        methodology: 'abp_proyectos',
        articulatingAxes: [],
        pda: '',
        teacherNeeds: '',
        nonSchoolDays: uploadNonSchoolDays,
        sessions,
        evaluationFormative: '',
        adjustments: '',
        ...fileMeta,
        notes: uploadNotes.trim(),
      });

      onDbUpdate(db);
      setSelectedPlanId(planId);
      setUploadTitle('');
      setUploadNotes('');
      setUploadFile(null);
      setUploadNonSchoolDays([]);
      setUploadSuccess('Planeación cargada y almacenada correctamente en el repositorio.');
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'No se pudo cargar la planeación.'
      );
    } finally {
      setUploading(false);
    }
  };

  // --- Generate AI NEM Plan ---
  const handleGenerateAiPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiError('');
    setAiSavedMsg('');
    if (!aiTitle.trim() && !aiNeeds.trim()) {
      setAiError('Indica el tema o proyecto y/o las necesidades de tu grupo.');
      return;
    }

    setGeneratingAi(true);
    try {
      const result = await localApi.generateNemLessonPlan({
        title: aiTitle.trim(),
        groupName: classroom.name,
        schoolName: classroom.schoolName,
        period: aiPeriod,
        planScope: aiScope,
        formativeField: aiScope === 'integrada' ? 'general' : aiField,
        methodology: aiMethodology,
        articulatingAxes: aiAxes,
        pda: aiPda.trim(),
        teacherNeeds: aiNeeds.trim(),
        weekStartDate: aiWeekStart,
        weekEndDate: aiWeekEnd,
        nonSchoolDays: aiNonSchoolDays,
      });

      setAiDraft({
        title: result.title,
        pda: result.pda,
        evaluationFormative: result.evaluationFormative,
        adjustments: result.adjustments,
        fieldBlocks: Array.isArray(result.fieldBlocks) ? result.fieldBlocks : [],
        sessions: result.sessions.map((s) => ({
          day: s.day as WeekdayKey,
          active: Boolean(s.active),
          suspensionReason: s.suspensionReason || '',
          activities: s.activities || '',
          materials: s.materials || '',
        })),
      });
      setAiSavedMsg(
        formatAiUsageNotice(
          result._aiMeta,
          'Planeación NEM generada y lista para revisar o exportar a Word (.docx)'
        )
      );
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'No se pudo generar la planeación NEM con IA.'
      );
    } finally {
      setGeneratingAi(false);
    }
  };

  // Sync nonSchoolDays edits into aiDraft if teacher toggles days after generating
  const handleAiNonSchoolDaysChange = (next: NonSchoolDay[]) => {
    setAiNonSchoolDays(next);
    if (!aiDraft) return;
    const map = new Map(next.map((d) => [d.day, d.reason]));
    setAiDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sessions: prev.sessions.map((s) => {
          if (map.has(s.day)) {
            const reason = map.get(s.day) || 'Sin asistencia escolar';
            return {
              ...s,
              active: false,
              suspensionReason: reason,
              activities: `Sin clases presenciales. Motivo: ${reason}.`,
              materials: '—',
            };
          }
          if (!s.active) {
            return {
              ...s,
              active: true,
              suspensionReason: '',
              activities: s.activities.startsWith('Sin clases presenciales')
                ? 'Actividades de inicio, desarrollo y cierre para este día.'
                : s.activities,
              materials: s.materials === '—' ? 'Cuaderno y libros de texto SEP.' : s.materials,
            };
          }
          return s;
        }),
      };
    });
  };

  const handleSaveAiDraft = async (andExportDocx: boolean) => {
    if (!aiDraft) return;
    setSavingAiPlan(true);
    setAiSavedMsg('');
    try {
      const payload = {
        classroomId: classroom.id,
        period: aiPeriod,
        title: aiDraft.title.trim() || 'Planeación NEM',
        source: 'ia_nem' as const,
        planScope: aiScope,
        weekStartDate: aiWeekStart,
        weekEndDate: aiWeekEnd,
        formativeField: aiScope === 'integrada' ? ('general' as const) : aiField,
        methodology: aiMethodology,
        articulatingAxes: aiAxes,
        pda: aiDraft.pda.trim(),
        teacherNeeds: aiNeeds.trim(),
        nonSchoolDays: aiNonSchoolDays,
        fieldBlocks: aiDraft.fieldBlocks,
        sessions: aiDraft.sessions,
        evaluationFormative: aiDraft.evaluationFormative.trim(),
        adjustments: aiDraft.adjustments.trim(),
        fileName: '',
        mimeType: '',
        sizeBytes: 0,
        dataUrl: '',
        notes: '',
      };

      const { planId, db } = await localApi.createLessonPlan(payload);
      onDbUpdate(db);
      setSelectedPlanId(planId);

      if (andExportDocx) {
        const saved = db.lessonPlans.find((p) => p.id === planId);
        if (saved) {
          await exportLessonPlanDocx(classroom, saved);
        }
        setAiSavedMsg('Planeación guardada y descargada en Word (.docx).');
      } else {
        setAiSavedMsg('Planeación NEM almacenada en tu repositorio local.');
      }
    } finally {
      setSavingAiPlan(false);
    }
  };

  const handleSavePlanChanges = async () => {
    if (!editingPlan) return;
    setSavingEdit(true);
    setEditSavedNotice('');
    try {
      const { db } = await localApi.updateLessonPlan(editingPlan.id, {
        title: editingPlan.title,
        period: editingPlan.period,
        formativeField: editingPlan.formativeField,
        weekStartDate: editingPlan.weekStartDate,
        weekEndDate: editingPlan.weekEndDate,
        nonSchoolDays: editingPlan.nonSchoolDays,
        fieldBlocks: editingPlan.fieldBlocks ?? [],
        sessions: editingPlan.sessions,
        pda: editingPlan.pda,
        evaluationFormative: editingPlan.evaluationFormative,
        adjustments: editingPlan.adjustments,
        notes: editingPlan.notes,
      });
      onDbUpdate(db);
      setEditSavedNotice('Cambios guardados localmente.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditPlanNonSchoolChange = (next: NonSchoolDay[]) => {
    if (!editingPlan) return;
    const map = new Map(next.map((d) => [d.day, d.reason]));
    const baseSessions =
      editingPlan.sessions.length === 5
        ? editingPlan.sessions
        : buildEmptySessions(next);

    const updatedSessions = baseSessions.map((s) => {
      if (map.has(s.day)) {
        const reason = map.get(s.day) || 'Sin asistencia';
        return {
          ...s,
          active: false,
          suspensionReason: reason,
          activities: `Sin clases presenciales. Motivo: ${reason}.`,
          materials: '—',
        };
      }
      if (!s.active) {
        return {
          ...s,
          active: true,
          suspensionReason: '',
          activities: s.activities.startsWith('Sin clases presenciales') ? '' : s.activities,
          materials: s.materials === '—' ? '' : s.materials,
        };
      }
      return s;
    });

    setEditingPlan({
      ...editingPlan,
      nonSchoolDays: next,
      sessions: updatedSessions,
    });
  };

  const handleDownloadOriginalFile = (plan: LessonPlan) => {
    if (!plan.dataUrl) return;
    fetch(plan.dataUrl)
      .then((r) => r.blob())
      .then((blob) => saveAs(blob, plan.fileName || `${plan.title}.bin`))
      .catch(() => {});
  };

  const handleDeletePlan = async (id: string) => {
    const { db } = await localApi.deleteLessonPlan(id);
    onDbUpdate(db);
    setConfirmDeleteId('');
    if (selectedPlanId === id) {
      setSelectedPlanId('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            {classroom.name} · Nueva Escuela Mexicana (NEM) · Almacenamiento local
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Planeaciones didácticas
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Carga tus propias planeaciones, guárdalas por trimestre o genera una planeación NEM con IA en Word (.docx) ajustando los días sin clases.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Funciones de planeaciones"
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ia_nem'}
            onClick={() => setActiveTab('ia_nem')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'ia_nem'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-700" />
            Crear con IA (NEM)
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cargar'}
            onClick={() => setActiveTab('cargar')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'cargar'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-blue-700" />
            Cargar planeación
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'guardadas'}
            onClick={() => setActiveTab('guardadas')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'guardadas'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FolderCheck className="w-3.5 h-3.5 text-blue-700" />
            Almacenadas ({lessonPlans.length})
          </button>
        </div>
      </div>

      {/* FUNCTION 3: Crear planeación con IA basada en NEM + Word .docx + días sin asistencia */}
      {activeTab === 'ia_nem' && (
        <div className="space-y-6">
          <form
            onSubmit={handleGenerateAiPlan}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Diseñador de Planeación NEM con IA
                </h2>
                <p className="text-sm text-slate-600 mt-0.5">
                  Escribe todos tus temas y necesidades en un solo texto para que la IA los separe por Campo Formativo en un único Word (.docx), o elige un campo individual.
                </p>
              </div>

              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
                <button
                  type="button"
                  onClick={() => setAiScope('integrada')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    aiScope === 'integrada'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Un solo documento (IA separa campos)
                </button>
                <button
                  type="button"
                  onClick={() => setAiScope('campo_unico')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    aiScope === 'campo_unico'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Un solo campo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Título semanal o proyecto (opcional)
                </label>
                <input
                  type="text"
                  value={aiTitle}
                  onChange={(e) => setAiTitle(e.target.value)}
                  placeholder={
                    aiScope === 'integrada'
                      ? 'Ej. Planeación Semana 12 — Todos los campos'
                      : 'Ej. Cuidamos el agua de nuestra escuela'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trimestre
                </label>
                <select
                  value={aiPeriod}
                  onChange={(e) => setAiPeriod(e.target.value as TrimesterPeriod)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                >
                  {TRIMESTERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                {aiScope === 'campo_unico' ? (
                  <>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Campo Formativo (NEM)
                    </label>
                    <select
                      value={aiField === 'general' ? 'lenguajes' : aiField}
                      onChange={(e) => setAiField(e.target.value as FormativeField)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    >
                      {FORMATIVE_FIELDS.filter((f) => f.value !== 'general').map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <div className="h-full flex flex-col justify-end">
                    <div className="px-3 py-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg">
                      La IA separará automáticamente tus temas en Lenguajes, Saberes, Ética y De lo Humano.
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-6">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Metodología sociocrítica NEM
                </label>
                <select
                  value={aiMethodology}
                  onChange={(e) => setAiMethodology(e.target.value as NemMethodology)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                >
                  {NEM_METHODOLOGIES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Inicio de semana
                </label>
                <input
                  type="date"
                  value={aiWeekStart}
                  onChange={(e) => setAiWeekStart(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fin de semana
                </label>
                <input
                  type="date"
                  value={aiWeekEnd}
                  onChange={(e) => setAiWeekEnd(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {/* Ejes Articuladores */}
            <div>
              <p className="text-xs font-medium text-slate-700 mb-2">
                Ejes Articuladores NEM (selecciona los que vincula tu proyecto)
              </p>
              <div className="flex flex-wrap gap-2">
                {ARTICULATING_AXES.map((axis) => {
                  const selected = aiAxes.includes(axis);
                  return (
                    <button
                      key={axis}
                      type="button"
                      onClick={() => handleToggleAxis(axis)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        selected
                          ? 'bg-blue-50 border-blue-300 text-blue-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {axis}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lunes a Viernes días sin asistencia */}
            <WeekdayNonSchoolSelector
              nonSchoolDays={aiNonSchoolDays}
              onChange={handleAiNonSchoolDaysChange}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contenido o PDA específico (opcional)
                </label>
                <textarea
                  rows={3}
                  value={aiPda}
                  onChange={(e) => setAiPda(e.target.value)}
                  placeholder="Si ya tienes el PDA del Programa Sintético o Analítico, pégalo aquí; si lo dejas vacío, la IA propondrá uno acorde al grado."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    {aiScope === 'integrada'
                      ? 'Temas de la semana y necesidades del grupo (todo en un solo texto)'
                      : 'Necesidades del grupo y contexto (indicadas por el maestro)'}
                  </label>
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={toggleVoiceNeeds}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                        listening
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                      {listening ? 'Detener dictado' : 'Dictar por voz'}
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={aiNeeds}
                  onChange={(e) => setAiNeeds(e.target.value)}
                  placeholder={
                    aiScope === 'integrada'
                      ? 'Ej. Quiero trabajar lectura de instructivos, fracciones equivalentes, cuidado del agua en la comunidad y trabajo colaborativo. Tengo 2 alumnos que requieren apoyos visuales.'
                      : 'Ej. Tengo 2 alumnos con rezago en lectoescritura que requieren apoyos visuales y el grupo trabaja mejor en equipos pequeños.'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {aiError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {aiError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                {aiNonSchoolDays.length === 0
                  ? 'Se planificarán actividades para los 5 días (lunes a viernes).'
                  : `Se ajustará la secuencia para ${5 - aiNonSchoolDays.length} día(s) efectivos de clase.`}
              </p>
              <button
                type="submit"
                disabled={generatingAi}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                {generatingAi ? 'Generando planeación NEM...' : 'Generar planeación NEM con IA'}
              </button>
            </div>
          </form>

          {/* Editable AI Result + Store + Word .docx */}
          {aiDraft && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-900">
                    Borrador editable (Nueva Escuela Mexicana)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Revisa o ajusta cualquier campo antes de guardar y generar el archivo Word (.docx).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={savingAiPlan}
                    onClick={() => handleSaveAiDraft(false)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg"
                  >
                    <Save className="w-4 h-4" />
                    Almacenar planeación
                  </button>
                  <button
                    type="button"
                    disabled={savingAiPlan}
                    onClick={() => handleSaveAiDraft(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                  >
                    <FileDown className="w-4 h-4" />
                    Guardar y descargar Word (.docx)
                  </button>
                </div>
              </div>

              {aiSavedMsg && (
                <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2.5 text-sm">
                  <span>{aiSavedMsg}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('guardadas')}
                    className="text-xs font-semibold underline whitespace-nowrap"
                  >
                    Ver en almacenadas
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Título final de la planeación
                  </label>
                  <input
                    type="text"
                    value={aiDraft.title}
                    onChange={(e) =>
                      setAiDraft({ ...aiDraft, title: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Proceso de Desarrollo de Aprendizaje (PDA) general
                  </label>
                  <input
                    type="text"
                    value={aiDraft.pda}
                    onChange={(e) =>
                      setAiDraft({ ...aiDraft, pda: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Separated Campo Formativo Blocks when AI split topics */}
              {aiDraft.fieldBlocks.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Temas separados por Campo Formativo (NEM)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {aiDraft.fieldBlocks.map((block, bIdx) => (
                      <div
                        key={`${block.field}-${bIdx}`}
                        className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2.5"
                      >
                        <p className="text-xs font-semibold text-blue-800">
                          {block.fieldLabel}
                        </p>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                            Tema / Contenido
                          </label>
                          <input
                            type="text"
                            value={block.topic}
                            onChange={(e) => {
                              const updated = [...aiDraft.fieldBlocks];
                              updated[bIdx] = { ...block, topic: e.target.value };
                              setAiDraft({ ...aiDraft, fieldBlocks: updated });
                            }}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                            PDA del campo
                          </label>
                          <textarea
                            rows={2}
                            value={block.pda}
                            onChange={(e) => {
                              const updated = [...aiDraft.fieldBlocks];
                              updated[bIdx] = { ...block, pda: e.target.value };
                              setAiDraft({ ...aiDraft, fieldBlocks: updated });
                            }}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">
                            Actividades clave
                          </label>
                          <textarea
                            rows={2}
                            value={block.activitiesSummary}
                            onChange={(e) => {
                              const updated = [...aiDraft.fieldBlocks];
                              updated[bIdx] = {
                                ...block,
                                activitiesSummary: e.target.value,
                              };
                              setAiDraft({ ...aiDraft, fieldBlocks: updated });
                            }}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monday to Friday sessions */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  Secuencia semanal ajustada (Lunes a Viernes)
                </h4>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                  {aiDraft.sessions.map((sess, idx) => {
                    const dayLabel =
                      WEEKDAYS.find((w) => w.key === sess.day)?.label || sess.day;
                    return (
                      <div
                        key={sess.day}
                        className={`p-4 space-y-2.5 ${
                          sess.active ? 'bg-white' : 'bg-amber-50/50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-display text-sm font-semibold text-slate-900">
                            {dayLabel}
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              sess.active ? 'text-emerald-700' : 'text-amber-800'
                            }`}
                          >
                            {sess.active
                              ? 'Día con clases'
                              : `Sin clases · ${sess.suspensionReason || 'Suspensión'}`}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                          <div className="lg:col-span-8">
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              {sess.active
                                ? 'Actividades (Inicio, Desarrollo y Cierre)'
                                : 'Motivo y ajuste de jornada'}
                            </label>
                            <textarea
                              rows={sess.active ? 3 : 2}
                              value={sess.activities}
                              onChange={(e) => {
                                const updated = [...aiDraft.sessions];
                                updated[idx] = { ...sess, activities: e.target.value };
                                setAiDraft({ ...aiDraft, sessions: updated });
                              }}
                              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                            />
                          </div>
                          <div className="lg:col-span-4">
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Materiales y recursos
                            </label>
                            <textarea
                              rows={sess.active ? 3 : 2}
                              value={sess.materials}
                              onChange={(e) => {
                                const updated = [...aiDraft.sessions];
                                updated[idx] = { ...sess, materials: e.target.value };
                                setAiDraft({ ...aiDraft, sessions: updated });
                              }}
                              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Evaluación formativa e instrumentos
                  </label>
                  <textarea
                    rows={3}
                    value={aiDraft.evaluationFormative}
                    onChange={(e) =>
                      setAiDraft({ ...aiDraft, evaluationFormative: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ajustes razonables e inclusión
                  </label>
                  <textarea
                    rows={3}
                    value={aiDraft.adjustments}
                    onChange={(e) =>
                      setAiDraft({ ...aiDraft, adjustments: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FUNCTION 1 & 2: Cargar planeaciones creadas por el docente y almacenar */}
      {activeTab === 'cargar' && (
        <form
          onSubmit={handleSaveUploadedPlan}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-4xl"
        >
          <div className="border-b border-slate-100 pb-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Cargar planeación creada por el docente
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Sube tu archivo en Word (.docx / .doc), PDF, texto o imagen (hasta 5 MB) para resguardarlo localmente junto con sus fechas y días sin asistencia.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-6">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Título o nombre de la planeación
              </label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Ej. Planeación Semana 12 — Lenguajes y Saberes"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Trimestre
              </label>
              <select
                value={uploadPeriod}
                onChange={(e) => setUploadPeriod(e.target.value as TrimesterPeriod)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
              >
                {TRIMESTERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Campo Formativo (NEM)
              </label>
              <select
                value={uploadField}
                onChange={(e) => setUploadField(e.target.value as FormativeField)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
              >
                {FORMATIVE_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Inicio de semana
              </label>
              <input
                type="date"
                value={uploadWeekStart}
                onChange={(e) => setUploadWeekStart(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Fin de semana
              </label>
              <input
                type="date"
                value={uploadWeekEnd}
                onChange={(e) => setUploadWeekEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Archivo de planeación (Word, PDF o imagen)
              </label>
              <label className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer truncate">
                <Upload className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {uploadFile ? uploadFile.name : 'Seleccionar archivo...'}
                </span>
                <input
                  type="file"
                  accept=".docx,.doc,.pdf,.txt,.odt,image/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <WeekdayNonSchoolSelector
            nonSchoolDays={uploadNonSchoolDays}
            onChange={setUploadNonSchoolDays}
          />

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Notas, observaciones o resumen de la planeación (opcional)
            </label>
            <textarea
              rows={3}
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              placeholder="Anota materiales especiales, recordatorios para dirección o ajustes para la semana..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          {uploadError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {uploadError}
            </p>
          )}
          {uploadSuccess && (
            <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2.5 text-sm">
              <span>{uploadSuccess}</span>
              <button
                type="button"
                onClick={() => setActiveTab('guardadas')}
                className="text-xs font-semibold underline whitespace-nowrap"
              >
                Ver almacenadas
              </button>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
            >
              <Save className="w-4 h-4" />
              {uploading ? 'Almacenando...' : 'Almacenar planeación'}
            </button>
          </div>
        </form>
      )}

      {/* FUNCTION 2: Repositorio almacenado + edición de días sin clases + descarga */}
      {activeTab === 'guardadas' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por título, PDA, necesidades o archivo..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
            >
              <option value="todos">Todos los trimestres</option>
              {TRIMESTERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              value={filterField}
              onChange={(e) => setFilterField(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
            >
              <option value="todos">Todos los Campos Formativos</option>
              {FORMATIVE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {filteredPlans.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
              <BookMarked className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                No hay planeaciones almacenadas con este filtro
              </h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Carga una planeación creada por ti o genera una nueva planeación basada en la Nueva Escuela Mexicana (NEM) con IA.
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('cargar')}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  Cargar planeación
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('ia_nem')}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                >
                  Crear con IA (NEM)
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left list */}
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {filteredPlans.map((p) => {
                  const isSelected = selectedPlan?.id === p.id;
                  const fieldName =
                    FORMATIVE_FIELDS.find((f) => f.value === p.formativeField)?.label ||
                    'General';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`w-full text-left p-4 transition-colors ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                        <span className="font-medium text-blue-700">
                          {p.source === 'ia_nem' ? 'IA · NEM' : 'Cargada por docente'}
                        </span>
                        <span className="font-mono tabular-nums">
                          {p.weekStartDate || p.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <p className="font-display text-sm font-semibold text-slate-900 line-clamp-2">
                        {p.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                        <span>{p.period}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[160px]">{fieldName}</span>
                        {p.nonSchoolDays.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 font-medium">
                              {p.nonSchoolDays.length} día(s) sin clases
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right inspector / editor */}
              {editingPlan && (
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>
                          {editingPlan.source === 'ia_nem'
                            ? 'Generada con IA (NEM)'
                            : 'Cargada por el docente'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{editingPlan.period}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {editingPlan.weekStartDate || '—'} al {editingPlan.weekEndDate || '—'}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={editingPlan.title}
                        onChange={(e) =>
                          setEditingPlan({ ...editingPlan, title: e.target.value })
                        }
                        className="w-full font-display text-xl font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-600 focus:outline-none py-0.5"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {editingPlan.dataUrl && (
                        <button
                          type="button"
                          onClick={() => handleDownloadOriginalFile(editingPlan)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Archivo original ({formatBytes(editingPlan.sizeBytes)})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => exportLessonPlanDocx(classroom, editingPlan)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        Descargar Word (.docx)
                      </button>
                    </div>
                  </div>

                  {editingPlan.fileName && (
                    <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-700">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-blue-700 shrink-0" />
                        <span className="font-medium truncate">{editingPlan.fileName}</span>
                        <span className="text-slate-400">·</span>
                        <span className="tabular-nums">{formatBytes(editingPlan.sizeBytes)}</span>
                      </div>
                    </div>
                  )}

                  {/* Adjust non-school days on stored plan */}
                  <WeekdayNonSchoolSelector
                    nonSchoolDays={editingPlan.nonSchoolDays}
                    onChange={handleEditPlanNonSchoolChange}
                  />

                  {editingPlan.pda && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        PDA / Contenido NEM
                      </label>
                      <textarea
                        rows={2}
                        value={editingPlan.pda}
                        onChange={(e) =>
                          setEditingPlan({ ...editingPlan, pda: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>
                  )}

                  {editingPlan.fieldBlocks && editingPlan.fieldBlocks.length > 0 && (
                    <div className="space-y-2.5">
                      <p className="text-xs font-semibold text-slate-800">
                        Separación por Campos Formativos (NEM)
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {editingPlan.fieldBlocks.map((block, bIdx) => (
                          <div
                            key={`${block.field}-${bIdx}`}
                            className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-1.5"
                          >
                            <p className="text-xs font-semibold text-blue-800">
                              {block.fieldLabel}
                            </p>
                            <input
                              type="text"
                              value={block.topic}
                              onChange={(e) => {
                                const nextBlocks = [...(editingPlan.fieldBlocks ?? [])];
                                nextBlocks[bIdx] = { ...block, topic: e.target.value };
                                setEditingPlan({
                                  ...editingPlan,
                                  fieldBlocks: nextBlocks,
                                });
                              }}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded"
                            />
                            <textarea
                              rows={2}
                              value={block.activitiesSummary}
                              onChange={(e) => {
                                const nextBlocks = [...(editingPlan.fieldBlocks ?? [])];
                                nextBlocks[bIdx] = {
                                  ...block,
                                  activitiesSummary: e.target.value,
                                };
                                setEditingPlan({
                                  ...editingPlan,
                                  fieldBlocks: nextBlocks,
                                });
                              }}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {editingPlan.sessions.length > 0 && (
                    <div className="space-y-2.5">
                      <p className="text-xs font-semibold text-slate-800">
                        Secuencia semanal (Lunes a Viernes)
                      </p>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                        {editingPlan.sessions.map((sess, idx) => {
                          const dayLabel =
                            WEEKDAYS.find((w) => w.key === sess.day)?.label || sess.day;
                          return (
                            <div
                              key={sess.day}
                              className={`p-3 space-y-2 ${
                                sess.active ? 'bg-white' : 'bg-amber-50/50'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-slate-900">
                                  {dayLabel}
                                </span>
                                <span
                                  className={
                                    sess.active
                                      ? 'text-emerald-700 font-medium'
                                      : 'text-amber-800 font-medium'
                                  }
                                >
                                  {sess.active
                                    ? 'Con clases'
                                    : `Sin clases: ${sess.suspensionReason || 'Ajuste'}`}
                                </span>
                              </div>
                              <textarea
                                rows={sess.active ? 2 : 1}
                                value={sess.activities}
                                onChange={(e) => {
                                  const nextSessions = [...editingPlan.sessions];
                                  nextSessions[idx] = {
                                    ...sess,
                                    activities: e.target.value,
                                  };
                                  setEditingPlan({
                                    ...editingPlan,
                                    sessions: nextSessions,
                                  });
                                }}
                                placeholder="Describe las actividades o ajustes de este día..."
                                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Notas del docente
                    </label>
                    <textarea
                      rows={2}
                      value={editingPlan.notes}
                      onChange={(e) =>
                        setEditingPlan({ ...editingPlan, notes: e.target.value })
                      }
                      placeholder="Observaciones adicionales..."
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>

                  {editSavedNotice && (
                    <p className="text-xs font-medium text-emerald-700">{editSavedNotice}</p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    {confirmDeleteId === editingPlan.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-700 font-medium">
                          ¿Eliminar esta planeación?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeletePlan(editingPlan.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
                        >
                          Sí, eliminar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId('')}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(editingPlan.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Eliminar planeación
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={savingEdit}
                      onClick={handleSavePlanChanges}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                    >
                      <Save className="w-4 h-4" />
                      {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
