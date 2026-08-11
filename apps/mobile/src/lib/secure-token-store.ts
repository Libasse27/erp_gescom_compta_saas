import * as SecureStore from "expo-secure-store";

// Isole l'API native (Keychain iOS / Keystore Android) du reste du code :
// un seul module à mocker dans les tests, et un seul endroit à changer si le
// mécanisme de stockage évolue. Seul le refresh token est persisté ici —
// l'access token reste en mémoire (voir auth-context.tsx).
const REFRESH_TOKEN_KEY = "erp.refreshToken";

// WHEN_UNLOCKED_THIS_DEVICE_ONLY (au lieu du défaut WHEN_UNLOCKED) exclut
// l'entrée des sauvegardes iCloud/iTunes du trousseau : un refresh token
// valide ~30 jours ne doit pas devenir restaurable sur un autre appareil
// (CLAUDE.md §6). Sans effet sur Android (option iOS uniquement).
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, STORE_OPTIONS);
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, STORE_OPTIONS);
}

export async function clearStoredRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, STORE_OPTIONS);
}
