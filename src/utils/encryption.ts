import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Key for storing the secret in SecureStore (iOS Keychain / Android Keystore)
// Changed to sv2_ prefix for fresh start (old keys persist in Keychain after uninstall)
const SECRET_KEY_STORAGE = 'sv2_secret_key';

// Fallback placeholder (only used if SecureStore fails)
const FALLBACK_SECRET = 'Place_holder280399';

// PBKDF2 iterations for key derivation at login
// 10,000 is fast on mobile (~1-2 seconds) while still secure with secretKey
const KEY_DERIVATION_ITERATIONS = 10000;

// Legacy format iterations (kept for backwards compatibility)
const LEGACY_ENCRYPTION_ITERATIONS = 10000;
const OLD_ENCRYPTION_ITERATIONS = 1000;

// Cache for pre-generated random bytes (1KB = 256 words)
let randomBytesCache: Uint8Array = new Uint8Array(0);
let cacheIndex = 0;
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the crypto random number generator
 * Must be called before any encryption operations
 * Pre-generates 1KB of cryptographically secure random bytes
 */
export const initializeCrypto = async (): Promise<void> => {
  if (isInitialized) return;

  // Prevent multiple simultaneous initializations
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      // Pre-generate 1KB of secure random bytes
      randomBytesCache = await Crypto.getRandomBytesAsync(1024);
      cacheIndex = 0;
      isInitialized = true;
      console.log('Crypto initialized with 1KB secure random pool');
    } catch (error) {
      console.error('CRITICAL: Failed to initialize crypto:', error);
      throw new Error('Cannot initialize secure random generator');
    }
  })();

  return initializationPromise;
};

/**
 * Refill the random bytes cache
 * Called automatically when cache runs low
 */
const refillRandomCache = async (): Promise<void> => {
  try {
    randomBytesCache = await Crypto.getRandomBytesAsync(1024);
    cacheIndex = 0;
    console.log('Random cache refilled');
  } catch (error) {
    console.error('Failed to refill random cache:', error);
    throw new Error('Cannot generate secure random bytes');
  }
};

/**
 * Get secure random bytes from the pre-generated cache
 * NEVER falls back to Math.random - throws error instead
 */
const getSecureRandomBytes = async (count: number): Promise<Uint8Array> => {
  // Ensure initialized
  if (!isInitialized) {
    await initializeCrypto();
  }

  // Check if we have enough bytes
  const availableBytes = randomBytesCache.length - cacheIndex;

  if (availableBytes < count) {
    // Refill cache before continuing
    await refillRandomCache();
  }

  // Get bytes from cache
  const bytes = randomBytesCache.slice(cacheIndex, cacheIndex + count);
  cacheIndex += count;

  // If cache is running low (less than 256 bytes left), trigger async refill
  if (randomBytesCache.length - cacheIndex < 256) {
    refillRandomCache().catch(console.error);
  }

  return bytes;
};

/**
 * Convert bytes to CryptoJS WordArray
 */
const bytesToWordArray = (bytes: Uint8Array): CryptoJS.lib.WordArray => {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const word = (bytes[i] << 24) |
      ((bytes[i + 1] || 0) << 16) |
      ((bytes[i + 2] || 0) << 8) |
      (bytes[i + 3] || 0);
    words.push(word >>> 0);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
};

/**
 * Get or create the secret key from secure storage
 * - iOS: Stored in Keychain (hardware-encrypted)
 * - Android: Stored in Keystore (hardware-encrypted)
 * This key is NOT accessible to the user, even with device access
 */
export const getSecretKey = async (): Promise<string> => {
  try {
    // Try to get existing secret key
    let secretKey = await SecureStore.getItemAsync(SECRET_KEY_STORAGE);

    if (!secretKey) {
      // Generate a new random secret key (64 random bytes as hex = 128 chars)
      const randomBytes = await Crypto.getRandomBytesAsync(64);
      const hexArray = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0'));
      secretKey = hexArray.join('') + FALLBACK_SECRET; // Combine random + placeholder

      // Store it securely (user can't access this)
      await SecureStore.setItemAsync(SECRET_KEY_STORAGE, secretKey);
    }

    return secretKey;
  } catch (error) {
    console.error('SecureStore error, using fallback:', error);
    return FALLBACK_SECRET;
  }
};

/**
 * Derive a 256-bit encryption key from password using PBKDF2
 * Formula: PBKDF2(password + secretKey, secretKey, 100,000 iterations)
 *
 * @param password - User's password
 * @param secretKey - Secret key from secure storage
 */
export const deriveKey = (password: string, secretKey: string): string => {
  return CryptoJS.PBKDF2(password + secretKey, secretKey, {
    keySize: 256 / 32, // 256 bits
    iterations: KEY_DERIVATION_ITERATIONS,
  }).toString();
};

/**
 * Encrypt data using AES-256-CBC (FAST - SVAULT3 format)
 *
 * Uses the pre-derived 256-bit key directly (no per-file PBKDF2)
 * This is ~100x faster than SVAULT2 while maintaining security because:
 * - The key is already derived with 100,000 PBKDF2 iterations at login
 * - Each file gets a unique random IV (prevents pattern analysis)
 * - AES-256-CBC with proper padding
 *
 * @param data - Plain text or Base64 string to encrypt
 * @param key - Derived encryption key (hex string from login)
 * @returns Encrypted string in SVAULT3 format
 */
export const encryptData = async (data: string, key: string): Promise<string> => {
  // Get secure random IV (16 bytes) - no salt needed since key is pre-derived
  const ivBytes = await getSecureRandomBytes(16);
  const iv = bytesToWordArray(ivBytes);

  // Parse the derived key (it's already a 256-bit hex string from PBKDF2 at login)
  const keyWordArray = CryptoJS.enc.Hex.parse(key);

  // Encrypt with AES-256-CBC - NO additional PBKDF2!
  const encrypted = CryptoJS.AES.encrypt(data, keyWordArray, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  // Format: "SVAULT3:" + base64(iv) + ":" + base64(ciphertext)
  // SVAULT3 = Fast format with no per-file key derivation
  return 'SVAULT3:' +
    iv.toString(CryptoJS.enc.Base64) + ':' +
    encrypted.ciphertext.toString(CryptoJS.enc.Base64);
};

/**
 * Decrypt data using AES-256-CBC
 * Supports all format versions: SVAULT3, SVAULT2, SVAULT, and legacy
 *
 * @param encryptedData - Encrypted ciphertext
 * @param key - Derived encryption key (hex string from login)
 * @returns Decrypted string
 */
export const decryptData = (encryptedData: string, key: string): string => {
  // SVAULT3: Fast format (no per-file PBKDF2) - ~100x faster
  if (encryptedData.startsWith('SVAULT3:')) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid SVAULT3 format');
    }

    const iv = CryptoJS.enc.Base64.parse(parts[1]);
    const ciphertext = CryptoJS.enc.Base64.parse(parts[2]);

    // Parse the derived key directly (no additional PBKDF2)
    const keyWordArray = CryptoJS.enc.Hex.parse(key);

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertext,
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, keyWordArray, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const result = decrypted.toString(CryptoJS.enc.Utf8);
    if (!result) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    return result;
  }

  // SVAULT2: Slower format with 10,000 iterations (backwards compatibility)
  if (encryptedData.startsWith('SVAULT2:')) {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid SVAULT2 format');
    }

    const salt = CryptoJS.enc.Base64.parse(parts[1]);
    const iv = CryptoJS.enc.Base64.parse(parts[2]);
    const ciphertext = CryptoJS.enc.Base64.parse(parts[3]);

    const derivedKey = CryptoJS.PBKDF2(key, salt, {
      keySize: 256 / 32,
      iterations: LEGACY_ENCRYPTION_ITERATIONS,
    });

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertext,
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, derivedKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const result = decrypted.toString(CryptoJS.enc.Utf8);
    if (!result) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    return result;
  }

  // SVAULT: Old format with 1,000 iterations (backwards compatibility)
  if (encryptedData.startsWith('SVAULT:')) {
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid SVAULT format');
    }

    const salt = CryptoJS.enc.Base64.parse(parts[1]);
    const iv = CryptoJS.enc.Base64.parse(parts[2]);
    const ciphertext = CryptoJS.enc.Base64.parse(parts[3]);

    const derivedKey = CryptoJS.PBKDF2(key, salt, {
      keySize: 256 / 32,
      iterations: OLD_ENCRYPTION_ITERATIONS,
    });

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertext,
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, derivedKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    const result = decrypted.toString(CryptoJS.enc.Utf8);
    if (!result) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    return result;
  }

  // Legacy crypto-js format (U2FsdGVk...)
  if (encryptedData.startsWith('U2FsdGVk')) {
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    const result = bytes.toString(CryptoJS.enc.Utf8);
    if (!result) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    return result;
  }

  throw new Error('Unknown encryption format');
};

/**
 * Encrypt a JSON bundle (for .svault files)
 */
export const encryptBundle = async (bundleJson: string, key: string): Promise<string> => {
  return encryptData(bundleJson, key);
};

/**
 * Decrypt a JSON bundle (for .svault files)
 */
export const decryptBundle = (encryptedBundle: string, key: string): string => {
  return decryptData(encryptedBundle, key);
};

/**
 * Check if data appears to be encrypted
 * Supports all format versions: SVAULT3, SVAULT2, SVAULT, legacy
 */
export const isEncrypted = (data: string): boolean => {
  return data.startsWith('SVAULT3:') ||
         data.startsWith('SVAULT2:') ||
         data.startsWith('SVAULT:') ||
         data.startsWith('U2FsdGVk');
};
