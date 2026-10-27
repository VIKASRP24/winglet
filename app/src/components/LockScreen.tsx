import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { unlock, useLock } from '../lib/appLock';
import { spring, useReducedMotion } from '../lib/motion';
import { makeStyles, useTheme } from '../lib/themeContext';
import { Aurora, useAuroraColors } from './Aurora';
import { Glass } from './Glass';
import { Fingerprint } from './icons';
import { Logo } from './Logo';
import { Button } from './ui';

/** Covers everything while the app is locked, and asks for the phone's own unlock straight away. */
export function LockScreen() {
  const locked = useLock((st) => st.locked);
  useEffect(() => {
    if (locked) unlock();
  }, [locked]);
  if (!locked) return null;
  return <Cover />;
}

function Cover() {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
  const glow = useAuroraColors();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(y); y.value = 0; return; }
    y.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const float = useAnimatedStyle(() => ({ transform: [{ translateY: (y.value - 0.5) * 10 }] }));
  const enter = reduced ? undefined : FadeInDown.delay(120).springify().damping(spring.soft.damping).stiffness(spring.soft.stiffness);
  return (
    <View style={s.cover} accessibilityViewIsModal>
      <Aurora colors={glow} strength={1.2} />
      <Animated.View style={[s.mark, float]}>
        <View style={[s.halo, { backgroundColor: t.colors.accentSoft }]} />
        <Logo size={84} />
      </Animated.View>
      <Text style={s.title} accessibilityRole="header">Winglet is locked</Text>
      <Animated.View entering={enter} style={s.panelWrap}>
        <Glass style={s.panel}>
          <View style={s.print} accessible={false}>
            <Fingerprint size={30} color={t.colors.onAccentSoft} />
          </View>
          <Button title="Unlock" size="lg" style={{ alignSelf: 'stretch' }} icon={<Fingerprint size={20} color={t.colors.onAccent} />} onPress={() => unlock()} />
        </Glass>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: t.colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: t.space.xl, padding: t.space.xxl,
  },
  mark: { alignItems: 'center', justifyContent: 'center', width: 140, height: 140 },
  halo: { position: 'absolute', width: 140, height: 140, borderRadius: t.radius.pill },
  title: { ...t.type.hero, color: t.colors.text, textAlign: 'center' },
  panelWrap: { width: '100%', maxWidth: 340 },
  panel: { borderRadius: t.radius.xl, padding: t.space.xl, gap: t.space.xl, alignItems: 'center' },
  print: { width: 64, height: 64, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
}));
