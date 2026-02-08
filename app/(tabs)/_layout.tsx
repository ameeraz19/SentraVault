import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabIconProps {
  name: IconName;
  focused: boolean;
}

function TabIcon({ name, focused }: TabIconProps) {
  return (
    <Ionicons
      name={name}
      size={24}
      color={focused ? colors.primary : colors.textTertiary}
    />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="vault"
        options={{
          title: 'Vault',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'lock-closed' : 'lock-closed-outline'}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="usb"
        options={{
          title: 'Files',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'folder' : 'folder-outline'}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              name={focused ? 'settings' : 'settings-outline'}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
