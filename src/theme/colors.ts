// Premium dark theme - sophisticated, deep, and vibrant
export const colors = {
  // Backgrounds
  background: '#050505', // Almost black, very deep grey
  surface: '#121212', // Material Dark standard
  surfaceSecondary: '#1E1E1E', // Slightly lighter for cards/inputs
  surfaceTertiary: '#2C2C2E', // For modals or elevated surfaces

  // Primary accent (Vibrant Blue-Violet gradient feel)
  primary: '#4D88FF', // Bright, legible blue
  primaryDark: '#0055D4', // Darker shade for press states
  primaryLight: '#8FB5FF', // Lighter shade for highlights

  // Semantic states
  success: '#32D74B', // iOS green
  error: '#FF453A', // iOS red
  warning: '#FFD60A', // iOS yellow
  info: '#64D2FF', // iOS cyan

  // Text hierarchy
  text: '#FFFFFF',
  textSecondary: '#EBEBF5', // 60% white
  textTertiary: '#EBEBF599', // 30% white (using hex alpha for better blending)

  // Borders & Separators
  border: '#38383A',
  separator: '#38383A', // Subtle divider

  // Overlays & Glass
  overlay: 'rgba(0, 0, 0, 0.75)',
  glass: 'rgba(30, 30, 30, 0.6)', // For blur effects
} as const;
