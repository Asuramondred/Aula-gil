import { useCallback, useEffect, useState } from 'react';
import { getAuthToken } from './api';
import type { AppUpdaterState } from '../types';

const CURRENT_APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

const DEFAULT_UPDATER_STATE: AppUpdaterState = {
  isDesktopApp: false,
  platform: 'web',
  isPackaged: false,
  isPortable: false,
  supportsAutoInstall: false,
  currentVersion: CURRENT_APP_VERSION,
  status: 'idle',
  availableVersion: null,
  releaseNotes: '',
  releaseDate: null,
  progress: 0,
  transferredBytes: 0,
  totalBytes: 0,
  directDownloadUrl: null,
  requiresManualDownload: true,
  repoSlug: '',
  lastCheckedAt: null,
  error: null,
  message: '',
};

export function useAppUpdater(authenticated: boolean) {
  const [state, setState] = useState<AppUpdaterState>(() => ({
    ...DEFAULT_UPDATER_STATE,
    isDesktopApp: typeof window !== 'undefined' && Boolean(window.aulaAgilUpdater),
  }));

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.aulaAgilUpdater : undefined;
    if (!bridge) return;

    let mounted = true;
    bridge
      .getState()
      .then((initial) => {
        if (mounted && initial) setState(initial);
      })
      .catch(() => {});

    const unsubscribe = bridge.onStatus((next) => {
      if (mounted && next) setState(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.aulaAgilUpdater : undefined;
    if (bridge) {
      setState((prev) => ({
        ...prev,
        status: 'checking',
        error: null,
        message: 'Buscando actualizaciones...',
      }));
      try {
        const next = await bridge.checkForUpdates();
        if (next) setState(next);
      } catch {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Sin conexión para verificar actualizaciones',
          message: 'Sin conexión para verificar actualizaciones',
        }));
      }
      return;
    }

    if (!authenticated) return;

    setState((prev) => ({
      ...prev,
      status: 'checking',
      error: null,
      message: 'Buscando actualizaciones...',
    }));

    try {
      const token = getAuthToken();
      const res = await fetch('/api/updates/check-github', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || 'No se pudieron consultar las actualizaciones.'
        );
      }
      setState((prev) => ({
        ...prev,
        ...data,
        isDesktopApp: false,
      }));
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Sin conexión para verificar actualizaciones';
      setState((prev) => ({
        ...prev,
        status: 'error',
        lastCheckedAt: new Date().toISOString(),
        error: msg,
        message: msg,
      }));
    }
  }, [authenticated]);

  const downloadUpdate = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.aulaAgilUpdater : undefined;
    if (bridge) {
      const res = await bridge.downloadUpdate();
      if (res?.state) setState(res.state);
    }
  }, []);

  const quitAndInstall = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.aulaAgilUpdater : undefined;
    if (bridge) {
      await bridge.quitAndInstall();
    }
  }, []);

  const openDirectDownload = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.aulaAgilUpdater : undefined;
    if (bridge) {
      await bridge.openReleaseDownload(state.directDownloadUrl || undefined);
    }
  }, [state.directDownloadUrl]);

  const hasUpdateAttention =
    state.status === 'available' ||
    state.status === 'downloading' ||
    state.status === 'downloaded';

  return {
    updater: state,
    hasUpdateAttention,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    openDirectDownload,
  };
}
