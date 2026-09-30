import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Toasts } from '../components/Toasts';
import { registerServiceWorker } from '../lib/push';
import { useApp } from '../lib/store';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const setForeground = useApp((s) => s.setForeground);

  useEffect(() => {
    init();
    registerServiceWorker();
  }, [init]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVis = () => setForeground(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, [setForeground]);

  // A font that fails to load falls back to the system font rather than a blank screen.
  if ((!fontsLoaded && !fontError) || !ready) return <View style={{ flex: 1, backgroundColor: colors.rail }} />;

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.rail }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.chat }, animation: 'slide_from_right' }} />
      <Toasts />
    </SafeAreaProvider>
  );
}
