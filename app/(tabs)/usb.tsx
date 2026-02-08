import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store';
import { useMediaStore } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';
import { MediaViewer } from '../../src/components/MediaViewer';

interface MountedFile {
  id: string;
  uri: string;
  name: string;
  type: 'photo' | 'video';
  mimeType: string;
}

export default function USBScreen() {
  const { vaultType } = useAuthStore();
  const { importFromUSB, importVaultFiles, exportAllToUSB, media, previewVaultFile, cleanupPreviews } = useMediaStore();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'import' | 'importVault' | 'export' | 'view' | null>(null);
  const [mountedFiles, setMountedFiles] = useState<MountedFile[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Import regular media files (photos/videos)
  const handleImportMedia = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setAction('import');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        await importFromUSB(result.assets, vaultType || 'real');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Import Complete',
          `${result.assets.length} file(s) added to your vault`
        );
      }
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to import files');
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  // Import .svault bundle files
  const handleImportVaultFiles = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setAction('importVault');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream', '*/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        // Filter for .svault files
        const vaultFiles = result.assets.filter(
          (f) => f.name?.endsWith('.svault') || f.name?.endsWith('.json')
        );

        if (vaultFiles.length === 0) {
          Alert.alert('No Vault Files', 'Please select .svault files exported from SentraVault');
          return;
        }

        await importVaultFiles(vaultFiles, vaultType || 'real');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Import Complete',
          `${vaultFiles.length} vault file(s) restored`
        );
      }
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to import vault files. Make sure they are valid .svault files.');
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  // Export all vault items as .svault bundles
  const handleExport = async () => {
    if (media.length === 0) {
      Alert.alert('No Media', 'Your vault is empty.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const message = media.length === 1
      ? 'Export 1 item as .svault file?'
      : `Export all ${media.length} items into a single .svault file?`;

    Alert.alert(
      'Export Vault',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            setLoading(true);
            setAction('export');
            try {
              await exportAllToUSB(vaultType || 'real');
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'Failed to export');
            } finally {
              setLoading(false);
              setAction(null);
            }
          },
        },
      ]
    );
  };

  // View external files without importing (supports .svault files too)
  const handleViewExternal = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAction('view');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*', 'application/json', 'application/octet-stream', '*/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        const files: MountedFile[] = [];

        for (const asset of result.assets) {
          // Check if it's a .svault file
          if (asset.name?.endsWith('.svault')) {
            try {
              // Decode and create temp preview files
              const previews = await previewVaultFile(asset.uri);
              for (const preview of previews) {
                files.push({
                  id: preview.id,
                  uri: preview.uri,
                  name: preview.originalName,
                  type: preview.type,
                  mimeType: preview.type === 'video' ? 'video/mp4' : 'image/jpeg',
                });
              }
            } catch (error) {
              console.error('Failed to preview vault file:', error);
              Alert.alert('Error', 'Failed to read .svault file');
            }
          } else {
            // Regular media file
            files.push({
              id: `external-${files.length}-${Date.now()}`,
              uri: asset.uri,
              name: asset.name || 'Unknown',
              type: asset.mimeType?.startsWith('video/') ? 'video' : 'photo',
              mimeType: asset.mimeType || 'image/jpeg',
            });
          }
        }

        if (files.length > 0) {
          setMountedFiles(files);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open files');
    } finally {
      setAction(null);
    }
  };

  const clearMounted = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMountedFiles([]);
    // Clean up any temp preview files
    await cleanupPreviews();
  };

  const openFile = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  // Transform mounted files to MediaViewer format
  const viewerMedia = mountedFiles.map((file) => ({
    id: file.id,
    type: file.type,
    encryptedPath: file.uri,
    originalName: file.name,
    createdAt: Date.now(),
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Files</Text>
        </View>

        {/* Import Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Import</Text>

          <ActionRow
            icon="images-outline"
            title="Import Media"
            subtitle="Add photos & videos to vault"
            onPress={handleImportMedia}
            loading={loading && action === 'import'}
            disabled={loading}
          />

          <ActionRow
            icon="archive-outline"
            title="Restore Backup"
            subtitle="Import .svault files"
            onPress={handleImportVaultFiles}
            loading={loading && action === 'importVault'}
            disabled={loading}
          />
        </View>

        {/* Export Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Export</Text>

          <ActionRow
            icon="share-outline"
            title="Backup Vault"
            subtitle={`Export ${media.length} items as single .svault file`}
            onPress={handleExport}
            loading={loading && action === 'export'}
            disabled={loading || media.length === 0}
          />
        </View>

        {/* View Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preview</Text>

          <ActionRow
            icon="eye-outline"
            title="View External"
            subtitle="Preview media or .svault files"
            onPress={handleViewExternal}
            disabled={loading}
          />
        </View>

        {/* Mounted Files Section */}
        {mountedFiles.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>
                {mountedFiles.length} {mountedFiles.length === 1 ? 'file' : 'files'}
              </Text>
              <TouchableOpacity onPress={clearMounted}>
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.filesGrid}>
              {mountedFiles.map((file, index) => (
                <TouchableOpacity
                  key={file.id}
                  style={styles.fileItem}
                  onPress={() => openFile(index)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: file.uri }}
                    style={styles.fileThumbnail}
                    contentFit="cover"
                  />
                  {file.type === 'video' && (
                    <View style={styles.videoIndicator}>
                      <Ionicons name="play" size={12} color={colors.text} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoText}>
            Export creates .svault files that can be restored later using "Restore Backup"
          </Text>
        </View>
      </ScrollView>

      {/* Gesture-based Media Viewer */}
      <MediaViewer
        visible={viewerVisible}
        media={viewerMedia}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </SafeAreaView>
  );
}

interface ActionRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

function ActionRow({ icon, title, subtitle, onPress, loading, disabled }: ActionRowProps) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, disabled && styles.actionRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={disabled ? colors.textTertiary : colors.text} />
      </View>
      <View style={styles.actionContent}>
        <Text style={[styles.actionTitle, disabled && styles.textDisabled]}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  clearText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  textDisabled: {
    color: colors.textTertiary,
  },
  filesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -2,
  },
  fileItem: {
    width: '31.5%',
    aspectRatio: 1,
    margin: '0.9%',
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  fileThumbnail: {
    width: '100%',
    height: '100%',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  infoText: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
