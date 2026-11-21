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
