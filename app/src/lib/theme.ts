import { Platform } from 'react-native';

// Every colour the app uses lives in this file. Screens ask for tokens through useTheme(), never for
// raw values, so switching theme or accent restyles everything at once. Contrast is checked by
// tests/theme.test.ts for every theme and accent combination.

export type Scheme = 'light' | 'dark';
export type AccentName = 'iris' | 'ocean' | 'mint' | 'sunset' | 'rose';

type Accent = {
  label: string;
  /** Text, icons and outlines on the background. */
  light: string;
  dark: string;
  /** Filled buttons and your message bubbles, always with white text. Two stops for a soft gradient. */
  fill: string;
  fillLight: string;
  /** Text on a tinted (accentSoft) background in the light theme, where `light` would be too pale. */
  deep: string;
};

export const ACCENTS: Record<AccentName, Accent> = {
  iris: { label: 'Iris', light: '#5B4BD6', dark: '#8B7CFF', fill: '#5B4BD6', fillLight: '#6E64DC', deep: '#4E2ECA' },
  ocean: { label: 'Ocean', light: '#0369A1', dark: '#38BDF8', fill: '#0369A1', fillLight: '#037BB7', deep: '#024479' },
  mint: { label: 'Mint', light: '#047857', dark: '#34D399', fill: '#047857', fillLight: '#04845E', deep: '#035141' },
  sunset: { label: 'Sunset', light: '#BA3E0B', dark: '#FB923C', fill: '#C2410C', fillLight: '#D1430D', deep: '#9C410A' },
  rose: { label: 'Rose', light: '#BE123C', dark: '#FB7185', fill: '#BE123C', fillLight: '#E51651', deep: '#990E24' },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

const base = {
  light: {
    bg: '#F6F6F9',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EEEEF3',
    /** Selected segment, raised chip: one step above whatever it sits on. */
    surfaceHigh: '#FFFFFF',
    glass: 'rgba(255,255,255,0.88)',
    glassOpaque: '#FFFFFF',
    border: 'rgba(0,0,0,0.08)',
    borderStrong: 'rgba(0,0,0,0.14)',
    text: '#0B0B0F',
    textSecondary: '#55555F',
    textTertiary: '#66666F',
    success: '#126F34',
    warning: '#9C4806',
    danger: '#B91C1C',
    codeBg: '#F1F1F5',
    codeText: '#1F1F27',
    /** Syntax colours inside code blocks, all readable on codeBg. */
    synKeyword: '#B0245A',
    synString: '#14693A',
    synNumber: '#9A4A00',
    synComment: '#62626E',
    synFunction: '#5134C4',
    synType: '#0B6A8A',
    overlay: 'rgba(10,10,20,0.32)',
    shadow: '#1A1A2E',
    pressed: 'rgba(0,0,0,0.05)',
  },
  dark: {
    bg: '#000000',
    surface: '#0B0B0D',
    surfaceRaised: '#141417',
    surfaceSunken: '#141417',
    surfaceHigh: '#26262C',
    glass: 'rgba(16,16,20,0.86)',
    glassOpaque: '#141417',
    border: 'rgba(255,255,255,0.09)',
    borderStrong: 'rgba(255,255,255,0.16)',
    text: '#F5F5F7',
    textSecondary: '#A1A1AA',
    textTertiary: '#8E8E96',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#FB7185',
    codeBg: '#0F0F12',
    codeText: '#E4E4EA',
    synKeyword: '#FF7AB2',
    synString: '#8BD99A',
    synNumber: '#F7B267',
    synComment: '#8E8E9A',
    synFunction: '#A99BFF',
    synType: '#6CCFF6',
    overlay: 'rgba(0,0,0,0.6)',
    shadow: '#000000',
    pressed: 'rgba(255,255,255,0.06)',
  },
} as const;

/** Bots keep their own colour for their avatar and name. Decoration only: never behind text. */
export const BOT_COLORS = ['#7C6CFF', '#EC4899', '#22C55E', '#F59E0B', '#EF4444', '#06B6D4', '#A855F7', '#14B8A6', '#F97316', '#3B82F6'];

/** Fixed colours that don't change with the theme: the camera viewfinder is always dark, and marks on
 * an accent fill are always white. */
export const FIXED = {
  white: '#FFFFFF',
  camera: '#000000',
  cameraScrim: 'rgba(0,0,0,0.5)',
  cameraFrame: 'rgba(255,255,255,0.9)',
  onAccentFaint: 'rgba(255,255,255,0.5)',
  onAccentWash: 'rgba(0,0,0,0.22)',
};

/** The Winglet mark's tile, the same in every theme. */
export const BRAND = { from: '#8B6CFF', via: '#6C5CE7', to: '#3BA7FF', mark: '#FFFFFF', stroke: 'rgba(91,75,214,0.55)' };

/** The agent's face: dark eyes and mouth, a grey body when offline, light highlights. */
export const AVATAR = {
  ink: '#16131F',
  offline: '#71717A',
  shine: 'rgba(255,255,255,0.32)',
  cheek: 'rgba(255,255,255,0.3)',
  catchlight: '#FFFFFF',
};

export type Colors = {
  [K in keyof typeof base.light]: string;
} & {
  accent: string;
  accentFill: string;
  accentFillLight: string;
  onAccent: string;
  /** Text on a filled danger badge. */
  onDanger: string;
  accentSoft: string;
  onAccentSoft: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
};

export type Theme = {
  scheme: Scheme;
  accentName: AccentName;
  colors: Colors;
  radius: typeof radius;
  space: typeof space;
  fonts: typeof fonts;
  type: typeof type;
};

/** Hex colour at an alpha, as rgba(). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const SOFT_ALPHA = { light: 0.1, dark: 0.16 } as const;

export function buildColors(scheme: Scheme, accentName: AccentName): Colors {
  const b = base[scheme];
  const a = ACCENTS[accentName];
  const accent = scheme === 'light' ? a.light : a.dark;
  const soft = SOFT_ALPHA[scheme];
  return {
    ...b,
    accent,
    accentFill: a.fill,
    accentFillLight: a.fillLight,
    onAccent: '#FFFFFF',
    onDanger: scheme === 'light' ? '#FFFFFF' : '#000000',
    accentSoft: alpha(accent, soft),
    onAccentSoft: scheme === 'light' ? a.deep : a.dark,
    successSoft: alpha(b.success, soft),
    warningSoft: alpha(b.warning, soft),
    dangerSoft: alpha(b.danger, soft),
  };
}

export function buildTheme(scheme: Scheme, accentName: AccentName): Theme {
  return { scheme, accentName, colors: buildColors(scheme, accentName), radius, space, fonts, type };
}

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
};

export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Type scale. Body stays at 16 for reading; headings get tighter tracking. */
export const type = {
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 16 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.4, textTransform: 'uppercase' as const },
};

export const WIDE_BREAKPOINT = 900;
