import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp, useServerState } from '../../lib/store';
import { makeStyles, useTheme } from '../../lib/themeContext';

/** Quiet and non-blocking: cached chats and the composer remain available while catching up. One line, at most. */
export function SyncStatus({ serverId, details = false }: { serverId: string; details?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const rt = useServerState(serverId);
  const sync = rt?.sync;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (sync?.phase !== 'idle') return;
    const timer = setTimeout(() => setSettled(true), 2000);
    return () => clearTimeout(timer);
  }, [sync]);
  if (!sync || sync.phase === 'unsupported' || rt?.status !== 'online') return null;
  if (!details && sync.phase === 'idle' && (!sync.caught || settled)) return null;
  const busy = sync.phase === 'snapshot' || sync.phase === 'catching-up';
  const blocked = sync.phase === 'blocked';
  const label = blocked ? "Couldn't catch up" : busy ? 'Catching up…' : details ? 'Up to date' : 'Back in sync';
  const count = busy && sync.caught ? ` · ${sync.caught}` : '';
  const reason = details && sync.reason ? ` · ${sync.reason === 'network' ? 'Check connection and storage' : sync.reason}` : '';
  return <View accessibilityLiveRegion="polite" style={s.row}>
    <Text style={[s.text, blocked && { color: t.colors.danger }]} numberOfLines={1}>
      {details ? 'Sync · ' : ''}{label}{count}{reason}
    </Text>
    {(blocked || details) && <Pressable accessibilityRole="button" accessibilityLabel={blocked ? 'Retry catching up' : 'Resync now'}
      disabled={busy} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} onPress={() => useApp.getState().resyncNow(serverId)}
      style={busy ? s.dim : undefined}>
      <Text style={s.action}>{blocked ? 'Retry' : 'Resync now'}</Text>
    </Pressable>}
  </View>;
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingHorizontal: t.space.lg, paddingVertical: t.space.xs },
  text: { ...t.type.caption, color: t.colors.textSecondary, flexShrink: 1 },
  action: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.accent },
  dim: { opacity: 0.5 },
}));
