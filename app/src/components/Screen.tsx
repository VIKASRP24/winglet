import { router } from 'expo-router';
import { useContext, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../lib/haptics';
import { makeStyles, useTheme } from '../lib/themeContext';
import { Aurora, useAuroraColors } from './Aurora';
import { Glass } from './Glass';
import { ArrowLeft } from './icons';
import { IconButton } from './ui';
import { ServerScreenContext } from '../lib/serverScreenContext';

const StyleSheetFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);
/** How far the large title scrolls before the small one takes over in the bar. */
const TITLE_SWAP = 44;

/**
 * A pushed screen: a sticky bar with a back arrow, then a large title that scrolls with the content and hands over to a
 * small one in the bar. Pull down to refresh it. `subtitle` is one short line of context (whose screen this is), never
 * an explanation: see docs/DESIGN.md.
 */
export function Screen({ title, subtitle, children, right, onRefresh }: {
  title: string; subtitle?: string; children: ReactNode; right?: ReactNode;
  /** Reload what the screen shows; the spinner stays until it's done. */
  onRefresh?: () => unknown;
}) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const bot = useContext(ServerScreenContext);
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const small = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [TITLE_SWAP - 12, TITLE_SWAP + 8], [0, 1], 'clamp') }));
  const rule = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, TITLE_SWAP + 8], [0, 1], 'clamp') }));
  // The glow sits behind the large title and slides away with it.
  const glow = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, y.value) * 0.6 }] }));
  const aurora = useAuroraColors();
  const refresh = async () => {
    haptic.soft();
    setRefreshing(true);
    try {
      await Promise.all([Promise.resolve(onRefresh?.()).catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
    } finally {
      setRefreshing(false);
    }
  };
  const context = subtitle ?? bot;
  return (
    <View style={s.root}>
      <Animated.View pointerEvents="none" style={[s.glow, glow]}><Aurora colors={aurora} strength={0.7} /></Animated.View>
      <View style={[s.bar, { paddingTop: insets.top + 4 }]}>
        <Animated.View style={[StyleSheetFill, rule]}><Glass borderless style={StyleSheetFill} /></Animated.View>
        <View style={s.barInner}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/agent'))}>
            <ArrowLeft size={22} color={t.colors.text} />
          </IconButton>
          <Animated.Text style={[s.smallTitle, small]} numberOfLines={1} accessible={false}>{title}</Animated.Text>
          {right ? <View style={s.actions}>{right}</View> : null}
        </View>
        <Animated.View style={[s.rule, rule]} />
      </View>
      <AnimatedScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} colors={[t.colors.accentFill]}
            progressBackgroundColor={t.colors.surfaceRaised} />
        ) : undefined}>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        {context ? <Text style={s.subtitle} numberOfLines={2} accessibilityLabel={!subtitle && bot ? `Managing ${bot}` : undefined}>{context}</Text> : null}
        <View style={s.body}>{children}</View>
      </AnimatedScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  bar: { zIndex: 2 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 380 },
  barInner: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 52, paddingHorizontal: 8, maxWidth: 696, width: '100%', alignSelf: 'center' },
  smallTitle: { ...t.type.heading, color: t.colors.text, flex: 1, minWidth: 0, marginLeft: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rule: { height: 1, backgroundColor: t.colors.border },
  content: { paddingHorizontal: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  title: { ...t.type.display, color: t.colors.text, marginTop: 4 },
  subtitle: { ...t.type.callout, color: t.colors.textSecondary, marginTop: 4 },
  body: { paddingTop: 4 },
}));
