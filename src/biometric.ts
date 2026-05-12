import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const BIOMETRIC_PREF_KEY = 'revis_biometric_unlock_enabled';
export const BIOMETRIC_LS_MIRROR = 'revis_biometric_unlock_enabled';

export function isNativeCapacitorApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  if (!isNativeCapacitorApp()) return false;
  try {
    const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
    const result = await NativeBiometric.isAvailable({ useFallback: true });
    return Boolean(result.isAvailable);
  } catch {
    return false;
  }
}

export function readBiometricEnabledSyncFromStorage(): boolean {
  try {
    return localStorage.getItem(BIOMETRIC_LS_MIRROR) === 'true';
  } catch {
    return false;
  }
}

export async function getBiometricUnlockEnabled(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: BIOMETRIC_PREF_KEY });
    return value === 'true';
  } catch {
    return readBiometricEnabledSyncFromStorage();
  }
}

export async function setBiometricUnlockEnabled(enabled: boolean): Promise<void> {
  try {
    await Preferences.set({
      key: BIOMETRIC_PREF_KEY,
      value: enabled ? 'true' : 'false',
    });
  } catch {
    /* Preferences pode falhar fora do Capacitor */
  }
  try {
    if (enabled) localStorage.setItem(BIOMETRIC_LS_MIRROR, 'true');
    else localStorage.removeItem(BIOMETRIC_LS_MIRROR);
  } catch {
    /* ignore */
  }
}

export async function promptBiometricUnlock(reason: string, title?: string): Promise<void> {
  const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
  await NativeBiometric.verifyIdentity({
    reason,
    title: title ?? 'RevisAuto',
    subtitle: '',
    description: reason,
    useFallback: true,
    negativeButtonText: 'Cancelar',
  });
}

export function resolveStoreUpdateUrl(): string {
  const single = (import.meta.env.VITE_APP_UPDATE_URL as string | undefined)?.trim();
  if (single) return single;
  const ios = (import.meta.env.VITE_IOS_STORE_URL as string | undefined)?.trim();
  const android = (import.meta.env.VITE_ANDROID_STORE_URL as string | undefined)?.trim();
  try {
    if (Capacitor.getPlatform() === 'ios') {
      return ios || 'https://apps.apple.com/app/id000000000';
    }
  } catch {
    /* web */
  }
  return android || 'https://play.google.com/store/apps/details?id=com.revisauto.app';
}

export function mercadoPagoSubscriptionsPortalUrl(): string {
  return (
    (import.meta.env.VITE_MP_SUBSCRIPTIONS_URL as string | undefined)?.trim() ||
    'https://www.mercadopago.com.br/subscriptions'
  );
}
