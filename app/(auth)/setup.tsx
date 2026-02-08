import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store';
import { colors, spacing, radius } from '../../src/theme';
import { Button, Input } from '../../src/components/ui';

export default function SetupScreen() {
  const [step, setStep] = useState<'real' | 'decoy' | 'confirm'>('real');
  const [realPassword, setRealPassword] = useState('');
  const [decoyPassword, setDecoyPassword] = useState('');
  const [confirmReal, setConfirmReal] = useState('');
  const [confirmDecoy, setConfirmDecoy] = useState('');
  const [loading, setLoading] = useState(false);

  const { setupVault, error, clearError } = useAuthStore();

  const handleNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearError();

    if (step === 'real') {
      if (realPassword.length < 6) {
        Alert.alert('Weak Password', 'Password must be at least 6 characters');
        return;
      }
      setStep('decoy');
    } else if (step === 'decoy') {
      if (decoyPassword.length < 6) {
        Alert.alert('Weak Password', 'Decoy password must be at least 6 characters');
        return;
      }
      if (decoyPassword === realPassword) {
        Alert.alert('Invalid', 'Decoy password must be different from real password');
        return;
      }
      setStep('confirm');
    } else {
      if (confirmReal !== realPassword) {
        Alert.alert('Mismatch', 'Real password confirmation does not match');
        return;
      }
      if (confirmDecoy !== decoyPassword) {
        Alert.alert('Mismatch', 'Decoy password confirmation does not match');
        return;
      }

      setLoading(true);
      const success = await setupVault(realPassword, decoyPassword);
      setLoading(false);

      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace('/(auth)/lock');
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  };

  const handleBack = () => {
    if (step === 'decoy') setStep('real');
    else setStep('decoy');
  };

  const renderStep = () => {
    if (step === 'real') {
      return (
        <View style={styles.formSection}>
          <Text style={styles.title}>Create Password</Text>
          <Text style={styles.subtitle}>
            This unlocks your real vault
          </Text>
          <Input
            placeholder="Enter password"
            secureTextEntry
            value={realPassword}
            onChangeText={setRealPassword}
            autoFocus
            style={styles.input}
          />
        </View>
      );
    }

    if (step === 'decoy') {
      return (
        <View style={styles.formSection}>
          <Text style={styles.title}>Create Decoy</Text>
          <Text style={styles.subtitle}>
            Opens a fake vault if forced to unlock
          </Text>
          <Input
            placeholder="Enter decoy password"
            secureTextEntry
            value={decoyPassword}
            onChangeText={setDecoyPassword}
            autoFocus
            style={styles.input}
          />
        </View>
      );
    }

    return (
      <View style={styles.formSection}>
        <Text style={styles.title}>Confirm</Text>
        <Text style={styles.subtitle}>Re-enter both passwords</Text>
        <Input
          placeholder="Real password"
          secureTextEntry
          value={confirmReal}
          onChangeText={setConfirmReal}
          autoFocus
          style={styles.input}
        />
        <View style={styles.inputSpacer} />
        <Input
          placeholder="Decoy password"
          secureTextEntry
          value={confirmDecoy}
          onChangeText={setConfirmDecoy}
          style={styles.input}
        />
      </View>
    );
  };

  const stepIndex = step === 'real' ? 0 : step === 'decoy' ? 1 : 2;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Minimal Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="lock-closed" size={28} color={colors.text} />
          </View>
          <Text style={styles.appName}>SentraVault</Text>
        </View>

        {/* Step Indicator - Simple dots */}
        <View style={styles.stepIndicator}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.stepDot,
                i === stepIndex && styles.stepDotActive,
                i < stepIndex && styles.stepDotComplete,
              ]}
            />
          ))}
        </View>

        {renderStep()}

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.buttonSection}>
          <Button
            title={loading ? 'Setting up...' : step === 'confirm' ? 'Create Vault' : 'Continue'}
            onPress={handleNext}
            disabled={loading}
            loading={loading}
          />

          {step !== 'real' && (
            <Button
              title="Back"
              variant="ghost"
              onPress={handleBack}
              style={styles.backButton}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  appName: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.5,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  stepDotComplete: {
    backgroundColor: colors.textTertiary,
  },
  formSection: {
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    textAlign: 'center',
  },
  inputSpacer: {
    height: spacing.md,
  },
  buttonSection: {
    gap: spacing.sm,
  },
  backButton: {
    marginTop: 0,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    fontSize: 14,
    marginBottom: spacing.md,
  },
});
