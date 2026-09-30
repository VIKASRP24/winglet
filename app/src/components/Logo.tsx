import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** The Winglet mark: a small wing on a violet-to-blurple tile. */
export function Logo({ size = 48, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#8B6CFF" />
          <Stop offset="0.55" stopColor="#5865F2" />
          <Stop offset="1" stopColor="#3BA7FF" />
        </LinearGradient>
      </Defs>
      {tile ? <Rect x={0} y={0} width={64} height={64} rx={18} fill="url(#wg)" /> : null}
      <Path
        d="M14 40c9-1 16-6 21-14 3-5 7-9 13-10-2 3-3 6-3 9 3-1 5-1 7 0-3 2-5 4-6 7 2 0 4 1 5 2-4 1-7 3-9 6-6 7-17 9-28 0z"
        fill={tile ? '#FFFFFF' : '#5865F2'}
      />
      <Path d="M20 43c7-1 13-4 18-9" stroke={tile ? 'rgba(88,101,242,0.55)' : '#FFFFFF'} strokeWidth={2.2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
