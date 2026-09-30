import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, fonts, gradients, radius } from '../lib/theme';

export function tap() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
}

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'md' | 'lg' | 'sm';
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, size = 'md' }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const height = size === 'lg' ? 52 : size === 'sm' ? 34 : 42;
  const bg = {
    primary: hover ? colors.accentHover : colors.accent,
    secondary: hover ? '#6D6F78' : '#4E5058',
    danger: hover ? '#C03537' : '#DA373C',
    success: hover ? '#1A8B4A' : colors.green,
    ghost: hover ? colors.hover : 'transparent',
  }[variant];
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress?.();
      }}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { height, backgroundColor: bg, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        size === 'sm' && { paddingHorizontal: 12 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : icon}
      {!loading || !icon ? (
        <Text style={[styles.buttonText, size === 'sm' && { fontSize: 13.5 }, size === 'lg' && { fontSize: 16 }]}>{title}</Text>
      ) : null}
    </Pressable>
  );
}

export function GradientButton({ title, onPress, icon, loading, disabled, style }: ButtonProps) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress?.();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [{ borderRadius: radius.md, overflow: 'hidden', opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      <LinearGradient colors={gradients.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, { height: 52 }]}>
        {loading ? <ActivityIndicator color={colors.white} /> : icon}
        <Text style={[styles.buttonText, { fontSize: 16 }]}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function Row({ children, onPress, active, style, onLongPress }: {
  children: ReactNode; onPress?: () => void; active?: boolean; style?: StyleProp<ViewStyle>; onLongPress?: PressableProps['onLongPress'];
}) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.row,
        (hover || pressed) && { backgroundColor: colors.hover },
        active && { backgroundColor: colors.active },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string; hint?: string }) {
  const [focus, setFocus] = useState(false);
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...rest}
        onFocus={(e) => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        style={[styles.input, focus && { borderColor: colors.accent }, style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  if (!count) return null;
  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>{children}</Text>
      {right}
    </View>
  );
}

export function IconButton({ children, onPress, label, style }: { children: ReactNode; onPress?: () => void; label: string; style?: StyleProp<ViewStyle> }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress?.();
      }}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (hover || pressed) && { backgroundColor: colors.hover }, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, paddingHorizontal: 18,
  },
  buttonText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.sm + 2 },
  label: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  hint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: colors.rail, color: colors.text, fontFamily: fonts.medium, fontSize: 16, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'transparent',
  },
  badge: {
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 11 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 18, paddingBottom: 6 },
  sectionText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  iconButton: { width: 36, height: 36, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
});
