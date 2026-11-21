import { useEffect, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Bot,
  Camera,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  HardDrive,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
  UserCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import { processAvatarImage } from '../lib/fileUtils';
import {
  getCachedDriveAccessToken,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from '../lib/googleDriveAuth';
import { BackupModal, type BackupModalState } from './BackupModal';
import type {
  AiEngineKey,
  AiExecutionMeta,
  AiProviderMode,
  ApiKeyStatus,
  AppUpdaterState,
  Classroom,
  DriveAutoSchedule,
  DriveBackupFile,
  DriveBackupManifest,
  DriveBackupStatus,
  LocalDatabase,
  TrimesterPeriod,
  UserProfile,
} from '../types';

function formatBytesMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCompactFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isSafeGitHubHref(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host === 'objects.githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

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
  currentUser?: UserProfile | null;
  updater: AppUpdaterState;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onQuitAndInstall: () => void;
  onOpenDirectDownload: () => void;
  onProfileUpdate?: (user: UserProfile) => void;
  onSelectClassroom: (classroomId: string) => void;
  onDbUpdate: (db: LocalDatabase) => void;
  onBackupRecorded?: (timestamp: string) => void;
}

export function SettingsView({
  classrooms,
  activeClassroom,
  currentUser,
  updater,
  onCheckUpdates,
  onDownloadUpdate,
  onQuitAndInstall,
  onOpenDirectDownload,
  onProfileUpdate,
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
  const [pendingRestore, setPendingRestore] = useState<
    | { kind: 'json'; fileName: string; data: LocalDatabase }
    | { kind: 'zip'; fileName: string; sizeBytes: number; zipBase64: string }
    | null
  >(null);
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

  // Local profile & password state
  const [profileDisplayName, setProfileDisplayName] = useState(
    currentUser?.displayName || activeClassroom.teacherName || ''
  );
  const [profileUsername, setProfileUsername] = useState(
    currentUser?.username || ''
  );
  const [profileAvatar, setProfileAvatar] = useState(
    currentUser?.avatarDataUrl || ''
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmNewPwd, setConfirmNewPwd] = useState('');
  const [showPwdFields, setShowPwdFields] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  // Google Drive Cloud Backup state
  const [driveStatus, setDriveStatus] = useState<DriveBackupStatus | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveBackupFile[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [backingUpDrive, setBackingUpDrive] = useState(false);
  const [driveProgressLabel, setDriveProgressLabel] = useState('');
  const [driveProgressPct, setDriveProgressPct] = useState(0);
  const [driveMsg, setDriveMsg] = useState('');
  const [driveError, setDriveError] = useState('');
  const [desktopAuthUrl, setDesktopAuthUrl] = useState('');
  const [backupModal, setBackupModal] = useState<BackupModalState>(null);
  const [previewManifest, setPreviewManifest] = useState<DriveBackupManifest | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setProfileDisplayName(currentUser.displayName || '');
    setProfileUsername(currentUser.username || '');
    setProfileAvatar(currentUser.avatarDataUrl || '');
  }, [currentUser]);

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

  const refreshDriveFiles = async () => {
    setLoadingDrive(true);
    setDriveError('');
    try {
      const res = await localApi.listDriveBackups();
      setDriveFiles(res.files || []);
      if (res.status) setDriveStatus(res.status);
    } catch (err) {
      setDriveError(
        err instanceof Error
          ? err.message
          : 'No se pudo consultar la carpeta de respaldos en Google Drive.'
      );
    } finally {
      setLoadingDrive(false);
    }
  };

  useEffect(() => {
    localApi
      .getKeyStatus()
      .then((status) => {
        applyStatusFromServer(status);
      })
      .catch(() => {});

    localApi
      .getDriveBackupStatus()
      .then((st) => {
        setDriveStatus(st);
        const canFetchNow =
          st.authMode === 'desktop_oauth' ||
          (st.authMode === 'firebase' && Boolean(getCachedDriveAccessToken()));
        if (st.connected && canFetchNow) {
          refreshDriveFiles().catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProfileErr('');
    try {
      const dataUrl = await processAvatarImage(file);
      setProfileAvatar(dataUrl);
    } catch (err) {
      setProfileErr(
        err instanceof Error ? err.message : 'No se pudo procesar la foto.'
      );
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErr('');
    setProfileMsg('');
    if (!profileUsername.trim() || profileUsername.trim().length < 3) {
      setProfileErr('El nombre de usuario debe tener al menos 3 caracteres.');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await localApi.updateProfile({
        displayName: profileDisplayName.trim(),
        username: profileUsername.trim(),
        avatarDataUrl: profileAvatar,
      });
      onProfileUpdate?.(res.user);
      setProfileMsg('Perfil docente actualizado.');
    } catch (err) {
      setProfileErr(
        err instanceof Error ? err.message : 'No se pudo guardar el perfil.'
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdErr('');
    setPwdMsg('');
    if (!currentPwd) {
      setPwdErr('Ingresa tu contraseña actual.');
      return;
    }
    if (newPwd.length < 6) {
      setPwdErr('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPwd !== confirmNewPwd) {
      setPwdErr('La confirmación de contraseña no coincide.');
      return;
    }
    setSavingPwd(true);
    try {
      const res = await localApi.changePassword({
        currentPassword: currentPwd,
        newPassword: newPwd,
      });
      onProfileUpdate?.(res.user);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmNewPwd('');
      setPwdMsg('Contraseña local actualizada correctamente.');
    } catch (err) {
      setPwdErr(
        err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.'
      );
    } finally {
      setSavingPwd(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    setConnectingDrive(true);
    setDriveError('');
    setDriveMsg('');
    setDesktopAuthUrl('');
    try {
      const { user } = await signInWithGoogleDrive();
      const status = await localApi.syncFirebaseDriveProfile({
        email: user.email || '',
        name: user.displayName || '',
        avatar: user.photoURL || '',
      });
      setDriveStatus(status);
      setDriveMsg(
        `Cuenta vinculada correctamente (${status.userEmail || user.email || 'Google Drive'}).`
      );
      await refreshDriveFiles();
    } catch (err) {
      setDriveError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con Google Drive.'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleStartDesktopOAuth = async () => {
    setConnectingDrive(true);
    setDriveError('');
    setDriveMsg('');
    try {
      const { authUrl } = await localApi.startDesktopDriveOAuth();
      setDesktopAuthUrl(authUrl);
      if (window.aulaAgilDrive) {
        await window.aulaAgilDrive.openAuthUrl(authUrl);
      }
      setDriveMsg(
        'Autoriza el acceso en la pestaña de Google que se abrió. Detectando vinculación automáticamente...'
      );
      // Poll briefly for loopback callback completion
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        try {
          const st = await localApi.getDriveBackupStatus();
          if (st.connected && st.authMode === 'desktop_oauth') {
            clearInterval(timer);
            setDriveStatus(st);
            setDesktopAuthUrl('');
            setConnectingDrive(false);
            setDriveMsg(
              `Cuenta de escritorio conectada (${st.userEmail || 'Google Drive'}) con renovación automática.`
            );
            refreshDriveFiles().catch(() => {});
          } else if (attempts >= 45) {
            clearInterval(timer);
            setConnectingDrive(false);
          }
        } catch {
          if (attempts >= 45) {
            clearInterval(timer);
            setConnectingDrive(false);
          }
        }
      }, 2000);
    } catch (err) {
      setConnectingDrive(false);
      setDriveError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar la vinculación de escritorio.'
      );
    }
  };

  const handleDisconnectDrive = async () => {
    setDriveError('');
    setDriveMsg('');
    setDesktopAuthUrl('');
    try {
      await signOutGoogleDrive();
      const st = await localApi.disconnectDriveBackup();
      setDriveStatus(st);
      setDriveFiles([]);
      setDriveMsg('Cuenta de Google Drive desvinculada de esta computadora.');
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'No se pudo desvincular la cuenta.'
      );
    }
  };

  const handleBackupNowToDrive = async () => {
    setBackingUpDrive(true);
    setDriveError('');
    setDriveMsg('');
    setDriveProgressPct(25);
    setDriveProgressLabel('Preparando base SQLite y archivos adjuntos...');

    const stepTimer = setTimeout(() => {
      setDriveProgressPct(65);
      setDriveProgressLabel('Empaquetando .zip y subiendo a Google Drive...');
    }, 450);

    try {
      const res = await localApi.backupNowToDrive();
      clearTimeout(stepTimer);
      setDriveProgressPct(100);
      setDriveProgressLabel('Respaldo completado.');
      setDriveStatus(res.status);
      if (res.status.lastBackupAt) onBackupRecorded?.(res.status.lastBackupAt);
      setDriveMsg(
        `Copia "${res.file.name}" guardada en la carpeta ${res.status.folderName}.`
      );
      await refreshDriveFiles();
    } catch (err) {
      clearTimeout(stepTimer);
      setDriveProgressPct(0);
      setDriveProgressLabel('');
      setDriveError(
        err instanceof Error
          ? err.message
          : 'No se pudo completar la copia de seguridad en Google Drive.'
      );
    } finally {
      setBackingUpDrive(false);
    }
  };

  const handleChangeDriveSchedule = async (schedule: DriveAutoSchedule) => {
    setDriveError('');
    try {
      const st = await localApi.saveDriveBackupSettings({ autoSchedule: schedule });
      setDriveStatus(st);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'No se pudo guardar la programación.'
      );
    }
  };

  const handleChangeMaxBackups = async (maxBackups: number) => {
    setDriveError('');
    try {
      const st = await localApi.saveDriveBackupSettings({ maxBackups });
      setDriveStatus(st);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'No se pudo guardar el historial máximo.'
      );
    }
  };

  const handleOpenRestoreDriveModal = async (file: DriveBackupFile) => {
    setBackupModal({ type: 'restore_drive', file });
    setPreviewManifest(null);
    setPreviewError('');
    setLoadingPreview(true);
    try {
      const res = await localApi.previewDriveBackup(file.id);
      setPreviewManifest(res.manifest);
    } catch (err) {
      setPreviewError(
        err instanceof Error
          ? err.message
          : 'No se pudo descargar o verificar este respaldo.'
      );
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConfirmRestoreDrive = async (file: DriveBackupFile) => {
    setModalBusy(true);
    setDriveError('');
    setDriveMsg('');
    try {
      const res = await localApi.restoreDriveBackup(file.id);
      onDbUpdate(res.db);
      if (res.user) onProfileUpdate?.(res.user);
      if (res.status) setDriveStatus(res.status);
      setBackupModal(null);
      setDriveMsg(
        `Respaldo "${file.name}" restaurado correctamente (${res.manifest.classroomCount} grupos y ${res.manifest.studentCount} alumnos).`
      );
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : 'Error al restaurar desde Google Drive.'
      );
    } finally {
      setModalBusy(false);
    }
  };

  const handleConfirmDeleteDrive = async (file: DriveBackupFile) => {
    setModalBusy(true);
    setDriveError('');
    try {
      await localApi.deleteDriveBackup(file.id);
      setBackupModal(null);
      setDriveMsg(`Copia "${file.name}" eliminada de Google Drive.`);
      await refreshDriveFiles();
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'No se pudo eliminar el respaldo.'
      );
      setBackupModal(null);
    } finally {
      setModalBusy(false);
    }
  };

  const handleSaveDesktopCredentials = async (payload: {
    clientId: string;
    clientSecret: string;
    clearCustomCredentials?: boolean;
  }) => {
    const st = await localApi.saveDriveBackupSettings(payload);
    setDriveStatus(st);
    setDriveMsg(
      payload.clearCustomCredentials
        ? 'Credenciales de escritorio eliminadas.'
        : 'Credenciales de escritorio guardadas en SQLite local.'
    );
  };

  const handleDownloadFullZip = async () => {
    setDownloadingZip(true);
    setBackupError('');
    setBackupMsg('');
    try {
      const { blob, fileName } = await localApi.downloadFullZipBackup();
      saveAs(blob, fileName);
      setBackupMsg(`Paquete completo "${fileName}" descargado correctamente.`);
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'No se pudo generar el archivo .zip.'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

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
      if (file.name.toLowerCase().endsWith('.zip')) {
        const buf = new Uint8Array(await file.arrayBuffer());
        if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
          throw new Error('El archivo seleccionado no es un paquete .zip válido.');
        }
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode(...buf.subarray(i, i + chunk));
        }
        const zipBase64 = btoa(binary);
        setPendingRestore({
          kind: 'zip',
          fileName: file.name,
          sizeBytes: file.size,
          zipBase64,
        });
        return;
      }

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
        kind: 'json',
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
      if (pendingRestore.kind === 'zip') {
        const res = await localApi.restoreFullZipBackup(pendingRestore.zipBase64);
        onDbUpdate(res.db);
        if (res.user) onProfileUpdate?.(res.user);
        if (res.db.classrooms[0]) {
          onSelectClassroom(res.db.classrooms[0].id);
        }
        setPendingRestore(null);
        setBackupMsg(
          `Respaldo completo .zip restaurado (${res.manifest.classroomCount} grupos, ${res.manifest.studentCount} alumnos y ${res.manifest.attachmentCount} adjuntos).`
        );
      } else {
        const { db } = await localApi.importBackup(pendingRestore.data);
        onDbUpdate(db);
        if (db.classrooms[0]) {
          onSelectClassroom(db.classrooms[0].id);
        }
        setPendingRestore(null);
        setBackupMsg('Respaldo restaurado correctamente en tu base de datos local.');
      }
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

          {/* Respaldo de Seguridad Local y en la Nube (Google Drive) */}
          <div className="bg-white border border-blue-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-700" />
                  Respaldos locales y en Google Drive
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {keyStatus?.dataDir
                    ? `Base local: ${keyStatus.dataDir}`
                    : 'Tus datos viajan directo de tu computadora a tu propio Google Drive o archivo local sin servidores intermedios.'}
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
                {driveStatus?.lastBackupAt
                  ? `Último respaldo nube: ${driveStatus.lastBackupAt.slice(0, 10)}`
                  : keyStatus?.lastBackupAt
                  ? `Último respaldo: ${keyStatus.lastBackupAt.slice(0, 10)}`
                  : 'Sin respaldo registrado'}
              </span>
            </div>

            {/* Google Drive Cloud Integration */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-blue-700" />
                    Respaldo privado en Google Drive (.zip completo)
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Empaqueta tu base SQLite, grupos, expedientes y archivos adjuntos en la carpeta{' '}
                    <span className="font-medium text-slate-800">
                      {driveStatus?.folderName || 'AulaÁgil - Respaldos'}
                    </span>{' '}
                    con acceso exclusivo de esta app.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setBackupModal({ type: 'desktop_credentials' })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {driveStatus?.hasDesktopCredentials
                    ? 'Credenciales escritorio activas'
                    : 'Client ID / Secret (opcional)'}
                </button>
              </div>

              {!driveStatus?.connected ? (
                <div className="flex flex-wrap items-center gap-3">
                  {/* Official Sign in with Google button style */}
                  <button
                    type="button"
                    onClick={handleConnectGoogleDrive}
                    disabled={connectingDrive}
                    className="inline-flex items-center gap-3 px-4 py-2 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs disabled:opacity-60 whitespace-nowrap"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      className="w-4 h-4 shrink-0"
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                    <span>
                      {connectingDrive
                        ? 'Conectando...'
                        : 'Conectar con Google Drive'}
                    </span>
                  </button>

                  {driveStatus?.hasDesktopCredentials && (
                    <button
                      type="button"
                      onClick={handleStartDesktopOAuth}
                      disabled={connectingDrive}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      Vincular modo Escritorio (Loopback)
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Linked account bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      {driveStatus.userAvatar ? (
                        <img
                          src={driveStatus.userAvatar}
                          alt={driveStatus.userName || driveStatus.userEmail}
                          className="w-9 h-9 rounded-lg border border-slate-200 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg border border-slate-200 bg-blue-50 text-blue-700 flex items-center justify-center font-display text-xs font-bold shrink-0">
                          {(driveStatus.userName || driveStatus.userEmail || 'GD')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {driveStatus.userName || 'Cuenta de Google vinculada'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {driveStatus.userEmail || 'Google Drive activo'} ·{' '}
                          {driveStatus.authMode === 'desktop_oauth'
                            ? 'Modo escritorio persistente'
                            : 'Sesión web activa'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleDisconnectDrive}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg whitespace-nowrap"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Desvincular cuenta
                    </button>
                  </div>

                  {/* Manual backup button & schedule */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-5">
                      <button
                        type="button"
                        onClick={handleBackupNowToDrive}
                        disabled={backingUpDrive}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                      >
                        <CloudUpload className="w-4 h-4" />
                        {backingUpDrive
                          ? 'Subiendo respaldo...'
                          : 'Hacer copia de seguridad ahora'}
                      </button>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Respaldo automático
                      </label>
                      <select
                        value={driveStatus.autoSchedule}
                        onChange={(e) =>
                          handleChangeDriveSchedule(e.target.value as DriveAutoSchedule)
                        }
                        className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="off">Desactivado</option>
                        <option value="on_close">Al cerrar la aplicación</option>
                        <option value="daily">Cada 24 horas</option>
                        <option value="weekly">Semanal</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Conservar últimas
                      </label>
                      <select
                        value={driveStatus.maxBackups}
                        onChange={(e) =>
                          handleChangeMaxBackups(Number(e.target.value))
                        }
                        className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white tabular-nums"
                      >
                        <option value={3}>3 copias</option>
                        <option value={5}>5 copias</option>
                        <option value={10}>10 copias</option>
                        <option value={15}>15 copias</option>
                      </select>
                    </div>
                  </div>

                  {driveStatus.autoSchedule !== 'off' &&
                    driveStatus.authMode === 'firebase' && (
                      <p className="text-[11px] text-slate-500">
                        Nota: El respaldo automático diario/semanal funciona mientras tengas sesión abierta en Google; para respaldos silenciosos al cerrar el programa <code className="font-mono">.exe</code> sin ventana, configura opcionalmente credenciales de escritorio.
                      </p>
                    )}

                  {/* Progress bar during cloud backup */}
                  {backingUpDrive && (
                    <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                        <span>{driveProgressLabel}</span>
                        <span className="font-mono font-semibold">{driveProgressPct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-700 transition-all duration-300"
                          style={{ width: `${driveProgressPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {driveStatus.lastBackupAt && (
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Último respaldo exitoso:{' '}
                      <span className="font-medium text-slate-700">
                        {new Date(driveStatus.lastBackupAt).toLocaleString('es-MX')}
                      </span>
                      {driveStatus.lastBackupFile
                        ? ` (${driveStatus.lastBackupFile})`
                        : ''}
                    </p>
                  )}

                  {/* Cloud Backups List */}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-800">
                        Respaldos guardados en Drive ({driveFiles.length})
                      </p>
                      <button
                        type="button"
                        onClick={refreshDriveFiles}
                        disabled={loadingDrive}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${loadingDrive ? 'animate-spin' : ''}`}
                        />
                        {loadingDrive ? 'Actualizando...' : 'Actualizar lista'}
                      </button>
                    </div>

                    {driveFiles.length === 0 ? (
                      <div className="p-4 text-xs text-slate-500 text-center">
                        {loadingDrive
                          ? 'Consultando archivos en tu carpeta de Google Drive...'
                          : driveStatus.authMode === 'firebase' &&
                            !getCachedDriveAccessToken()
                          ? 'Vuelve a presionar "Conectar con Google Drive" para listar o subir archivos en esta sesión.'
                          : 'Aún no hay respaldos .zip en tu carpeta de Google Drive.'}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                        {driveFiles.map((file) => (
                          <div
                            key={file.id}
                            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-mono font-medium text-slate-900 truncate">
                                {file.name}
                              </p>
                              <p className="text-[11px] text-slate-500 tabular-nums">
                                {file.createdTime
                                  ? new Date(file.createdTime).toLocaleString('es-MX')
                                  : '—'}{' '}
                                · {formatCompactFileSize(file.sizeBytes)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleOpenRestoreDriveModal(file)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md whitespace-nowrap"
                              >
                                <CloudDownload className="w-3.5 h-3.5" />
                                Restaurar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setBackupModal({ type: 'delete_drive', file })
                                }
                                title="Eliminar copia de Google Drive"
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {driveStatus.authMode === 'firebase' &&
                    !getCachedDriveAccessToken() && (
                      <button
                        type="button"
                        onClick={handleConnectGoogleDrive}
                        disabled={connectingDrive}
                        className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Renovar permiso de sesión con Google Drive
                      </button>
                    )}
                </div>
              )}

              {desktopAuthUrl && !driveStatus?.connected && (
                <div className="p-3 bg-white border border-blue-200 rounded-lg text-xs text-slate-700 space-y-1">
                  <p>Si el navegador no se abrió automáticamente, usa este enlace seguro:</p>
                  <a
                    href={desktopAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-blue-700 underline break-all"
                  >
                    Autorizar acceso en Google <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {driveMsg && (
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {driveMsg}
                </p>
              )}
              {driveError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {driveError}
                </p>
              )}
            </div>

            {/* Local Backup Export / Import */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-700">
                Respaldo manual en archivo local (.zip completo o .json)
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={downloadingZip}
                  onClick={handleDownloadFullZip}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloadingZip
                    ? 'Empaquetando .zip...'
                    : 'Descargar respaldo completo (.zip)'}
                </button>

                <button
                  type="button"
                  disabled={exportingBackup}
                  onClick={handleExportBackup}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingBackup ? 'Generando...' : 'Exportar JSON'}
                </button>

                <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Restaurar archivo (.zip / .json)
                  <input
                    type="file"
                    accept="application/json,.json,.zip,application/zip"
                    onChange={handleSelectBackupFile}
                    className="hidden"
                  />
                </label>
              </div>
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

        {/* Right Column: User Profile & Manage Classrooms */}
        <div className="lg:col-span-5 space-y-6">
          {currentUser && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-blue-700" />
                    Mi perfil y acceso local
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Protege el inicio de sesión en esta computadora sin usar internet.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                    {profileAvatar ? (
                      <img
                        src={profileAvatar}
                        alt={profileDisplayName || currentUser.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-display text-base font-bold text-blue-700">
                        {(profileDisplayName || currentUser.username || 'AA')
                          .trim()
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap">
                      <Camera className="w-3.5 h-3.5" />
                      Cambiar foto
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </label>
                    {profileAvatar && (
                      <button
                        type="button"
                        onClick={() => setProfileAvatar('')}
                        className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-red-600 rounded-lg whitespace-nowrap"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nombre visible
                    </label>
                    <input
                      type="text"
                      value={profileDisplayName}
                      onChange={(e) => setProfileDisplayName(e.target.value)}
                      placeholder="Mtra. Laura Hernández"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Usuario de acceso
                    </label>
                    <input
                      type="text"
                      required
                      value={profileUsername}
                      onChange={(e) => setProfileUsername(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                {profileErr && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {profileErr}
                  </p>
                )}
                {profileMsg && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    {profileMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingProfile ? 'Guardando...' : 'Guardar perfil'}
                </button>
              </form>

              <form
                onSubmit={handleChangePassword}
                className="pt-4 border-t border-slate-100 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    Cambiar contraseña local
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPwdFields((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800"
                  >
                    {showPwdFields ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Ocultar
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Mostrar
                      </>
                    )}
                  </button>
                </div>

                <input
                  type={showPwdFields ? 'text' : 'password'}
                  placeholder="Contraseña actual"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type={showPwdFields ? 'text' : 'password'}
                    placeholder="Nueva contraseña (mín. 6)"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  <input
                    type={showPwdFields ? 'text' : 'password'}
                    placeholder="Confirmar nueva"
                    value={confirmNewPwd}
                    onChange={(e) => setConfirmNewPwd(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>

                {pwdErr && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {pwdErr}
                  </p>
                )}
                {pwdMsg && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    {pwdMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingPwd}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {savingPwd ? 'Actualizando...' : 'Actualizar contraseña'}
                </button>
              </form>
            </div>
          )}

          {/* Actualizaciones del Sistema */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <ArrowDownToLine className="w-5 h-5 text-blue-700" />
                  Actualizaciones del Sistema
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tus grupos, SQLite y expedientes locales permanecen intactos al actualizar.
                </p>
              </div>
              <span className="px-2.5 py-1 text-xs font-mono font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap tabular-nums">
                v{updater.currentVersion}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCheckUpdates}
                disabled={
                  updater.status === 'checking' || updater.status === 'downloading'
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    updater.status === 'checking' ? 'animate-spin' : ''
                  }`}
                />
                {updater.status === 'checking'
                  ? 'Buscando actualizaciones...'
                  : 'Buscar actualizaciones'}
              </button>

              {updater.lastCheckedAt && (
                <span className="text-[11px] text-slate-400 tabular-nums">
                  Última consulta:{' '}
                  {new Date(updater.lastCheckedAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>

            {updater.status === 'up-to-date' && (
              <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  {updater.message || 'Ya cuentas con la última versión instalada.'}
                </span>
              </div>
            )}

            {updater.status === 'unconfigured' && (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 space-y-1">
                <p className="font-semibold text-slate-800">
                  Repositorio de GitHub pendiente de configurar
                </p>
                <p className="text-slate-600">
                  Edita <code className="font-mono">owner</code> y{' '}
                  <code className="font-mono">repo</code> en{' '}
                  <code className="font-mono">electron-builder.yml</code> antes de
                  publicar tus releases en GitHub.
                </p>
              </div>
            )}

            {updater.status === 'error' && updater.error && (
              <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{updater.error}</span>
              </div>
            )}

            {(updater.status === 'available' ||
              updater.status === 'downloading' ||
              updater.status === 'downloaded') && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-blue-800">
                      {updater.status === 'downloaded'
                        ? `Versión v${updater.availableVersion} lista para instalar`
                        : `Nueva versión disponible: v${updater.availableVersion}`}
                    </p>
                    {updater.releaseDate && (
                      <p className="text-[11px] text-slate-500">
                        Publicada el {String(updater.releaseDate).slice(0, 10)}
                      </p>
                    )}
                  </div>
                  <span className="px-2 py-0.5 text-[11px] font-mono font-semibold text-blue-800 bg-blue-100 border border-blue-200 rounded">
                    v{updater.availableVersion}
                  </span>
                </div>

                {/* Safe plain-text Changelog */}
                <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="text-[11px] font-semibold text-slate-700">
                    Notas de la versión (Changelog)
                  </p>
                  <div className="text-xs text-slate-600 whitespace-pre-line max-h-36 overflow-y-auto leading-relaxed">
                    {updater.releaseNotes ||
                      'Mejoras de estabilidad, rendimiento y compatibilidad.'}
                  </div>
                </div>

                {/* Real-time download progress bar */}
                {(updater.status === 'downloading' ||
                  updater.status === 'downloaded') && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                      <span>
                        {updater.status === 'downloaded'
                          ? 'Descarga completada'
                          : 'Descargando instalador...'}
                      </span>
                      <span className="font-mono font-semibold text-slate-800">
                        {updater.progress}%
                        {updater.totalBytes > 0
                          ? ` (${formatBytesMb(updater.transferredBytes)} / ${formatBytesMb(
                              updater.totalBytes
                            )})`
                          : ''}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          updater.status === 'downloaded'
                            ? 'bg-emerald-600'
                            : 'bg-blue-700'
                        }`}
                        style={{ width: `${updater.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {updater.status === 'downloaded' && (
                    <button
                      type="button"
                      onClick={onQuitAndInstall}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reiniciar e Instalar Ahora
                    </button>
                  )}

                  {updater.status === 'available' &&
                    updater.supportsAutoInstall &&
                    !updater.requiresManualDownload && (
                      <button
                        type="button"
                        onClick={onDownloadUpdate}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar actualización
                      </button>
                    )}

                  {updater.status === 'available' &&
                    isSafeGitHubHref(updater.directDownloadUrl) &&
                    (updater.requiresManualDownload ||
                      !updater.isDesktopApp ||
                      !updater.supportsAutoInstall) &&
                    (updater.isDesktopApp ? (
                      <button
                        type="button"
                        onClick={onOpenDirectDownload}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {updater.platform === 'darwin'
                          ? 'Descargar instalador (.dmg)'
                          : 'Descargar instalador (.exe)'}
                      </button>
                    ) : (
                      <a
                        href={updater.directDownloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Descargar desde GitHub Releases
                      </a>
                    ))}
                </div>
              </div>
            )}
          </div>

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

            {pendingRestore.kind === 'zip' ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1 tabular-nums">
                <p><strong>Paquete completo (.zip) detectado:</strong></p>
                <p>· Tamaño: {formatCompactFileSize(pendingRestore.sizeBytes)}</p>
                <p>· Incluye base SQLite, libreta escolar y archivos adjuntos.</p>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1 tabular-nums">
                <p><strong>Contenido detectado:</strong></p>
                <p>· {pendingRestore.data.classrooms.length} grupo(s) escolar(es)</p>
                <p>· {pendingRestore.data.students.length} estudiante(s)</p>
                <p>· {pendingRestore.data.assignments.length} actividad(es) y {pendingRestore.data.attendance.length} pase(s) de lista</p>
                <p>· {pendingRestore.data.incidents.length} registro(s) de conducta y {pendingRestore.data.dailyLogs.length} bitácora(s)</p>
                <p>· {pendingRestore.data.lessonPlans.length} planeación(es) guardada(s)</p>
              </div>
            )}

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

      <BackupModal
        modal={backupModal}
        driveStatus={driveStatus}
        previewManifest={previewManifest}
        loadingPreview={loadingPreview}
        previewError={previewError}
        busy={modalBusy}
        onClose={() => {
          if (!modalBusy) setBackupModal(null);
        }}
        onConfirmRestoreDrive={handleConfirmRestoreDrive}
        onConfirmDeleteDrive={handleConfirmDeleteDrive}
        onSaveDesktopCredentials={handleSaveDesktopCredentials}
      />
    </div>
  );
}
