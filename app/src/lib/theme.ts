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
    bg: '#FAFAFA',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    /** Inputs, segmented controls and wells: one step below whatever they sit on. */
    surfaceSunken: '#F1F1F3',
    /** Selected segment, raised chip: one step above whatever it sits on. */
    surfaceHigh: '#FFFFFF',
    /** Your own message bubbles. */
    bubble: '#EFEFF1',
    /** Sticky headers and the composer: near-opaque, so text never sits on a busy backdrop. */
    glass: 'rgba(250,250,250,0.94)',
    glassOpaque: '#FFFFFF',
    glassBorder: 'rgba(0,0,0,0.08)',
    glassSheen: 'transparent',
    card: '#FFFFFF',
    cardBorder: 'rgba(0,0,0,0.08)',
    border: 'rgba(0,0,0,0.08)',
    borderStrong: 'rgba(0,0,0,0.14)',
    text: '#111113',
    textSecondary: '#5C5C66',
    textTertiary: '#6B6B75',
    success: '#126F34',
    warning: '#9C4806',
    danger: '#B91C1C',
    codeBg: '#F4F4F6',
    codeText: '#1F1F27',
    /** Syntax colours inside code blocks, all readable on codeBg. */
    synKeyword: '#B0245A',
    synString: '#14693A',
    synNumber: '#9A4A00',
    synComment: '#62626E',
    synFunction: '#5134C4',
    synType: '#0B6A8A',
    overlay: 'rgba(10,10,14,0.36)',
    shadow: '#101014',
    pressed: 'rgba(0,0,0,0.045)',
  },
  dark: {
    bg: '#0C0C0E',
    surface: '#161619',
    surfaceRaised: '#1B1B1F',
    surfaceSunken: '#1B1B1F',
    surfaceHigh: '#232327',
    bubble: '#232327',
    glass: 'rgba(12,12,14,0.94)',
    glassOpaque: '#161619',
    glassBorder: 'rgba(255,255,255,0.07)',
    glassSheen: 'transparent',
    card: '#161619',
    cardBorder: 'rgba(255,255,255,0.07)',
    border: 'rgba(255,255,255,0.07)',
    borderStrong: 'rgba(255,255,255,0.13)',
    text: '#EDEDEF',
    textSecondary: '#A3A3AB',
    textTertiary: '#8E8E97',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#FB7185',
    codeBg: '#111113',
    codeText: '#E4E4EA',
    synKeyword: '#FF7AB2',
    synString: '#8BD99A',
    synNumber: '#F7B267',
    synComment: '#8E8E9A',
    synFunction: '#A99BFF',
    synType: '#6CCFF6',
    overlay: 'rgba(0,0,0,0.62)',
    shadow: '#000000',
    pressed: 'rgba(255,255,255,0.055)',
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
  /** The strongest action on a screen (and the send button): the text colour as a fill. */
  ink: string;
  onInk: string;
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
const PURE_BLACK = { bg: '#000000', surface: '#111113', surfaceRaised: '#17171A', surfaceSunken: '#17171A', surfaceHigh: '#232327', bubble: '#1E1E22', glass: 'rgba(0,0,0,0.94)', glassOpaque: '#111113', card: '#111113', codeBg: '#0B0B0D' };

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
    ink: b.text,
    onInk: scheme === 'light' ? '#FFFFFF' : b.bg,
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

export const radius = { xs: 6, sm: 10, md: 12, lg: 16, xl: 22, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Type scale. Body stays at 16 for reading; headings get tighter tracking. */
export const type = {
  /** The landing greeting. */
  hero: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6 },
  display: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.7 },
  title: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.semibold, fontSize: 16.5, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
};

export const WIDE_BREAKPOINT = 900;
