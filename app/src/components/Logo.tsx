import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { BRAND } from '../lib/theme';

/** The Winglet mark: a small wing on a violet-to-sky tile. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Winglet">
      <Defs>
        <LinearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={BRAND.from} />
          <Stop offset="0.55" stopColor={BRAND.via} />
          <Stop offset="1" stopColor={BRAND.to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={64} height={64} rx={18} fill="url(#wg)" />
      <Path
        d="M14 40c9-1 16-6 21-14 3-5 7-9 13-10-2 3-3 6-3 9 3-1 5-1 7 0-3 2-5 4-6 7 2 0 4 1 5 2-4 1-7 3-9 6-6 7-17 9-28 0z"
        fill={BRAND.mark}
      />
      <Path d="M20 43c7-1 13-4 18-9" stroke={BRAND.stroke} strokeWidth={2.2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
