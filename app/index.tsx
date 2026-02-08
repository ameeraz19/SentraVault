import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/store';

export default function Index() {
  const { authState } = useAuthStore();

  if (authState === 'setup') {
    return <Redirect href="/(auth)/setup" />;
  }

  if (authState === 'biometrics' || authState === 'password') {
    return <Redirect href="/(auth)/lock" />;
  }

  if (authState === 'unlocked') {
    return <Redirect href="/(tabs)/vault" />;
  }

  return <Redirect href="/(auth)/lock" />;
}
