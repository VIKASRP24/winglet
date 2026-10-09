import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { connectionView } from '../lib/connection';
import { useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Server } from '../lib/types';
import { CloudOff, RefreshCw, WifiOff } from './icons';
import { Tap } from './ui';

/** Why a bot isn't reachable, with the one thing to do about it. Hidden while online. */
export function ConnectionBanner({ server, compact }: { server: Server; compact?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const rt = useApp((st) => st.runtime[server.id]);
  const network = useApp((st) => st.network);
  const retryNow = useApp((st) => st.retryNow);
  const [now, setNow] = useState(Date.now());
  const view = connectionView(network, rt, server.bot.title, now);

  // Keep the "trying again in Ns" countdown honest.
  useEffect(() => {
    if (view.kind !== 'unreachable') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view.kind]);

  if (view.kind === 'online' || view.kind === 'connecting') return null;
  const tint = view.tone === 'error' ? t.colors.danger : view.tone === 'warn' ? t.colors.warning : t.colors.accent;
  const soft = view.tone === 'error' ? t.colors.dangerSoft : view.tone === 'warn' ? t.colors.warningSoft : t.colors.accentSoft;
  const Icon = view.kind === 'no-internet' ? WifiOff : CloudOff;
  const action = view.action === 'retry' ? 'Try now' : view.action === 'pair' ? 'Pair again' : view.action === 'about' ? 'How to update' : null;

  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutUp.duration(160)} accessibilityRole="alert"
      accessibilityLiveRegion="polite" style={[s.banner, compact && s.compact]}>
      <View style={[s.icon, { backgroundColor: soft }]}>
        {view.kind === 'recovering' ? <ActivityIndicator size="small" color={tint} /> : <Icon size={17} color={tint} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>{view.title}</Text>
        {!compact && view.detail ? <Text style={s.detail}>{view.detail}</Text> : null}
        <Text accessibilityRole="link" style={s.link} onPress={() => router.push(`/connection/${server.id}`)}>Details</Text>
      </View>
      {action ? (
        <Tap feedback="selection" accessibilityLabel={action} style={s.button} onPress={() => {
          if (view.action === 'retry') retryNow(server.id);
          else if (view.action === 'pair') router.push('/pair');
          else router.push('/about');
        }}>
          {view.action === 'retry' ? <RefreshCw size={14} color={t.colors.text} /> : null}
          <Text style={s.buttonText}>{action}</Text>
        </Tap>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginHorizontal: 0, padding: 12, borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border,
  },
  compact: { marginHorizontal: 12, paddingVertical: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { ...t.type.callout, fontFamily: t.fonts.semibold, color: t.colors.text },
  detail: { ...t.type.caption, fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginTop: 2 },
  link: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.accent, marginTop: 4, alignSelf: 'flex-start' },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
  },
  buttonText: { fontFamily: t.fonts.semibold, fontSize: 13.5, color: t.colors.text },
}));
