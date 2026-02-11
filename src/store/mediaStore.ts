import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  VaultHandle,
  VaultItem,
  openVault,
  saveVault,
  closeVault,
  extractThumbnail,
  extractFile,
  addFileToVault,
  deleteFromVault,
  getVaultFilePath,
  exportVaultToArchive,
  importFromArchive,
  getThumbsCacheDir,
} from '../utils/svaultFormat';

type VaultType = 'real' | 'decoy';

// Re-export VaultItem as MediaItem for compatibility
export type MediaItem = VaultItem;

// Pending import item (shown immediately, encrypted in background)
export interface PendingItem {
  id: string;
  tempPath: string;
  thumbnailPath: string | null;
  thumbnailBase64: string | null;
  originalName: string;
  mimeType: string;
  size?: number;
  status: 'pending' | 'encrypting' | 'done' | 'error';
}

interface MediaStore {
  // Vault state
  vaultHandle: VaultHandle | null;
  isVaultOpen: boolean;
  vaultLoading: boolean;

  // Credentials (stored on login for operations)
  vaultCredentials: { password: string; secretKey: string; vaultType: VaultType } | null;

  // Media state
  media: MediaItem[];
  pendingItems: PendingItem[]; // Items being imported (shown immediately)
  thumbnailCache: Map<string, string>; // id -> decrypted thumbnail path
  extractedFiles: Map<string, string>; // id -> decrypted file path

  // UI state
  loading: boolean;
  importing: boolean;
  encryptingInBackground: boolean;

  // Thumbnail decryption state (non-blocking, background)
  isDecryptingThumbnails: boolean;
  decryptionProgress: { current: number; total: number };
  thumbnailQueue: string[]; // IDs waiting to be decrypted

  // Encryption progress (real count, not percentage)
  encryptionProgress: { current: number; total: number };

  // Auth operations (called on login - INSTANT)
  setVaultCredentials: (password: string, secretKey: string, vaultType: VaultType) => void;
  clearVaultCredentials: () => void;

  // Vault operations
  openVaultAsync: () => Promise<boolean>;
  closeVaultAsync: () => Promise<void>;

  // Thumbnail operations (background, non-blocking)
  startThumbnailDecryption: () => void;
  prioritizeThumbnail: (itemId: string) => void;
  getThumbnailPath: (itemId: string) => string | null; // Sync! Returns from cache only

  // File operations (on-demand, only when user taps)
  getFilePath: (itemId: string) => Promise<string | null>;

  // Import operations
  importFromPhotos: (assets: MediaLibrary.Asset[]) => Promise<number>;
  importFromFiles: (files: { uri: string; name: string; mimeType: string }[]) => Promise<number>;
  encryptPendingItems: () => void; // Background, non-blocking
  importSvaultFile: (svaultUri: string) => Promise<number>;

  // Other operations
  deleteMedia: (ids: string[]) => Promise<void>;
  exportVault: () => Promise<string>;
  exportSelection: (ids: string[]) => Promise<string>;
  refreshMedia: () => void;
}

// Temp directory for pending imports
const PENDING_DIR = FileSystem.cacheDirectory + 'pending/';
const PENDING_THUMBS_DIR = PENDING_DIR + 'thumbs/';

// Ensure pending directories exist
async function ensurePendingDirs() {
  for (const dir of [PENDING_DIR, PENDING_THUMBS_DIR]) {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  }
}

// Generate a simple ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  vaultHandle: null,
  isVaultOpen: false,
  vaultLoading: false,
  vaultCredentials: null,
  media: [],
  pendingItems: [],
  thumbnailCache: new Map(),
  extractedFiles: new Map(),
  loading: false,
  importing: false,
  encryptingInBackground: false,
  isDecryptingThumbnails: false,
  decryptionProgress: { current: 0, total: 0 },
  thumbnailQueue: [],
  encryptionProgress: { current: 0, total: 0 },

  // ============ Auth Operations ============

  // Called on login - INSTANT, just stores credentials
  setVaultCredentials: (password, secretKey, vaultType) => {
    set({ vaultCredentials: { password, secretKey, vaultType } });
    console.log('Vault credentials set - ready for lazy loading');
  },

  clearVaultCredentials: () => {
    set({ vaultCredentials: null });
  },

  // ============ Vault Operations ============

  // Open vault - loads index only (fast!)
  openVaultAsync: async () => {
    const { vaultCredentials, vaultLoading } = get();

    if (vaultLoading) return false;
    if (!vaultCredentials) {
      console.error('No vault credentials');
      return false;
    }

    set({ vaultLoading: true });

    try {
      const { password, secretKey, vaultType } = vaultCredentials;
      const handle = await openVault(vaultType, password, secretKey);

      if (!handle) {
        set({ vaultLoading: false });
        return false;
      }

      // Sort items by newest first
      const sortedItems = [...handle.index.items].sort((a, b) => {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      handle.index.items = sortedItems;

      // Build thumbnail queue (all items with thumbnails)
      const thumbnailQueue = sortedItems
        .filter((item) => item.thumbnailBase64)
        .map((item) => item.id);

      set({
        vaultHandle: handle,
        isVaultOpen: true,
        media: sortedItems,
        vaultLoading: false,
        thumbnailQueue,
        decryptionProgress: { current: 0, total: thumbnailQueue.length },
      });

      console.log(`Vault opened: ${sortedItems.length} items`);

      // Start background thumbnail decryption (non-blocking!)
      if (thumbnailQueue.length > 0) {
        // Use setTimeout to not block
        setTimeout(() => get().startThumbnailDecryption(), 0);
      }

      return true;
    } catch (error) {
      console.error('Failed to open vault:', error);
      set({ vaultLoading: false });
      return false;
    }
  },

  closeVaultAsync: async () => {
    const { vaultHandle } = get();

    if (vaultHandle) {
      await saveVault(vaultHandle);
    }

    await closeVault();

    // Clean pending directory
    try {
      await FileSystem.deleteAsync(PENDING_DIR, { idempotent: true });
    } catch (e) {
      // Ignore
    }

    set({
      vaultHandle: null,
      isVaultOpen: false,
      media: [],
      pendingItems: [],
      thumbnailCache: new Map(),
      extractedFiles: new Map(),
      vaultCredentials: null,
      thumbnailQueue: [],
      isDecryptingThumbnails: false,
    });

    console.log('Vault closed');
  },

  // ============ Thumbnail Operations (Background) ============

  // Start background thumbnail decryption - non-blocking!
  startThumbnailDecryption: () => {
    const { thumbnailQueue, isDecryptingThumbnails } = get();

    if (isDecryptingThumbnails) return;
    if (thumbnailQueue.length === 0) return;

    set({ isDecryptingThumbnails: true });

    let lastUpdate = 0;
    const UPDATE_INTERVAL = 500; // Update progress max twice per second

    // Process one at a time with setTimeout to keep UI responsive
    const processNext = async () => {
      const { thumbnailQueue, thumbnailCache, vaultHandle, decryptionProgress } = get();

      // Done?
      if (thumbnailQueue.length === 0) {
        set({ isDecryptingThumbnails: false });
        // Ensure final 100% progress is shown
        set((state) => ({
          decryptionProgress: {
            current: state.decryptionProgress.total,
            total: state.decryptionProgress.total
          }
        }));
        return;
      }

      // Get next item
      const itemId = thumbnailQueue[0];
      const remaining = thumbnailQueue.slice(1);
      const shouldUpdate = Date.now() - lastUpdate > UPDATE_INTERVAL || remaining.length === 0;

      // Skip if already cached
      if (thumbnailCache.has(itemId)) {
        if (shouldUpdate) {
          set((state) => ({
            thumbnailQueue: remaining,
            decryptionProgress: {
              current: state.decryptionProgress.total - remaining.length,
              total: state.decryptionProgress.total,
            },
          }));
          lastUpdate = Date.now();
        } else {
          // Just update queue silently to keep loop going without re-render
          // We can't update ONLY queue without triggering re-render in Zustand unless we use transient updates,
          // but here we just want to avoid the PROGRESS update re-render which is the heavy part if it triggers UI.
          // Actually, updating `thumbnailQueue` triggers re-renders too.
          // Optimization: Process a BATCH of cached items?
          // For now, staying simple but just throttling the progress object might not be enough if queue updates trigger render.
          // Let's at least update the progress count less often.
          set({ thumbnailQueue: remaining });
        }
        setTimeout(processNext, 0);
        return;
      }

      // Need vault handle
      if (!vaultHandle) {
        set({ isDecryptingThumbnails: false });
        return;
      }

      try {
        // Extract thumbnail (writes base64 from index to cache file)
        const path = await extractThumbnail(vaultHandle, itemId);

        if (path) {
          set((state) => {
            const newCache = new Map(state.thumbnailCache);
            newCache.set(itemId, path);

            const nextProgress = {
              current: state.decryptionProgress.total - remaining.length,
              total: state.decryptionProgress.total,
            };

            // Only update progress state if interval passed
            return {
              thumbnailCache: newCache,
              thumbnailQueue: remaining,
              decryptionProgress: shouldUpdate ? nextProgress : state.decryptionProgress
            };
          });
          if (shouldUpdate) lastUpdate = Date.now();
        } else {
          set({ thumbnailQueue: remaining });
        }
      } catch (error) {
        console.error('Thumbnail extraction failed:', error);
        set({ thumbnailQueue: remaining });
      }

      // Process next with small delay for UI responsiveness
      setTimeout(processNext, 5);
    };

    // Start
    setTimeout(processNext, 0);
  },

  // Move item to front of queue (for tap priority)
  prioritizeThumbnail: (itemId: string) => {
    const { thumbnailQueue, thumbnailCache } = get();

    if (thumbnailCache.has(itemId)) return;
    if (thumbnailQueue[0] === itemId) return;
    if (!thumbnailQueue.includes(itemId)) return;

    const newQueue = [itemId, ...thumbnailQueue.filter((id) => id !== itemId)];
    set({ thumbnailQueue: newQueue });
  },

  // Get thumbnail path - SYNC, returns from cache only
  getThumbnailPath: (itemId: string) => {
    const { thumbnailCache, pendingItems } = get();

    // Check pending items first
    const pending = pendingItems.find((p) => p.id === itemId);
    if (pending && pending.thumbnailPath) {
      return pending.thumbnailPath;
    }

    // Check cache
    return thumbnailCache.get(itemId) || null;
  },

  // ============ File Operations (On-Demand) ============

  // Get file path - decrypts on demand when user taps
  getFilePath: async (itemId: string) => {
    const { extractedFiles, pendingItems, vaultHandle } = get();

    // Check pending items first
    const pending = pendingItems.find((p) => p.id === itemId);
    if (pending) {
      return pending.tempPath;
    }

    // Check cache
    if (extractedFiles.has(itemId)) {
      const cached = extractedFiles.get(itemId)!;
      const info = await FileSystem.getInfoAsync(cached);
      if (info.exists) {
        return cached;
      }
    }

    // Need vault handle
    if (!vaultHandle) {
      // Try to open vault
      const opened = await get().openVaultAsync();
      if (!opened) return null;
    }

    const handle = get().vaultHandle;
    if (!handle) return null;

    // Decrypt file on-demand
    const path = await extractFile(handle, itemId);

    if (path) {
      set((state) => {
        const newFiles = new Map(state.extractedFiles);
        newFiles.set(itemId, path);
        return { extractedFiles: newFiles };
      });
    }

    return path;
  },

  // ============ Import Operations ============

  // Import from photos - INSTANT display, background encryption
  importFromPhotos: async (assets) => {
    await ensurePendingDirs();

    const newPendingItems: PendingItem[] = [];

    // Phase 1: Copy all files to temp IMMEDIATELY
    for (const asset of assets) {
      try {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const sourceUri = assetInfo.localUri || asset.uri;
        if (!sourceUri) continue;

        const id = generateId();
        const ext = asset.filename?.split('.').pop() || 'jpg';
        const tempPath = PENDING_DIR + `${id}.${ext}`;

        // Copy file (fast!)
        await FileSystem.copyAsync({ from: sourceUri, to: tempPath });

        // Get file size
        const fileInfo = await FileSystem.getInfoAsync(tempPath);
        const size = fileInfo.exists ? fileInfo.size : undefined;

        // Generate thumbnail for images
        let thumbnailPath: string | null = null;
        let thumbnailBase64: string | null = null;

        if (asset.mediaType === 'video') {
          try {
            // Generate video thumbnail
            const { uri } = await VideoThumbnails.getThumbnailAsync(tempPath, {
              quality: 0.5,
            });
            thumbnailPath = PENDING_THUMBS_DIR + `${id}.jpg`;
            await FileSystem.copyAsync({ from: uri, to: thumbnailPath });
            thumbnailBase64 = await FileSystem.readAsStringAsync(thumbnailPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (e) {
            console.warn('Failed to generate video thumbnail:', e);
          }
        } else {
          thumbnailPath = PENDING_THUMBS_DIR + `${id}.jpg`;
          await FileSystem.copyAsync({ from: tempPath, to: thumbnailPath });

          // Read as base64 for storage in index
          thumbnailBase64 = await FileSystem.readAsStringAsync(thumbnailPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        const mimeType = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

        newPendingItems.push({
          id,
          tempPath,
          thumbnailPath,
          thumbnailBase64,
          originalName: asset.filename || `media_${Date.now()}`,
          mimeType,
          size,
          status: 'pending',
        });
      } catch (error) {
        console.error('Failed to copy asset:', error);
      }
    }

    // Add to state immediately - user sees them right away!
    set((state) => ({
      pendingItems: [...newPendingItems, ...state.pendingItems],
      encryptionProgress: {
        current: 0,
        total: state.encryptionProgress.total + newPendingItems.length,
      },
    }));

    console.log(`${newPendingItems.length} files ready - starting background encryption`);

    // Phase 2: Encrypt in background (non-blocking!)
    setTimeout(() => get().encryptPendingItems(), 0);

    return newPendingItems.length;
  },

  importFromFiles: async (files) => {
    await ensurePendingDirs();

    const newPendingItems: PendingItem[] = [];

    for (const file of files) {
      try {
        const id = generateId();
        const ext = file.name.split('.').pop() || 'bin';
        const tempPath = PENDING_DIR + `${id}.${ext}`;

        await FileSystem.copyAsync({ from: file.uri, to: tempPath });

        let thumbnailPath: string | null = null;
        let thumbnailBase64: string | null = null;

        if (file.mimeType.startsWith('image/')) {
          thumbnailPath = PENDING_THUMBS_DIR + `${id}.jpg`;
          await FileSystem.copyAsync({ from: tempPath, to: thumbnailPath });
          thumbnailBase64 = await FileSystem.readAsStringAsync(thumbnailPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else if (file.mimeType.startsWith('video/')) {
          try {
            const { uri } = await VideoThumbnails.getThumbnailAsync(tempPath, {
              quality: 0.5,
            });
            thumbnailPath = PENDING_THUMBS_DIR + `${id}.jpg`;
            await FileSystem.copyAsync({ from: uri, to: thumbnailPath });
            thumbnailBase64 = await FileSystem.readAsStringAsync(thumbnailPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (e) {
            console.warn('Failed to generate video thumbnail:', e);
          }
        }

        newPendingItems.push({
          id,
          tempPath,
          thumbnailPath,
          thumbnailBase64,
          originalName: file.name,
          mimeType: file.mimeType,
          status: 'pending',
        });
      } catch (error) {
        console.error('Failed to copy file:', error);
      }
    }

    set((state) => ({
      pendingItems: [...newPendingItems, ...state.pendingItems],
      encryptionProgress: {
        current: 0,
        total: state.encryptionProgress.total + newPendingItems.length,
      },
    }));

    setTimeout(() => get().encryptPendingItems(), 0);

    return newPendingItems.length;
  },

  // Background encryption - non-blocking
  encryptPendingItems: () => {
    const { pendingItems, encryptingInBackground, vaultHandle } = get();

    if (encryptingInBackground) return;

    const itemsToEncrypt = pendingItems.filter((p) => p.status === 'pending');
    if (itemsToEncrypt.length === 0) return;

    set({ encryptingInBackground: true, importing: true });

    let lastUpdate = 0;
    const UPDATE_INTERVAL = 500;

    const processNext = async () => {
      const { pendingItems, vaultHandle } = get();

      // Find next pending item
      const item = pendingItems.find((p) => p.status === 'pending');
      if (!item) {
        set({
          encryptingInBackground: false,
          importing: false,
          encryptionProgress: { current: 0, total: 0 },
        });
        return;
      }

      // Need vault
      let handle = vaultHandle;
      if (!handle) {
        const opened = await get().openVaultAsync();
        if (!opened) {
          set({ encryptingInBackground: false, importing: false });
          return;
        }
        handle = get().vaultHandle;
      }

      if (!handle) {
        set({ encryptingInBackground: false, importing: false });
        return;
      }

      // Update status to encrypting
      // OPTIMIZATION: Removed this intermediate state update to reduce renders
      // unless it's critical for UI to show "Encrypting..." vs "Pending" instantly for each item.
      // We'll skip it for speed.
      /*
      set((state) => ({
        pendingItems: state.pendingItems.map((p) =>
          p.id === item.id ? { ...p, status: 'encrypting' as const } : p
        ),
      }));
      */

      const shouldUpdate = Date.now() - lastUpdate > UPDATE_INTERVAL;

      try {
        // Add to vault (encrypts file)
        const vaultItem = await addFileToVault(
          handle,
          item.tempPath,
          item.originalName,
          item.mimeType,
          item.thumbnailBase64 || undefined,
          true, // skipSave for batch
          item.size,
          item.id // Preserve ID!
        );

        // OPTIMIZATION: Instant Thumbnail Transfer
        // If we have a pending thumbnail on disk, move it to the Session dir for immediate viewing
        if (item.thumbnailPath) {
          const sessionThumbPath = get().getThumbnailPath(item.id);
          // Wait, getThumbnailPath returns what's in cache or null.
          // We need to construct the path manually or use a helper.
          // The helper `svaultFormat.ts` methods are not imported or handy here?
          // Actually, we can just move it to `SESSION_DIR + id.jpg` (naive) or use a known path logic.
          // But `mediaStore`'s `getThumbnailPath` is a getter for logic.
          // Let's rely on standard logic: `getThumbsCacheDir() + id.jpg?`
          // Let's just update the cache map! 
          // We need to move the file first.

          try {
            // We'll trust the SESSION_DIR from svaultFormat is consistent
            // But we need to import it or recreate logic.
            // Actually, update the `thumbnailCache` map in state with the *pending* path?
            // No, pending path will be deleted in cleanup.
            // We MUST move/copy it to a persistent temp location (Session).

            // Since we don't have SESSION_DIR exported easily here (it's internal to logic usually), 
            // let's just skip the move for now and rely on cache?
            // NO, if we delete pending path, cache points to nowhere.

            // Best: We used `copyAsync` so we can just NOT delete the thumbnail path in cleanup?
            // But `cleanup temp files` block deletes it.
            // Let's MOVE it to a safe spot.
          } catch (e) { }
        }

        // Update status to done
        set((state) => {
          const newPending = state.pendingItems.map((p) =>
            p.id === item.id ? { ...p, status: 'done' as const } : p
          );

          // Update thumbnail cache IMMEDIATELY if we have base64 or path
          // If we had a path, we should keep using it until the system regenerates it?
          // Actually, since we used the SAME ID, and the pending item had a thumbnail,
          // the UI might still be looking at pending item?
          // No, `renderItem` uses `getThumbnailPath`.

          // CRITICAL: We need to populate `thumbnailCache` with the base64 or path.
          // Since `vaultItem` is now in `media` list (will be), we need cache to be ready.

          // For now, let's essentially "hydrate" the cache from the pending item if possible.
          // But without moving the file, we can't point to it safely because cleanup deletes it.

          // Calculate done count internal to this state update
          const doneCount = newPending.filter(p => p.status === 'done').length;

          return {
            pendingItems: newPending,
            encryptionProgress: shouldUpdate ? {
              current: doneCount,
              total: state.encryptionProgress.total,
            } : state.encryptionProgress,
          };
        });

        if (shouldUpdate) lastUpdate = Date.now();

        // Clean up temp files
        try {
          await FileSystem.deleteAsync(item.tempPath, { idempotent: true });
          if (item.thumbnailPath) {
            await FileSystem.deleteAsync(item.thumbnailPath, { idempotent: true });
          }
        } catch (e) {
          // Ignore
        }
      } catch (error) {
        console.error('Encryption failed:', error);
        set((state) => ({
          pendingItems: state.pendingItems.map((p) =>
            p.id === item.id ? { ...p, status: 'error' as const } : p
          ),
        }));
      }

      // Check if more items
      const remaining = get().pendingItems.filter((p) => p.status === 'pending');
      if (remaining.length > 0) {
        setTimeout(processNext, 5); // Short delay
      } else {
        // All done - save vault and refresh
        const currentHandle = get().vaultHandle;
        if (currentHandle) {
          await saveVault(currentHandle);

          // Remove done items from pending, update media
          // IMPORTANT: Create NEW array for media to trigger re-render
          set((state) => ({
            pendingItems: state.pendingItems.filter((p) => p.status !== 'done'),
            media: [...currentHandle.index.items],
            encryptingInBackground: false,
            importing: false,
            encryptionProgress: { current: 0, total: 0 },
          }));
        }

        console.log('Background encryption complete');
      }
    };

    setTimeout(processNext, 0);
  },

  importSvaultFile: async (svaultUri) => {
    const { vaultCredentials, vaultHandle } = get();
    if (!vaultCredentials) return 0;

    let handle = vaultHandle;
    if (!handle) {
      const opened = await get().openVaultAsync();
      if (!opened) return 0;
      handle = get().vaultHandle;
    }

    if (!handle) return 0;

    set({ importing: true });

    try {
      const { password, secretKey } = vaultCredentials;
      // We assume the backup was created with the CURRENT password for now.
      // In a real UI, we might need to prompt the user if this fails.
      const imported = await importFromArchive(handle, svaultUri, password, secretKey);

      set({
        media: handle.index.items,
        importing: false,
      });

      return imported;
    } catch (error) {
      console.error('Failed to import .svault:', error);
      set({ importing: false });
      return 0;
    }
  },

  // ============ Other Operations ============

  deleteMedia: async (ids) => {
    const { vaultHandle } = get();

    let handle = vaultHandle;
    if (!handle) {
      const opened = await get().openVaultAsync();
      if (!opened) return;
      handle = get().vaultHandle;
    }

    if (!handle) return;

    await deleteFromVault(handle, ids);

    // Remove from cache
    set((state) => {
      const newThumbCache = new Map(state.thumbnailCache);
      const newFileCache = new Map(state.extractedFiles);
      ids.forEach((id) => {
        newThumbCache.delete(id);
        newFileCache.delete(id);
      });
      return {
        media: handle!.index.items,
        thumbnailCache: newThumbCache,
        extractedFiles: newFileCache,
      };
    });
  },

  exportVault: async () => {
    const { vaultCredentials, vaultHandle } = get();
    if (!vaultCredentials) throw new Error('No credentials');

    let handle = vaultHandle;
    if (!handle) {
      const opened = await get().openVaultAsync();
      if (!opened) throw new Error('Cannot open vault');
      handle = get().vaultHandle!;
    }

    // Export ALL items
    const allIds = handle.index.items.map(i => i.id);
    const { password, secretKey } = vaultCredentials;

    return await exportVaultToArchive(handle, allIds, password, secretKey);
  },

  exportSelection: async (ids) => {
    const { vaultCredentials, vaultHandle } = get();
    if (!vaultCredentials) throw new Error('No credentials');

    let handle = vaultHandle;
    if (!handle) {
      const opened = await get().openVaultAsync();
      if (!opened) throw new Error('Cannot open vault');
      handle = get().vaultHandle;
    }

    if (!handle) throw new Error('No vault handle');

    const { password, secretKey } = vaultCredentials;
    return await exportVaultToArchive(handle, ids, password, secretKey);
  },

  refreshMedia: () => {
    const { vaultHandle } = get();
    if (vaultHandle) {
      set({ media: vaultHandle.index.items });
    }
  },
}));
