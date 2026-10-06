import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '../lib/themeContext';
import { ChevronLeft } from './icons';
import { IconButton } from './ui';

/** A pushed screen: back button, large title, and a centred scrolling column. */
export function Screen({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <IconButton label="Back" variant="filled" onPress={() => (router.canGoBack() ? router.back() : router.replace('/agent'))}>
            <ChevronLeft size={24} color={t.colors.text} />
          </IconButton>
          {right}
        </View>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  title: { ...t.type.display, color: t.colors.text, marginTop: 12 },
  subtitle: { ...t.type.callout, color: t.colors.textSecondary, marginTop: 6 },
}));
