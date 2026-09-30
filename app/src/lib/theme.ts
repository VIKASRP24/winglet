import { Platform } from 'react-native';

export const colors = {
  rail: '#1E1F22',
  sidebar: '#2B2D31',
  chat: '#313338',
  input: '#383A40',
  hover: '#35373C',
  active: '#404249',
  border: '#3F4147',
  divider: '#26272B',
  card: '#2B2D31',
  cardRaised: '#232428',
  text: '#F2F3F5',
  textDim: '#DBDEE1',
  textMuted: '#949BA4',
  textFaint: '#6D6F78',
  accent: '#5865F2',
  accentHover: '#4752C4',
  accentSoft: 'rgba(88, 101, 242, 0.16)',
  green: '#23A55A',
  red: '#F23F43',
  redSoft: 'rgba(242, 63, 67, 0.14)',
  yellow: '#F0B232',
  yellowSoft: 'rgba(240, 178, 50, 0.12)',
  link: '#00A8FC',
  codeBg: '#1E1F22',
  mention: 'rgba(88, 101, 242, 0.3)',
  white: '#FFFFFF',
};

export const gradients = {
  hero: ['#7C5CFF', '#5865F2', '#3BA7FF'] as const,
  accent: ['#6E7BFF', '#5865F2'] as const,
};

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
};

export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 };

export const WIDE_BREAKPOINT = 900;
