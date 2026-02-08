// Minimal dark theme - neutral with single accent
export const colors = {
  // Backgrounds
  background: '#000000',
  surface: '#161616',
  surfaceSecondary: '#1C1C1C',

  // Primary accent (single color for focus)
  primary: '#007AFF',

  // Semantic states
  success: '#34C759',
  error: '#FF3B30',

  // Text hierarchy (3 levels)
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',

  // Borders (subtle)
  border: '#2C2C2E',
  separator: '#1C1C1E',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.8)',
} as const;
