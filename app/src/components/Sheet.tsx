import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLock } from '../lib/appLock';
import { haptic } from '../lib/haptics';
import { spring, useReducedMotion } from '../lib/motion';
import { alpha } from '../lib/theme';
import { makeStyles, useTheme } from '../lib/themeContext';
import { Glass } from './Glass';
import { X } from './icons';
import { Tap } from './ui';

/** Leaving is quicker than arriving, and never bounces back up past the bottom edge. */
const LEAVE = { ...spring.snappy, overshootClamping: true };

/**
 * A bottom sheet: a frosted pane that springs up over a fading scrim, drags down to dismiss, closes on
 * the backdrop or the back button. On wide screens it becomes a centred dialog.
 */
export function Sheet({ visible, onClose, onDismiss, title, children, scrollable = false }: {
  visible: boolean; onClose: () => void; onDismiss?: () => void; title?: string; children: ReactNode;
  scrollable?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;
  const reduced = useReducedMotion();
  const locked = useLock((st) => st.locked);
  const [mounted, setMounted] = useState(visible);
  const keyboard = useKeyboardHeight(visible);
  const y = useSharedValue(height);
  const fade = useSharedValue(0);
  const dismissed = () => { setMounted(false); onDismiss?.(); };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      haptic.light();
      fade.value = withTiming(1, { duration: reduced ? 0 : 220 });
      y.value = reduced ? 0 : withSpring(0, spring.soft);
    } else if (mounted) {
      fade.value = withTiming(0, { duration: reduced ? 0 : 200 });
      if (reduced) y.value = withTiming(0, { duration: 0 }, (done) => { if (done) runOnJS(dismissed)(); });
      else y.value = withSpring(height, LEAVE, (done) => { if (done) runOnJS(dismissed)(); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-20, 20])
    .onUpdate((e) => { y.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) runOnJS(onClose)();
      else y.value = withSpring(0, spring.soft);
    })
    .onFinalize((_e, success) => { if (!success) y.value = withSpring(0, spring.soft); });

  const panel = useAnimatedStyle(() => {
    // How far through arriving it is, 0 (offscreen) to 1 (in place): the pane grows into place as it rises.
    const p = 1 - Math.min(1, Math.max(0, y.value) / Math.max(1, height));
    return wide
      ? { opacity: fade.value, transform: [{ translateY: y.value * 0.12 }, { scale: 0.94 + 0.06 * p }] }
      : { transform: [{ translateY: y.value }, { scale: 0.97 + 0.03 * p }] };
  });
  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));

  // A native modal sits above the lock screen: unmount it while locked. An open sheet comes back on unlocking.
  if (!mounted || locked) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close sheet" onPress={onClose} />
        </Animated.View>
        <View style={[s.host, wide && s.hostWide, keyboard ? { paddingBottom: keyboard } : null]} pointerEvents="box-none">
          <Animated.View style={[s.panel, { maxHeight: Math.max(0, height - Math.max(insets.top, 12) - 12 - keyboard) }, wide && s.panelWide, panel]} accessibilityViewIsModal>
            <Glass intensity={60} style={[s.glass, wide && s.glassWide, { paddingBottom: wide ? 20 : keyboard ? 12 : insets.bottom + 16 }]}>
              <GestureDetector gesture={pan}>
                <View style={s.handle}>
                  {wide ? null : <View style={s.grabber} />}
                  <View style={s.heading}>
                    <Text style={s.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
                    <Tap accessibilityRole="button" accessibilityLabel="Close sheet" hitSlop={6} scaleTo={0.9} feedback="selection" onPress={onClose}
                      style={({ pressed, hovered }) => [s.close, (pressed || hovered) && { backgroundColor: t.colors.pressed }]}>
                      <X size={18} color={t.colors.textSecondary} />
                    </Tap>
                  </View>
                </View>
              </GestureDetector>
              {scrollable ? <ScrollView style={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">{children}</ScrollView>
                : <View style={s.content}>{children}</View>}
            </Glass>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The keyboard's height while a sheet is open. A sheet is a native modal drawn edge to edge, so its window
 * doesn't shrink for the keyboard: a text field in it would sit behind the keys without this.
 */
function useKeyboardHeight(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    setHeight(Keyboard.metrics?.()?.height ?? 0);
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); setHeight(0); };
  }, [active]);
  return height;
}

/**
 * A slim frosted pill that floats over a chat: goal, task progress, connection and sync notes, the branch line.
 * Purely visual: the caller wraps it in whatever it needs to be (a button, an alert). The shadow sits outside
 * the glass, which clips its own corners.
 */
export function FloatingPill({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={s.pillShadow}><Glass intensity={50} style={[s.pill, style]}>{children}</Glass></View>;
}

/** A frosted group of sheet rows: related actions sit together, so a long menu reads as a few short ones.
 * Renders nothing when every row in it is hidden. */
export function SheetGroup({ children }: { children: ReactNode }) {
  const s = useStyles();
  if (!Children.toArray(children).some(Boolean)) return null;
  return <View style={s.group}>{children}</View>;
}

/** One action row inside a sheet: its icon in a soft circle, then the label. A disabled row keeps its
 * explanation visible instead of silently disappearing (offline, busy, an older server). */
export function SheetAction({ icon, label, onPress, destructive, disabled, hint }: {
  icon?: ReactNode; label: string; onPress: () => void; destructive?: boolean; disabled?: boolean; hint?: string;
}) {
  const t = useTheme();
  const s = useStyles();
  const tint = destructive ? t.colors.danger : t.colors.text;
  return (
    <Tap accessibilityRole="button" accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ disabled: !!disabled }} disabled={!!disabled} scaleTo={0.98}
      onPress={() => { haptic.selection(); onPress(); }}
      style={({ pressed, hovered }) => [s.action, disabled && { opacity: 0.5 }, (pressed || hovered) && !disabled && { backgroundColor: t.colors.pressed }]}>
      {icon ? <View style={[s.actionIcon, { backgroundColor: destructive ? t.colors.dangerSoft : alpha(t.colors.text, t.scheme === 'dark' ? 0.08 : 0.06) }]}>
        {isValidElement(icon) ? cloneElement(icon as ReactElement<{ color?: string; size?: number }>, { size: 19, color: tint }) : icon}
      </View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.actionText, destructive && { color: t.colors.danger }]}>{label}</Text>
        {hint ? <Text style={[s.actionHint, destructive && { color: t.colors.danger }]}>{hint}</Text> : null}
      </View>
    </Tap>
  );
}

const useStyles = makeStyles((t) => ({
  host: { flex: 1, justifyContent: 'flex-end' },
  hostWide: { justifyContent: 'center', alignItems: 'center', padding: t.space.xl },
  panel: {
    width: '100%', flexShrink: 1,
    shadowColor: t.colors.shadow, shadowOpacity: t.scheme === 'light' ? 0.14 : 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: -6 },
  },
  panelWide: { maxWidth: 640, shadowOffset: { width: 0, height: 16 } },
  glass: {
    borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, paddingHorizontal: t.space.lg, paddingTop: t.space.sm,
    flexShrink: 1,
  },
  glassWide: { borderRadius: t.radius.xl, paddingTop: t.space.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.borderStrong, marginBottom: t.space.md },
  handle: { flexShrink: 0 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingLeft: t.space.xs, marginBottom: t.space.md },
  title: { ...t.type.title, fontSize: 20, lineHeight: 26, color: t.colors.text, flex: 1 },
  close: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.pill,
    backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  content: { flexShrink: 1, minHeight: 0 },
  pillShadow: {
    borderRadius: t.radius.pill,
    shadowColor: t.colors.shadow, shadowOpacity: t.scheme === 'light' ? 0.1 : 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  pill: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 44, borderRadius: t.radius.pill, elevation: 3 },
  group: {
    padding: t.space.xs, marginBottom: t.space.md, borderRadius: t.radius.lg,
    backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderRadius: t.radius.md },
  actionIcon: { width: 36, height: 36, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...t.type.body, fontFamily: t.fonts.medium, color: t.colors.text },
  actionHint: { ...t.type.caption, color: t.colors.textSecondary, marginTop: 2 },
}));
