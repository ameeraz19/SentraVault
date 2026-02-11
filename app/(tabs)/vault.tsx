import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  RefreshControl,
  StatusBar,
  AppState,
  Alert,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useAuthStore } from '../../src/store';
import { useMediaStore, MediaItem } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';
import { FAB } from '../../src/components/ui';
import { MediaViewer } from '../../src/components/MediaViewer';
import { ImportModal } from '../../src/components/ImportModal';
import { ShimmerPlaceholder } from '../../src/components/ShimmerPlaceholder';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GAP = 2;
const ITEM_SIZE = (width - GAP * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

export default function VaultScreen() {
  const { vaultType, lock } = useAuthStore();
  const {
    media,
    vaultLoading,
    importing,
    pendingItems,
    encryptingInBackground,
    thumbnailCache,
    isDecryptingThumbnails,
    decryptionProgress,
    encryptionProgress,
    getThumbnailPath,
    getFilePath,
    deleteMedia,
    exportSelection,
    refreshMedia,
    openVaultAsync,
    prioritizeThumbnail,
  } = useMediaStore();

  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states
  // Modal states
  const [importVisible, setImportVisible] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerMedia, setViewerMedia] = useState<MediaItem[]>([]);

  // Trigger vault open when screen appears
  useEffect(() => {
    openVaultAsync();
  }, []);

  // Clean up on app background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        await lock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [lock]);

  // Viewability config for FlatList optimization
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 100,
  }).current;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    refreshMedia();
    setRefreshing(false);
  };

  const openMedia = async (item: MediaItem, index: number) => {
    if (selectionMode) {
      toggleSelection(item.id);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // For non-media files, open in system viewer via Share sheet
    if (item.type === 'file') {
      try {
        const filePath = await getFilePath(item.id);
        if (!filePath) {
          Alert.alert('Error', 'Failed to decrypt file');
          return;
        }

        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Error', 'Sharing is not available on this device');
          return;
        }

        await Sharing.shareAsync(filePath, {
          mimeType: item.mimeType || 'application/octet-stream',
          dialogTitle: item.originalName,
        });
      } catch (error) {
        console.error('Failed to share file:', error);
        Alert.alert('Error', 'Failed to open file');
      }
      return;
    }

    // For photos and videos, open MediaViewer
    setViewerMedia(media);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  const toggleSelection = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const enterSelectionMode = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  };

  const exitSelectionMode = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleExportSelection = async () => {
    if (selectedIds.size === 0) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const exportPath = await exportSelection(Array.from(selectedIds));

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(exportPath, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Export Selection',
        });
      }
      exitSelectionMode();
    } catch (error) {
      console.error('Export failed:', error);
      Alert.alert('Error', 'Failed to export selection');
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    Alert.alert(
      'Secure Deletion',
      `Permanently delete ${selectedIds.size} items? This cannot be undone. Files will be scrubbed from storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await deleteMedia(Array.from(selectedIds));
            exitSelectionMode();
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const handleViewerDelete = async (id: string) => {
    await deleteMedia([id]);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (media.length <= 1) {
      setViewerVisible(false);
    }
  };

  const renderItem = ({ item, index }: { item: MediaItem; index: number }) => {
    const isSelected = selectedIds.has(item.id);
    const isFile = item.type === 'file';
    const fileExtension = item.fileExtension?.toUpperCase() || 'FILE';

    // Get thumbnail from cache (sync call)
    const thumbnailPath = getThumbnailPath(item.id);
    const hasThumbnail = item.thumbnailBase64; // Item has a thumbnail to load
    const isLoadingThumb = !thumbnailPath && !isFile && hasThumbnail;

    // Handle tap - prioritize thumbnail loading if not cached
    const handlePress = () => {
      if (!thumbnailPath && hasThumbnail) {
        prioritizeThumbnail(item.id);
      }
      openMedia(item, index);
    };

    return (
      <TouchableOpacity
        style={styles.item}
        onPress={handlePress}
        onLongPress={() => enterSelectionMode(item.id)}
        activeOpacity={0.8}
      >
        {isFile ? (
          // File type - show extension badge
          <View style={styles.filePlaceholder}>
            <Ionicons name="document-outline" size={28} color={colors.textTertiary} />
            <View style={styles.extensionBadge}>
              <Text style={styles.extensionText}>.{fileExtension}</Text>
            </View>
          </View>
        ) : isLoadingThumb ? (
          // Shimmer placeholder while loading
          <View style={styles.shimmerContainer}>
            <ShimmerPlaceholder width={ITEM_SIZE} height={ITEM_SIZE} borderRadius={radius.sm} />
            <View style={styles.shimmerIcon}>
              <ActivityIndicator size="small" color={colors.textTertiary} />
            </View>
          </View>
        ) : thumbnailPath ? (
          // Show thumbnail
          <Image
            source={{ uri: thumbnailPath }}
            style={[styles.thumbnail, isSelected && styles.thumbnailSelected]}
            contentFit="cover"
            transition={150}
          />
        ) : (
          // No thumbnail available
          <View style={styles.thumbnailPlaceholder}>
            <Ionicons
              name={item.type === 'video' ? 'videocam-outline' : 'image-outline'}
              size={24}
              color={colors.textTertiary}
            />
          </View>
        )}

        {item.type === 'video' && item.duration && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
          </View>
        )}

        {selectionMode && (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Ionicons name="checkmark" size={14} color={colors.text} />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="lock-closed-outline" size={32} color={colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>No items yet</Text>
      <Text style={styles.emptySubtitle}>Tap + to import photos, videos, or files</Text>
    </View>
  );

  // Handle pending item press - view immediately
  const handlePendingPress = (item: any) => {
    // Convert PendingItem to MediaItem for viewer
    const tempItem: MediaItem = {
      id: item.id,
      type: item.mimeType.startsWith('video/') ? 'video' : item.mimeType.startsWith('image/') ? 'photo' : 'file',
      originalName: item.originalName,
      mimeType: item.mimeType,
      fileExtension: item.originalName.split('.').pop(),
      createdAt: Date.now(),
      thumbnailBase64: item.thumbnailBase64 || undefined,
      encryptedFileName: 'PENDING',
      size: item.size
    };

    // Open viewer with just this item (or we could merge lists, but this is safer for now)
    // We'll use a local state for "viewer media" if needed, but for now let's hack it 
    // by passing it as a single-item list to the viewer
    // But MediaViewer takes `media` prop which is usually the store `media`.
    // We should utilize the `media` prop on MediaViewer component.
    // It's currently `<MediaViewer media={media} ... />`.
    // I need to change how MediaViewer is instantiated.
  };

  const renderPendingItems = () => (
    <View style={styles.pendingContainer}>
      {pendingItems.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.item}
          onPress={() => handlePendingPress(item)}
          activeOpacity={0.7}
        >
          {item.thumbnailPath ? (
            <Image
              source={{ uri: item.thumbnailPath }}
              style={[styles.thumbnail, styles.pendingThumbnail]}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Ionicons
                name={item.mimeType.startsWith('video/') ? 'videocam-outline' : 'image-outline'}
                size={24}
                color={colors.textTertiary}
              />
            </View>
          )}
          {item.thumbnailPath ? (
            <View style={styles.pendingStatusBadge}>
              <Ionicons name="sync" size={12} color={colors.primary} />
            </View>
          ) : (
            <View style={styles.pendingOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      {selectionMode ? (
        <>
          <TouchableOpacity onPress={exitSelectionMode} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleExportSelection} style={styles.headerButton}>
              <Ionicons name="share-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <View>
            <Text style={styles.title}>Vault</Text>
            {(media.length > 0 || pendingItems.length > 0) && (
              <Text style={styles.subtitle}>
                {media.length + pendingItems.length} {(media.length + pendingItems.length) === 1 ? 'item' : 'items'}
                {pendingItems.length > 0 && ` (${pendingItems.length} importing)`}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={() => lock()} style={styles.headerButton}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // Show loading only during initial vault load
  if (vaultLoading && media.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Opening vault...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      {renderHeader()}

      <FlatList
        data={media}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={COLUMN_COUNT}
        contentContainerStyle={[styles.grid, media.length === 0 && pendingItems.length === 0 && styles.gridEmpty]}
        ListHeaderComponent={pendingItems.length > 0 ? renderPendingItems : null}
        ListEmptyComponent={pendingItems.length === 0 ? renderEmpty : null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textTertiary}
          />
        }
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews={true}
        maxToRenderPerBatch={Platform.OS === 'android' ? 8 : 12}
        windowSize={Platform.OS === 'android' ? 3 : 5}
        initialNumToRender={18}
        extraData={[thumbnailCache.size, selectionMode, selectedIds.size]} // Re-render when thumbnails or selection changes
      />

      {/* FAB - Import button */}
      {!selectionMode && <FAB onPress={() => setImportVisible(true)} />}

      {/* Import Modal */}
      <ImportModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onComplete={() => {
          setImportVisible(false);
          refreshMedia();
        }}
      />

      {/* Media Viewer */}
      <MediaViewer
        visible={viewerVisible}
        media={viewerMedia}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        onDelete={handleViewerDelete}
      />

      {/* Decrypting Thumbnails Banner */}
      {isDecryptingThumbnails && decryptionProgress.total > 0 && (
        <View style={styles.decryptingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.decryptingText}>
            Decrypting {decryptionProgress.current}/{decryptionProgress.total}
          </Text>
        </View>
      )}

      {/* Encrypting Banner (real progress) */}
      {encryptingInBackground && (
        <View style={styles.encryptingFooter}>
          <View style={styles.encryptingValidContent}>
            <ActivityIndicator size="small" color={colors.primary} />
            <View style={styles.encryptingTextContainer}>
              <Text style={styles.encryptingTitle}>
                Encrypting {encryptionProgress.current}/{encryptionProgress.total}
              </Text>
              <Text style={styles.encryptingSubtitle}>
                Don't exit app
              </Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 16,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  cancelText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  deleteText: {
    fontSize: 16,
    color: colors.error,
    fontWeight: '500',
  },
  selectionCount: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  grid: {
    padding: GAP,
    paddingBottom: 100,
  },
  gridEmpty: {
    flex: 1,
  },
  pendingContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: GAP / 2,
  },
  pendingThumbnail: {
    opacity: 0.6,
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: GAP / 2,
    borderRadius: radius.md, // More rounded
    overflow: 'hidden',
    backgroundColor: colors.surfaceSecondary,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    opacity: 0.95, // Slightly less harsh
  },
  thumbnailSelected: {
    opacity: 0.7,
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  shimmerContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  shimmerIcon: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    opacity: 0.5,
  },
  filePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
  },
  extensionBadge: {
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  extensionText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 11,
    color: colors.text,
    fontWeight: '500',
  },
  checkbox: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  decryptingBanner: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  decryptingText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  encryptingFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 24 : spacing.sm, // Safe area
  },
  encryptingValidContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    justifyContent: 'center',
  },
  encryptingTextContainer: {
    flexDirection: 'column',
  },
  encryptingTitle: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  encryptingSubtitle: {
    fontSize: 11,
    color: colors.error, // or warning color
    fontWeight: '500',
  },
  pendingStatusBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  encryptingSubtext: {
    fontSize: 10,
    color: colors.error,
    fontWeight: '700',
  }
});
