import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { colors } from '../lib/theme';

const PALETTE = ['#5865F2', '#EB459E', '#3BA55C', '#FAA61A', '#ED4245', '#00B0F4', '#9B59B6', '#1ABC9C', '#E67E22', '#7C5CFF'];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function botColor(name: string): string {
  return PALETTE[hash(name || 'hermes') % PALETTE.length];
}

type Props = {
  name: string;
  size?: number;
  status?: 'online' | 'offline' | 'connecting' | 'busy';
  ringColor?: string;
  shape?: 'circle' | 'squircle';
};

/** A friendly, deterministic face for each bot: same name, same face. */
export function BotAvatar({ name, size = 40, status, ringColor = colors.sidebar, shape = 'circle' }: Props) {
  const h = hash(name || 'hermes');
  const bg = PALETTE[h % PALETTE.length];
  const eyes = (h >> 4) % 3; // 0 round, 1 happy, 2 tall
  const mouth = (h >> 7) % 3; // 0 smile, 1 open, 2 grin
  const cheeks = ((h >> 9) & 1) === 1;
  const look = status === 'busy' ? -1.4 : 0;
  const r = shape === 'squircle' ? 30 : 50;

  const eye = (cx: number) => {
    if (eyes === 1) return <Path key={cx} d={`M${cx - 6} 45 Q${cx} 37 ${cx + 6} 45`} stroke="#1E1F22" strokeWidth={4} strokeLinecap="round" fill="none" />;
    const ry = eyes === 2 ? 8 : 6.5;
    return (
      <Ellipse key={cx} cx={cx} cy={44 + look} rx={6} ry={ry} fill="#FFFFFF" />
    );
  };
  const pupil = (cx: number) =>
    eyes === 1 ? null : <Circle key={`p${cx}`} cx={cx + 1} cy={45 + look * 1.6} r={3.2} fill="#1E1F22" />;

  const mouthEl =
    mouth === 0 ? (
      <Path d="M40 61 Q50 70 60 61" stroke="#1E1F22" strokeWidth={4} strokeLinecap="round" fill="none" />
    ) : mouth === 1 ? (
      <Ellipse cx={50} cy={63} rx={5} ry={4.5} fill="#1E1F22" />
    ) : (
      <Path d="M38 59 Q50 74 62 59 Z" fill="#1E1F22" />
    );

  const dot = status ? { online: colors.green, busy: colors.yellow, connecting: colors.yellow, offline: colors.textFaint }[status] : null;
  const dotSize = Math.max(10, size * 0.32);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Rect x={0} y={0} width={100} height={100} rx={r} fill={bg} />
        <Ellipse cx={50} cy={22} rx={34} ry={14} fill="#FFFFFF" opacity={0.13} />
        {eye(36)}
        {eye(64)}
        {pupil(36)}
        {pupil(64)}
        {cheeks ? (
          <>
            <Ellipse cx={26} cy={57} rx={6} ry={3.5} fill="#FFFFFF" opacity={0.25} />
            <Ellipse cx={74} cy={57} rx={6} ry={3.5} fill="#FFFFFF" opacity={0.25} />
          </>
        ) : null}
        {mouthEl}
      </Svg>
      {dot ? (
        <View
          style={{
            position: 'absolute', right: -2, bottom: -2, width: dotSize, height: dotSize, borderRadius: dotSize,
            backgroundColor: dot, borderWidth: Math.max(2, size * 0.07), borderColor: ringColor,
          }}
        />
      ) : null}
    </View>
  );
}

/** The human side of the conversation. */
export function UserAvatar({ size = 40 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size, backgroundColor: '#4E5058', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24">
        <Circle cx={12} cy={8} r={4.2} fill="#DBDEE1" />
        <Path d="M4 20c1.2-4 4.4-6 8-6s6.8 2 8 6" fill="#DBDEE1" />
      </Svg>
    </View>
  );
}
