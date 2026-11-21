import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

const driveProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  driveProvider.addScope(scope);
}
driveProvider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
let cachedDriveAccessToken: string | null = null;

export function getCachedDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function clearCachedDriveAccessToken(): void {
  cachedDriveAccessToken = null;
}

export function initDriveAuthListener(
  onTokenChange?: (user: User | null, token: string | null) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedDriveAccessToken = null;
      onTokenChange?.(null, null);
    } else if (cachedDriveAccessToken && !isSigningIn) {
      onTokenChange?.(user, cachedDriveAccessToken);
    }
  });
}

function mapFirebaseDriveError(err: unknown): Error {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  if (code === 'auth/unauthorized-domain') {
    return new Error(
      'Este dominio local no está autorizado en Firebase (si estás en un ejecutable compilado anteriormente, actualiza el instalador o usa el botón "Client ID / Secret (opcional)" para vincular directamente con tu navegador).'
    );
  }
  if (code === 'auth/popup-closed-by-user') {
    return new Error('Se cerró la ventana de inicio de sesión de Google antes de completar la vinculación.');
  }
  if (code === 'auth/popup-blocked') {
    return new Error('El navegador bloqueó la ventana emergente de Google. Permite ventanas emergentes o usa "Client ID / Secret (opcional)".');
  }
  if (code === 'auth/cancelled-popup-request') {
    return new Error('Ya hay una ventana de Google abierta. Completa o cierra esa ventana e intenta nuevamente.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('Sin conexión a internet para conectar con Google Drive.');
  }
  return err instanceof Error
    ? err
    : new Error('No se pudo conectar con Google Drive.');
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'No se recibió permiso de acceso para Google Drive. Intenta nuevamente.'
      );
    }
    cachedDriveAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedDriveAccessToken,
    };
  } catch (err) {
    throw mapFirebaseDriveError(err);
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedDriveAccessToken = null;
  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase signout errors if already signed out
  }
}
