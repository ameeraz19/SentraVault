import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store';
import { useMediaStore } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';
import { FAB } from '../../src/components/ui';
import { MediaViewer } from '../../src/components/MediaViewer';
import { ImportModal } from '../../src/components/ImportModal';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GAP = 2;
const ITEM_SIZE = (width - GAP * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

interface MediaItem {
  id: string;
  type: 'photo' | 'video';
  encryptedPath: string;
  originalName: string;
  duration?: number;
  createdAt: number;
}

export default function VaultScreen() {
  const { vaultType } = useAuthStore();
  const { media, loading, loadMedia, refreshMedia, deleteMedia } = useMediaStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states
  const [importVisible, setImportVisible] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  useEffect(() => {
    loadMedia(vaultType || 'real');
  }, [vaultType]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await refreshMedia(vaultType || 'real');
    setRefreshing(false);
  };

  const openMedia = async (item: MediaItem, index: number) => {
    if (selectionMode) {
      toggleSelection(item.id);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    for (const id of selectedIds) {
      await deleteMedia(id);
    }

    exitSelectionMode();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleViewerDelete = async (id: string) => {
    await deleteMedia(id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // If no more media, close viewer
    if (media.length <= 1) {
      setViewerVisible(false);
    }
  };

  const renderItem = ({ item, index }: { item: MediaItem; index: number }) => {
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => openMedia(item, index)}
        onLongPress={() => enterSelectionMode(item.id)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.encryptedPath }}
          style={[styles.thumbnail, isSelected && styles.thumbnailSelected]}
          contentFit="cover"
          transition={150}
        />
        {item.type === 'video' && item.duration && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>
              {formatDuration(item.duration)}
            </Text>
          </View>
        )}
        {selectionMode && (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && (
              <Ionicons name="checkmark" size={14} color={colors.text} />
            )}
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
      <Text style={styles.emptySubtitle}>
        Tap + to import photos and videos
      </Text>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      {selectionMode ? (
        <>
          <TouchableOpacity onPress={exitSelectionMode} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>
            {selectedIds.size} selected
          </Text>
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
          <View style={styles.headerRight} />
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      {renderHeader()}

      <FlatList
        data={media}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={COLUMN_COUNT}
        contentContainerStyle={[
          styles.grid,
          media.length === 0 && styles.gridEmpty,
        ]}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textTertiary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* FAB - Import button */}
      {!selectionMode && (
        <FAB onPress={() => setImportVisible(true)} />
      )}

      {/* Import Modal */}
      <ImportModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onComplete={() => {
          setImportVisible(false);
          refreshMedia(vaultType || 'real');
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
  headerRight: {
    width: 60,
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
});
