import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';

type AuthState = 'loading' | 'setup' | 'biometrics' | 'password' | 'unlocked';
type VaultType = 'real' | 'decoy' | null;

interface AuthStore {
  authState: AuthState;
  vaultType: VaultType;
  error: string | null;
  biometricsAvailable: boolean;

  initialize: () => Promise<void>;
  setupVault: (realPassword: string, decoyPassword: string) => Promise<boolean>;
  authenticateBiometrics: () => Promise<boolean>;
  authenticatePassword: (password: string) => Promise<boolean>;
  lock: () => void;
  clearError: () => void;
}

const hashPassword = async (password: string, salt: string): Promise<string> => {
  const data = password + salt;
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
  return hash;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  authState: 'loading',
  vaultType: null,
  error: null,
  biometricsAvailable: false,

  initialize: async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const biometricsAvailable = hasHardware && isEnrolled;

      const setupComplete = await SecureStore.getItemAsync('setup_complete');

      if (!setupComplete) {
        set({ authState: 'setup', biometricsAvailable });
      } else if (biometricsAvailable) {
        set({ authState: 'biometrics', biometricsAvailable });
      } else {
        set({ authState: 'password', biometricsAvailable });
      }
    } catch {
      set({ authState: 'setup', error: 'Failed to initialize' });
    }
  },

  setupVault: async (realPassword, decoyPassword) => {
    try {
      const salt = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        Date.now().toString()
      );

      const realHash = await hashPassword(realPassword, salt);
      const decoyHash = await hashPassword(decoyPassword, salt);

      await SecureStore.setItemAsync('salt', salt);
      await SecureStore.setItemAsync('real_hash', realHash);
      await SecureStore.setItemAsync('decoy_hash', decoyHash);
      await SecureStore.setItemAsync('setup_complete', 'true');

      const { biometricsAvailable } = get();
      set({
        authState: biometricsAvailable ? 'biometrics' : 'password',
        error: null
      });
      return true;
    } catch {
      set({ error: 'Failed to setup vault' });
      return false;
    }
  },

  authenticateBiometrics: async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock SentraVault',
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        set({ authState: 'password', error: null });
        return true;
      }
      return false;
    } catch {
      set({ error: 'Biometric authentication failed' });
      return false;
    }
  },

  authenticatePassword: async (password) => {
    try {
      const salt = await SecureStore.getItemAsync('salt');
      const realHash = await SecureStore.getItemAsync('real_hash');
      const decoyHash = await SecureStore.getItemAsync('decoy_hash');

      if (!salt || !realHash || !decoyHash) {
        set({ error: 'Vault not configured' });
        return false;
      }

      const enteredHash = await hashPassword(password, salt);

      if (enteredHash === realHash) {
        set({ authState: 'unlocked', vaultType: 'real', error: null });
        return true;
      } else if (enteredHash === decoyHash) {
        set({ authState: 'unlocked', vaultType: 'decoy', error: null });
        return true;
      } else {
        set({ error: 'Incorrect password' });
        return false;
      }
    } catch {
      set({ error: 'Authentication failed' });
      return false;
    }
  },

  lock: () => {
    const { biometricsAvailable } = get();
    set({
      authState: biometricsAvailable ? 'biometrics' : 'password',
      vaultType: null,
      error: null
    });
  },

  clearError: () => set({ error: null }),
}));
