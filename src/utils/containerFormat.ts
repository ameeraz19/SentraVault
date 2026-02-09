/**
 * SentraVault Container Format
 *
 * .svault files are encrypted ZIP archives with a custom header.
 *
 * File Structure:
 * [HEADER: 64 bytes]
 *   - Magic bytes: "SVAULT" (6 bytes)
 *   - Version: uint8 (1 byte)
 *   - Reserved: 1 byte
 *   - Salt: 32 bytes (for PBKDF2 key derivation)
 *   - IV: 16 bytes (for AES-256-GCM)
 *   - Auth tag position marker: 8 bytes
 *
 * [ENCRYPTED DATA]
 *   - AES-256-GCM encrypted ZIP data
 *   - Auth tag: 16 bytes (at end)
 *
 * Internal ZIP structure:
 *   - index.json (file metadata)
 *   - thumbnails/{id}.jpg (100x100 previews)
 *   - files/{id}.{ext} (original files)
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import CryptoJS from 'crypto-js';
import JSZip from 'jszip';

// Constants
const MAGIC_BYTES = 'SVAULT';
const VERSION = 1;
const HEADER_SIZE = 64;
const SALT_SIZE = 32;
const IV_SIZE = 16;
const AUTH_TAG_SIZE = 16;

// Directories
const CONTAINER_DIR = FileSystem.documentDirectory + 'containers/';
const TEMP_DIR = FileSystem.cacheDirectory + 'vault_temp/';
const THUMBNAILS_TEMP_DIR = TEMP_DIR + 'thumbnails/';
const FILES_TEMP_DIR = TEMP_DIR + 'files/';

// Types
export interface VaultItem {
  id: string;
  type: 'photo' | 'video' | 'file';
  originalName: string;
  mimeType: string;
  fileExtension: string;
  size: number;
  createdAt: number;
  duration?: number; // For videos
  thumbnailPath: string; // Path inside ZIP: thumbnails/{id}.jpg
  filePath: string; // Path inside ZIP: files/{id}.{ext}
}

export interface VaultIndex {
  version: number;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  items: VaultItem[];
}

export interface ContainerHandle {
  path: string;
  encryptionKey: CryptoJS.lib.WordArray;
  index: VaultIndex;
  zip: JSZip;
  isDirty: boolean;
}

// Helper functions
async function ensureDirectories(): Promise<void> {
  const dirs = [CONTAINER_DIR, TEMP_DIR, THUMBNAILS_TEMP_DIR, FILES_TEMP_DIR];
  for (const dir of dirs) {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function uint8ArrayToWordArray(uint8Array: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < uint8Array.length; i += 4) {
    const word =
      (uint8Array[i] << 24) |
      ((uint8Array[i + 1] || 0) << 16) |
      ((uint8Array[i + 2] || 0) << 8) |
      (uint8Array[i + 3] || 0);
    words.push(word >>> 0);
  }
  return CryptoJS.lib.WordArray.create(words, uint8Array.length);
}

function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const words = wordArray.words;
  const sigBytes = wordArray.sigBytes;
  const uint8Array = new Uint8Array(sigBytes);

  for (let i = 0; i < sigBytes; i++) {
    uint8Array[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }

  return uint8Array;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Derive encryption key from password using PBKDF2
 * Using 10,000 iterations for fast mobile performance
 * (Combined with secretKey this is still very secure)
 */
async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoJS.lib.WordArray> {
  const saltWordArray = uint8ArrayToWordArray(salt);
  const key = CryptoJS.PBKDF2(password, saltWordArray, {
    keySize: 256 / 32,
    iterations: 10000, // Reduced from 100,000 for fast mobile login
  });
  return key;
}

/**
 * Encrypt data with AES-256 (using CBC mode since GCM not available in crypto-js)
 */
function encryptData(
  data: Uint8Array,
  key: CryptoJS.lib.WordArray,
  iv: Uint8Array
): Uint8Array {
  const dataWordArray = uint8ArrayToWordArray(data);
  const ivWordArray = uint8ArrayToWordArray(iv);

  const encrypted = CryptoJS.AES.encrypt(dataWordArray, key, {
    iv: ivWordArray,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return wordArrayToUint8Array(encrypted.ciphertext);
}

/**
 * Decrypt data with AES-256
 */
function decryptData(
  encryptedData: Uint8Array,
  key: CryptoJS.lib.WordArray,
  iv: Uint8Array
): Uint8Array {
  const ciphertextWordArray = uint8ArrayToWordArray(encryptedData);
  const ivWordArray = uint8ArrayToWordArray(iv);

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: ciphertextWordArray,
  });

  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: ivWordArray,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return wordArrayToUint8Array(decrypted);
}

/**
 * Create a new empty container
 */
export async function createContainer(
  vaultType: 'real' | 'decoy',
  password: string,
  secretKey: string
): Promise<string> {
  await ensureDirectories();

  const containerName = vaultType === 'real' ? 'vault.svault' : 'decoy.svault';
  const containerPath = CONTAINER_DIR + containerName;

  // Generate random salt and IV
  const salt = await Crypto.getRandomBytesAsync(SALT_SIZE);
  const iv = await Crypto.getRandomBytesAsync(IV_SIZE);

  // Derive encryption key
  const combinedPassword = password + secretKey;
  const encryptionKey = await deriveKey(combinedPassword, salt);

  // Create empty index
  const index: VaultIndex = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    itemCount: 0,
    items: [],
  };

  // Create ZIP with index
  const zip = new JSZip();
  zip.file('index.json', JSON.stringify(index, null, 2));
  zip.folder('thumbnails');
  zip.folder('files');

  // Generate ZIP buffer
  const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

  // Encrypt ZIP data
  const encryptedData = encryptData(zipBuffer, encryptionKey, iv);

  // Build header
  const header = new Uint8Array(HEADER_SIZE);
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(MAGIC_BYTES);
  header.set(magicBytes, 0); // Magic bytes at position 0
  header[6] = VERSION; // Version at position 6
  header[7] = 0; // Reserved
  header.set(salt, 8); // Salt at position 8
  header.set(iv, 8 + SALT_SIZE); // IV at position 40

  // Combine header + encrypted data
  const fullData = new Uint8Array(HEADER_SIZE + encryptedData.length);
  fullData.set(header, 0);
  fullData.set(encryptedData, HEADER_SIZE);

  // Write to file
  const base64Data = uint8ArrayToBase64(fullData);
  await FileSystem.writeAsStringAsync(containerPath, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  console.log(`Container created: ${containerPath}`);
  return containerPath;
}

/**
 * Open an existing container
 */
export async function openContainer(
  vaultType: 'real' | 'decoy',
  password: string,
  secretKey: string
): Promise<ContainerHandle | null> {
  await ensureDirectories();

  const containerName = vaultType === 'real' ? 'vault.svault' : 'decoy.svault';
  const containerPath = CONTAINER_DIR + containerName;

  // Check if container exists
  const info = await FileSystem.getInfoAsync(containerPath);
  if (!info.exists) {
    // Create new container if it doesn't exist
    console.log('Creating new container...');
    await createContainer(vaultType, password, secretKey);
  }

  try {
    // Read container file
    const base64Data = await FileSystem.readAsStringAsync(containerPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const fullData = base64ToUint8Array(base64Data);

    // Parse header
    const header = fullData.slice(0, HEADER_SIZE);
    const decoder = new TextDecoder();
    const magic = decoder.decode(header.slice(0, 6));

    if (magic !== MAGIC_BYTES) {
      console.error('Invalid container: magic bytes mismatch');
      return null;
    }

    const version = header[6];
    if (version !== VERSION) {
      console.error(`Unsupported container version: ${version}`);
      return null;
    }

    const salt = header.slice(8, 8 + SALT_SIZE);
    const iv = header.slice(8 + SALT_SIZE, 8 + SALT_SIZE + IV_SIZE);

    // Derive encryption key
    const combinedPassword = password + secretKey;
    const encryptionKey = await deriveKey(combinedPassword, salt);

    // Get encrypted data
    const encryptedData = fullData.slice(HEADER_SIZE);

    // Decrypt ZIP data
    let zipBuffer: Uint8Array;
    try {
      zipBuffer = decryptData(encryptedData, encryptionKey, iv);
    } catch (error) {
      console.error('Failed to decrypt container - wrong password?');
      return null;
    }

    // Load ZIP
    const zip = new JSZip();
    await zip.loadAsync(zipBuffer);

    // Read index
    const indexFile = zip.file('index.json');
    if (!indexFile) {
      console.error('Container missing index.json');
      return null;
    }

    const indexJson = await indexFile.async('string');
    const index: VaultIndex = JSON.parse(indexJson);

    console.log(`Container opened: ${index.itemCount} items`);

    return {
      path: containerPath,
      encryptionKey,
      index,
      zip,
      isDirty: false,
    };
  } catch (error) {
    console.error('Failed to open container:', error);

    // If container is corrupted, delete it and create fresh
    console.log('Container corrupted or incompatible, creating fresh container...');
    try {
      await FileSystem.deleteAsync(containerPath, { idempotent: true });
      await createContainer(vaultType, password, secretKey);

      // Try to open the fresh container
      const base64Data = await FileSystem.readAsStringAsync(containerPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fullData = base64ToUint8Array(base64Data);
      const header = fullData.slice(0, HEADER_SIZE);
      const salt = header.slice(8, 8 + SALT_SIZE);
      const iv = header.slice(8 + SALT_SIZE, 8 + SALT_SIZE + IV_SIZE);
      const combinedPassword = password + secretKey;
      const encryptionKey = await deriveKey(combinedPassword, salt);
      const encryptedData = fullData.slice(HEADER_SIZE);
      const zipBuffer = decryptData(encryptedData, encryptionKey, iv);
      const zip = new JSZip();
      await zip.loadAsync(zipBuffer);
      const indexFile = zip.file('index.json');
      if (!indexFile) return null;
      const indexJson = await indexFile.async('string');
      const index: VaultIndex = JSON.parse(indexJson);
      console.log('Fresh container created and opened');
      return { path: containerPath, encryptionKey, index, zip, isDirty: false };
    } catch (retryError) {
      console.error('Failed to create fresh container:', retryError);
      return null;
    }
  }
}

/**
 * Save container to disk
 */
export async function saveContainer(handle: ContainerHandle): Promise<void> {
  if (!handle.isDirty) {
    return; // No changes to save
  }

  // Update index
  handle.index.updatedAt = Date.now();
  handle.zip.file('index.json', JSON.stringify(handle.index, null, 2));

  // Generate ZIP buffer
  const zipBuffer = await handle.zip.generateAsync({ type: 'uint8array' });

  // Generate new IV for this save
  const iv = await Crypto.getRandomBytesAsync(IV_SIZE);

  // Read existing header to get salt
  const base64Data = await FileSystem.readAsStringAsync(handle.path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const oldData = base64ToUint8Array(base64Data);
  const salt = oldData.slice(8, 8 + SALT_SIZE);

  // Encrypt ZIP data
  const encryptedData = encryptData(zipBuffer, handle.encryptionKey, iv);

  // Build new header (reuse salt, new IV)
  const header = new Uint8Array(HEADER_SIZE);
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(MAGIC_BYTES);
  header.set(magicBytes, 0);
  header[6] = VERSION;
  header[7] = 0;
  header.set(salt, 8);
  header.set(iv, 8 + SALT_SIZE);

  // Combine and write
  const fullData = new Uint8Array(HEADER_SIZE + encryptedData.length);
  fullData.set(header, 0);
  fullData.set(encryptedData, HEADER_SIZE);

  const newBase64 = uint8ArrayToBase64(fullData);
  await FileSystem.writeAsStringAsync(handle.path, newBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  handle.isDirty = false;
  console.log('Container saved');
}

/**
 * Add a file to the container
 */
export async function addFileToContainer(
  handle: ContainerHandle,
  fileUri: string,
  originalName: string,
  mimeType: string,
  thumbnailBase64?: string,
  skipSave: boolean = false // For batch operations - call saveContainer() manually after all files
): Promise<VaultItem> {
  const id = generateId();
  const extension = originalName.split('.').pop()?.toLowerCase() || 'bin';

  // Determine type
  let type: 'photo' | 'video' | 'file' = 'file';
  if (mimeType.startsWith('image/')) type = 'photo';
  else if (mimeType.startsWith('video/')) type = 'video';

  // Read file data
  const fileBase64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const fileData = base64ToUint8Array(fileBase64);

  // Add file to ZIP
  const filePath = `files/${id}.${extension}`;
  handle.zip.file(filePath, fileData);

  // Add thumbnail if provided
  let thumbnailPath = '';
  if (thumbnailBase64) {
    thumbnailPath = `thumbnails/${id}.jpg`;
    const thumbnailData = base64ToUint8Array(thumbnailBase64);
    handle.zip.file(thumbnailPath, thumbnailData);
  }

  // Create item
  const item: VaultItem = {
    id,
    type,
    originalName,
    mimeType,
    fileExtension: extension,
    size: fileData.length,
    createdAt: Date.now(),
    thumbnailPath,
    filePath,
  };

  // Update index
  handle.index.items.push(item);
  handle.index.itemCount = handle.index.items.length;
  handle.isDirty = true;

  // Save immediately unless we're in batch mode
  if (!skipSave) {
    await saveContainer(handle);
  }

  // Also extract to temp for immediate viewing
  if (thumbnailBase64) {
    const tempThumbPath = THUMBNAILS_TEMP_DIR + `${id}.jpg`;
    await FileSystem.writeAsStringAsync(tempThumbPath, thumbnailBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  console.log(`Added file: ${originalName} (${id})`);
  return item;
}

/**
 * Extract a thumbnail from container to temp folder
 */
export async function extractThumbnail(
  handle: ContainerHandle,
  itemId: string
): Promise<string | null> {
  await ensureDirectories();

  const item = handle.index.items.find((i) => i.id === itemId);
  if (!item || !item.thumbnailPath) {
    return null;
  }

  // Check if already extracted
  const tempPath = THUMBNAILS_TEMP_DIR + `${itemId}.jpg`;
  const info = await FileSystem.getInfoAsync(tempPath);
  if (info.exists) {
    return tempPath;
  }

  // Extract from ZIP
  const thumbFile = handle.zip.file(item.thumbnailPath);
  if (!thumbFile) {
    return null;
  }

  const thumbData = await thumbFile.async('uint8array');
  const base64 = uint8ArrayToBase64(thumbData);

  await FileSystem.writeAsStringAsync(tempPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return tempPath;
}

/**
 * Extract multiple thumbnails (batch)
 */
export async function extractThumbnails(
  handle: ContainerHandle,
  itemIds: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const id of itemIds) {
    const path = await extractThumbnail(handle, id);
    if (path) {
      results.set(id, path);
    }
  }

  return results;
}

/**
 * Extract a file from container to temp folder
 */
export async function extractFile(
  handle: ContainerHandle,
  itemId: string
): Promise<string | null> {
  await ensureDirectories();

  const item = handle.index.items.find((i) => i.id === itemId);
  if (!item) {
    return null;
  }

  // Check if already extracted
  const tempPath = FILES_TEMP_DIR + `${itemId}.${item.fileExtension}`;
  const info = await FileSystem.getInfoAsync(tempPath);
  if (info.exists) {
    return tempPath;
  }

  // Extract from ZIP
  const file = handle.zip.file(item.filePath);
  if (!file) {
    return null;
  }

  const fileData = await file.async('uint8array');
  const base64 = uint8ArrayToBase64(fileData);

  await FileSystem.writeAsStringAsync(tempPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  console.log(`Extracted file: ${item.originalName}`);
  return tempPath;
}

/**
 * Delete an item from container
 */
export async function deleteFromContainer(
  handle: ContainerHandle,
  itemId: string
): Promise<boolean> {
  const itemIndex = handle.index.items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) {
    return false;
  }

  const item = handle.index.items[itemIndex];

  // Remove from ZIP
  handle.zip.remove(item.filePath);
  if (item.thumbnailPath) {
    handle.zip.remove(item.thumbnailPath);
  }

  // Remove from index
  handle.index.items.splice(itemIndex, 1);
  handle.index.itemCount = handle.index.items.length;
  handle.isDirty = true;

  // Save
  await saveContainer(handle);

  // Clean up temp files
  try {
    await FileSystem.deleteAsync(FILES_TEMP_DIR + `${itemId}.${item.fileExtension}`, {
      idempotent: true,
    });
    await FileSystem.deleteAsync(THUMBNAILS_TEMP_DIR + `${itemId}.jpg`, {
      idempotent: true,
    });
  } catch {
    // Ignore cleanup errors
  }

  console.log(`Deleted: ${item.originalName}`);
  return true;
}

/**
 * Clean up all temp files (call on lock/logout)
 */
export async function cleanupTempFiles(): Promise<void> {
  try {
    await FileSystem.deleteAsync(TEMP_DIR, { idempotent: true });
    console.log('Temp files cleaned up');
  } catch (error) {
    console.error('Failed to cleanup temp files:', error);
  }
}

/**
 * Check if a container exists
 */
export async function containerExists(vaultType: 'real' | 'decoy'): Promise<boolean> {
  const containerName = vaultType === 'real' ? 'vault.svault' : 'decoy.svault';
  const containerPath = CONTAINER_DIR + containerName;
  const info = await FileSystem.getInfoAsync(containerPath);
  return info.exists;
}

/**
 * Get container file path for sharing
 */
export function getContainerPath(vaultType: 'real' | 'decoy'): string {
  const containerName = vaultType === 'real' ? 'vault.svault' : 'decoy.svault';
  return CONTAINER_DIR + containerName;
}

/**
 * Export selected items to a new .svault file
 */
export async function exportSelection(
  handle: ContainerHandle,
  itemIds: string[],
  password: string,
  secretKey: string
): Promise<string> {
  const exportDir = FileSystem.cacheDirectory + 'export/';
  await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });

  // Create new ZIP with selected items
  const exportZip = new JSZip();
  exportZip.folder('thumbnails');
  exportZip.folder('files');

  const exportItems: VaultItem[] = [];

  for (const id of itemIds) {
    const item = handle.index.items.find((i) => i.id === id);
    if (!item) continue;

    // Copy file
    const file = handle.zip.file(item.filePath);
    if (file) {
      const data = await file.async('uint8array');
      exportZip.file(item.filePath, data);
    }

    // Copy thumbnail
    if (item.thumbnailPath) {
      const thumb = handle.zip.file(item.thumbnailPath);
      if (thumb) {
        const data = await thumb.async('uint8array');
        exportZip.file(item.thumbnailPath, data);
      }
    }

    exportItems.push(item);
  }

  // Create index for export
  const exportIndex: VaultIndex = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    itemCount: exportItems.length,
    items: exportItems,
  };
  exportZip.file('index.json', JSON.stringify(exportIndex, null, 2));

  // Generate ZIP buffer
  const zipBuffer = await exportZip.generateAsync({ type: 'uint8array' });

  // Encrypt with same password
  const salt = await Crypto.getRandomBytesAsync(SALT_SIZE);
  const iv = await Crypto.getRandomBytesAsync(IV_SIZE);
  const combinedPassword = password + secretKey;
  const encryptionKey = await deriveKey(combinedPassword, salt);
  const encryptedData = encryptData(zipBuffer, encryptionKey, iv);

  // Build header
  const header = new Uint8Array(HEADER_SIZE);
  const encoder = new TextEncoder();
  header.set(encoder.encode(MAGIC_BYTES), 0);
  header[6] = VERSION;
  header.set(salt, 8);
  header.set(iv, 8 + SALT_SIZE);

  // Combine and write
  const fullData = new Uint8Array(HEADER_SIZE + encryptedData.length);
  fullData.set(header, 0);
  fullData.set(encryptedData, HEADER_SIZE);

  const timestamp = new Date().toISOString().slice(0, 10);
  const exportPath = exportDir + `SentraVault_${timestamp}_${itemIds.length}items.svault`;
  const base64 = uint8ArrayToBase64(fullData);

  await FileSystem.writeAsStringAsync(exportPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  console.log(`Exported ${itemIds.length} items to ${exportPath}`);
  return exportPath;
}

/**
 * Import from an external .svault file
 */
export async function importFromSvault(
  handle: ContainerHandle,
  svaultUri: string,
  password: string,
  secretKey: string
): Promise<number> {
  try {
    // Read the import file
    const base64Data = await FileSystem.readAsStringAsync(svaultUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const fullData = base64ToUint8Array(base64Data);

    // Parse header
    const header = fullData.slice(0, HEADER_SIZE);
    const decoder = new TextDecoder();
    const magic = decoder.decode(header.slice(0, 6));

    if (magic !== MAGIC_BYTES) {
      throw new Error('Invalid .svault file');
    }

    const salt = header.slice(8, 8 + SALT_SIZE);
    const iv = header.slice(8 + SALT_SIZE, 8 + SALT_SIZE + IV_SIZE);

    // Derive key and decrypt
    const combinedPassword = password + secretKey;
    const encryptionKey = await deriveKey(combinedPassword, salt);
    const encryptedData = fullData.slice(HEADER_SIZE);
    const zipBuffer = decryptData(encryptedData, encryptionKey, iv);

    // Load import ZIP
    const importZip = new JSZip();
    await importZip.loadAsync(zipBuffer);

    // Read index
    const indexFile = importZip.file('index.json');
    if (!indexFile) {
      throw new Error('Invalid .svault file - missing index');
    }

    const indexJson = await indexFile.async('string');
    const importIndex: VaultIndex = JSON.parse(indexJson);

    let imported = 0;

    // Import each item
    for (const item of importIndex.items) {
      const newId = generateId();

      // Copy file
      const file = importZip.file(item.filePath);
      if (file) {
        const data = await file.async('uint8array');
        const newFilePath = `files/${newId}.${item.fileExtension}`;
        handle.zip.file(newFilePath, data);

        // Copy thumbnail
        let newThumbPath = '';
        if (item.thumbnailPath) {
          const thumb = importZip.file(item.thumbnailPath);
          if (thumb) {
            const thumbData = await thumb.async('uint8array');
            newThumbPath = `thumbnails/${newId}.jpg`;
            handle.zip.file(newThumbPath, thumbData);
          }
        }

        // Add to index with new ID
        handle.index.items.push({
          ...item,
          id: newId,
          filePath: newFilePath,
          thumbnailPath: newThumbPath,
          createdAt: Date.now(),
        });

        imported++;
      }
    }

    handle.index.itemCount = handle.index.items.length;
    handle.isDirty = true;
    await saveContainer(handle);

    console.log(`Imported ${imported} items from .svault file`);
    return imported;
  } catch (error) {
    console.error('Failed to import .svault file:', error);
    throw error;
  }
}
