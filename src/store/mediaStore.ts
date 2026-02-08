import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Crypto from 'expo-crypto';

type VaultType = 'real' | 'decoy';

interface MediaItem {
  id: string;
  type: 'photo' | 'video';
  thumbnailUri: string | null;
  encryptedPath: string;
  originalName: string;
  size: number;
  duration?: number;
  createdAt: number;
  checksum: string;
}

// Single item export format
interface VaultExportItem {
  type: 'photo' | 'video';
  originalName: string;
  duration?: number;
  createdAt: number;
  checksum: string;
  data: string; // Base64 encoded file data
}

// Export bundle format - can contain multiple items
interface VaultExportBundle {
  version: number;
  exportedAt: number;
  itemCount: number;
  items: VaultExportItem[];
}

// Temporary preview item (for viewing .svault without importing)
interface PreviewItem {
  id: string;
  type: 'photo' | 'video';
  uri: string;
  originalName: string;
  duration?: number;
}

interface MediaStore {
  media: MediaItem[];
  loading: boolean;
  importing: boolean;
  importProgress: number;

  loadMedia: (vaultType: VaultType) => Promise<void>;
  refreshMedia: (vaultType: VaultType) => Promise<void>;
  importMedia: (assets: any[], vaultType: VaultType) => Promise<void>;
  importFromUSB: (files: any[], vaultType: VaultType) => Promise<void>;
  importVaultFiles: (files: any[], vaultType: VaultType) => Promise<void>;
  exportToUSB: (mediaIds: string[], vaultType: VaultType) => Promise<void>;
  exportAllToUSB: (vaultType: VaultType) => Promise<void>;
  deleteMedia: (id: string) => Promise<void>;
  previewVaultFile: (fileUri: string) => Promise<PreviewItem[]>;
  cleanupPreviews: () => Promise<void>;
}

const VAULT_DIR = FileSystem.documentDirectory + 'vault/';
const DECOY_VAULT_DIR = FileSystem.documentDirectory + 'decoy_vault/';
const EXPORT_DIR = FileSystem.cacheDirectory + 'export/';

const ensureVaultDir = async (vaultType: VaultType) => {
  const dir = vaultType === 'real' ? VAULT_DIR : DECOY_VAULT_DIR;
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
};

const ensureExportDir = async () => {
  const dirInfo = await FileSystem.getInfoAsync(EXPORT_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
  }
  return EXPORT_DIR;
};

const generateId = (): string => {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
};

// Get file extension from original name or type
const getExtension = (type: 'photo' | 'video', originalName?: string): string => {
  if (originalName) {
    const ext = originalName.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'gif', 'heic', 'mp4', 'mov', 'm4v', 'webm'].includes(ext)) {
      return ext;
    }
  }
  return type === 'video' ? 'mp4' : 'jpg';
};

export const useMediaStore = create<MediaStore>((set, get) => ({
  media: [],
  loading: false,
  importing: false,
  importProgress: 0,

  loadMedia: async (vaultType) => {
    set({ loading: true });
    try {
      const dir = await ensureVaultDir(vaultType);
      const metadataPath = dir + 'metadata.json';
      const metaInfo = await FileSystem.getInfoAsync(metadataPath);

      if (metaInfo.exists) {
        const content = await FileSystem.readAsStringAsync(metadataPath);
        const media = JSON.parse(content) as MediaItem[];
        set({ media, loading: false });
      } else {
        set({ media: [], loading: false });
      }
    } catch (error) {
      console.error('Failed to load media:', error);
      set({ media: [], loading: false });
    }
  },

  refreshMedia: async (vaultType) => {
    await get().loadMedia(vaultType);
  },

  importMedia: async (assets, vaultType) => {
    set({ importing: true, importProgress: 0 });

    try {
      const dir = await ensureVaultDir(vaultType);
      const metadataPath = dir + 'metadata.json';
      const { media } = get();
      const newMedia: MediaItem[] = [...media];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const progress = ((i + 1) / assets.length) * 100;
        set({ importProgress: progress });

        const id = generateId();

        // Get the full asset info with localUri
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const sourceUri = assetInfo.localUri || asset.uri;

        if (!sourceUri) {
          console.error('No source URI for asset:', asset.id);
          continue;
        }

        // First copy to cache directory
        const tempPath = FileSystem.cacheDirectory + id + '_temp';

        try {
          await FileSystem.copyAsync({
            from: sourceUri,
            to: tempPath,
          });
        } catch (copyError) {
          console.error('Failed to copy from sourceUri, trying asset.uri:', copyError);
          try {
            await FileSystem.copyAsync({
              from: asset.uri,
              to: tempPath,
            });
          } catch (fallbackError) {
            console.error('Failed to copy asset:', fallbackError);
            continue;
          }
        }

        const tempInfo = await FileSystem.getInfoAsync(tempPath);
        if (!tempInfo.exists) {
          console.error('Temp file does not exist after copy');
          continue;
        }

        let checksum = '';
        try {
          const fileContent = await FileSystem.readAsStringAsync(tempPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          checksum = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            fileContent.substring(0, 10000)
          );
        } catch (hashError) {
          console.error('Failed to hash file, using timestamp:', hashError);
          checksum = Date.now().toString();
        }

        // Store with original extension for proper playback
        const ext = getExtension(asset.mediaType === 'video' ? 'video' : 'photo', asset.filename);
        const encryptedPath = dir + id + '.' + ext;

        await FileSystem.moveAsync({
          from: tempPath,
          to: encryptedPath,
        });

        const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
        if (!verifyInfo.exists) {
          console.error('Failed to move file to vault');
          continue;
        }

        const mediaItem: MediaItem = {
          id,
          type: asset.mediaType === 'video' ? 'video' : 'photo',
          thumbnailUri: null,
          encryptedPath,
          originalName: asset.filename || `media_${id}.${ext}`,
          size: tempInfo.size || 0,
          duration: asset.duration,
          createdAt: Date.now(),
          checksum,
        };

        newMedia.push(mediaItem);
      }

      await FileSystem.writeAsStringAsync(
        metadataPath,
        JSON.stringify(newMedia)
      );

      set({ media: newMedia, importing: false, importProgress: 100 });
    } catch (error) {
      console.error('Failed to import media:', error);
      set({ importing: false, importProgress: 0 });
      throw error;
    }
  },

  importFromUSB: async (files, vaultType) => {
    set({ importing: true, importProgress: 0 });

    try {
      const dir = await ensureVaultDir(vaultType);
      const metadataPath = dir + 'metadata.json';
      const { media } = get();
      const newMedia: MediaItem[] = [...media];

      // Separate .svault files from regular media
      const vaultFiles = files.filter((f: any) =>
        f.name?.endsWith('.svault') || f.mimeType === 'application/octet-stream'
      );
      const regularFiles = files.filter((f: any) =>
        !f.name?.endsWith('.svault') && f.mimeType !== 'application/octet-stream'
      );

      // Import regular media files
      for (let i = 0; i < regularFiles.length; i++) {
        const file = regularFiles[i];
        const progress = ((i + 1) / files.length) * 100;
        set({ importProgress: progress });

        const id = generateId();

        let checksum = '';
        try {
          const fileContent = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          checksum = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            fileContent.substring(0, 10000)
          );
        } catch (hashError) {
          console.error('Failed to hash USB file:', hashError);
          checksum = Date.now().toString();
        }

        const isVideo = file.mimeType?.startsWith('video/');
        const ext = getExtension(isVideo ? 'video' : 'photo', file.name);
        const encryptedPath = dir + id + '.' + ext;

        await FileSystem.copyAsync({
          from: file.uri,
          to: encryptedPath,
        });

        const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
        if (!verifyInfo.exists) {
          console.error('Failed to copy USB file to vault');
          continue;
        }

        const mediaItem: MediaItem = {
          id,
          type: isVideo ? 'video' : 'photo',
          thumbnailUri: null,
          encryptedPath,
          originalName: file.name || `usb_${id}.${ext}`,
          size: file.size || verifyInfo.size || 0,
          createdAt: Date.now(),
          checksum,
        };

        newMedia.push(mediaItem);
      }

      // Import .svault bundle files (supports both single and multi-item bundles)
      for (let i = 0; i < vaultFiles.length; i++) {
        const file = vaultFiles[i];

        try {
          const bundleContent = await FileSystem.readAsStringAsync(file.uri);
          const bundle: VaultExportBundle = JSON.parse(bundleContent);

          if (bundle.version !== 1 && bundle.version !== 2) {
            console.error('Unsupported vault bundle version:', bundle.version);
            continue;
          }

          // Handle new multi-item format (version 2)
          if (bundle.items && Array.isArray(bundle.items)) {
            for (let j = 0; j < bundle.items.length; j++) {
              const item = bundle.items[j];
              const progress = ((regularFiles.length + i + (j / bundle.items.length)) / files.length) * 100;
              set({ importProgress: progress });

              const id = generateId();
              const ext = getExtension(item.type, item.originalName);
              const encryptedPath = dir + id + '.' + ext;

              await FileSystem.writeAsStringAsync(
                encryptedPath,
                item.data,
                { encoding: FileSystem.EncodingType.Base64 }
              );

              const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
              if (!verifyInfo.exists) continue;

              const mediaItem: MediaItem = {
                id,
                type: item.type,
                thumbnailUri: null,
                encryptedPath,
                originalName: item.originalName,
                size: verifyInfo.size || 0,
                duration: item.duration,
                createdAt: item.createdAt || Date.now(),
                checksum: item.checksum,
              };

              newMedia.push(mediaItem);
            }
          } else {
            // Handle legacy single-item format (version 1)
            const progress = ((regularFiles.length + i + 1) / files.length) * 100;
            set({ importProgress: progress });

            const legacyBundle = bundle as any;
            const id = generateId();
            const ext = getExtension(legacyBundle.type, legacyBundle.originalName);
            const encryptedPath = dir + id + '.' + ext;

            await FileSystem.writeAsStringAsync(
              encryptedPath,
              legacyBundle.data,
              { encoding: FileSystem.EncodingType.Base64 }
            );

            const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
            if (!verifyInfo.exists) continue;

            const mediaItem: MediaItem = {
              id,
              type: legacyBundle.type,
              thumbnailUri: null,
              encryptedPath,
              originalName: legacyBundle.originalName,
              size: verifyInfo.size || 0,
              duration: legacyBundle.duration,
              createdAt: legacyBundle.createdAt || Date.now(),
              checksum: legacyBundle.checksum,
            };

            newMedia.push(mediaItem);
          }
        } catch (bundleError) {
          console.error('Failed to parse vault bundle:', bundleError);
          continue;
        }
      }

      await FileSystem.writeAsStringAsync(
        metadataPath,
        JSON.stringify(newMedia)
      );

      set({ media: newMedia, importing: false, importProgress: 100 });
    } catch (error) {
      console.error('Failed to import from USB:', error);
      set({ importing: false, importProgress: 0 });
      throw error;
    }
  },

  // Import .svault files specifically (supports both single and multi-item bundles)
  importVaultFiles: async (files, vaultType) => {
    set({ importing: true, importProgress: 0 });

    try {
      const dir = await ensureVaultDir(vaultType);
      const metadataPath = dir + 'metadata.json';
      const { media } = get();
      const newMedia: MediaItem[] = [...media];

      let totalItems = 0;
      let processedItems = 0;

      // First pass: count total items
      for (const file of files) {
        try {
          const bundleContent = await FileSystem.readAsStringAsync(file.uri);
          const bundle: VaultExportBundle = JSON.parse(bundleContent);
          totalItems += bundle.items?.length || 1;
        } catch {
          totalItems += 1;
        }
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
          const bundleContent = await FileSystem.readAsStringAsync(file.uri);
          const bundle: VaultExportBundle = JSON.parse(bundleContent);

          if (bundle.version !== 1 && bundle.version !== 2) {
            console.error('Unsupported vault bundle version');
            continue;
          }

          // Handle new multi-item format (version 2)
          if (bundle.items && Array.isArray(bundle.items)) {
            for (const item of bundle.items) {
              processedItems++;
              set({ importProgress: (processedItems / totalItems) * 100 });

              const id = generateId();
              const ext = getExtension(item.type, item.originalName);
              const encryptedPath = dir + id + '.' + ext;

              await FileSystem.writeAsStringAsync(
                encryptedPath,
                item.data,
                { encoding: FileSystem.EncodingType.Base64 }
              );

              const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
              if (!verifyInfo.exists) continue;

              const mediaItem: MediaItem = {
                id,
                type: item.type,
                thumbnailUri: null,
                encryptedPath,
                originalName: item.originalName,
                size: verifyInfo.size || 0,
                duration: item.duration,
                createdAt: item.createdAt || Date.now(),
                checksum: item.checksum,
              };

              newMedia.push(mediaItem);
            }
          } else {
            // Handle legacy single-item format (version 1)
            processedItems++;
            set({ importProgress: (processedItems / totalItems) * 100 });

            const legacyBundle = bundle as any;
            const id = generateId();
            const ext = getExtension(legacyBundle.type, legacyBundle.originalName);
            const encryptedPath = dir + id + '.' + ext;

            await FileSystem.writeAsStringAsync(
              encryptedPath,
              legacyBundle.data,
              { encoding: FileSystem.EncodingType.Base64 }
            );

            const verifyInfo = await FileSystem.getInfoAsync(encryptedPath);
            if (!verifyInfo.exists) continue;

            const mediaItem: MediaItem = {
              id,
              type: legacyBundle.type,
              thumbnailUri: null,
              encryptedPath,
              originalName: legacyBundle.originalName,
              size: verifyInfo.size || 0,
              duration: legacyBundle.duration,
              createdAt: legacyBundle.createdAt || Date.now(),
              checksum: legacyBundle.checksum,
            };

            newMedia.push(mediaItem);
          }
        } catch (bundleError) {
          console.error('Failed to parse vault bundle:', bundleError);
        }
      }

      await FileSystem.writeAsStringAsync(
        metadataPath,
        JSON.stringify(newMedia)
      );

      set({ media: newMedia, importing: false, importProgress: 100 });
    } catch (error) {
      console.error('Failed to import vault files:', error);
      set({ importing: false, importProgress: 0 });
      throw error;
    }
  },

  // Export specific media items (always bundles into single file)
  exportToUSB: async (mediaIds, vaultType) => {
    const { media } = get();
    const itemsToExport = media.filter(m => mediaIds.includes(m.id));

    if (itemsToExport.length === 0) {
      throw new Error('No media to export');
    }

    const { shareAsync } = await import('expo-sharing');
    const exportDir = await ensureExportDir();

    try {
      // Build array of export items
      const exportItems: VaultExportItem[] = [];

      for (const item of itemsToExport) {
        const fileData = await FileSystem.readAsStringAsync(item.encryptedPath, {
          encoding: FileSystem.EncodingType.Base64,
        });

        exportItems.push({
          type: item.type,
          originalName: item.originalName,
          duration: item.duration,
          createdAt: item.createdAt,
          checksum: item.checksum,
          data: fileData,
        });
      }

      // Create single bundle with all items
      const bundle: VaultExportBundle = {
        version: 2,
        exportedAt: Date.now(),
        itemCount: exportItems.length,
        items: exportItems,
      };

      // Generate export filename
      const timestamp = new Date().toISOString().slice(0, 10);
      const exportName = itemsToExport.length === 1
        ? itemsToExport[0].originalName.replace(/\.[^.]+$/, '') + '.svault'
        : `SentraVault_${timestamp}_${itemsToExport.length}items.svault`;
      const exportPath = exportDir + exportName;

      await FileSystem.writeAsStringAsync(
        exportPath,
        JSON.stringify(bundle)
      );

      // Share the bundle file
      await shareAsync(exportPath, {
        mimeType: 'application/octet-stream',
        dialogTitle: `Export ${itemsToExport.length} item(s)`,
        UTI: 'public.data',
      });

      // Clean up
      await FileSystem.deleteAsync(exportPath, { idempotent: true });
    } catch (error) {
      console.error('Failed to export items:', error);
      throw error;
    }
  },

  // Export all media into single .svault file
  exportAllToUSB: async (vaultType) => {
    const { media } = get();

    if (media.length === 0) {
      throw new Error('No media to export');
    }

    // Export all items as single bundle
    await get().exportToUSB(media.map(m => m.id), vaultType);
  },

  deleteMedia: async (id) => {
    const { media } = get();
    const item = media.find((m) => m.id === id);

    if (item) {
      await FileSystem.deleteAsync(item.encryptedPath, { idempotent: true });
      const newMedia = media.filter((m) => m.id !== id);

      const dir = item.encryptedPath.includes('decoy_vault')
        ? DECOY_VAULT_DIR
        : VAULT_DIR;
      await FileSystem.writeAsStringAsync(
        dir + 'metadata.json',
        JSON.stringify(newMedia)
      );

      set({ media: newMedia });
    }
  },

  // Preview .svault file without importing (creates temp files)
  previewVaultFile: async (fileUri) => {
    const previewDir = FileSystem.cacheDirectory + 'preview/';
    const dirInfo = await FileSystem.getInfoAsync(previewDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(previewDir, { intermediates: true });
    }

    const previews: PreviewItem[] = [];

    try {
      const bundleContent = await FileSystem.readAsStringAsync(fileUri);
      const bundle: VaultExportBundle = JSON.parse(bundleContent);

      if (bundle.version !== 1 && bundle.version !== 2) {
        throw new Error('Unsupported vault file version');
      }

      // Handle multi-item format (version 2)
      if (bundle.items && Array.isArray(bundle.items)) {
        for (let i = 0; i < bundle.items.length; i++) {
          const item = bundle.items[i];
          const id = `preview-${Date.now()}-${i}`;
          const ext = getExtension(item.type, item.originalName);
          const tempPath = previewDir + id + '.' + ext;

          await FileSystem.writeAsStringAsync(
            tempPath,
            item.data,
            { encoding: FileSystem.EncodingType.Base64 }
          );

          previews.push({
            id,
            type: item.type,
            uri: tempPath,
            originalName: item.originalName,
            duration: item.duration,
          });
        }
      } else {
        // Handle legacy single-item format (version 1)
        const legacyBundle = bundle as any;
        const id = `preview-${Date.now()}-0`;
        const ext = getExtension(legacyBundle.type, legacyBundle.originalName);
        const tempPath = previewDir + id + '.' + ext;

        await FileSystem.writeAsStringAsync(
          tempPath,
          legacyBundle.data,
          { encoding: FileSystem.EncodingType.Base64 }
        );

        previews.push({
          id,
          type: legacyBundle.type,
          uri: tempPath,
          originalName: legacyBundle.originalName,
          duration: legacyBundle.duration,
        });
      }

      return previews;
    } catch (error) {
      console.error('Failed to preview vault file:', error);
      throw error;
    }
  },

  // Clean up preview temp files
  cleanupPreviews: async () => {
    const previewDir = FileSystem.cacheDirectory + 'preview/';
    try {
      await FileSystem.deleteAsync(previewDir, { idempotent: true });
    } catch (error) {
      console.error('Failed to cleanup previews:', error);
    }
  },
}));
