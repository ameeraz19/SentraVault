import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Modal,
  FlatList,
  StatusBar,
  TouchableOpacity,
  Animated,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;

interface MediaItem {
  id: string;
  type: 'photo' | 'video';
  encryptedPath: string;
  originalName: string;
  duration?: number;
}

interface MediaViewerProps {
  visible: boolean;
  media: MediaItem[];
  initialIndex: number;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export function MediaViewer({
  visible,
  media,
  initialIndex,
  onClose,
  onDelete,
}: MediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [headerVisible, setHeaderVisible] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Animation values
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const resetAnimations = () => {
    translateY.setValue(0);
    scale.setValue(1);
    opacity.setValue(1);
  };

  const handleClose = useCallback(() => {
    resetAnimations();
    onClose();
  }, [onClose]);

  const toggleHeader = () => {
    setHeaderVisible((prev) => !prev);
  };

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // PanResponder for images only (swipe down to close)
  const createImagePanResponder = () => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Only capture vertical swipes down
      return gestureState.dy > 15 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
        const newScale = Math.max(0.75, 1 - gestureState.dy / (SCREEN_HEIGHT * 2));
        scale.setValue(newScale);
        const newOpacity = Math.max(0, 1 - gestureState.dy / (SCREEN_HEIGHT / 3));
        opacity.setValue(newOpacity);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > DISMISS_THRESHOLD) {
        handleClose();
      } else {
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      }
    },
  });

  const imagePanResponder = useRef(createImagePanResponder()).current;

  const renderItem = useCallback(({ item }: { item: MediaItem }) => {
    if (item.type === 'video') {
      // Video - no pan responder, let native controls work
      return (
        <View style={styles.mediaContainer}>
          <Video
            source={{ uri: item.encryptedPath }}
            style={styles.media}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={false}
          />
          {/* Close button for videos since swipe doesn't work well with video controls */}
          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + spacing.sm }]}
            onPress={handleClose}
          >
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Image - with pan responder for swipe to close
    return (
      <Animated.View
        style={[
          styles.mediaContainer,
          {
            transform: [
              { translateY },
              { scale },
            ]
          }
        ]}
        {...imagePanResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={toggleHeader}
          style={styles.imageWrapper}
        >
          <Image
            source={{ uri: item.encryptedPath }}
            style={styles.media}
            contentFit="contain"
          />
        </TouchableOpacity>
      </Animated.View>
    );
  }, [handleClose, insets.top]);

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: SCREEN_WIDTH,
    offset: SCREEN_WIDTH * index,
    index,
  }), []);

  if (!visible || media.length === 0) {
    return null;
  }

  const currentMedia = media[currentIndex];
  const isVideo = currentMedia?.type === 'video';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />

        {/* Background */}
        <Animated.View style={[styles.background, { opacity: isVideo ? 1 : opacity }]} />

        {/* Content */}
        <View style={styles.content}>
          {/* Header - only for photos */}
          {headerVisible && !isVideo && (
            <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
              <View style={styles.headerContent}>
                <Text style={styles.counter}>
                  {currentIndex + 1} / {media.length}
                </Text>
                <Text style={styles.filename} numberOfLines={1}>
                  {currentMedia?.originalName}
                </Text>
              </View>
            </View>
          )}

          {/* Media Carousel */}
          <FlatList
            ref={flatListRef}
            data={media}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={getItemLayout}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            bounces={false}
            decelerationRate="fast"
          />

          {/* Hint - only for photos */}
          {headerVisible && !isVideo && (
            <View style={[styles.hint, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.hintPill} />
              <Text style={styles.hintText}>Swipe down to close</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerContent: {
    alignItems: 'center',
  },
  counter: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  filename: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
    maxWidth: SCREEN_WIDTH - spacing.lg * 2,
  },
  mediaContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  hint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  hintPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  hintText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
  },
  closeButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
});
