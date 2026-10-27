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
  iris: { label: 'Iris', light: '#5B4BD6', dark: '#988CFF', fill: '#5B4BD6', fillLight: '#6E64DC', deep: '#4E2ECA' },
  ocean: { label: 'Ocean', light: '#0369A1', dark: '#38BDF8', fill: '#0369A1', fillLight: '#037BB7', deep: '#024479' },
  mint: { label: 'Mint', light: '#047857', dark: '#34D399', fill: '#047857', fillLight: '#04845E', deep: '#035141' },
  sunset: { label: 'Sunset', light: '#BA3E0B', dark: '#FB923C', fill: '#C2410C', fillLight: '#D1430D', deep: '#9C410A' },
  rose: { label: 'Rose', light: '#BE123C', dark: '#FB7185', fill: '#BE123C', fillLight: '#E51651', deep: '#990E24' },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

const base = {
  light: {
    bg: '#F5F5F7',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#ECECF1',
    /** Selected segment, raised chip: one step above whatever it sits on. */
    surfaceHigh: '#FFFFFF',
    glass: 'rgba(255,255,255,0.64)',
    glassOpaque: '#FFFFFF',
    /** The lit edge and top sheen of glass. */
    glassBorder: 'rgba(255,255,255,0.75)',
    glassSheen: 'rgba(255,255,255,0.55)',
    /** Grouped lists and cards: a frosted pane that lets the screen's glow through. */
    card: 'rgba(255,255,255,0.72)',
    cardBorder: 'rgba(0,0,0,0.06)',
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
    bg: '#09090B',
    surface: '#131316',
    surfaceRaised: '#1A1A1F',
    surfaceSunken: '#1A1A1F',
    surfaceHigh: '#26262D',
    glass: 'rgba(24,24,30,0.58)',
    glassOpaque: '#1A1A1F',
    glassBorder: 'rgba(255,255,255,0.10)',
    glassSheen: 'rgba(255,255,255,0.07)',
    card: 'rgba(255,255,255,0.05)',
    cardBorder: 'rgba(255,255,255,0.08)',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.14)',
    text: '#F5F5F7',
    textSecondary: '#A1A1AA',
    textTertiary: '#8E8E96',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#FB7185',
    codeBg: '#0E0E11',
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

/** The glow colours behind a screen: the bot's own colour, the accent, then the brand's blue. */
export function auroraColors(botColor: string, accent: string): string[] {
  return [botColor, accent, BRAND.to];
}

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

/** Dark surfaces one step down, for OLED screens: true black behind everything. */
const PURE_BLACK = { bg: '#000000', surface: '#0B0B0D', surfaceRaised: '#141417', surfaceSunken: '#141417', surfaceHigh: '#26262C', glass: 'rgba(16,16,20,0.6)', glassOpaque: '#141417', codeBg: '#0B0B0D' };

export function buildColors(scheme: Scheme, accentName: AccentName, pureBlack = false): Colors {
  const b = scheme === 'dark' && pureBlack ? { ...base.dark, ...PURE_BLACK } : base[scheme];
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

export function buildTheme(scheme: Scheme, accentName: AccentName, pureBlack = false): Theme {
  return { scheme, accentName, colors: buildColors(scheme, accentName, pureBlack), radius, space, fonts, type };
}

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
};

export const radius = { xs: 10, sm: 14, md: 18, lg: 22, xl: 28, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Type scale. Body stays at 16 for reading; headings get tighter tracking. */
export const type = {
  /** The landing greeting. */
  hero: { fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -1.1 },
  display: { fontFamily: fonts.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.9 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 16 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
};

export const WIDE_BREAKPOINT = 900;
