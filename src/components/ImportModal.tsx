import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../store';
import { useMediaStore } from '../store/mediaStore';
import { colors, spacing, radius } from '../theme';
import { Button } from './ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GAP = 2;
const ITEM_SIZE = (SCREEN_WIDTH - GAP * (COLUMN_COUNT + 1)) / COLUMN_COUNT;
const DISMISS_THRESHOLD = 120;

interface Asset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  duration: number;
  filename: string;
}

interface ImportModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ImportModal({ visible, onClose, onComplete }: ImportModalProps) {
  const insets = useSafeAreaInsets();
  const { vaultType } = useAuthStore();
  const { importMedia, importing, importProgress } = useMediaStore();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [endCursor, setEndCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  // Animation values
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20 }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      requestPermission();
    } else {
      translateY.setValue(SCREEN_HEIGHT);
      backdropOpacity.setValue(0);
      setSelected(new Set());
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      onClose();
    });
  }, [onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20 }).start();
        }
      },
    })
  ).current;

  const requestPermission = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    setHasPermission(status === 'granted');
    if (status === 'granted') {
      loadAssets();
    }
  };

  const loadAssets = async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: 50,
        after: endCursor,
        mediaType: ['photo', 'video'],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });

      setAssets((prev) => [...prev, ...result.assets as Asset[]]);
      setEndCursor(result.endCursor);
      setHasMore(result.hasNextPage);
    } catch (error) {
      Alert.alert('Error', 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selected.size === assets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(assets.map((a) => a.id)));
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) {
      Alert.alert('Select Items', 'Please select photos or videos to import');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const selectedAssets = assets.filter((a) => selected.has(a.id));

    try {
      await importMedia(selectedAssets, vaultType || 'real');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      handleClose();
      setTimeout(() => {
        onComplete();
      }, 300);
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Import Failed', 'Some files could not be imported.');
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderItem = ({ item }: { item: Asset }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() => toggleSelect(item.id)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.uri }}
          style={[styles.thumbnail, isSelected && styles.thumbnailSelected]}
          contentFit="cover"
          transition={100}
        />
        {item.mediaType === 'video' && item.duration > 0 && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
          </View>
        )}
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && (
            <Ionicons name="checkmark" size={14} color={colors.text} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (hasPermission === null) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      );
    }

    if (!hasPermission) {
      return (
        <View style={styles.center}>
          <View style={styles.permissionIconContainer}>
            <Ionicons name="images-outline" size={32} color={colors.textTertiary} />
          </View>
          <Text style={styles.permissionTitle}>Photo Access</Text>
          <Text style={styles.permissionText}>
            Allow access to import photos and videos
          </Text>
          <Button title="Allow Access" onPress={requestPermission} />
        </View>
      );
    }

    return (
      <>
        {importing && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${importProgress}%` }]} />
            </View>
          </View>
        )}

        <FlatList
          data={assets}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={styles.grid}
          onEndReached={loadAssets}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            loading ? (
              <View style={styles.loader}>
                <ActivityIndicator size="small" color={colors.textTertiary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyList}>
                <Text style={styles.emptyText}>No photos or videos</Text>
              </View>
            ) : null
          }
        />

        {selected.size > 0 && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <Button
              title={importing ? 'Importing...' : `Import ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
              onPress={handleImport}
              disabled={importing}
              loading={importing}
            />
          </View>
        )}
      </>
    );
  };

  if (!visible) return null;

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible={visible}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.container,
          { paddingTop: insets.top, transform: [{ translateY }] }
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>Import</Text>
          {assets.length > 0 && (
            <TouchableOpacity onPress={selectAll} style={styles.selectAllButton}>
              <Text style={styles.selectAllText}>
                {selected.size === assets.length ? 'Clear' : 'All'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {renderContent()}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    marginTop: 60,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  selectAllButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectAllText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '500',
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  progressBar: {
    height: 2,
    backgroundColor: colors.border,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  grid: {
    padding: GAP,
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
  loader: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyList: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  permissionIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  permissionText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
