import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { FIXED } from '../lib/theme';

/** A QR code drawn as one SVG path: always dark on white, the way every camera reads best. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2},${r + 2}h1v1h-1z`;
    }
    return { path: d, count: n + 4 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} accessibilityLabel={label} accessibilityRole="image">
      <Rect x={0} y={0} width={count} height={count} fill={FIXED.white} />
      <Path d={path} fill={FIXED.camera} />
    </Svg>
  );
}
