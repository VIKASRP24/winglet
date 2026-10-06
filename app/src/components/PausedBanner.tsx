import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { signedApi } from '../lib/api';
import { haptic } from '../lib/haptics';
import { isOwner, useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { PauseState, Server } from '../lib/types';
import { CirclePause, Play } from './icons';
import { Tap } from './ui';

/** New work is on hold, so a message here gets Hermes's "paused" reply. Owners can resume in place. */
export function PausedBanner({ server }: { server: Server }) {
  const t = useTheme();
  const s = useStyles();
  const rt = useApp((st) => st.runtime[server.id]);
  const [busy, setBusy] = useState(false);
  if (!rt?.paused || rt.status !== 'online') return null;
  const owner = isOwner(rt);

  const resume = async () => {
    setBusy(true);
    try {
      const r = await signedApi<{ paused: PauseState }>(server, 'POST', '/api/system/pause', { paused: false });
      useApp.setState((st) => ({ runtime: { ...st.runtime, [server.id]: { ...st.runtime[server.id], paused: r.paused } } }));
      haptic.success();
    } catch (e) {
      haptic.error();
      useApp.getState().toast({ serverId: server.id, title: "Couldn't resume", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutUp.duration(160)} accessibilityRole="alert" style={s.banner}>
      <View style={s.icon}><CirclePause size={17} color={t.colors.warning} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>Paused</Text>
        <Text style={s.detail} numberOfLines={2}>
          {owner ? "It won't start anything new until you resume." : 'An owner paused new work for now.'}
        </Text>
      </View>
      {owner ? (
        <Tap feedback="selection" accessibilityLabel="Resume" style={s.button} onPress={() => !busy && resume()}>
          {busy ? <ActivityIndicator size="small" color={t.colors.text} /> : <Play size={14} color={t.colors.text} />}
          <Text style={s.buttonText}>Resume</Text>
        </Tap>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.warning,
  },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.warningSoft },
  title: { ...t.type.callout, fontFamily: t.fonts.semibold, color: t.colors.text },
  detail: { ...t.type.caption, fontSize: 13, color: t.colors.textSecondary, marginTop: 2 },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
  },
  buttonText: { fontFamily: t.fonts.semibold, fontSize: 13.5, color: t.colors.text },
}));
