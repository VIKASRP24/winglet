import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../lib/themeContext';

/** The Winglet mark: a small wing on a solid tile, in the theme's ink so it sits quietly in either theme. */
export function Logo({ size = 48 }: { size?: number }) {
  const t = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Winglet">
      <Rect x={0} y={0} width={64} height={64} rx={16} fill={t.colors.ink} />
      <Path
        d="M14 40c9-1 16-6 21-14 3-5 7-9 13-10-2 3-3 6-3 9 3-1 5-1 7 0-3 2-5 4-6 7 2 0 4 1 5 2-4 1-7 3-9 6-6 7-17 9-28 0z"
        fill={t.colors.onInk}
      />
    </Svg>
  );
}
