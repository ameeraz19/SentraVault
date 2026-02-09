import { useState, useEffect, useCallback, useRef } from 'react';
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
  ViewToken,
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

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GAP = 2;
const ITEM_SIZE = (width - GAP * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

export default function VaultScreen() {
  const { vaultType, lock } = useAuthStore();
  const {
    media,
    loading,
    importing,
    importProgress,
    thumbnailCache,
    loadThumbnails,
    getThumbnailPath,
    getFilePath,
    deleteMedia,
    refreshMedia,
  } = useMediaStore();

  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [localThumbnails, setLocalThumbnails] = useState<Map<string, string>>(new Map());

  // Modal states
  const [importVisible, setImportVisible] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Track visible items for lazy loading
  const visibleItemsRef = useRef<Set<string>>(new Set());

  // Sync thumbnailCache to localThumbnails
  useEffect(() => {
    setLocalThumbnails(new Map(thumbnailCache));
  }, [thumbnailCache]);

  // Clean up on app background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Lock the vault when going to background
        await lock();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [lock]);

  // Handle viewable items change for lazy loading
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const visibleIds = viewableItems
        .filter((item) => item.isViewable && item.item)
        .map((item) => (item.item as MediaItem).id);

      visibleItemsRef.current = new Set(visibleIds);

      // Load thumbnails for visible items + buffer
      const itemsToLoad: string[] = [];
      const bufferSize = 20;

      viewableItems.forEach((viewToken) => {
        if (viewToken.index !== null && viewToken.item) {
          const startIdx = Math.max(0, viewToken.index - bufferSize);
          const endIdx = Math.min(media.length, viewToken.index + bufferSize);

          for (let i = startIdx; i < endIdx; i++) {
            const item = media[i];
            if (item && !thumbnailCache.has(item.id) && item.thumbnailPath) {
              itemsToLoad.push(item.id);
            }
          }
        }
      });

      // Load in batches
      if (itemsToLoad.length > 0) {
        const firstVisible = viewableItems[0]?.index || 0;
        loadThumbnails(Math.max(0, firstVisible - bufferSize), bufferSize * 2 + viewableItems.length);
      }
    },
    [media, thumbnailCache, loadThumbnails]
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 100,
  }).current;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await refreshMedia();
    setRefreshing(false);
  };

  const openMedia = async (item: MediaItem, index: number) => {
    if (selectionMode) {
      toggleSelection(item.id);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // For non-media files (type === 'file'), open in system viewer via Share sheet
    if (item.type === 'file') {
      try {
        // Extract the file first
        const filePath = await getFilePath(item.id);
        if (!filePath) {
          Alert.alert('Error', 'Failed to extract file');
          return;
        }

        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Error', 'Sharing is not available on this device');
          return;
        }

        // Open share sheet with the extracted file
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
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    Alert.alert(
      'Delete Items',
      `Delete ${selectedIds.size} item(s)? This cannot be undone.`,
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
    // If no more media, close viewer
    if (media.length <= 1) {
      setViewerVisible(false);
    }
  };

  const renderItem = ({ item, index }: { item: MediaItem; index: number }) => {
    const isSelected = selectedIds.has(item.id);
    const isFile = item.type === 'file';
    const fileExtension = item.fileExtension?.toUpperCase() || 'FILE';

    // Get thumbnail from cache
    const thumbnailPath = localThumbnails.get(item.id);
    const isLoadingThumb = !thumbnailPath && !isFile && item.thumbnailPath;

    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => openMedia(item, index)}
        onLongPress={() => enterSelectionMode(item.id)}
        activeOpacity={0.8}
      >
        {isFile ? (
          // File type - show extension badge instead of thumbnail
          <View style={styles.filePlaceholder}>
            <Ionicons name="document-outline" size={28} color={colors.textTertiary} />
            <View style={styles.extensionBadge}>
              <Text style={styles.extensionText}>.{fileExtension}</Text>
            </View>
          </View>
        ) : isLoadingThumb ? (
          // Loading placeholder
          <View style={styles.thumbnailPlaceholder}>
            <ActivityIndicator size="small" color={colors.textTertiary} />
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
          // No thumbnail - show placeholder
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

  const renderHeader = () => (
    <View style={styles.header}>
      {selectionMode ? (
        <>
          <TouchableOpacity onPress={exitSelectionMode} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
          <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View>
            <Text style={styles.title}>Vault</Text>
            {media.length > 0 && (
              <Text style={styles.subtitle}>
                {media.length} {media.length === 1 ? 'item' : 'items'}
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

  if (loading) {
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
        contentContainerStyle={[styles.grid, media.length === 0 && styles.gridEmpty]}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textTertiary}
          />
        }
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews={true}
        maxToRenderPerBatch={12}
        windowSize={5}
        initialNumToRender={18}
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

      {/* Media Viewer - Gesture-based */}
      <MediaViewer
        visible={viewerVisible}
        media={media}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        onDelete={handleViewerDelete}
      />

      {/* Importing Banner */}
      {importing && (
        <View style={styles.importingBanner}>
          <View style={styles.importingContent}>
            <ActivityIndicator size="small" color={colors.primary} />
            <View style={styles.importingTextContainer}>
              <Text style={styles.importingTitle}>
                {importProgress < 80 ? 'Importing...' : 'Encrypting...'}
              </Text>
              <Text style={styles.importingSubtitle}>
                Don't close the app
              </Text>
            </View>
            <Text style={styles.importingProgress}>{Math.round(importProgress)}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${importProgress}%` }]} />
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
  grid: {
    padding: GAP,
    paddingBottom: 100, // Space for FAB
  },
  gridEmpty: {
    flex: 1,
  },
  item: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: GAP / 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
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
  importingBanner: {
    position: 'absolute',
    bottom: 100,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  importingContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  importingTextContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  importingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  importingSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  importingProgress: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});
