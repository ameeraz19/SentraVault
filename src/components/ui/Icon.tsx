import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
}

const sizes = {
  sm: 18,
  md: 24,
  lg: 28,
  xl: 32,
};

export function Icon({ name, size = 'md', color = colors.text }: IconProps) {
  return <Ionicons name={name} size={sizes[size]} color={color} />;
}
