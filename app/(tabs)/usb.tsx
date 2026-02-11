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
import * as DocumentPicker from 'expo-document-picker';
import { useAuthStore } from '../../src/store';
import { useMediaStore } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';

export default function USBScreen() {
  const { vaultType } = useAuthStore();
  const { media, exportVault, importSvaultFile } = useMediaStore();

  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'export' | 'import' | null>(null);

  // Export entire vault backup
  const handleExportBackup = async () => {
    if (media.length === 0) {
      Alert.alert('Empty Vault', 'Your vault is empty. Add some files first.');
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Alert.alert(
      'Export Backup',
      `Export your entire vault (${media.length} items) as a .svault backup file?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            setLoading(true);
            setAction('export');
            try {
              const vaultPath = await exportVault();

              const isAvailable = await Sharing.isAvailableAsync();
              if (!isAvailable) {
                Alert.alert('Error', 'Sharing is not available on this device');
                return;
              }

              await Sharing.shareAsync(vaultPath, {
                mimeType: 'application/octet-stream',
                dialogTitle: 'Export Vault Backup',
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

  // Import from .svault file
  const handleImportSvault = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Pick .svault file
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];

      // Check if it's a .svault file
      if (!file.name.endsWith('.svault') && !file.name.endsWith('.vault')) {
        Alert.alert(
          'Invalid File',
          'Please select a .svault or .vault backup file.',
          [{ text: 'OK' }]
        );
        return;
      }

      Alert.alert(
        'Import Backup',
        `Import items from "${file.name}"? This will add them to your current vault.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              setLoading(true);
              setAction('import');
              try {
                const importedCount = await importSvaultFile(file.uri);

                if (importedCount > 0) {
                  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Success', `Imported ${importedCount} item(s) from backup.`);
                } else {
                  Alert.alert('No Items', 'No items were imported. The file may be empty or incompatible.');
                }
              } catch (error) {
                console.error('Import failed:', error);
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert(
                  'Import Failed',
                  'Failed to import the backup. Make sure the file is a valid .svault backup and you are using the correct password.'
                );
              } finally {
                setLoading(false);
                setAction(null);
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('File picker error:', error);
      Alert.alert('Error', 'Failed to pick file');
    }
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

        {/* Actions Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Backup & Restore</Text>

          <ActionRow
            icon="cloud-upload-outline"
            title="Export Backup"
            subtitle="Save your entire vault as a .svault file"
            onPress={handleExportBackup}
            loading={loading && action === 'export'}
            disabled={loading || media.length === 0}
            color={colors.primary}
          />

          <ActionRow
            icon="cloud-download-outline"
            title="Import from Backup"
            subtitle="Restore from a .svault file"
            onPress={handleImportSvault}
            loading={loading && action === 'import'}
            disabled={loading}
            color={colors.success}
          />
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>About .svault files</Text>
              <Text style={styles.infoText}>
                Your vault is stored as an encrypted .svault file. Export it to back up your data,
                then import it on this or another device.
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

          <View style={styles.infoCard}>
            <Ionicons name="share-outline" size={24} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Export Selection</Text>
              <Text style={styles.infoText}>
                To export specific items, go to Vault tab, long-press to select items, then tap
                the share icon.
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
  color?: string;
}

function ActionRow({ icon, title, subtitle, onPress, loading, disabled, color }: ActionRowProps) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, disabled && styles.actionRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
    >
      <View style={[styles.actionIcon, color && { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={22} color={disabled ? colors.textTertiary : (color || colors.text)} />
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
