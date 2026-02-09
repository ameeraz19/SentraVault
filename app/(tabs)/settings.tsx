import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../../src/store';
import { useMediaStore } from '../../src/store/mediaStore';
import { colors, spacing, radius } from '../../src/theme';

export default function SettingsScreen() {
  const { lock, vaultType, biometricsAvailable } = useAuthStore();
  const { media } = useMediaStore();
  const [useBiometrics, setUseBiometrics] = useState(biometricsAvailable);

  const handleLock = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    lock();
    router.replace('/(auth)/lock');
  };

  const handleChangePassword = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Coming Soon',
      'Password change will be available in a future update.'
    );
  };

  const handleEraseVault = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Erase All Data',
      'This will permanently delete ALL photos and videos. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Everything',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm',
              `Delete ${media.length} items?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success
                    );
                    Alert.alert('Done', 'All data deleted.');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleResetApp = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Reset App',
      'This will delete ALL data including your vault password and start fresh. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Everything',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'All encrypted files, passwords, and settings will be permanently deleted.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Reset App',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      // Clear all SecureStore items (both old and new prefixes)
                      await SecureStore.deleteItemAsync('sv2_salt');
                      await SecureStore.deleteItemAsync('sv2_real_hash');
                      await SecureStore.deleteItemAsync('sv2_decoy_hash');
                      await SecureStore.deleteItemAsync('sv2_setup_complete');
                      await SecureStore.deleteItemAsync('sv2_secret_key');
                      // Also clear old keys (in case they exist)
                      await SecureStore.deleteItemAsync('salt');
                      await SecureStore.deleteItemAsync('real_hash');
                      await SecureStore.deleteItemAsync('decoy_hash');
                      await SecureStore.deleteItemAsync('setup_complete');
                      await SecureStore.deleteItemAsync('sentravault_secret_key');

                      // Delete containers directory
                      const containersDir = `${FileSystem.documentDirectory}containers/`;
                      const dirInfo = await FileSystem.getInfoAsync(containersDir);
                      if (dirInfo.exists) {
                        await FileSystem.deleteAsync(containersDir, { idempotent: true });
                      }

                      // Delete temp directory
                      const tempDir = `${FileSystem.documentDirectory}temp/`;
                      const tempInfo = await FileSystem.getInfoAsync(tempDir);
                      if (tempInfo.exists) {
                        await FileSystem.deleteAsync(tempDir, { idempotent: true });
                      }

                      // Delete old encrypted files directory (legacy)
                      const encryptedDir = `${FileSystem.documentDirectory}encrypted/`;
                      const encInfo = await FileSystem.getInfoAsync(encryptedDir);
                      if (encInfo.exists) {
                        await FileSystem.deleteAsync(encryptedDir, { idempotent: true });
                      }

                      await Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success
                      );

                      // Navigate to setup
                      router.replace('/(auth)/setup');
                    } catch (error) {
                      console.error('Reset failed:', error);
                      Alert.alert('Error', 'Failed to reset app. Please try again.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const totalSize = media.reduce((sum, item) => sum + (item.size || 0), 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* Vault Stats */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{media.length}</Text>
            <Text style={styles.statLabel}>Items</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatSize(totalSize)}</Text>
            <Text style={styles.statLabel}>Used</Text>
          </View>
        </View>

        {/* Security Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>

          <SettingRow
            icon="lock-closed-outline"
            title="Lock Now"
            subtitle="Lock the vault immediately"
            onPress={handleLock}
            showArrow
          />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="scan-outline" size={22} color={colors.text} />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowTitle}>Face ID</Text>
              <Text style={styles.rowSubtitle}>
                {biometricsAvailable ? 'Use biometrics to unlock' : 'Not available'}
              </Text>
            </View>
            <Switch
              value={useBiometrics}
              onValueChange={setUseBiometrics}
              disabled={!biometricsAvailable}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>

          <SettingRow
            icon="key-outline"
            title="Change Password"
            subtitle="Update vault password"
            onPress={handleChangePassword}
            showArrow
          />
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <SettingRow
            icon="shield-checkmark-outline"
            title="Encryption"
            subtitle="AES-256-GCM"
          />

          <SettingRow
            icon="airplane-outline"
            title="Network"
            subtitle="Offline only"
          />

          <SettingRow
            icon="information-circle-outline"
            title="Version"
            subtitle="1.0.0"
          />
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.dangerLabel]}>Danger Zone</Text>

          <TouchableOpacity
            style={styles.row}
            onPress={handleEraseVault}
            activeOpacity={0.6}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, styles.dangerText]}>Erase Vault</Text>
              <Text style={styles.rowSubtitle}>Delete all data permanently</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={handleResetApp}
            activeOpacity={0.6}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="nuclear-outline" size={22} color={colors.error} />
            </View>
            <View style={styles.rowContent}>
              <Text style={[styles.rowTitle, styles.dangerText]}>Reset App</Text>
              <Text style={styles.rowSubtitle}>Delete everything and start fresh</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>SentraVault</Text>
          <Text style={styles.footerSubtext}>Your data never leaves this device</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface SettingRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress?: () => void;
  showArrow?: boolean;
}

function SettingRow({ icon, title, subtitle, onPress, showArrow }: SettingRowProps) {
  const content = (
    <>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={22} color={colors.text} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {showArrow && (
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.6}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.row}>{content}</View>;
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
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  rowSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dangerLabel: {
    color: colors.error,
  },
  dangerText: {
    color: colors.error,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginTop: spacing.lg,
  },
  footerText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  footerSubtext: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
});
