import { useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  FolderPlus,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import type {
  AiEngineKey,
  AiExecutionMeta,
  AiProviderMode,
  ApiKeyStatus,
  Classroom,
  LocalDatabase,
  TrimesterPeriod,
} from '../types';

const DEFAULT_PRIORITY_ORDER: AiEngineKey[] = [
  'ollama',
  'gemini',
  'groq',
  'openrouter',
  'custom_openai',
  'offline',
];

const ENGINE_DETAILS: Record<
  AiEngineKey,
  { title: string; subtitle: string }
> = {
  ollama: {
    title: 'Ollama local (Windows)',
    subtitle: 'Corre en tu PC sin internet ni límite de tokens',
  },
  gemini: {
    title: 'Google Gemini',
    subtitle: 'Soporta 1 o varias llaves gratuitas separadas por coma',
  },
  groq: {
    title: 'Groq (Llama 3.3 70B)',
    subtitle: 'Rápida y gratuita · soporta varias llaves',
  },
  openrouter: {
    title: 'OpenRouter',
    subtitle: 'Acceso a decenas de modelos gratuitos con una llave',
  },
  custom_openai: {
    title: 'Otra API compatible (DeepSeek / LM Studio / OpenAI)',
    subtitle: 'Conecta cualquier servidor local o proveedor compatible',
  },
  offline: {
    title: 'Generador básico offline integrado',
    subtitle: 'Último recurso automático sin internet ni llaves',
  },
};

interface SettingsViewProps {
  classrooms: Classroom[];
  activeClassroom: Classroom;
  onSelectClassroom: (classroomId: string) => void;
  onDbUpdate: (db: LocalDatabase) => void;
  onBackupRecorded?: (timestamp: string) => void;
}

export function SettingsView({
  classrooms,
  activeClassroom,
  onSelectClassroom,
  onDbUpdate,
  onBackupRecorded,
}: SettingsViewProps) {
  const [editForm, setEditForm] = useState({
    name: activeClassroom.name,
    schoolName: activeClassroom.schoolName,
    teacherName: activeClassroom.teacherName,
    cycle: activeClassroom.cycle,
    activePeriod: activeClassroom.activePeriod,
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [newGroupName, setNewGroupName] = useState('');
  const [newSchoolName, setNewSchoolName] = useState(activeClassroom.schoolName || '');
  const [newCycle, setNewCycle] = useState('2026-2027');
  const [creating, setCreating] = useState(false);

  // Backup state
  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{
    fileName: string;
    data: LocalDatabase;
  } | null>(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupError, setBackupError] = useState('');

  // Local AI & Failover Chain state
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProviderMode>('auto');
  const [autoFailoverOnQuota, setAutoFailoverOnQuota] = useState(true);
  const [aiPriorityOrder, setAiPriorityOrder] = useState<AiEngineKey[]>(
    DEFAULT_PRIORITY_ORDER
  );
  const [enabledAiProviders, setEnabledAiProviders] = useState<AiEngineKey[]>(
    DEFAULT_PRIORITY_ORDER
  );
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:3b');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [ollamaMsg, setOllamaMsg] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-4-hydrogen');
  const [groqInput, setGroqInput] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.3-70b-versatile');
  const [openrouterInput, setOpenrouterInput] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState(
    'meta-llama/llama-3.3-70b-instruct:free'
  );
  const [customOpenAiUrl, setCustomOpenAiUrl] = useState('https://api.deepseek.com/v1');
  const [customOpenAiKeyInput, setCustomOpenAiKeyInput] = useState('');
  const [customOpenAiModel, setCustomOpenAiModel] = useState('deepseek-chat');
  const [savingKeys, setSavingKeys] = useState(false);
  const [testingChain, setTestingChain] = useState(false);
  const [testResult, setTestResult] = useState<AiExecutionMeta | null>(null);
  const [testError, setTestError] = useState('');
  const [keysNotice, setKeysNotice] = useState('');

  const applyStatusFromServer = (status: ApiKeyStatus) => {
    setKeyStatus(status);
    setAiProvider(status.aiProvider || 'auto');
    setAutoFailoverOnQuota(status.autoFailoverOnQuota !== false);
    setAiPriorityOrder(
      status.aiPriorityOrder?.length ? status.aiPriorityOrder : DEFAULT_PRIORITY_ORDER
    );
    setEnabledAiProviders(
      status.enabledAiProviders?.length
        ? status.enabledAiProviders
        : DEFAULT_PRIORITY_ORDER
    );
    setOllamaUrl(status.ollamaUrl || 'http://127.0.0.1:11434');
    setOllamaModel(status.ollamaModel || 'qwen2.5:3b');
    setGeminiModel(status.geminiModel || 'gemini-4-hydrogen');
    setGroqModel(status.groqModel || 'llama-3.3-70b-versatile');
    setOpenrouterModel(
      status.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free'
    );
    setCustomOpenAiUrl(status.customOpenAiUrl || 'https://api.deepseek.com/v1');
    setCustomOpenAiModel(status.customOpenAiModel || 'deepseek-chat');
  };

  useEffect(() => {
    setEditForm({
      name: activeClassroom.name,
      schoolName: activeClassroom.schoolName,
      teacherName: activeClassroom.teacherName,
      cycle: activeClassroom.cycle,
      activePeriod: activeClassroom.activePeriod,
    });
    setSavedMsg('');
  }, [activeClassroom.id]);

  useEffect(() => {
    localApi
      .getKeyStatus()
      .then((status) => {
        applyStatusFromServer(status);
      })
      .catch(() => {});
  }, []);

  const handleUpdateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg('');
    try {
      const { db } = await localApi.updateClassroom(activeClassroom.id, editForm);
      onDbUpdate(db);
      setSavedMsg('Datos del grupo actualizados.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      const { classroomId, db } = await localApi.createClassroom({
        name: newGroupName.trim(),
        schoolName: newSchoolName.trim() || 'Escuela Primaria',
        teacherName: activeClassroom.teacherName || 'Docente Titular',
        cycle: newCycle.trim() || '2026-2027',
        activePeriod: 'Trimestre 1',
      });
      onDbUpdate(db);
      setNewGroupName('');
      onSelectClassroom(classroomId);
    } finally {
      setCreating(false);
    }
  };

  const handleSeedDemo = async () => {
    setCreating(true);
    try {
      const { classroomId, db } = await localApi.seedSampleClassroom(
        activeClassroom.teacherName
      );
      onDbUpdate(db);
      onSelectClassroom(classroomId);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClassroom = async (classroomId: string) => {
    if (classrooms.length <= 1) return;
    const { db } = await localApi.deleteClassroom(classroomId);
    onDbUpdate(db);
    const fallback = classrooms.find((c) => c.id !== classroomId);
    if (fallback) onSelectClassroom(fallback.id);
  };

  const handleExportBackup = async () => {
    setExportingBackup(true);
    setBackupMsg('');
    setBackupError('');
    try {
      const dbData = await localApi.exportBackup();
      const today = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(dbData, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      saveAs(blob, `respaldo_aula_agil_${today}.json`);
      const nowIso = new Date().toISOString();
      setKeyStatus((prev) => (prev ? { ...prev, lastBackupAt: nowIso } : prev));
      onBackupRecorded?.(nowIso);
      setBackupMsg(`Copia de seguridad exportada: respaldo_aula_agil_${today}.json`);
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'No se pudo exportar la copia de seguridad.'
      );
    } finally {
      setExportingBackup(false);
    }
  };

  const handleSelectBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupMsg('');
    setBackupError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<LocalDatabase>;
      if (
        !parsed ||
        !Array.isArray(parsed.classrooms) ||
        !Array.isArray(parsed.students) ||
        !Array.isArray(parsed.assignments)
      ) {
        throw new Error(
          'El archivo JSON no corresponde a un respaldo válido de AulaÁgil.'
        );
      }
      setPendingRestore({
        fileName: file.name,
        data: {
          classrooms: parsed.classrooms,
          students: parsed.students,
          studentFiles: Array.isArray(parsed.studentFiles) ? parsed.studentFiles : [],
          attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
          assignments: parsed.assignments,
          incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
          gradingPeriods: Array.isArray(parsed.gradingPeriods) ? parsed.gradingPeriods : [],
          studentGrades: Array.isArray(parsed.studentGrades) ? parsed.studentGrades : [],
          dailyLogs: Array.isArray(parsed.dailyLogs) ? parsed.dailyLogs : [],
          lessonPlans: Array.isArray(parsed.lessonPlans) ? parsed.lessonPlans : [],
        },
      });
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'Archivo de respaldo inválido.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    setRestoringBackup(true);
    setBackupMsg('');
    setBackupError('');
    try {
      const { db } = await localApi.importBackup(pendingRestore.data);
      onDbUpdate(db);
      if (db.classrooms[0]) {
        onSelectClassroom(db.classrooms[0].id);
      }
      setPendingRestore(null);
      setBackupMsg('Respaldo restaurado correctamente en tu base de datos local.');
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'No se pudo restaurar el respaldo.'
      );
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleCheckOllama = async () => {
    setCheckingOllama(true);
    setOllamaMsg('');
    try {
      const res = await localApi.checkOllama(ollamaUrl);
      if (res.ok && res.models.length > 0) {
        setOllamaModels(res.models);
        if (!res.models.includes(ollamaModel)) {
          setOllamaModel(res.models[0]);
        }
        setOllamaMsg(
          `Ollama detectado en tu PC (${res.models.length} modelo(s) disponible(s)).`
        );
      } else {
        setOllamaModels([]);
        setOllamaMsg(
          res.error ||
            'Ollama no respondió en esta PC. Si lo instalaste, ábrelo y ejecuta: ollama pull qwen2.5:3b'
        );
      }
    } finally {
      setCheckingOllama(false);
    }
  };

  const movePriority = (engine: AiEngineKey, direction: -1 | 1) => {
    setAiPriorityOrder((prev) => {
      const idx = prev.indexOf(engine);
      if (idx === -1) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const toggleEngineEnabled = (engine: AiEngineKey) => {
    if (engine === 'offline') return;
    setEnabledAiProviders((prev) =>
      prev.includes(engine) ? prev.filter((e) => e !== engine) : [...prev, engine]
    );
  };

  const buildSavePayload = () => {
    const payload: Parameters<typeof localApi.saveKeys>[0] = {
      aiProvider,
      autoFailoverOnQuota,
      aiPriorityOrder,
      enabledAiProviders,
      ollamaUrl: ollamaUrl.trim() || 'http://127.0.0.1:11434',
      ollamaModel: ollamaModel.trim() || 'qwen2.5:3b',
      geminiModel: geminiModel.trim() || 'gemini-4-hydrogen',
      groqModel: groqModel.trim() || 'llama-3.3-70b-versatile',
      openrouterModel:
        openrouterModel.trim() || 'meta-llama/llama-3.3-70b-instruct:free',
      customOpenAiUrl: customOpenAiUrl.trim(),
      customOpenAiModel: customOpenAiModel.trim() || 'deepseek-chat',
    };
    if (geminiInput.trim()) payload.geminiApiKey = geminiInput.trim();
    if (groqInput.trim()) payload.groqApiKey = groqInput.trim();
    if (openrouterInput.trim()) payload.openrouterApiKey = openrouterInput.trim();
    if (customOpenAiKeyInput.trim()) payload.customOpenAiKey = customOpenAiKeyInput.trim();
    return payload;
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKeys(true);
    setKeysNotice('');
    setTestError('');
    try {
      const next = await localApi.saveKeys(buildSavePayload());
      applyStatusFromServer(next);
      setGeminiInput('');
      setGroqInput('');
      setOpenrouterInput('');
      setCustomOpenAiKeyInput('');
      setKeysNotice(
        'Configuración de IA y orden de respaldo guardados localmente en tu computadora.'
      );
    } finally {
      setSavingKeys(false);
    }
  };

  const handleResetCooldowns = async () => {
    const next = await localApi.resetAiCooldowns();
    applyStatusFromServer(next);
    setKeysNotice('Se reactivaron todas las IAs que estaban en pausa por límite de tokens.');
  };

  const handleTestChain = async () => {
    setTestingChain(true);
    setTestError('');
    setTestResult(null);
    setKeysNotice('');
    try {
      const saved = await localApi.saveKeys(buildSavePayload());
      applyStatusFromServer(saved);
      setGeminiInput('');
      setGroqInput('');
      setOpenrouterInput('');
      setCustomOpenAiKeyInput('');
      const res = await localApi.testAiChain();
      if (res.status) applyStatusFromServer(res.status);
      if (res._aiMeta) setTestResult(res._aiMeta);
    } catch (err) {
      setTestError(
        err instanceof Error ? err.message : 'No se pudo completar la prueba de IA.'
      );
    } finally {
      setTestingChain(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs font-medium text-slate-500 mb-1">
          Datos institucionales, respaldos locales (.json) y llaves gratuitas de IA
        </p>
        <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
          Configuración del grupo, respaldo e IA
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleUpdateClassroom}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Grupo activo: {activeClassroom.name}
              </h2>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>

            {savedMsg && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {savedMsg}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Grado y grupo
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ciclo escolar
                </label>
                <input
                  type="text"
                  required
                  value={editForm.cycle}
                  onChange={(e) => setEditForm((p) => ({ ...p, cycle: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre de la escuela (para Word .docx e impresiones)
                </label>
                <input
                  type="text"
                  value={editForm.schoolName}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, schoolName: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre del docente titular
                </label>
                <input
                  type="text"
                  value={editForm.teacherName}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, teacherName: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trimestre activo
                </label>
                <select
                  value={editForm.activePeriod}
                  onChange={(e) =>
                    setEditForm((p) => ({
                      ...p,
                      activePeriod: e.target.value as TrimesterPeriod,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="Trimestre 1">Trimestre 1</option>
                  <option value="Trimestre 2">Trimestre 2</option>
                  <option value="Trimestre 3">Trimestre 3</option>
                </select>
              </div>
            </div>
          </form>

          {/* Respaldo de Seguridad */}
          <div className="bg-white border border-blue-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-700" />
                  Respaldo de Seguridad (.json)
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {keyStatus?.dataDir
                    ? `Base local: ${keyStatus.dataDir}`
                    : 'Tus datos se guardan localmente en tu equipo. Exporta copias periódicas para proteger tu trabajo.'}
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                {keyStatus?.lastBackupAt
                  ? `Último respaldo: ${keyStatus.lastBackupAt.slice(0, 10)}`
                  : 'Sin respaldo registrado'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={exportingBackup}
                onClick={handleExportBackup}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
              >
                <Download className="w-4 h-4" />
                {exportingBackup ? 'Generando archivo...' : 'Exportar copia de seguridad (.json)'}
              </button>

              <label className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer">
                <Upload className="w-4 h-4" />
                Restaurar desde archivo (.json)
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleSelectBackupFile}
                  className="hidden"
                />
              </label>
            </div>

            {backupMsg && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {backupMsg}
              </p>
            )}
            {backupError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {backupError}
              </p>
            )}
          </div>

          {/* Multi-API Failover & Local Ollama */}
          <form
            onSubmit={handleSaveKeys}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-700" />
                  Motor de IA y cambio automático por tokens
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Conecta varias APIs o Ollama local. Si a una IA se le acaban los tokens o alcanza su límite, AulaÁgil cambia directo a la siguiente en tu lista sin perder tu trabajo.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestChain}
                disabled={testingChain}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingChain ? 'animate-spin' : ''}`} />
                {testingChain ? 'Probando cadena...' : 'Probar cadena de IA'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IA principal / Modo de inicio
                </label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as AiProviderMode)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="auto">
                    Automático según orden de prioridad
                  </option>
                  <option value="ollama">Iniciar con Ollama local</option>
                  <option value="gemini">Iniciar con Google Gemini</option>
                  <option value="groq">Iniciar con Groq</option>
                  <option value="openrouter">Iniciar con OpenRouter</option>
                  <option value="custom_openai">Iniciar con API personalizada</option>
                  <option value="offline">Solo modo básico offline</option>
                </select>
              </div>

              <label className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoFailoverOnQuota}
                  onChange={(e) => setAutoFailoverOnQuota(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="block text-slate-900">
                    Cambiar automáticamente al agotar tokens
                  </strong>
                  Si la IA activa devuelve límite de cuota o tokens (HTTP 429), pasa directo a la siguiente IA disponible y pausa la agotada por 15 min.
                </span>
              </label>
            </div>

            {/* Reorderable Failover Priority List */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Orden de respaldo automático (de arriba hacia abajo)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Usa las flechas para decidir qué IA intenta primero y cuáles entran al acabarse los tokens.
                  </p>
                </div>
                {keyStatus && keyStatus.cooldowns.length > 0 && (
                  <button
                    type="button"
                    onClick={handleResetCooldowns}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reactivar pausadas ({keyStatus.cooldowns.length})
                  </button>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                {aiPriorityOrder.map((engine, index) => {
                  const meta = ENGINE_DETAILS[engine];
                  const isEnabled = enabledAiProviders.includes(engine);
                  const cooldown = keyStatus?.cooldowns.find(
                    (c) => c.provider === engine
                  );
                  const configuredText =
                    engine === 'offline'
                      ? 'Siempre listo'
                      : engine === 'ollama'
                      ? ollamaModels.length > 0
                        ? `Detectado (${ollamaModels.length} modelo${ollamaModels.length > 1 ? 's' : ''})`
                        : 'Local Windows'
                      : engine === 'gemini'
                      ? keyStatus?.hasGeminiKey
                        ? `Lista · ${keyStatus.geminiKeyCount} llave${keyStatus.geminiKeyCount > 1 ? 's' : ''}`
                        : 'Sin llave'
                      : engine === 'groq'
                      ? keyStatus?.hasGroqKey
                        ? `Lista · ${keyStatus.groqKeyCount} llave${keyStatus.groqKeyCount > 1 ? 's' : ''}`
                        : 'Sin llave'
                      : engine === 'openrouter'
                      ? keyStatus?.hasOpenrouterKey
                        ? `Lista · ${keyStatus.openrouterKeyCount} llave${keyStatus.openrouterKeyCount > 1 ? 's' : ''}`
                        : 'Sin llave'
                      : keyStatus?.hasCustomOpenAiKey
                      ? 'Configurada'
                      : 'Opcional';

                  return (
                    <div
                      key={engine}
                      className={`px-3 py-2.5 flex items-center justify-between gap-3 ${
                        isEnabled ? 'bg-white' : 'bg-slate-50 opacity-65'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono font-semibold text-slate-400 tabular-nums w-5 shrink-0">
                          {index + 1}.
                        </span>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          disabled={engine === 'offline'}
                          onChange={() => toggleEngineEnabled(engine)}
                          aria-label={`Activar ${meta.title}`}
                          className="h-4 w-4 rounded border-slate-300 text-blue-700 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-800">
                              {meta.title}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={
                                cooldown
                                  ? 'text-amber-700 font-medium tabular-nums'
                                  : configuredText.startsWith('Sin')
                                  ? 'text-slate-400'
                                  : 'text-emerald-700 font-medium'
                              }
                            >
                              {cooldown
                                ? `Sin tokens · en pausa (${cooldown.remainingMinutes} min)`
                                : configuredText}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate">
                            {meta.subtitle}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => movePriority(engine, -1)}
                          disabled={index === 0}
                          title="Subir prioridad"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 rounded-md"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => movePriority(engine, 1)}
                          disabled={index === aiPriorityOrder.length - 1}
                          title="Bajar prioridad"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 rounded-md"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {testResult && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  Prueba completada con: {testResult.providerLabel}
                </p>
                {testResult.failoverTriggered && testResult.failoverReason && (
                  <p className="text-amber-800">
                    Cambio automático activado: {testResult.failoverReason}
                  </p>
                )}
                <p className="text-[11px] text-emerald-800">
                  Recorrido:{' '}
                  {testResult.attempts
                    .map(
                      (a) =>
                        `${a.label} (${
                          a.status === 'ok'
                            ? 'respondió'
                            : a.status === 'quota_exhausted'
                            ? 'sin tokens'
                            : a.status === 'cooldown'
                            ? 'en pausa'
                            : a.status === 'unavailable'
                            ? 'sin configurar'
                            : 'no disponible'
                        })`
                    )
                    .join(' → ')}
                </p>
              </div>
            )}

            {testError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {testError}
              </p>
            )}

            {/* Ollama Local Section */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-slate-700" />
                  <span className="text-xs font-semibold text-slate-800">
                    1. Ollama local en Windows (gratis, sin límite de tokens)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCheckOllama}
                  disabled={checkingOllama}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingOllama ? 'animate-spin' : ''}`} />
                  {checkingOllama ? 'Detectando...' : 'Detectar Ollama local'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Dirección local de Ollama
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder="http://127.0.0.1:11434"
                    className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Modelo local (ej. qwen2.5:3b, llama3.2:3b)
                  </label>
                  {ollamaModels.length > 0 ? (
                    <select
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                    >
                      {ollamaModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      placeholder="qwen2.5:3b"
                      className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  )}
                </div>
              </div>

              {ollamaMsg && (
                <p
                  className={`text-xs px-3 py-2 rounded-lg border ${
                    ollamaModels.length > 0
                      ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                      : 'text-amber-800 bg-amber-50 border-amber-200'
                  }`}
                >
                  {ollamaMsg}
                </p>
              )}
            </div>

            {/* Cloud API Keys Section */}
            <div className="space-y-4 pt-1">
              <div>
                <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                  2. Llaves de APIs en la nube (puedes pegar varias llaves separadas por coma)
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Si pegas 2 o más llaves en un mismo campo separadas por coma, primero rotará entre esas llaves y luego cambiará a la siguiente IA.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Google Gemini ({keyStatus?.hasGeminiKey ? `${keyStatus.geminiKeyCount} configurada(s)` : 'Opcional'})
                  </label>
                  <input
                    type="password"
                    placeholder={
                      keyStatus?.hasGeminiKey
                        ? '•••••••••••• (vacío para conservar)'
                        : 'AIza..., AIza... (una o varias)'
                    }
                    value={geminiInput}
                    onChange={(e) => setGeminiInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="mt-1.5 w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 rounded-lg bg-white text-slate-600"
                  >
                    <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Groq ({keyStatus?.hasGroqKey ? `${keyStatus.groqKeyCount} configurada(s)` : 'Opcional'})
                  </label>
                  <input
                    type="password"
                    placeholder={
                      keyStatus?.hasGroqKey
                        ? '•••••••••••• (vacío para conservar)'
                        : 'gsk_..., gsk_... (una o varias)'
                    }
                    value={groqInput}
                    onChange={(e) => setGroqInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    value={groqModel}
                    onChange={(e) => setGroqModel(e.target.value)}
                    placeholder="llama-3.3-70b-versatile"
                    className="mt-1.5 w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 rounded-lg text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    OpenRouter ({keyStatus?.hasOpenrouterKey ? `${keyStatus.openrouterKeyCount} configurada(s)` : 'Opcional'})
                  </label>
                  <input
                    type="password"
                    placeholder={
                      keyStatus?.hasOpenrouterKey
                        ? '•••••••••••• (vacío para conservar)'
                        : 'sk-or-v1-... (modelos gratis)'
                    }
                    value={openrouterInput}
                    onChange={(e) => setOpenrouterInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    value={openrouterModel}
                    onChange={(e) => setOpenrouterModel(e.target.value)}
                    placeholder="meta-llama/llama-3.3-70b-instruct:free"
                    className="mt-1.5 w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 rounded-lg text-slate-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    API compatible OpenAI / LM Studio / DeepSeek
                  </label>
                  <input
                    type="password"
                    placeholder={
                      keyStatus?.hasCustomOpenAiKey
                        ? '•••••••••••• (vacío para conservar)'
                        : 'API Key (opcional si es servidor local)'
                    }
                    value={customOpenAiKeyInput}
                    onChange={(e) => setCustomOpenAiKeyInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                    <input
                      type="text"
                      value={customOpenAiUrl}
                      onChange={(e) => setCustomOpenAiUrl(e.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                      className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 rounded-lg text-slate-600"
                    />
                    <input
                      type="text"
                      value={customOpenAiModel}
                      onChange={(e) => setCustomOpenAiModel(e.target.value)}
                      placeholder="deepseek-chat"
                      className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 rounded-lg text-slate-600"
                    />
                  </div>
                </div>
              </div>
            </div>

            {keysNotice && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {keysNotice}
              </p>
            )}

            <button
              type="submit"
              disabled={savingKeys}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              {savingKeys ? 'Guardando...' : 'Guardar configuración y orden de IA'}
            </button>
          </form>
        </div>

        {/* Right Column: Manage Classrooms */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={handleCreateClassroom}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Crear otro grupo
            </h2>
            <div className="space-y-3">
              <input
                type="text"
                required
                placeholder="Grado y grupo (ej. 5° B)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                placeholder="Nombre de la escuela"
                value={newSchoolName}
                onChange={(e) => setNewSchoolName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                placeholder="Ciclo escolar (2026-2027)"
                value={newCycle}
                onChange={(e) => setNewCycle(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                <FolderPlus className="w-4 h-4" />
                Crear grupo vacío
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleSeedDemo}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
              >
                <Sparkles className="w-4 h-4" />
                Cargar grupo ejemplo 4° A
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Mis grupos ({classrooms.length})
            </h3>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {classrooms.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectClassroom(c.id)}
                    className={`text-left text-sm font-medium ${
                      c.id === activeClassroom.id ? 'text-blue-700' : 'text-slate-700'
                    }`}
                  >
                    {c.name} · <span className="text-xs text-slate-500">{c.cycle}</span>
                  </button>
                  {classrooms.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteClassroom(c.id)}
                      title="Eliminar grupo"
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Confirmar restauración de respaldo
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Archivo: <span className="font-mono font-semibold">{pendingRestore.fileName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1 tabular-nums">
              <p><strong>Contenido detectado:</strong></p>
              <p>· {pendingRestore.data.classrooms.length} grupo(s) escolar(es)</p>
              <p>· {pendingRestore.data.students.length} estudiante(s)</p>
              <p>· {pendingRestore.data.assignments.length} actividad(es) y {pendingRestore.data.attendance.length} pase(s) de lista</p>
              <p>· {pendingRestore.data.incidents.length} registro(s) de conducta y {pendingRestore.data.dailyLogs.length} bitácora(s)</p>
              <p>· {pendingRestore.data.lessonPlans.length} planeación(es) guardada(s)</p>
            </div>

            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Esta acción sobrescribirá los datos actuales guardados en esta computadora.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={restoringBackup}
                onClick={handleConfirmRestore}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
              >
                {restoringBackup ? 'Restaurando...' : 'Confirmar y restaurar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
