import { TextStyle } from 'react-native';
import { colors } from './colors';

// Typography scale for consistent text hierarchy
export const typography = {
  // Large page titles
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  } as TextStyle,

  // Section titles
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.3,
  } as TextStyle,

  // Body text
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.text,
    lineHeight: 24,
  } as TextStyle,

  // Secondary body text
  bodySecondary: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 24,
  } as TextStyle,

  // Small labels and captions
  caption: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 18,
  } as TextStyle,

  // Section labels (uppercase)
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } as TextStyle,

  // Button text
  button: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  } as TextStyle,
} as const;
