import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  KeyRound,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import type { GitHubRepoSummary, GitHubUpdateConfigStatus } from '../types';

interface GitHubLinkModalProps {
  open: boolean;
  status: GitHubUpdateConfigStatus | null;
  onClose: () => void;
  onUpdated: (next: GitHubUpdateConfigStatus) => void;
}

export function GitHubLinkModal({
  open,
  status,
  onClose,
  onUpdated,
}: GitHubLinkModalProps) {
  const [repoInput, setRepoInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenField, setShowTokenField] = useState(false);

  const [showOAuthCreds, setShowOAuthCreds] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');

  const [repos, setRepos] = useState<GitHubRepoSummary[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [busy, setBusy] = useState(false);
  const [oauthAuthUrl, setOauthAuthUrl] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');
  const [waitingOAuth, setWaitingOAuth] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setNotice('');
    setOauthAuthUrl('');
    setOauthRedirectUri('');
    setWaitingOAuth(false);
    setRepoInput(status?.repoSlug || '');
    setOauthClientId(status?.oauthClientId || '');
    setOauthClientSecret('');
    setTokenInput('');
    if (status?.hasAccessToken) {
      setLoadingRepos(true);
      localApi
        .listGitHubUserRepos()
        .then((res) => setRepos(res.repos))
        .catch(() => setRepos([]))
        .finally(() => setLoadingRepos(false));
    } else {
      setRepos([]);
    }
  }, [open, status?.repoSlug, status?.oauthClientId, status?.hasAccessToken]);

  useEffect(() => {
    if (!open || !waitingOAuth) return;

    const checkCompleted = async () => {
      try {
        const next = await localApi.getGitHubUpdateStatus();
        if (next.hasAccessToken && (next.authMode === 'oauth' || next.githubLogin)) {
          setWaitingOAuth(false);
          setOauthAuthUrl('');
          onUpdated(next);
          setNotice(
            `Cuenta @${next.githubLogin} conectada. Elige ahora el repositorio para actualizaciones.`
          );
          setLoadingRepos(true);
          localApi
            .listGitHubUserRepos()
            .then((r) => setRepos(r.repos))
            .catch(() => {})
            .finally(() => setLoadingRepos(false));
        }
      } catch {
        // Wait for next poll
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        !origin.includes('127.0.0.1')
      ) {
        return;
      }
      if (event.data?.type === 'GITHUB_OAUTH_SUCCESS') {
        void checkCompleted();
      } else if (event.data?.type === 'GITHUB_OAUTH_ERROR') {
        setWaitingOAuth(false);
        setError('La autorización con GitHub fue cancelada o rechazada.');
      }
    };

    window.addEventListener('message', handleMessage);
    const interval = setInterval(() => {
      void checkCompleted();
    }, 2000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
    };
  }, [open, waitingOAuth, onUpdated]);

  if (!open) return null;

  const isDesktopElectron =
    typeof window !== 'undefined' && Boolean(window.aulaAgilGitHub);

  const webCallbackDisplay =
    status?.callbackUrlHint ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/api/github-updates/oauth/callback`
      : '/api/github-updates/oauth/callback');

  const handleLinkDirectRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const next = await localApi.linkGitHubRepo({
        repoInput: repoInput.trim(),
        accessToken: tokenInput.trim() || undefined,
      });
      onUpdated(next);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo vincular el repositorio de GitHub.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSelectUserRepo = async (fullName: string) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const next = await localApi.linkGitHubRepo({ repoInput: fullName });
      onUpdated(next);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo seleccionar el repositorio.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnectWithToken = async () => {
    if (!tokenInput.trim()) {
      setError('Ingresa un token personal de GitHub para listar tus repositorios.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const next = await localApi.linkGitHubWithToken(tokenInput.trim());
      onUpdated(next);
      setTokenInput('');
      setNotice(`Cuenta @${next.githubLogin} conectada. Selecciona un repositorio abajo.`);
      setLoadingRepos(true);
      const list = await localApi.listGitHubUserRepos();
      setRepos(list.repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token de GitHub inválido.');
    } finally {
      setLoadingRepos(false);
      setBusy(false);
    }
  };

  const handleStartOAuth = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (isDesktopElectron && window.aulaAgilGitHub) {
        const res = await localApi.startGitHubDesktopOAuth();
        setOauthAuthUrl(res.authUrl);
        setOauthRedirectUri(res.redirectUri);
        setWaitingOAuth(true);
        await window.aulaAgilGitHub.openAuthUrl(res.authUrl);
        setNotice(
          'Autoriza el acceso en la pestaña de GitHub que se abrió. Detectaremos la conexión automáticamente...'
        );
      } else {
        const res = await localApi.startGitHubWebOAuth();
        setOauthAuthUrl(res.authUrl);
        setOauthRedirectUri(res.redirectUri);
        setWaitingOAuth(true);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar la conexión OAuth con GitHub.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveOAuthCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const next = await localApi.saveGitHubCredentials({
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret.trim(),
      });
      onUpdated(next);
      setOauthClientSecret('');
      setShowOAuthCreds(false);
      setNotice(
        'Credenciales OAuth de GitHub guardadas. Ya puedes iniciar sesión con GitHub.'
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudieron guardar las credenciales OAuth.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-slate-900" />
              Conectar con GitHub para actualizaciones
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Vincula el repositorio de GitHub donde publicas tus lanzamientos (
              <span className="font-mono">Releases</span>) para buscar e instalar nuevas versiones desde la app.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: GitHub Account OAuth Sign-In */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800">
              Opción 1: Iniciar sesión con tu cuenta de GitHub
            </span>
            <button
              type="button"
              onClick={() => setShowOAuthCreds((v) => !v)}
              className="text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              {showOAuthCreds ? 'Ocultar credenciales' : 'Configurar OAuth App'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleStartOAuth}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              <svg
                className="w-4 h-4 fill-current shrink-0"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>
                {status?.hasAccessToken && status.githubLogin
                  ? `Cambiar cuenta (@${status.githubLogin})`
                  : 'Conectar con GitHub (OAuth)'}
              </span>
            </button>

            {!status?.hasOAuthConfigured && (
              <span className="text-[11px] text-slate-500">
                Requiere Client ID/Secret o usa la Opción 2 directa sin configuración previa.
              </span>
            )}
          </div>

          {oauthAuthUrl && !isDesktopElectron && (
            <div className="p-3 bg-white border border-blue-200 rounded-lg space-y-2">
              <p className="text-xs text-slate-700 font-medium">
                Autoriza el acceso en GitHub y regresa aquí automáticamente:
              </p>
              <a
                href={oauthAuthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                Abrir autorización oficial en GitHub
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              {oauthRedirectUri && (
                <p className="text-[11px] text-slate-500 font-mono break-all">
                  Callback: {oauthRedirectUri}
                </p>
              )}
            </div>
          )}

          {showOAuthCreds && (
            <form
              onSubmit={handleSaveOAuthCreds}
              className="p-3 bg-white border border-slate-200 rounded-lg space-y-2.5"
            >
              <p className="text-[11px] text-slate-600">
                Crea una GitHub OAuth App con Callback URL:{' '}
                <code className="font-mono bg-slate-100 px-1 rounded break-all">
                  {webCallbackDisplay}
                </code>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={oauthClientId}
                  onChange={(e) => setOauthClientId(e.target.value)}
                  placeholder="Client ID (Ov23li...)"
                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
                <input
                  type="password"
                  value={oauthClientSecret}
                  onChange={(e) => setOauthClientSecret(e.target.value)}
                  placeholder={
                    status?.hasOAuthClientSecret
                      ? '•••••••• (vacío para conservar)'
                      : 'Client Secret'
                  }
                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                {status?.oauthClientId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const next = await localApi.saveGitHubCredentials({
                        clearOAuthCredentials: true,
                      });
                      onUpdated(next);
                      setOauthClientId('');
                      setOauthClientSecret('');
                    }}
                    className="text-[11px] font-medium text-red-700 hover:underline"
                  >
                    Borrar credenciales
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Guardar credenciales OAuth
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Repository Picker if authenticated with GitHub */}
        {status?.hasAccessToken && (
          <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-blue-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700" />
                Tus repositorios en @{status.githubLogin}
              </p>
              <button
                type="button"
                disabled={loadingRepos}
                onClick={() => {
                  setLoadingRepos(true);
                  localApi
                    .listGitHubUserRepos()
                    .then((r) => setRepos(r.repos))
                    .catch((e) =>
                      setError(
                        e instanceof Error
                          ? e.message
                          : 'No se pudieron actualizar tus repositorios.'
                      )
                    )
                    .finally(() => setLoadingRepos(false));
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700"
              >
                <RefreshCw
                  className={`w-3 h-3 ${loadingRepos ? 'animate-spin' : ''}`}
                />
                Actualizar lista
              </button>
            </div>

            {repos.length > 0 ? (
              <div className="max-h-40 overflow-y-auto bg-white border border-blue-100 rounded-lg divide-y divide-slate-100">
                {repos.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleSelectUserRepo(r.fullName)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-semibold text-slate-900 truncate">
                        {r.fullName}
                      </p>
                      {r.description && (
                        <p className="text-[11px] text-slate-500 truncate">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                      {r.private ? 'Privado' : 'Público'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-600">
                {loadingRepos
                  ? 'Cargando repositorios de tu cuenta...'
                  : 'No se encontraron repositorios en esta cuenta.'}
              </p>
            )}
          </div>
        )}

        {/* Section 2: Direct Repo URL or owner/repo */}
        <form onSubmit={handleLinkDirectRepo} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-800">
              Opción 2: Vincular repositorio directo (URL o usuario/repo)
            </label>
            <button
              type="button"
              onClick={() => setShowTokenField((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
            >
              <Lock className="w-3 h-3" />
              {showTokenField ? 'Ocultar token' : '¿Repositorio privado?'}
            </button>
          </div>

          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="https://github.com/tu-usuario/aula-agil  o  tu-usuario/aula-agil"
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
          />

          {showTokenField && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <label className="block text-[11px] font-medium text-slate-700 flex items-center gap-1">
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                Personal Access Token de GitHub (opcional para repos privados)
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="github_pat_... o ghp_..."
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConnectWithToken}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap"
                >
                  Listar mis repos
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !repoInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              {busy ? 'Verificando...' : 'Vincular repositorio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
