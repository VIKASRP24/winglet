/**
 * Compare release versions like "0.2.0" and "0.2.0-beta.1": -1 if a is older than b, 1 if newer,
 * 0 if the same. A beta comes before its release, and beta.2 after beta.1.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.trim().split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const x = pa.nums[i] ?? 0, y = pb.nums[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const order = pa.pre.localeCompare(pb.pre, 'en', { numeric: true });
  return order < 0 ? -1 : order > 0 ? 1 : 0;
}
