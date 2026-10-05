import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { ChevronLeft, Copy } from '../../components/icons';
import { Button, IconButton, SectionLabel } from '../../components/ui';
import { addressKind, connectionView, diagnosticReport } from '../../lib/connection';
import { APP_PROTOCOL, useApp } from '../../lib/store';
import { colors, fonts, radius } from '../../lib/theme';

/** Connection details for one bot, and a redacted report to share when asking for help. */
export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const rt = useApp((s) => s.runtime[serverId]);
  const network = useApp((s) => s.network);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!server) return <Redirect href="/" />;
  const view = connectionView(network, rt, server.bot.title, now);
  const appVersion = Constants.expoConfig?.version ?? '';
  const report = () => diagnosticReport({ bot: server.bot.title, url: server.url, recovery: !!server.recovery, network,
    appVersion, appProtocol: APP_PROTOCOL, platform: Platform.OS, rt });

  const rows: [string, string][] = [
    ['State', view.kind === 'online' ? 'Online' : view.title],
    ['Phone network', network ? 'Online' : 'Offline'],
    ['Address type', addressKind(server.url)],
    ['Address recovery', server.recovery ? (rt?.conn.recovering ? 'Looking for a new address' : 'Enrolled') : Platform.OS === 'android' ? 'Not available on this connection' : 'Android only'],
    ['Last problem', rt?.conn.lastError ?? 'None'],
    ['Queued messages', String(rt?.outbox.filter((o) => !o.failed).length ?? 0)],
    ['This app', `${appVersion} (protocol ${APP_PROTOCOL})`],
    ['Winglet on server', rt?.info?.version ? `${rt.info.version} (protocol ${rt.info.protocol})` : 'Unknown until connected'],
    ['Hermes', rt?.info?.hermes_version || 'Unknown'],
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ChevronLeft size={24} color={colors.textDim} />
        </IconButton>
        <Text style={styles.title}>{server.bot.title} · Connection</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 6, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <ConnectionBanner server={server} />
        <SectionLabel>Details</SectionLabel>
        <View style={styles.group}>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.key}>{k}</Text>
              <Text style={styles.value} selectable>{v}</Text>
            </View>
          ))}
        </View>
        <SectionLabel>Recent events</SectionLabel>
        <View style={styles.group}>
          {(rt?.conn.history ?? []).slice().reverse().map((h, i) => (
            <View key={`${h.t}-${i}`} style={styles.row}>
              <Text style={styles.key}>{ago(now - h.t)}</Text>
              <Text style={styles.value}>{h.status}{h.note ? ` · ${h.note}` : ''}</Text>
            </View>
          ))}
          {!rt?.conn.history.length ? <Text style={[styles.value, { padding: 10 }]}>Nothing yet.</Text> : null}
        </View>
        <Text style={styles.note}>
          The report below has no passwords, tokens, addresses or messages: only states, times and versions. Paste it when
          asking for help.
        </Text>
        <Button
          title={copied ? 'Copied' : 'Copy report'}
          icon={<Copy size={16} color={colors.white} />}
          onPress={async () => {
            await Clipboard.setStringAsync(report());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </ScrollView>
    </View>
  );
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chat },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 17, flexShrink: 1 },
  group: { backgroundColor: colors.sidebar, borderRadius: radius.lg, padding: 6 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 10, paddingVertical: 9 },
  key: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 14, width: 140 },
  value: { color: colors.text, fontFamily: fonts.regular, fontSize: 14, flex: 1 },
  note: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, marginVertical: 10 },
});
