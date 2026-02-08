import { TextInput, StyleSheet, TextInputProps, View, Text } from 'react-native';
import { colors, spacing, radius } from '../../theme';

interface InputProps extends TextInputProps {
  error?: boolean;
  errorMessage?: string;
}

export function Input({ error, errorMessage, style, ...props }: InputProps) {
  return (
    <View>
      <TextInput
        style={[styles.input, error && styles.inputError, style]}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        {...props}
      />
      {error && errorMessage && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 56,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
});
