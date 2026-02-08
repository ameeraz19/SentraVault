import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store';
import { colors, spacing, radius } from '../../src/theme';
import { Button, Input } from '../../src/components/ui';

export default function LockScreen() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const {
    authState,
    error,
    biometricsAvailable,
    authenticateBiometrics,
    authenticatePassword,
    clearError,
  } = useAuthStore();

  useEffect(() => {
    if (authState === 'biometrics' && biometricsAvailable) {
      handleBiometrics();
    }
  }, [authState]);

  const handleBiometrics = async () => {
    const success = await authenticateBiometrics();
    if (success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password.trim()) return;

    clearError();
    setHasError(false);
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const success = await authenticatePassword(password);
    setLoading(false);

    if (success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/vault');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setHasError(true);
      setPassword('');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          {/* Minimal Logo */}
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Ionicons name="lock-closed" size={32} color={colors.text} />
            </View>
            <Text style={styles.appName}>SentraVault</Text>
          </View>

          {authState === 'biometrics' ? (
            <View style={styles.biometricSection}>
              <TouchableOpacity
                style={styles.biometricButton}
                onPress={handleBiometrics}
                activeOpacity={0.7}
              >
                <Ionicons name="scan-outline" size={48} color={colors.primary} />
              </TouchableOpacity>
              <Text style={styles.biometricText}>Tap to unlock with Face ID</Text>
            </View>
          ) : (
            <View style={styles.passwordSection}>
              <Input
                placeholder="Enter password"
                secureTextEntry
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setHasError(false);
                }}
                onSubmitEditing={handlePasswordSubmit}
                autoFocus
                editable={!loading}
                error={hasError}
                style={styles.input}
              />

              <Button
                title={loading ? 'Unlocking...' : 'Unlock'}
                onPress={handlePasswordSubmit}
                disabled={loading || !password.trim()}
                loading={loading}
              />

              {error && (
                <Text style={styles.errorText}>{error}</Text>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  appName: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.5,
  },
  biometricSection: {
    alignItems: 'center',
    width: '100%',
  },
  biometricButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  biometricText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  passwordSection: {
    width: '100%',
    maxWidth: 320,
    gap: spacing.md,
  },
  input: {
    textAlign: 'center',
    letterSpacing: 2,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
