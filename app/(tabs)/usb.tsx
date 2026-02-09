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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store';
import { useMediaStore } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';
import { getContainerPath } from '../../src/utils/containerFormat';

export default function USBScreen() {
  const { vaultType, getCredentials } = useAuthStore();
  const { media, exportVault, exportSelection } = useMediaStore();

  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'exportAll' | 'exportSelection' | null>(null);

  // Export entire vault (share the container file)
  const handleExportAll = async () => {
    if (media.length === 0) {
      Alert.alert('Empty Vault', 'Your vault is empty. Add some files first.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Alert.alert(
      'Export Vault',
      `Share your entire vault (${media.length} items) as a .svault file?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            setLoading(true);
            setAction('exportAll');
            try {
              const vaultPath = await exportVault();

              const isAvailable = await Sharing.isAvailableAsync();
              if (!isAvailable) {
                Alert.alert('Error', 'Sharing is not available on this device');
                return;
              }

              await Sharing.shareAsync(vaultPath, {
                mimeType: 'application/octet-stream',
                dialogTitle: 'Export Vault',
                UTI: 'public.data',
              });

              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error('Export failed:', error);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'Failed to export vault');
            } finally {
              setLoading(false);
              setAction(null);
            }
          },
        },
      ]
    );
  };

  // Export selected items (create new .svault with selection)
  const handleExportSelection = async () => {
    if (media.length === 0) {
      Alert.alert('Empty Vault', 'Your vault is empty. Add some files first.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // For now, export all - in future can add selection UI
    const credentials = getCredentials();
    if (!credentials) {
      Alert.alert('Error', 'Not authenticated');
      return;
    }

    Alert.alert(
      'Export Selection',
      'This will create a new .svault file with all items. In a future update, you can select specific items to export.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export All',
          onPress: async () => {
            setLoading(true);
            setAction('exportSelection');
            try {
              const allIds = media.map((m) => m.id);
              const exportPath = await exportSelection(
                allIds,
                credentials.password,
                credentials.secretKey
              );

              const isAvailable = await Sharing.isAvailableAsync();
              if (!isAvailable) {
                Alert.alert('Error', 'Sharing is not available on this device');
                return;
              }

              await Sharing.shareAsync(exportPath, {
                mimeType: 'application/octet-stream',
                dialogTitle: 'Export Selection',
                UTI: 'public.data',
              });

              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error('Export failed:', error);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Error', 'Failed to export selection');
            } finally {
              setLoading(false);
              setAction(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Backup</Text>
          <Text style={styles.subtitle}>{media.length} items in vault</Text>
        </View>

        {/* Export Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Export Options</Text>

          <ActionRow
            icon="cloud-download-outline"
            title="Export Entire Vault"
            subtitle="Share your vault.svault file"
            onPress={handleExportAll}
            loading={loading && action === 'exportAll'}
            disabled={loading || media.length === 0}
          />

          <ActionRow
            icon="document-attach-outline"
            title="Export Selection"
            subtitle="Create new .svault with selected items"
            onPress={handleExportSelection}
            loading={loading && action === 'exportSelection'}
            disabled={loading || media.length === 0}
          />
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>About .svault files</Text>
              <Text style={styles.infoText}>
                Your vault is stored as an encrypted .svault file. You can share this file to back
                it up, then import it later using the + button on the Vault tab.
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Secure & Encrypted</Text>
              <Text style={styles.infoText}>
                Files are encrypted with AES-256. You'll need your password to access them on
                another device.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
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
  infoSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
