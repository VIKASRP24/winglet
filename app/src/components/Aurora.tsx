import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from '../lib/motion';
import { avatarColor } from '../lib/pets';
import { useApp } from '../lib/store';
import { auroraColors, BOT_COLORS } from '../lib/theme';
import type { Server } from '../lib/types';
import { useTheme } from '../lib/themeContext';

type Blob = { color: string; x: number; y: number; size: number; drift: number; period: number };

/**
 * The soft light behind the landing, chats and screen headers: a few large blurred colour glows that drift slowly.
 * Decoration only. It never sits behind body text at a strength that hurts reading, and it holds still when motion is
 * reduced. `colors` are the glow colours (bot colour first); `strength` scales how much they show.
 */
export const Aurora = memo(function Aurora({ colors, strength = 1, style, still, top }: {
  colors: string[]; strength?: number; style?: StyleProp<ViewStyle>; still?: boolean;
  /** Only a glow along the top edge (behind a header), fading out well before the middle. */
  top?: boolean;
}) {
  const t = useTheme();
  const reduced = useReducedMotion() || !!still;
  const base = (t.scheme === 'dark' ? 0.42 : 0.3) * strength;
  const [a, b = a, c = b] = colors;
  const blobs: Blob[] = top ? [
    { color: a, x: -0.35, y: -0.55, size: 1.1, drift: 0.06, period: 16000 },
    { color: b, x: 0.4, y: -0.6, size: 1.0, drift: 0.08, period: 19000 },
  ] : [
    { color: a, x: -0.25, y: -0.18, size: 1.15, drift: 0.08, period: 14000 },
    { color: b, x: 0.45, y: -0.05, size: 1.0, drift: 0.1, period: 17000 },
    { color: c, x: 0.05, y: 0.32, size: 0.9, drift: 0.07, period: 21000 },
  ];
  const [size, setSize] = useState({ w: 0, h: 0 });
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}
    onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
    {size.w ? blobs.map((blob, i) => <Glow key={i} blob={blob} w={size.w} h={size.h} opacity={i === 2 ? base * 0.7 : base} reduced={reduced} />) : null}
  </View>;
});

function Glow({ blob, w, h, opacity, reduced }: { blob: Blob; w: number; h: number; opacity: number; reduced: boolean }) {
  const side = Math.max(w, Math.min(h, w * 1.6)) * blob.size;
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(phase); phase.value = 0; return; }
    phase.value = withRepeat(withTiming(1, { duration: blob.period, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(phase);
  }, [reduced, blob.period, phase]);
  const pose = useAnimatedStyle(() => ({
    transform: [
      { translateX: (phase.value - 0.5) * blob.drift * 2 * side },
      { translateY: (0.5 - phase.value) * blob.drift * 1.2 * side },
      { scale: 1 + phase.value * 0.12 },
    ],
  }));
  const id = `aurora-${blob.color.replace(/\W/g, '')}-${blob.period}`;
  return <Animated.View style={[{ position: 'absolute', left: blob.x * w, top: blob.y * side, width: side, height: side }, pose]}>
    <Svg width={side} height={side} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={id} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={blob.color} stopOpacity={opacity} />
          <Stop offset="0.45" stopColor={blob.color} stopOpacity={opacity * 0.45} />
          <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
    </Svg>
  </Animated.View>;
}

/** Glow colours for a bot (or the selected one): its own colour leads, so each bot's screens feel like its own. */
export function useAuroraColors(server?: Server): string[] {
  const t = useTheme();
  const color = useApp((st) => {
    const bot = server ?? st.servers.find((x) => x.id === st.selection.serverId) ?? st.servers[0];
    return bot ? avatarColor(BOT_COLORS, bot.bot.name, st.runtime[bot.id]?.pet) : undefined;
  });
  return useMemo(() => auroraColors(color ?? t.colors.accent, t.colors.accent), [color, t.colors.accent]);
}
