/**
 * SVault Format - Secure Storage & Exchange
 *
 * Structure (Internal Storage):
 * - Index: JSON with file metadata + Encrypted MASTER KEY (Wrapped).
 * - Files: Encrypted individually using MASTER KEY.
 * - Thumbnails: Stored as base64 in index (fast access) or separate encrypted files.
 *
 * Structure (Export/Backup .svault):
 * - ZIP Archive:
 *   - metadata.json: Contains Salt, IV, and Wrapped Master Key (encrypted with User Password).
 *   - index.json: The Vault Index (encrypted with Master Key).
 *   - files/: Directory of encrypted files (encrypted with Master Key).
 *
 * Security:
 * - Master Key: Random 32-byte key generated once. Encrypts all data.
 * - User Password: Encrypts the Master Key (Key Wrapping).
 * - Changing Password: Re-encrypts ONLY the Master Key. Fast.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import JSZip from 'jszip';
import {
  deriveKey,
  generateSalt,
  encryptString,
  decryptString,
  encryptFile,
  decryptFile,
  generateId,
  encryptData,
  decryptData
} from './fastCrypto';

// File paths
const VAULTS_DIR = FileSystem.documentDirectory + 'vaults/';
const SESSION_DIR = FileSystem.documentDirectory + 'session/'; // Temp decrypted files

export type VaultType = 'real' | 'decoy';

export interface VaultItem {
  id: string;
  type: 'photo' | 'video' | 'file';
  originalName: string;
  mimeType: string;
  fileExtension?: string;
  duration?: number;
  createdAt: number;
  thumbnailBase64?: string;
  encryptedFileName: string;
  size?: number; // Original file size
}

export interface VaultIndex {
  version: number;
  salt: string; // Salt used to derive the Key Envelope key
  keyEnvelope: string; // Master Key encrypted with (Password + Salt)
  items: VaultItem[];
}

export interface VaultHandle {
  type: VaultType;
  masterKey: string; // The Unwrapped Master Key (in memory only)
  index: VaultIndex;
  indexPath: string;
  filesDir: string;
}

// ============ Directory Setup ============

async function ensureDirectories(): Promise<void> {
  const dirs = [VAULTS_DIR, SESSION_DIR];
  for (const dir of dirs) {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }
}

export function getVaultPath(vaultType: VaultType): string {
  return VAULTS_DIR + `${vaultType}.svault`;
}

export function getVaultFilesDir(vaultType: VaultType): string {
  return VAULTS_DIR + `${vaultType}_files/`;
}

// Alias for compatibility
export const getVaultFilePath = getVaultPath;

// ============ Session Management ============

/**
 * Clears the session directory (removes all cleartext files)
 * Must be called on Logout/Lock
 */
export async function clearSession(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(SESSION_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(SESSION_DIR, { idempotent: true });
    }
    await FileSystem.makeDirectoryAsync(SESSION_DIR, { intermediates: true });
  } catch (e) {
    console.error('Failed to clear session:', e);
  }
}

export function getSessionDir(): string {
  return SESSION_DIR;
}

// For compatibility with mediaStore
export function getThumbsCacheDir(): string {
  return SESSION_DIR;
}

// ============ Vault Operations ============

/**
 * Open or create a vault - FAST (only loads index)
 */
export async function openVault(
  vaultType: VaultType,
  password: string,
  secretKey: string
): Promise<VaultHandle | null> {
  await ensureDirectories();
  // Clear any leftover session data from crashes
  await clearSession();

  const indexPath = getVaultPath(vaultType);
  const filesDir = getVaultFilesDir(vaultType);

  // Ensure files directory exists
  const filesDirInfo = await FileSystem.getInfoAsync(filesDir);
  if (!filesDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(filesDir, { intermediates: true });
  }

  const indexInfo = await FileSystem.getInfoAsync(indexPath);

  if (!indexInfo.exists) {
    // === CREATE NEW VAULT ===
    const salt = await generateSalt();

    // 1. Derive Key Wrapping Key (KEK) from Password
    const kek = await deriveKey(password, secretKey, salt);

    // 2. Generate secure random Master Key (32 bytes = 64 hex chars)
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const masterKey = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // 3. Wrap (Encrypt) Master Key with KEK
    const { encrypted: keyEnvelope, iv } = await encryptString(masterKey, kek);
    const storedEnvelope = `${iv}:${keyEnvelope}`;

    const index: VaultIndex = {
      version: 2,
      salt,
      keyEnvelope: storedEnvelope,
      items: [],
    };

    // Save index (Index itself is just JSON, sensitive parts are inside)
    await saveIndex(indexPath, index);

    return {
      type: vaultType,
      masterKey,
      index,
      indexPath,
      filesDir,
    };
  }

  // === OPEN EXISTING VAULT ===
  try {
    const indexContent = await FileSystem.readAsStringAsync(indexPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const index: VaultIndex = JSON.parse(indexContent);

    // 1. Derive KEK from Password + Stored Salt
    const kek = await deriveKey(password, secretKey, index.salt);

    // 2. Unwrap (Decrypt) Master Key
    const [envIv, envData] = index.keyEnvelope.split(':');
    let masterKey: string;

    try {
      masterKey = decryptString(envData, kek, envIv);
    } catch {
      console.error('Failed to unwrap master key - wrong password');
      return null;
    }

    if (!masterKey) return null;

    return {
      type: vaultType,
      masterKey,
      index,
      indexPath,
      filesDir,
    };
  } catch (error) {
    console.error('Failed to open vault:', error);

    // Attempt to recover from backup
    try {
      console.log('Attempting to recover from backup index...');
      const backupPath = indexPath + '.bak';
      const backupInfo = await FileSystem.getInfoAsync(backupPath);
      if (backupInfo.exists) {
        const backupContent = await FileSystem.readAsStringAsync(backupPath, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const index: VaultIndex = JSON.parse(backupContent);

        // Validate backup by deriving key
        const kek = await deriveKey(password, secretKey, index.salt);
        const [envIv, envData] = index.keyEnvelope.split(':');
        const masterKey = decryptString(envData, kek, envIv);

        if (masterKey) {
          console.log('Recovered successfully from backup!');
          // Restore backup to main
          await FileSystem.copyAsync({ from: backupPath, to: indexPath });

          return {
            type: vaultType,
            masterKey,
            index,
            indexPath,
            filesDir,
          };
        }
      }
    } catch (backupError) {
      console.error('Failed to recover from backup:', backupError);
    }

    // If we're here, main is corrupted AND backup failed/didn't exist.
    // NUCLEAR OPTION: Rename corrupted file and start fresh to un-brick the user.
    try {
      console.error('CRITICAL: Vault index corrupted and unrecoverable. Archiving and resetting.');
      const corruptedPath = indexPath + `.corrupted.${Date.now()}`;
      await FileSystem.moveAsync({ from: indexPath, to: corruptedPath });

      // Also archive backup if it exists (it's likely bad too)
      const backupPath = indexPath + '.bak';
      const backupInfo = await FileSystem.getInfoAsync(backupPath);
      if (backupInfo.exists) {
        await FileSystem.moveAsync({ from: backupPath, to: backupPath + `.corrupted.${Date.now()}` });
      }

      // Recursively call openVault - it will now see "no file" and create a fresh one
      return openVault(vaultType, password, secretKey);
    } catch (resetError) {
      console.error('Failed to reset corrupted vault:', resetError);
      return null;
    }
  }
}

// Mutex for save operations to prevent race conditions
let saveLock: Promise<void> = Promise.resolve();

async function saveIndex(indexPath: string, index: VaultIndex): Promise<void> {
  // Chain execution to ensure sequential saves
  const operation = async () => {
    const indexJson = JSON.stringify(index);
    // Use unique temp file to avoid collisions
    const tempPath = indexPath + '.tmp.' + Date.now() + Math.random().toString(36).substring(7);
    const backupPath = indexPath + '.bak';

    try {
      // 1. Write to temp file first (Atomic Write Pattern)
      await FileSystem.writeAsStringAsync(tempPath, indexJson, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // 2. Check if main file exists, if so, back it up
      const info = await FileSystem.getInfoAsync(indexPath);
      if (info.exists) {
        // We use copy instead of move for backup to keep main file valid
        await FileSystem.copyAsync({ from: indexPath, to: backupPath });
      }

      // 3. Move temp to main (Replace)
      if (info.exists) {
        await FileSystem.deleteAsync(indexPath, { idempotent: true });
      }
      await FileSystem.moveAsync({ from: tempPath, to: indexPath });

    } catch (error) {
      console.error('Failed to save vault index:', error);
      // Cleanup temp
      try {
        await FileSystem.deleteAsync(tempPath, { idempotent: true });
      } catch (e) { }
      throw error;
    }
  };

  // Add to queue and return the promise
  saveLock = saveLock.then(operation).catch(() => { });
  return saveLock;
}

export async function saveVault(handle: VaultHandle): Promise<void> {
  await saveIndex(handle.indexPath, handle.index);
}

/**
 * Close vault and clear cache (SESSION)
 */
export async function closeVault(): Promise<void> {
  await clearSession();
}

// ============ Thumbnail Operations ============

/**
 * Extract a thumbnail to Session - FAST (already in index as base64)
 */
export async function extractThumbnail(
  handle: VaultHandle,
  itemId: string
): Promise<string | null> {
  const item = handle.index.items.find((i) => i.id === itemId);
  if (!item || !item.thumbnailBase64) {
    return null;
  }

  const thumbPath = SESSION_DIR + `${itemId}_thumb.jpg`;

  // Check if already cached
  const thumbInfo = await FileSystem.getInfoAsync(thumbPath);
  if (thumbInfo.exists) {
    return thumbPath;
  }

  // Write thumbnail to session
  try {
    await FileSystem.writeAsStringAsync(thumbPath, item.thumbnailBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return thumbPath;
  } catch (error) {
    console.error('Failed to extract thumbnail:', error);
    return null;
  }
}

// Alias for compatibility
export const extractFile = extractFileToSession;

// ============ File Operations ============

/**
 * Add a file to the vault
 * Encrypts source -> vault using Master Key
 */
export async function addFileToVault(
  handle: VaultHandle,
  sourcePath: string,
  originalName: string,
  mimeType: string,
  thumbnailBase64?: string,
  skipSave = false, // Optimization for batch imports
  size?: number, // Original file size
  existingId?: string // Preserve ID from pending item
): Promise<VaultItem> {
  const id = existingId || generateId();
  const ext = originalName.split('.').pop() || 'bin';
  const encryptedFileName = `${id}.enc`;

  let type: 'photo' | 'video' | 'file' = 'file';
  if (mimeType.startsWith('image/')) type = 'photo';
  else if (mimeType.startsWith('video/')) type = 'video';

  const item: VaultItem = {
    id,
    type,
    originalName,
    mimeType,
    fileExtension: ext,
    createdAt: Date.now(),
    thumbnailBase64,
    encryptedFileName,
    size: size || 0,
  };

  handle.index.items.unshift(item);

  const encryptedPath = handle.filesDir + encryptedFileName;
  // Encrypt with MASTER KEY
  await encryptFile(sourcePath, encryptedPath, handle.masterKey);

  if (!skipSave) {
    await saveVault(handle);
  }

  return item;
}

/**
 * Decrypt file to Session (Temp) folder
 * Only called on-demand
 */
export async function extractFileToSession(
  handle: VaultHandle,
  itemId: string
): Promise<string | null> {
  const item = handle.index.items.find((i) => i.id === itemId);
  if (!item) return null;

  const ext = item.fileExtension || 'bin';
  const sessionPath = SESSION_DIR + `${itemId}.${ext}`;

  // Check if exists in session
  const info = await FileSystem.getInfoAsync(sessionPath);
  if (info.exists) return sessionPath;

  const encryptedPath = handle.filesDir + item.encryptedFileName;

  // Decrypt with MASTER KEY
  try {
    await decryptFile(encryptedPath, sessionPath, handle.masterKey);
    return sessionPath;
  } catch (e) {
    console.error('Failed to decrypt to session:', e);
    return null;
  }
}

/**
 * Securely delete items
 */
export async function deleteFromVault(
  handle: VaultHandle,
  itemIds: string[]
): Promise<void> {
  for (const id of itemIds) {
    const item = handle.index.items.find((i) => i.id === id);
    if (item) {
      const encryptedPath = handle.filesDir + item.encryptedFileName;
      const sessionPath = SESSION_DIR + `${id}.${item.fileExtension || 'bin'}`;

      try {
        // Delete encrypted file
        await FileSystem.deleteAsync(encryptedPath, { idempotent: true });

        // Delete any temp session file
        await FileSystem.deleteAsync(sessionPath, { idempotent: true });
      } catch (e) {
        // Ignore
      }
    }
  }

  handle.index.items = handle.index.items.filter((i) => !itemIds.includes(i.id));
  await saveVault(handle);
}

/**
 * Change Vault Password
 * Re-wraps the Master Key with new password
 */
export async function changeVaultPassword(
  handle: VaultHandle,
  newPassword: string,
  secretKey: string
): Promise<boolean> {
  try {
    const newSalt = await generateSalt();
    const newKek = await deriveKey(newPassword, secretKey, newSalt);

    const { encrypted: newEnvelope, iv } = await encryptString(handle.masterKey, newKek);
    const storedEnvelope = `${iv}:${newEnvelope}`;

    handle.index.salt = newSalt;
    handle.index.keyEnvelope = storedEnvelope;

    await saveVault(handle);
    return true;
  } catch (e) {
    console.error('Failed to change password:', e);
    return false;
  }
}


// ============ Export / Import (ZIP Archive) ============

/**
 * Export to .svault Archive (ZIP)
 * Standard format:
 * - metadata.json (salt, wrapped master key)
 * - index.json (encrypted inventory)
 * - files/ (encrypted files)
 */
export async function exportVaultToArchive(
  handle: VaultHandle,
  itemIds: string[],
  userPassword: string, // Password to lock the export with
  secretKey: string
): Promise<string> {
  const exportPath = FileSystem.cacheDirectory + `sentravault_backup_${Date.now()}.svault`;
  const zip = new JSZip();

  // 1. Setup Export Security
  // We use the SAME approach: Master Key + Envelope
  // We re-use the current Vault's Master Key? NO. 
  // We should just dump the encrypted files AS IS (Fastest) and securely wrap the Master Key with the supplied password.
  // This allows restoring without re-encrypting every file.

  // Generate a salt for this export
  const exportSalt = await generateSalt();
  const exportKek = await deriveKey(userPassword, secretKey, exportSalt);

  // Wrap the CURRENT Master Key with the Export Password
  const { encrypted: keyEnvelope, iv } = await encryptString(handle.masterKey, exportKek);

  const metadata = {
    version: 2,
    salt: exportSalt,
    keyEnvelope: `${iv}:${keyEnvelope}`,
    created: Date.now()
  };

  zip.file('metadata.json', JSON.stringify(metadata));

  // 2. Add Index (Filtered)
  const exportItems = handle.index.items.filter(i => itemIds.includes(i.id));
  zip.file('index.json', JSON.stringify(exportItems));

  // 3. Add Files
  const filesFolder = zip.folder('files');
  if (filesFolder) {
    for (const item of exportItems) {
      const srcPath = handle.filesDir + item.encryptedFileName;
      try {
        const fileContent = await FileSystem.readAsStringAsync(srcPath, { encoding: FileSystem.EncodingType.Base64 });
        filesFolder.file(item.encryptedFileName, fileContent, { base64: true });
      } catch (e) {
        console.warn(`Skipping missing file: ${item.id}`);
      }
    }
  }

  // 4. Generate Zip
  const content = await zip.generateAsync({ type: 'base64' });
  await FileSystem.writeAsStringAsync(exportPath, content, { encoding: FileSystem.EncodingType.Base64 });

  return exportPath;
}

/**
 * Import from .svault Archive
 */
export async function importFromArchive(
  handle: VaultHandle,
  archivePath: string,
  inputPassword: string, // Password the user THINKS is correct (could be old or current)
  secretKey: string
): Promise<number> {
  try {
    const fileContent = await FileSystem.readAsStringAsync(archivePath, { encoding: FileSystem.EncodingType.Base64 });
    const zip = await JSZip.loadAsync(fileContent, { base64: true });

    // 1. Read Metadata
    const metaFile = zip.file('metadata.json');
    if (!metaFile) throw new Error('Invalid Backup: Missing metadata');

    const metaJson = await metaFile.async('string');
    const metadata = JSON.parse(metaJson);

    // 2. Try to Unwrap the Backup's Master Key
    const kek = await deriveKey(inputPassword, secretKey, metadata.salt);
    const [envIv, envData] = metadata.keyEnvelope.split(':');

    let backupMasterKey: string;
    try {
      backupMasterKey = decryptString(envData, kek, envIv);
    } catch (e) {
      throw new Error('Incorrect Password');
    }

    if (!backupMasterKey) throw new Error('Decryption Failed');

    // 3. Read Index
    const indexFile = zip.file('index.json');
    if (!indexFile) throw new Error('Invalid Backup: Missing index');
    const itemsJson = await indexFile.async('string');
    const importItems: VaultItem[] = JSON.parse(itemsJson);

    let importedCount = 0;
    const filesFolder = zip.folder('files');

    // 4. Import Items
    for (const item of importItems) {
      try {
        const fileEntry = filesFolder?.file(item.encryptedFileName);
        if (!fileEntry) continue;

        // Decrypt from Backup Key -> Temp
        const tempEncPath = SESSION_DIR + `temp_imp_${item.id}.enc`;
        const tempDecPath = SESSION_DIR + `temp_imp_${item.id}.dec`;
        const finalEncPath = handle.filesDir + `${item.id}.enc`; // Re-use ID or generate new? Ideally keep ID if not conflict.

        // Write raw encrypted from zip
        const b64 = await fileEntry.async('base64');
        await FileSystem.writeAsStringAsync(tempEncPath, b64, { encoding: FileSystem.EncodingType.Base64 });

        // Decrypt using Backup Key
        await decryptFile(tempEncPath, tempDecPath, backupMasterKey);

        // Re-Encrypt using Current Vault Key
        await encryptFile(tempDecPath, finalEncPath, handle.masterKey);

        // Add to Index (Check for duplicates)
        if (!handle.index.items.some(i => i.id === item.id)) {
          handle.index.items.unshift(item);
        } else {
          // If ID exists, generate new ID
          const newId = generateId();
          item.id = newId;
          item.encryptedFileName = `${newId}.enc`;
          // Move file to new name
          await FileSystem.moveAsync({
            from: finalEncPath,
            to: handle.filesDir + item.encryptedFileName
          });
          handle.index.items.unshift(item);
        }

        // Cleanup
        await FileSystem.deleteAsync(tempEncPath, { idempotent: true });
        await FileSystem.deleteAsync(tempDecPath, { idempotent: true });
        importedCount++;

      } catch (e) {
        console.error('Failed to import item:', item.id, e);
      }
    }

    await saveVault(handle);
    return importedCount;

  } catch (error) {
    if (error instanceof Error && error.message === 'Incorrect Password') {
      throw error;
    }
    console.error('Import failed:', error);
    throw new Error('Failed to parse backup file');
  }
}

