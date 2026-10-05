import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { Copy } from '../../components/icons';
import { Screen } from '../../components/Screen';
import { Button, Card, SectionHeader } from '../../components/ui';
import { addressKind, connectionView, diagnosticReport } from '../../lib/connection';
import { APP_PROTOCOL, useApp } from '../../lib/store';
import { makeStyles, useTheme } from '../../lib/themeContext';

/** Connection details for one bot, and a redacted report to share when asking for help. */
export default function DiagnosticsScreen() {
  const t = useTheme();
  const s = useStyles();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const server = useApp((st) => st.servers.find((x) => x.id === serverId));
  const rt = useApp((st) => st.runtime[serverId]);
  const network = useApp((st) => st.network);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
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
    <Screen title="Connection" subtitle={server.bot.title}>
      <ConnectionBanner server={server} />
      <SectionHeader title="Details" />
      <Card style={{ paddingVertical: 6 }}>
        {rows.map(([k, v], i) => (
          <View key={k} style={[s.row, i > 0 && s.rowBorder]}>
            <Text style={s.key}>{k}</Text>
            <Text style={s.value} selectable>{v}</Text>
          </View>
        ))}
      </Card>
      <SectionHeader title="Recent events" />
      <Card style={{ paddingVertical: 6 }}>
        {(rt?.conn.history ?? []).slice().reverse().map((h, i) => (
          <View key={`${h.t}-${i}`} style={[s.row, i > 0 && s.rowBorder]}>
            <Text style={s.key}>{ago(now - h.t)}</Text>
            <Text style={s.value}>{h.status}{h.note ? ` · ${h.note}` : ''}</Text>
          </View>
        ))}
        {!rt?.conn.history.length ? <Text style={[s.value, { paddingVertical: 10 }]}>Nothing yet.</Text> : null}
      </Card>
      <Text style={s.note}>The report has no passwords, tokens, addresses or messages: only states, times and versions. Paste it when asking for help.</Text>
      <Button title={copied ? 'Copied' : 'Copy report'} icon={<Copy size={16} color={t.colors.onAccent} />} onPress={async () => {
        await Clipboard.setStringAsync(report());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }} />
    </Screen>
  );
}

function ago(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: t.colors.border },
  key: { ...t.type.callout, color: t.colors.textSecondary, width: 140 },
  value: { ...t.type.callout, color: t.colors.text, flex: 1 },
  note: { ...t.type.caption, fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginVertical: 14, lineHeight: 18 },
}));
