import { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  AlertTriangle,
  Camera,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  GraduationCap,
  HelpCircle,
  KeyRound,
  Lock,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { localApi, setAuthToken } from '../lib/api';
import { processAvatarImage } from '../lib/fileUtils';
import type { RecoveryQuestionsResponse, UserProfile } from '../types';

interface LoginViewProps {
  hasUser: boolean;
  existingProfile: UserProfile | null;
  onAuthenticated: (user: UserProfile) => void;
  onFactoryResetDone: () => void;
}

const SECURITY_QUESTION_PRESETS = [
  '¿Cómo se llamó la primera escuela donde trabajaste?',
  '¿Cuál es el nombre de tu primera mascota?',
  '¿En qué ciudad naciste?',
  '¿Cuál es el segundo nombre de tu madre o padre?',
  '¿Cuál era el nombre de tu mejor amigo(a) de la infancia?',
  '¿Cuál fue tu libro favorito de primaria?',
];

function evaluatePasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
  barClass: string;
  textClass: string;
  hint: string;
} {
  if (!password) {
    return {
      score: 0,
      label: 'Sin contraseña',
      barClass: 'w-0 bg-slate-200',
      textClass: 'text-slate-400',
      hint: 'Mínimo 6 caracteres; se recomiendan letras, números y algún símbolo.',
    };
  }
  let points = 0;
  if (password.length >= 6) points++;
  if (password.length >= 10) points++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) points++;
  if (/\d/.test(password)) points++;
  if (/[^A-Za-z0-9]/.test(password)) points++;

  if (password.length < 6 || points <= 2) {
    return {
      score: 1,
      label: 'Débil',
      barClass: 'w-1/3 bg-red-600',
      textClass: 'text-red-700',
      hint: 'Usa al menos 8 caracteres combinando mayúsculas, minúsculas y números.',
    };
  }
  if (points <= 3) {
    return {
      score: 2,
      label: 'Media',
      barClass: 'w-2/3 bg-amber-600',
      textClass: 'text-amber-700',
      hint: 'Buena base; agregar un número o símbolo la hace más segura.',
    };
  }
  return {
    score: 3,
    label: 'Fuerte',
    barClass: 'w-full bg-emerald-600',
    textClass: 'text-emerald-700',
    hint: 'Contraseña sólida para proteger los expedientes de tus alumnos.',
  };
}

function getInitials(name: string): string {
  const parts = String(name || 'Docente')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'AA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function LoginView({
  hasUser,
  existingProfile,
  onAuthenticated,
  onFactoryResetDone,
}: LoginViewProps) {
  // --- Login State ---
  const [loginUsername, setLoginUsername] = useState(existingProfile?.username || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  // --- Recovery Modal State ---
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryTab, setRecoveryTab] = useState<'key' | 'questions'>('key');
  const [recoveryUsername, setRecoveryUsername] = useState(
    existingProfile?.username || ''
  );
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [recoveryQuestions, setRecoveryQuestions] =
    useState<RecoveryQuestionsResponse | null>(null);
  const [recoveryAnswer1, setRecoveryAnswer1] = useState('');
  const [recoveryAnswer2, setRecoveryAnswer2] = useState('');
  const [recoveryNewPwd, setRecoveryNewPwd] = useState('');
  const [recoveryConfirmPwd, setRecoveryConfirmPwd] = useState('');
  const [showRecoveryPwd, setShowRecoveryPwd] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [rotatedKeyResult, setRotatedKeyResult] = useState<{
    newRecoveryKey: string;
    user: UserProfile;
    token: string;
  } | null>(null);
  const [rotatedKeyConfirmed, setRotatedKeyConfirmed] = useState(false);

  // --- Factory Reset inside Recovery Modal ---
  const [factoryStepOpen, setFactoryStepOpen] = useState(false);
  const [factoryTyped, setFactoryTyped] = useState('');
  const [factoryDoubleChecked, setFactoryDoubleChecked] = useState(false);
  const [factoryBusy, setFactoryBusy] = useState(false);
  const [factoryError, setFactoryError] = useState('');

  // --- Onboarding Wizard State (hasUser === false) ---
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOnbPwd, setShowOnbPwd] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState('');
  const [avatarError, setAvatarError] = useState('');

  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadedKey, setDownloadedKey] = useState(false);
  const [confirmedSavedKey, setConfirmedSavedKey] = useState(false);

  const [q1Choice, setQ1Choice] = useState(SECURITY_QUESTION_PRESETS[0]);
  const [q1Custom, setQ1Custom] = useState('');
  const [a1, setA1] = useState('');
  const [q2Choice, setQ2Choice] = useState(SECURITY_QUESTION_PRESETS[1]);
  const [q2Custom, setQ2Custom] = useState('');
  const [a2, setA2] = useState('');

  const [onbError, setOnbError] = useState('');
  const [onbBusy, setOnbBusy] = useState(false);

  useEffect(() => {
    if (existingProfile?.username) {
      setLoginUsername(existingProfile.username);
      setRecoveryUsername(existingProfile.username);
    }
  }, [existingProfile?.username]);

  useEffect(() => {
    if (!hasUser && !generatedRecoveryKey) {
      localApi
        .getRecoveryPreview()
        .then((res) => setGeneratedRecoveryKey(res.recoveryKey))
        .catch(() => {});
    }
  }, [hasUser, generatedRecoveryKey]);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const recoveryStrength = useMemo(
    () => evaluatePasswordStrength(recoveryNewPwd),
    [recoveryNewPwd]
  );

  const downloadRecoveryTxt = (code: string, userLabel: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const content = [
      '====================================================',
      '  AulaÁgil — Llave Maestra de Recuperación Offline',
      '====================================================',
      '',
      `Usuario: ${userLabel || 'docente'}`,
      `Fecha de emisión: ${today}`,
      '',
      `LLAVE MAESTRA: ${code}`,
      '',
      'Guarda este archivo en un lugar seguro (memoria USB,',
      'carpeta personal o impresión). Te permitirá recuperar',
      'el acceso sin internet si olvidas tu contraseña.',
      '====================================================',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const safeUser = (userLabel || 'docente').replace(/[^a-zA-Z0-9_-]/g, '_');
    saveAs(blob, `AulaAgil_Llave_Recuperacion_${safeUser}.txt`);
  };

  // --- Handlers: Login ---
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    try {
      const res = await localApi.login({
        username: loginUsername.trim(),
        password: loginPassword,
      });
      setAuthToken(res.token);
      setLoginPassword('');
      onAuthenticated(res.user);
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : 'No se pudo iniciar sesión.'
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const openRecoveryModal = async () => {
    setRecoveryError('');
    setRotatedKeyResult(null);
    setRotatedKeyConfirmed(false);
    setRecoveryNewPwd('');
    setRecoveryConfirmPwd('');
    setRecoveryKeyInput('');
    setRecoveryAnswer1('');
    setRecoveryAnswer2('');
    setFactoryStepOpen(false);
    setFactoryTyped('');
    setFactoryDoubleChecked(false);
    setFactoryError('');
    setRecoveryOpen(true);
    try {
      const qData = await localApi.getRecoveryQuestions(
        loginUsername.trim() || existingProfile?.username
      );
      setRecoveryQuestions(qData);
      setRecoveryUsername(qData.username);
    } catch {
      setRecoveryQuestions(null);
    }
  };

  const handleRecoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    if (recoveryNewPwd.length < 6) {
      setRecoveryError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (recoveryNewPwd !== recoveryConfirmPwd) {
      setRecoveryError('Las contraseñas nuevas no coinciden.');
      return;
    }

    setRecoveryBusy(true);
    try {
      if (recoveryTab === 'key') {
        const res = await localApi.recoverWithKey({
          username: recoveryUsername.trim(),
          recoveryKey: recoveryKeyInput.trim(),
          newPassword: recoveryNewPwd,
        });
        setRotatedKeyResult({
          newRecoveryKey: res.newRecoveryKey,
          user: res.user,
          token: res.token,
        });
      } else {
        const res = await localApi.recoverWithQuestions({
          username: recoveryUsername.trim(),
          answer1: recoveryAnswer1,
          answer2: recoveryAnswer2,
          newPassword: recoveryNewPwd,
        });
        setAuthToken(res.token);
        setRecoveryOpen(false);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setRecoveryError(
        err instanceof Error ? err.message : 'No se pudo completar la recuperación.'
      );
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleFinishRotatedKey = () => {
    if (!rotatedKeyResult || !rotatedKeyConfirmed) return;
    setAuthToken(rotatedKeyResult.token);
    setRecoveryOpen(false);
    onAuthenticated(rotatedKeyResult.user);
  };

  const handleFactoryReset = async () => {
    setFactoryError('');
    if (factoryTyped.trim().toUpperCase() !== 'RESTABLECER' || !factoryDoubleChecked) {
      setFactoryError(
        'Marca la casilla de confirmación y escribe RESTABLECER para continuar.'
      );
      return;
    }
    setFactoryBusy(true);
    try {
      await localApi.factoryReset({
        confirmation: factoryTyped.trim().toUpperCase(),
        doubleConfirmed: factoryDoubleChecked,
      });
      setAuthToken(null);
      setRecoveryOpen(false);
      setGeneratedRecoveryKey('');
      onFactoryResetDone();
    } catch (err) {
      setFactoryError(
        err instanceof Error ? err.message : 'No se pudo restablecer la aplicación.'
      );
    } finally {
      setFactoryBusy(false);
    }
  };

  // --- Handlers: Onboarding ---
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    try {
      const dataUrl = await processAvatarImage(file);
      setAvatarDataUrl(dataUrl);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : 'No se pudo cargar la foto de perfil.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setOnbError('');
    if (displayName.trim().length < 2) {
      setOnbError('Escribe tu nombre completo para tu perfil docente.');
      return;
    }
    if (username.trim().length < 3) {
      setOnbError('El nombre de usuario debe tener al menos 3 caracteres.');
      return;
    }
    if (password.length < 6) {
      setOnbError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setOnbError('Las contraseñas no coinciden.');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    setOnbError('');
    if (!confirmedSavedKey) {
      setOnbError(
        'Debes confirmar que guardaste tu Llave Maestra de Recuperación antes de continuar.'
      );
      return;
    }
    setStep(3);
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setOnbError('');
    const finalQ1 = q1Choice === '__custom__' ? q1Custom.trim() : q1Choice;
    const finalQ2 = q2Choice === '__custom__' ? q2Custom.trim() : q2Choice;

    if (!finalQ1 || a1.trim().length < 2 || !finalQ2 || a2.trim().length < 2) {
      setOnbError(
        'Completa las 2 preguntas de seguridad y escribe respuestas de al menos 2 caracteres.'
      );
      return;
    }
    if (finalQ1 === finalQ2) {
      setOnbError('Elige dos preguntas de seguridad diferentes.');
      return;
    }

    setOnbBusy(true);
    try {
      const res = await localApi.registerAccount({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        avatarDataUrl,
        recoveryKey: generatedRecoveryKey,
        securityQ1: finalQ1,
        securityA1: a1.trim(),
        securityQ2: finalQ2,
        securityA2: a2.trim(),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setOnbError(
        err instanceof Error ? err.message : 'No se pudo crear el perfil local.'
      );
    } finally {
      setOnbBusy(false);
    }
  };

  // --- Render Lock / Login Screen when user already registered ---
  if (hasUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-6 h-6 text-blue-700 shrink-0" />
            <span className="font-display text-lg font-bold text-slate-900 whitespace-nowrap">
              AulaÁgil
            </span>
          </div>
          <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            Sesión protegida localmente
          </span>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 space-y-6">
            {/* Profile identity header */}
            <div className="flex flex-col items-center text-center space-y-3">
              {existingProfile?.avatarDataUrl ? (
                <img
                  src={existingProfile.avatarDataUrl}
                  alt={existingProfile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-20 h-20 rounded-full object-cover border border-slate-200"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center font-display text-xl font-bold text-blue-800">
                  {getInitials(existingProfile?.displayName || loginUsername)}
                </div>
              )}
              <div>
                <h1 className="font-display text-xl font-bold text-slate-900">
                  {existingProfile?.displayName || 'Iniciar sesión'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {existingProfile?.username
                    ? `@${existingProfile.username} · Acceso docente offline`
                    : 'Ingresa tus credenciales locales para desbloquear tu libreta'}
                </p>
              </div>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Usuario
                </label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="Tu usuario local"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showLoginPwd ? 'text' : 'password'}
                    required
                    autoFocus
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPwd((v) => !v)}
                    title={showLoginPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showLoginPwd ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {loginError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                disabled={loginBusy}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
              >
                <UserCheck className="w-4 h-4" />
                {loginBusy ? 'Verificando...' : 'Entrar'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={openRecoveryModal}
                className="text-blue-700 hover:text-blue-900 font-medium hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </button>
              <span className="text-slate-400">100% sin internet</span>
            </div>
          </div>
        </main>

        {/* Offline Recovery & Factory Reset Modal */}
        {recoveryOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-5 my-8">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Recuperación de cuenta offline
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Restablece tu contraseña sin internet usando tu llave maestra o preguntas de seguridad.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRecoveryOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {rotatedKeyResult ? (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-emerald-900">
                      Contraseña restablecida correctamente
                    </p>
                    <p className="text-xs text-emerald-800">
                      Por seguridad, se generó una <strong>nueva Llave Maestra</strong> (la anterior dejó de ser válida). Guárdala antes de continuar:
                    </p>
                    <div className="p-3 bg-white border border-emerald-300 rounded-lg text-center font-mono text-base font-bold tracking-wider text-slate-900 select-all">
                      {rotatedKeyResult.newRecoveryKey}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        downloadRecoveryTxt(
                          rotatedKeyResult.newRecoveryKey,
                          rotatedKeyResult.user.username
                        )
                      }
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar nueva llave (.txt)
                    </button>
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rotatedKeyConfirmed}
                      onChange={(e) => setRotatedKeyConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700"
                    />
                    <span>Confirmo que ya guardé mi nueva Llave Maestra de Recuperación.</span>
                  </label>

                  <button
                    type="button"
                    disabled={!rotatedKeyConfirmed}
                    onClick={handleFinishRotatedKey}
                    className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
                  >
                    Entrar a AulaÁgil
                  </button>
                </div>
              ) : (
                <>
                  {/* Method Tabs */}
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryTab('key');
                        setRecoveryError('');
                      }}
                      className={`px-3 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        recoveryTab === 'key'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      Llave Maestra
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryTab('questions');
                        setRecoveryError('');
                      }}
                      className={`px-3 py-2 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        recoveryTab === 'questions'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      Preguntas de seguridad
                    </button>
                  </div>

                  <form onSubmit={handleRecoverSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Usuario del perfil
                      </label>
                      <input
                        type="text"
                        required
                        value={recoveryUsername}
                        onChange={(e) => setRecoveryUsername(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>

                    {recoveryTab === 'key' ? (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Llave Maestra de Recuperación (ej. REC-XXXX-XXXX-XXXX)
                        </label>
                        <input
                          type="text"
                          required
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value)}
                          placeholder="REC-XXXX-XXXX-XXXX"
                          className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-200 rounded-lg"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <div>
                          <label className="block text-xs font-medium text-slate-800 mb-1">
                            1. {recoveryQuestions?.securityQ1 || 'Pregunta de seguridad 1'}
                          </label>
                          <input
                            type="text"
                            required
                            value={recoveryAnswer1}
                            onChange={(e) => setRecoveryAnswer1(e.target.value)}
                            placeholder="Tu respuesta"
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-800 mb-1">
                            2. {recoveryQuestions?.securityQ2 || 'Pregunta de seguridad 2'}
                          </label>
                          <input
                            type="text"
                            required
                            value={recoveryAnswer2}
                            onChange={(e) => setRecoveryAnswer2(e.target.value)}
                            placeholder="Tu respuesta"
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Nueva contraseña
                        </label>
                        <div className="relative">
                          <input
                            type={showRecoveryPwd ? 'text' : 'password'}
                            required
                            value={recoveryNewPwd}
                            onChange={(e) => setRecoveryNewPwd(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            className="w-full pl-3 pr-9 py-2 text-sm border border-slate-200 rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRecoveryPwd((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                          >
                            {showRecoveryPwd ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Confirmar nueva contraseña
                        </label>
                        <input
                          type={showRecoveryPwd ? 'text' : 'password'}
                          required
                          value={recoveryConfirmPwd}
                          onChange={(e) => setRecoveryConfirmPwd(e.target.value)}
                          placeholder="Repite la contraseña"
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                        />
                      </div>
                    </div>

                    {recoveryNewPwd && (
                      <div className="space-y-1">
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${recoveryStrength.barClass}`}
                          />
                        </div>
                        <p className={`text-[11px] font-medium ${recoveryStrength.textClass}`}>
                          Seguridad: {recoveryStrength.label}
                        </p>
                      </div>
                    )}

                    {recoveryError && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {recoveryError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={recoveryBusy}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                    >
                      {recoveryBusy
                        ? 'Validando...'
                        : 'Restablecer contraseña y entrar'}
                    </button>
                  </form>

                  {/* Protected Factory Reset */}
                  <div className="pt-4 border-t border-slate-200 space-y-3">
                    {!factoryStepOpen ? (
                      <button
                        type="button"
                        onClick={() => setFactoryStepOpen(true)}
                        className="text-xs font-medium text-red-700 hover:text-red-900 flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        ¿Perdiste ambos métodos? Restablecer aplicación de fábrica
                      </button>
                    ) : (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                        <div className="flex items-start gap-2 text-red-900">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <div className="text-xs space-y-1">
                            <p className="font-semibold">
                              Restablecer aplicación de fábrica (Irreversible)
                            </p>
                            <p className="text-red-800">
                              Esta acción elimina el perfil bloqueado junto con los grupos, alumnos, calificaciones y llaves guardadas en esta PC para empezar desde cero sin comprometer los datos anteriores.
                            </p>
                          </div>
                        </div>

                        <label className="flex items-start gap-2 text-xs text-red-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={factoryDoubleChecked}
                            onChange={(e) => setFactoryDoubleChecked(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-700"
                          />
                          <span>
                            Entiendo que se limpiará la base de datos local actual para crear una cuenta nueva.
                          </span>
                        </label>

                        <div>
                          <label className="block text-[11px] font-medium text-red-900 mb-1">
                            Escribe <strong>RESTABLECER</strong> para confirmar:
                          </label>
                          <input
                            type="text"
                            value={factoryTyped}
                            onChange={(e) => setFactoryTyped(e.target.value)}
                            placeholder="RESTABLECER"
                            className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-white border border-red-300 rounded-lg"
                          />
                        </div>

                        {factoryError && (
                          <p className="text-xs text-red-800 font-medium">{factoryError}</p>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setFactoryStepOpen(false)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={factoryBusy}
                            onClick={handleFactoryReset}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-lg"
                          >
                            {factoryBusy ? 'Restableciendo...' : 'Confirmar restablecimiento total'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- First-Run Account Creation & Anti-Forget Onboarding ---
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <GraduationCap className="w-6 h-6 text-blue-700 shrink-0" />
          <span className="font-display text-lg font-bold text-slate-900 whitespace-nowrap">
            AulaÁgil
          </span>
        </div>
        <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          Configuración inicial privada (100% local)
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          {/* Editorial 3-Step Indicator */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div
                className={`pb-2 border-b-2 font-medium tabular-nums ${
                  step === 1
                    ? 'border-blue-700 text-blue-800'
                    : 'border-emerald-600 text-emerald-700'
                }`}
              >
                01. Perfil y clave
              </div>
              <div
                className={`pb-2 border-b-2 font-medium tabular-nums ${
                  step === 2
                    ? 'border-blue-700 text-blue-800'
                    : step > 2
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-slate-200 text-slate-400'
                }`}
              >
                02. Llave maestra
              </div>
              <div
                className={`pb-2 border-b-2 font-medium tabular-nums ${
                  step === 3
                    ? 'border-blue-700 text-blue-800'
                    : 'border-slate-200 text-slate-400'
                }`}
              >
                03. Preguntas respaldo
              </div>
            </div>
            <h1 className="font-display text-2xl font-bold text-slate-900 pt-1">
              {step === 1
                ? 'Crea tu perfil docente local'
                : step === 2
                ? 'Guarda tu Llave Maestra de Recuperación'
                : 'Configura 2 preguntas de seguridad'}
            </h1>
            <p className="text-sm text-slate-600">
              {step === 1
                ? 'Protege tus listas, expedientes y calificaciones con una contraseña cifrada localmente en esta computadora.'
                : step === 2
                ? 'Como no dependemos de internet ni servidores externos, esta llave única es tu acceso de emergencia si olvidas tu contraseña.'
                : 'Respaldo adicional 100% sin conexión por si alguna vez extravías tu llave maestra.'}
            </p>
          </div>

          {step === 1 && (
            <form onSubmit={handleNextStep1} className="space-y-4">
              {/* Optional Avatar Upload */}
              <div className="flex items-center gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                {avatarDataUrl ? (
                  <img
                    src={avatarDataUrl}
                    alt="Foto de perfil"
                    className="w-14 h-14 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center font-display text-base font-bold text-blue-800 shrink-0">
                    {getInitials(displayName || username)}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-semibold text-slate-800">
                    Foto o avatar del perfil (opcional)
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      Subir foto
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </label>
                    {avatarDataUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarDataUrl('')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Quitar
                      </button>
                    )}
                  </div>
                  {avatarError && (
                    <p className="text-[11px] text-red-700">{avatarError}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre completo del docente
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="ej. Mtra. Laura Hernández"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Usuario para iniciar sesión
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej. laura"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showOnbPwd ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full pl-3 pr-9 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOnbPwd((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showOnbPwd ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirmar contraseña
                  </label>
                  <input
                    type={showOnbPwd ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Password strength indicator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Indicador de seguridad:</span>
                  <span className={`font-semibold ${strength.textClass}`}>
                    {strength.label}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${strength.barClass}`} />
                </div>
                <p className="text-[11px] text-slate-500">{strength.hint}</p>
              </div>

              {onbError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {onbError}
                </p>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                >
                  Continuar a Llave Maestra
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-center">
                <p className="text-xs font-medium text-slate-500">
                  Código alfanumérico único de recuperación
                </p>
                <div className="py-3 px-4 bg-white border border-slate-300 rounded-lg font-mono text-xl font-bold tracking-widest text-slate-900 select-all">
                  {generatedRecoveryKey || 'Generando...'}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={!generatedRecoveryKey}
                    onClick={() => {
                      downloadRecoveryTxt(generatedRecoveryKey, username || displayName);
                      setDownloadedKey(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadedKey ? 'Archivo .txt descargado' : 'Descargar llave (.txt)'}
                  </button>
                  <button
                    type="button"
                    disabled={!generatedRecoveryKey}
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedRecoveryKey).catch(() => {});
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
                  >
                    {copiedKey ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Copiada
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar código
                      </>
                    )}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedSavedKey}
                  onChange={(e) => setConfirmedSavedKey(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-400 text-blue-700"
                />
                <span className="text-xs text-amber-950 leading-relaxed">
                  <strong>Confirmo que guardé esta Llave Maestra en un lugar seguro.</strong>{' '}
                  Entiendo que solo se almacena su huella criptográfica y no podrá volver a mostrarse después de este paso.
                </span>
              </label>

              {onbError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {onbError}
                </p>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOnbError('');
                    setStep(1);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={handleNextStep2}
                  disabled={!confirmedSavedKey}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
                >
                  Continuar a preguntas de seguridad
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handleCompleteOnboarding} className="space-y-4">
              <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Pregunta de seguridad 1
                  </label>
                  <select
                    value={q1Choice}
                    onChange={(e) => setQ1Choice(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  >
                    {SECURITY_QUESTION_PRESETS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                    <option value="__custom__">Escribir mi propia pregunta...</option>
                  </select>
                  {q1Choice === '__custom__' && (
                    <input
                      type="text"
                      required
                      value={q1Custom}
                      onChange={(e) => setQ1Custom(e.target.value)}
                      placeholder="Escribe tu pregunta 1"
                      className="mt-2 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    />
                  )}
                  <input
                    type="text"
                    required
                    value={a1}
                    onChange={(e) => setA1(e.target.value)}
                    placeholder="Respuesta a la pregunta 1"
                    className="mt-2 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Pregunta de seguridad 2
                  </label>
                  <select
                    value={q2Choice}
                    onChange={(e) => setQ2Choice(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  >
                    {SECURITY_QUESTION_PRESETS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                    <option value="__custom__">Escribir mi propia pregunta...</option>
                  </select>
                  {q2Choice === '__custom__' && (
                    <input
                      type="text"
                      required
                      value={q2Custom}
                      onChange={(e) => setQ2Custom(e.target.value)}
                      placeholder="Escribe tu pregunta 2"
                      className="mt-2 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    />
                  )}
                  <input
                    type="text"
                    required
                    value={a2}
                    onChange={(e) => setA2(e.target.value)}
                    placeholder="Respuesta a la pregunta 2"
                    className="mt-2 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {onbError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {onbError}
                </p>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOnbError('');
                    setStep(2);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={onbBusy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {onbBusy ? 'Creando perfil...' : 'Crear cuenta local y entrar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
