import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CloudDownload,
  HardDrive,
  KeyRound,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DriveBackupFile,
  DriveBackupManifest,
  DriveBackupStatus,
} from '../types';

export type BackupModalState =
  | { type: 'restore_drive'; file: DriveBackupFile }
  | { type: 'delete_drive'; file: DriveBackupFile }
  | { type: 'desktop_credentials' }
  | null;

interface BackupModalProps {
  modal: BackupModalState;
  driveStatus: DriveBackupStatus | null;
  previewManifest: DriveBackupManifest | null;
  loadingPreview: boolean;
  previewError: string;
  busy: boolean;
  onClose: () => void;
  onConfirmRestoreDrive: (file: DriveBackupFile) => void;
  onConfirmDeleteDrive: (file: DriveBackupFile) => void;
  onSaveDesktopCredentials: (payload: {
    clientId: string;
    clientSecret: string;
    clearCustomCredentials?: boolean;
  }) => Promise<void>;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupModal({
  modal,
  driveStatus,
  previewManifest,
  loadingPreview,
  previewError,
  busy,
  onClose,
  onConfirmRestoreDrive,
  onConfirmDeleteDrive,
  onSaveDesktopCredentials,
}: BackupModalProps) {
  const [clientId, setClientId] = useState(driveStatus?.desktopClientId || '');
  const [clientSecret, setClientSecret] = useState('');
  const [credError, setCredError] = useState('');

  useEffect(() => {
    if (modal?.type === 'desktop_credentials') {
      setClientId(driveStatus?.desktopClientId || '');
      setClientSecret('');
      setCredError('');
    }
  }, [modal, driveStatus?.desktopClientId]);

  if (!modal) return null;

  if (modal.type === 'restore_drive') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                <CloudDownload className="w-5 h-5 text-blue-700" />
                Restaurar respaldo desde Google Drive
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Archivo: <span className="font-mono font-semibold">{modal.file.name}</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                Fecha:{' '}
                {modal.file.createdTime
                  ? new Date(modal.file.createdTime).toLocaleString('es-MX')
                  : '—'}{' '}
                · Tamaño: {formatFileSize(modal.file.sizeBytes)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loadingPreview ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-xs text-slate-600">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-700 shrink-0" />
              <span>Descargando y verificando contenido del respaldo (.zip)...</span>
            </div>
          ) : previewError ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {previewError}
            </div>
          ) : previewManifest ? (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1 tabular-nums">
              <p className="font-semibold text-slate-900">
                Contenido verificado dentro del .zip:
              </p>
              <p>· {previewManifest.classroomCount} grupo(s) escolar(es)</p>
              <p>· {previewManifest.studentCount} estudiante(s)</p>
              <p>
                · {previewManifest.assignmentCount} actividad(es) y{' '}
                {previewManifest.incidentCount} registro(s) de conducta
              </p>
              <p>
                · {previewManifest.dailyLogCount} bitácora(s) y{' '}
                {previewManifest.lessonPlanCount} planeación(es)
              </p>
              <p>
                · {previewManifest.attachmentCount} archivo(s) adjunto(s){' '}
                {previewManifest.hasSqliteDb ? '+ base SQLite de perfil' : ''}
              </p>
            </div>
          ) : null}

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              Esta acción descargará el respaldo desde tu Google Drive y reemplazará los grupos, expedientes, calificaciones y base de datos local actuales en esta computadora.
            </span>
          </div>

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
              type="button"
              disabled={busy || loadingPreview || Boolean(previewError)}
              onClick={() => onConfirmRestoreDrive(modal.file)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              {busy ? 'Restaurando...' : 'Confirmar y restaurar respaldo'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (modal.type === 'delete_drive') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                Eliminar respaldo en Google Drive
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Archivo: <span className="font-mono font-semibold">{modal.file.name}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-slate-700">
            ¿Estás seguro de que deseas eliminar permanentemente esta copia de seguridad de tu carpeta{' '}
            <strong>{driveStatus?.folderName || 'AulaÁgil - Respaldos'}</strong> en Google Drive? Esta acción no afecta tus datos locales actuales.
          </p>

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
              type="button"
              disabled={busy}
              onClick={() => onConfirmDeleteDrive(modal.file)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              {busy ? 'Eliminando...' : 'Eliminar de Google Drive'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // modal.type === 'desktop_credentials'
  const handleCredsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError('');
    if (!clientId.trim()) {
      setCredError('Ingresa un Client ID válido de Google Cloud.');
      return;
    }
    if (!clientSecret.trim() && !driveStatus?.hasDesktopClientSecret) {
      setCredError('Ingresa el Client Secret correspondiente.');
      return;
    }
    try {
      await onSaveDesktopCredentials({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      onClose();
    } catch (err) {
      setCredError(
        err instanceof Error ? err.message : 'No se pudieron guardar las credenciales.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-blue-700" />
              Credenciales propias de Google Cloud (Escritorio)
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Opcional: permite usar flujo OAuth2 directo de escritorio (<code className="font-mono">http://127.0.0.1</code>) con{' '}
              <code className="font-mono">refresh_token</code> persistente para respaldos automáticos en segundo plano en la app <code className="font-mono">.exe</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCredsSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Google OAuth Client ID (Aplicación de escritorio)
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890-xxxx.apps.googleusercontent.com"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Client Secret{' '}
              {driveStatus?.hasDesktopClientSecret ? '(guardado localmente)' : ''}
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={
                driveStatus?.hasDesktopClientSecret
                  ? '•••••••••••• (vacío para conservar el actual)'
                  : 'GOCSPX-...'
              }
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
            <HardDrive className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <span>
              Se guardan únicamente en la base SQLite local de tu computadora con el alcance restringido{' '}
              <code className="font-mono">drive.file</code> (solo carpeta de AulaÁgil).
            </span>
          </div>

          {credError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {credError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {driveStatus?.hasDesktopCredentials ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onSaveDesktopCredentials({
                    clientId: '',
                    clientSecret: '',
                    clearCustomCredentials: true,
                  });
                  onClose();
                }}
                className="px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg"
              >
                Borrar credenciales propias
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
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
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
              >
                {busy ? 'Guardando...' : 'Guardar credenciales'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
