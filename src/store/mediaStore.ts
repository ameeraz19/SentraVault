import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import {
  ContainerHandle,
  VaultItem,
  openContainer,
  saveContainer,
  addFileToContainer,
  extractThumbnail,
  extractThumbnails,
  extractFile,
  deleteFromContainer,
  cleanupTempFiles,
  getContainerPath,
  exportSelection,
  importFromSvault,
  containerExists,
} from '../utils/containerFormat';
import { useAuthStore } from './authStore';

type VaultType = 'real' | 'decoy';

// Re-export VaultItem as MediaItem for compatibility
export type MediaItem = VaultItem;

interface MediaStore {
  // Container state
  containerHandle: ContainerHandle | null;
  isContainerOpen: boolean;

  // Media state
  media: MediaItem[];
  thumbnailCache: Map<string, string>; // id -> temp file path
  extractedFiles: Map<string, string>; // id -> temp file path

  // UI state
  loading: boolean;
  importing: boolean;
  importProgress: number;

  // Operations
  openVault: (password: string, secretKey: string, vaultType: VaultType) => Promise<boolean>;
  closeVault: () => Promise<void>;

  loadThumbnails: (startIndex: number, count: number) => Promise<void>;
  getThumbnailPath: (itemId: string) => Promise<string | null>;
  getFilePath: (itemId: string) => Promise<string | null>;

  importFromPhotos: (assets: MediaLibrary.Asset[]) => Promise<number>;
  importFromFiles: (files: { uri: string; name: string; mimeType: string }[]) => Promise<number>;
  importSvaultFile: (svaultUri: string, password: string, secretKey: string) => Promise<number>;

  deleteMedia: (ids: string[]) => Promise<void>;
  exportVault: () => Promise<string>;
  exportSelection: (ids: string[], password: string, secretKey: string) => Promise<string>;

  // Legacy compatibility
  refreshMedia: () => Promise<void>;
}

/**
 * Generate a thumbnail from an image or video
 * Note: For now, we use the original image for photos (thumbnails stored in container)
 * Video thumbnails require expo-video-thumbnails which may need separate handling
 */
async function generateThumbnail(
  uri: string,
  mimeType: string
): Promise<string | null> {
  try {
    if (mimeType.startsWith('image/')) {
      // For images, read the full file as base64 (will be used as thumbnail in container)
      // In a production app, you'd want to resize this first using expo-image-manipulator
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64;
    } else if (mimeType.startsWith('video/')) {
      // For videos, we can't easily generate thumbnails without additional libraries
      // Return null for now - videos will show a placeholder
      return null;
    }
    return null;
  } catch (error) {
    console.error('Failed to generate thumbnail:', error);
    return null;
  }
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  containerHandle: null,
  isContainerOpen: false,
  media: [],
  thumbnailCache: new Map(),
  extractedFiles: new Map(),
  loading: false,
  importing: false,
  importProgress: 0,

  openVault: async (password, secretKey, vaultType) => {
    set({ loading: true });
    try {
      const handle = await openContainer(vaultType, password, secretKey);
      if (!handle) {
        set({ loading: false });
        return false;
      }

      set({
        containerHandle: handle,
        isContainerOpen: true,
        media: handle.index.items,
        thumbnailCache: new Map(),
        extractedFiles: new Map(),
        loading: false,
      });

      // Pre-load first batch of thumbnails
      const firstBatch = handle.index.items.slice(0, 50).map((item) => item.id);
      if (firstBatch.length > 0) {
        get().loadThumbnails(0, 50);
      }

      return true;
    } catch (error) {
      console.error('Failed to open vault:', error);
      set({ loading: false });
      return false;
    }
  },

  closeVault: async () => {
    const { containerHandle } = get();

    if (containerHandle) {
      // Save any pending changes
      await saveContainer(containerHandle);
    }

    // Clean up all temp files
    await cleanupTempFiles();

    set({
      containerHandle: null,
      isContainerOpen: false,
      media: [],
      thumbnailCache: new Map(),
      extractedFiles: new Map(),
    });

    console.log('Vault closed and temp files cleaned');
  },

  loadThumbnails: async (startIndex, count) => {
    const { containerHandle, thumbnailCache } = get();
    if (!containerHandle) return;

    const items = containerHandle.index.items.slice(startIndex, startIndex + count);
    const idsToLoad = items
      .filter((item) => !thumbnailCache.has(item.id) && item.thumbnailPath)
      .map((item) => item.id);

    if (idsToLoad.length === 0) return;

    const results = await extractThumbnails(containerHandle, idsToLoad);

    set((state) => {
      const newCache = new Map(state.thumbnailCache);
      results.forEach((path, id) => {
        newCache.set(id, path);
      });
      return { thumbnailCache: newCache };
    });
  },

  getThumbnailPath: async (itemId) => {
    const { containerHandle, thumbnailCache } = get();

    // Check cache first
    if (thumbnailCache.has(itemId)) {
      return thumbnailCache.get(itemId) || null;
    }

    if (!containerHandle) return null;

    // Extract from container
    const path = await extractThumbnail(containerHandle, itemId);
    if (path) {
      set((state) => {
        const newCache = new Map(state.thumbnailCache);
        newCache.set(itemId, path);
        return { thumbnailCache: newCache };
      });
    }

    return path;
  },

  getFilePath: async (itemId) => {
    const { containerHandle, extractedFiles } = get();

    // Check cache first
    if (extractedFiles.has(itemId)) {
      const cached = extractedFiles.get(itemId)!;
      const info = await FileSystem.getInfoAsync(cached);
      if (info.exists) {
        return cached;
      }
    }

    if (!containerHandle) return null;

    // Extract from container
    const path = await extractFile(containerHandle, itemId);
    if (path) {
      set((state) => {
        const newFiles = new Map(state.extractedFiles);
        newFiles.set(itemId, path);
        return { extractedFiles: newFiles };
      });
    }

    return path;
  },

  importFromPhotos: async (assets) => {
    const { containerHandle } = get();
    if (!containerHandle) return 0;

    set({ importing: true, importProgress: 0 });
    let imported = 0;
    const total = assets.length;

    try {
      // Phase 1: Add all files to container (without saving each time)
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        // Progress: 0-80% for adding files
        set({ importProgress: Math.round((i / total) * 80) });

        try {
          // Get asset info
          const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
          const sourceUri = assetInfo.localUri || asset.uri;

          if (!sourceUri) continue;

          // Copy to cache for processing
          const tempPath = FileSystem.cacheDirectory + `import_${Date.now()}_${i}`;
          await FileSystem.copyAsync({ from: sourceUri, to: tempPath });

          // Determine mime type
          const mimeType = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';

          // Generate thumbnail
          const thumbnail = await generateThumbnail(tempPath, mimeType);

          // Add to container (skipSave=true for batch mode)
          await addFileToContainer(
            containerHandle,
            tempPath,
            asset.filename || `media_${Date.now()}`,
            mimeType,
            thumbnail || undefined,
            true // skipSave - we'll save once at the end
          );

          // Clean up temp file
          await FileSystem.deleteAsync(tempPath, { idempotent: true });

          imported++;
        } catch (itemError) {
          console.error('Failed to import asset:', itemError);
        }
      }

      // Phase 2: Save container once (80-100% progress)
      if (imported > 0) {
        set({ importProgress: 85 });
        await saveContainer(containerHandle);
        set({ importProgress: 100 });
      }

      // Refresh media list
      set({
        media: containerHandle.index.items,
        importing: false,
        importProgress: 100,
      });

      return imported;
    } catch (error) {
      console.error('Failed to import from photos:', error);
      set({ importing: false, importProgress: 0 });
      return 0;
    }
  },

  importFromFiles: async (files) => {
    const { containerHandle } = get();
    if (!containerHandle) return 0;

    set({ importing: true, importProgress: 0 });
    let imported = 0;
    const total = files.length;

    try {
      // Phase 1: Add all files to container (without saving each time)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Progress: 0-80% for adding files
        set({ importProgress: Math.round((i / total) * 80) });

        try {
          // Generate thumbnail for images
          let thumbnail: string | null = null;
          if (file.mimeType.startsWith('image/')) {
            thumbnail = await generateThumbnail(file.uri, file.mimeType);
          }

          // Add to container (skipSave=true for batch mode)
          await addFileToContainer(
            containerHandle,
            file.uri,
            file.name,
            file.mimeType,
            thumbnail || undefined,
            true // skipSave - we'll save once at the end
          );

          imported++;
        } catch (itemError) {
          console.error('Failed to import file:', itemError);
        }
      }

      // Phase 2: Save container once (80-100% progress)
      if (imported > 0) {
        set({ importProgress: 85 });
        await saveContainer(containerHandle);
        set({ importProgress: 100 });
      }

      // Refresh media list
      set({
        media: containerHandle.index.items,
        importing: false,
        importProgress: 100,
      });

      return imported;
    } catch (error) {
      console.error('Failed to import files:', error);
      set({ importing: false, importProgress: 0 });
      return 0;
    }
  },

  importSvaultFile: async (svaultUri, password, secretKey) => {
    const { containerHandle } = get();
    if (!containerHandle) return 0;

    set({ importing: true, importProgress: 0 });

    try {
      const imported = await importFromSvault(containerHandle, svaultUri, password, secretKey);

      // Refresh media list
      set({
        media: containerHandle.index.items,
        importing: false,
        importProgress: 100,
      });

      return imported;
    } catch (error) {
      console.error('Failed to import .svault file:', error);
      set({ importing: false, importProgress: 0 });
      return 0;
    }
  },

  deleteMedia: async (ids) => {
    const { containerHandle } = get();
    if (!containerHandle) return;

    for (const id of ids) {
      await deleteFromContainer(containerHandle, id);
    }

    // Refresh media list
    set({
      media: containerHandle.index.items,
    });
  },

  exportVault: async () => {
    const { containerHandle } = get();
    if (!containerHandle) {
      throw new Error('No vault open');
    }

    // Save any pending changes
    await saveContainer(containerHandle);

    // Get vault type from auth store
    const { vaultType } = useAuthStore.getState();
    return getContainerPath(vaultType || 'real');
  },

  exportSelection: async (ids, password, secretKey) => {
    const { containerHandle } = get();
    if (!containerHandle) {
      throw new Error('No vault open');
    }

    return await exportSelection(containerHandle, ids, password, secretKey);
  },

  refreshMedia: async () => {
    const { containerHandle } = get();
    if (containerHandle) {
      set({ media: containerHandle.index.items });
    }
  },
}));
