import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { initializeCrypto, getSecretKey } from '../utils/encryption';
import { useMediaStore } from './mediaStore';

type AuthState = 'loading' | 'setup' | 'biometrics' | 'password' | 'unlocked';
type VaultType = 'real' | 'decoy' | null;

interface AuthStore {
  authState: AuthState;
  vaultType: VaultType;
  error: string | null;
  biometricsAvailable: boolean;
  password: string | null; // Stored temporarily for container operations
  secretKey: string | null; // Secret key from secure storage

  initialize: () => Promise<void>;
  setupVault: (realPassword: string, decoyPassword: string) => Promise<boolean>;
  authenticateBiometrics: () => Promise<boolean>;
  authenticatePassword: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  clearError: () => void;
  getCredentials: () => { password: string; secretKey: string } | null;
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
  password: null,
  secretKey: null,

  initialize: async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const biometricsAvailable = hasHardware && isEnrolled;

      const setupComplete = await SecureStore.getItemAsync('sv2_setup_complete');

      // Initialize crypto random number generator
      await initializeCrypto();

      // Pre-initialize the secret key (generates if not exists)
      const secretKey = await getSecretKey();

      if (!setupComplete) {
        set({ authState: 'setup', biometricsAvailable, secretKey });
      } else if (biometricsAvailable) {
        set({ authState: 'biometrics', biometricsAvailable, secretKey });
      } else {
        set({ authState: 'password', biometricsAvailable, secretKey });
      }
    } catch {
      set({ authState: 'setup', error: 'Failed to initialize' });
    }
  },

  setupVault: async (realPassword, decoyPassword) => {
    try {
      // We no longer store password hashes. 
      // We JUST verify if we can unpack the vault with the password.
      // But for "SETUP", we just want to flag that setup is done.
      // The actual vault creation happens when we try to "open" (and it creates) 
      // OR we can explicitly create them here.

      // For SVault v2 with Master Key, we don't need to store hashes in SecureStore 
      // to "verify" the password. The verification IS the successful unwrapping of the Master Key.

      // However, to support "Decoy" vs "Real", we need to know WHICH one it is before opening.
      // So we will keep the hash storage for fast differentiation.

      const salt = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        Date.now().toString()
      );

      const realHash = await hashPassword(realPassword, salt);
      const decoyHash = await hashPassword(decoyPassword, salt);

      await SecureStore.setItemAsync('sv2_salt', salt);
      await SecureStore.setItemAsync('sv2_real_hash', realHash);
      await SecureStore.setItemAsync('sv2_decoy_hash', decoyHash);
      await SecureStore.setItemAsync('sv2_setup_complete', 'true');

      const secretKey = await getSecretKey();

      const { biometricsAvailable } = get();
      set({
        authState: biometricsAvailable ? 'biometrics' : 'password',
        secretKey,
        error: null,
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
      const salt = await SecureStore.getItemAsync('sv2_salt');
      const realHash = await SecureStore.getItemAsync('sv2_real_hash');
      const decoyHash = await SecureStore.getItemAsync('sv2_decoy_hash');

      if (!salt || !realHash || !decoyHash) {
        set({ error: 'Vault not configured' });
        return false;
      }

      const enteredHash = await hashPassword(password, salt);
      const secretKey = await getSecretKey();

      let vaultType: VaultType = null;

      if (enteredHash === realHash) {
        vaultType = 'real';
      } else if (enteredHash === decoyHash) {
        vaultType = 'decoy';
      } else {
        set({ error: 'Incorrect password' });
        return false;
      }

      // INSTANT login - just store credentials, don't open container yet
      // Container will be opened lazily when user needs thumbnails/files
      const mediaStore = useMediaStore.getState();
      mediaStore.setVaultCredentials(password, secretKey, vaultType);

      set({
        authState: 'unlocked',
        vaultType,
        password,
        secretKey,
        error: null,
      });

      console.log('Login instant - vault unlocked');
      return true;
    } catch (error) {
      console.error('Authentication error:', error);
      set({ error: 'Authentication failed' });
      return false;
    }
  },

  lock: async () => {
    // Close the vault and clean up temp files
    const mediaStore = useMediaStore.getState();
    await mediaStore.closeVaultAsync();

    // WIPE SESSION DATA
    // We import this dynamically or move the clearSession into mediaStore's closeVaultAsync
    // For now, let's assume mediaStore.closeVaultAsync handles the heavy lifting,
    // but strict hygiene is good.
    const { clearSession } = require('../utils/svaultFormat');
    await clearSession();

    const { biometricsAvailable } = get();
    set({
      authState: biometricsAvailable ? 'biometrics' : 'password',
      vaultType: null,
      password: null, // Clear password from memory
      error: null,
    });
  },

  clearError: () => set({ error: null }),

  getCredentials: () => {
    const { password, secretKey } = get();
    if (password && secretKey) {
      return { password, secretKey };
    }
    return null;
  },
}));
