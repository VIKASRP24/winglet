import { BlurView } from 'expo-blur';
import type { ReactNode, RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedTransparency } from '../lib/motion';
import { useTheme } from '../lib/themeContext';

/**
 * Frosted glass for floating chrome only (tab bar, headers, composer, sheets, toasts), never behind
 * body text. Falls back to a solid surface when transparency is reduced. On Android a real blur needs
 * the content behind it wrapped in a BlurTargetView, passed here as `target`.
 */
export function Glass({ children, style, target, intensity = 40, borderless }: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; target?: RefObject<View | null>; intensity?: number; borderless?: boolean;
}) {
  const t = useTheme();
  const reduced = useReducedTransparency();
  const border = borderless ? null : { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.colors.border };
  if (reduced) {
    return <View style={[{ backgroundColor: t.colors.glassOpaque, overflow: 'hidden' }, border, style]}>{children}</View>;
  }
  if (Platform.OS === 'web') {
    const glass = { backgroundColor: t.colors.glass, backdropFilter: 'blur(24px) saturate(170%)', WebkitBackdropFilter: 'blur(24px) saturate(170%)' };
    return <View style={[glass as ViewStyle, { overflow: 'hidden' }, border, style]}>{children}</View>;
  }
  if (Platform.OS === 'android' && !target) {
    // No blur target: a near-solid tint reads cleanly over busy content.
    return <View style={[{ backgroundColor: t.colors.glassOpaque, opacity: 1, overflow: 'hidden' }, border, style]}>{children}</View>;
  }
  return (
    <View style={[{ overflow: 'hidden' }, border, style]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint={t.scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={target}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.glass }]} />
      {children}
    </View>
  );
}
