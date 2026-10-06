import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { connectionView } from '../lib/connection';
import { useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import type { Server } from '../lib/types';
import { CloudOff, RefreshCw, WifiOff } from './icons';
import { tap } from './ui';

/** Why a bot isn't reachable, with the one thing to do about it. Hidden while online. */
export function ConnectionBanner({ server, compact }: { server: Server; compact?: boolean }) {
  const rt = useApp((s) => s.runtime[server.id]);
  const network = useApp((s) => s.network);
  const retryNow = useApp((s) => s.retryNow);
  const [now, setNow] = useState(Date.now());
  const view = connectionView(network, rt, server.bot.title, now);

  // Keep the "trying again in Ns" countdown honest.
  useEffect(() => {
    if (view.kind !== 'unreachable') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view.kind]);

  if (view.kind === 'online' || view.kind === 'connecting') return null;
  const tint = view.tone === 'error' ? colors.red : view.tone === 'warn' ? colors.yellow : colors.accent;
  const Icon = view.kind === 'no-internet' ? WifiOff : CloudOff;
  const action = view.action === 'retry' ? 'Try now' : view.action === 'pair' ? 'Pair again' : view.action === 'about' ? 'How to update' : null;

  return (
    <View accessibilityRole="alert" style={[styles.banner, { borderColor: tint }, compact && styles.compact]}>
      {view.kind === 'recovering' ? <ActivityIndicator size="small" color={tint} /> : <Icon size={18} color={tint} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{view.title}</Text>
        {!compact && view.detail ? <Text style={styles.detail}>{view.detail}</Text> : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
          hitSlop={8}
          onPress={() => {
            tap();
            if (view.action === 'retry') retryNow(server.id);
            else if (view.action === 'pair') router.push('/pair');
            else router.push('/settings');
          }}
        >
          {view.action === 'retry' ? <RefreshCw size={14} color={colors.text} /> : null}
          <Text style={styles.buttonText}>{action}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Connection details" hitSlop={8}
        onPress={() => router.push(`/diagnostics/${server.id}`)}>
        <Text style={styles.link}>Details</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, padding: 12,
    borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.cardRaised,
  },
  compact: { paddingVertical: 8 },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  detail: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.active, borderRadius: radius.sm + 2,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  buttonText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
  link: { color: colors.link, fontFamily: fonts.semibold, fontSize: 13 },
});
