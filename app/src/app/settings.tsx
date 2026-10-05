import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Activity, BellRing, ChevronLeft, ExternalLink, Plus, Trash2 } from '../components/icons';
import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotAvatar } from '../components/BotAvatar';
import { Button, IconButton, Row, SectionLabel } from '../components/ui';
import { describeTestPush, enableNtfy, enableWebPush, openNtfySubscribe, sendTestPush, webPushServer, webPushState, type PushState } from '../lib/push';
import { APP_PROTOCOL, useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import type { Server } from '../lib/types';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const servers = useApp((s) => s.servers);
  const runtime = useApp((s) => s.runtime);
  const removeServer = useApp((s) => s.removeServer);
  const clearCache = useApp((s) => s.clearCache);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <ChevronLeft size={24} color={colors.textDim} />
        </IconButton>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 6, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <SectionLabel>Your bots</SectionLabel>
        <View style={styles.group}>
          {servers.map((s) => (
            <View key={s.id} style={styles.botRow}>
              <BotAvatar name={s.bot.name} size={40} status={runtime[s.id]?.status === 'online' ? 'online' : 'offline'} ringColor={colors.sidebar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.botName}>{s.bot.title}</Text>
                <Text style={styles.botUrl} numberOfLines={1}>{s.url}</Text>
              </View>
              <Button
                size="sm"
                variant={confirm === s.id ? 'danger' : 'ghost'}
                title={confirm === s.id ? 'Remove?' : ''}
                icon={<Trash2 size={16} color={confirm === s.id ? colors.white : colors.red} />}
                onPress={() => {
                  if (confirm !== s.id) return setConfirm(s.id);
                  setConfirm(null);
                  removeServer(s.id);
                }}
              />
            </View>
          ))}
          <Row onPress={() => router.push('/pair')}>
            <Plus size={20} color={colors.green} />
            <Text style={[styles.rowText, { color: colors.green }]}>Add a bot</Text>
          </Row>
        </View>

        <SectionLabel>Notifications</SectionLabel>
        {Platform.OS === 'web' ? <WebPushSettings servers={servers} /> : servers.map((s) => <NtfySettings key={s.id} server={s} />)}

        <SectionLabel>Storage</SectionLabel>
        <View style={[styles.group, { padding: 14, gap: 12 }]}>
          <Text style={styles.note}>
            Recent messages are kept on this device so chats open instantly and can be read offline. Your server keeps the full history.
          </Text>
          <Button title={cleared ? 'Cleared' : 'Clear cached messages'} variant="secondary" onPress={async () => {
            await clearCache();
            setCleared(true);
          }} />
        </View>

        <SectionLabel>About</SectionLabel>
        <View style={styles.group}>
          <Text style={styles.about}>Winglet {appVersion} (protocol {APP_PROTOCOL}) · an open-source app for Hermes Agent. Not affiliated with Nous Research.</Text>
          {servers.map((s) => {
            const info = runtime[s.id]?.info;
            const compat = runtime[s.id]?.compat;
            const behind = info?.version && appVersion && compareVersions(info.version, appVersion) < 0;
            return (
              <View key={s.id} style={styles.versionRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.botName}>{s.bot.title}</Text>
                  <Text style={styles.botUrl}>
                    {info ? `Winglet ${info.version || '?'} · Hermes ${info.hermes_version || 'unknown'}` : 'Versions show once connected'}
                  </Text>
                  {compat === 'update-app' ? (
                    <Text style={styles.warn}>This app is too old for {s.bot.title}. Install the latest Winglet app.</Text>
                  ) : compat === 'update-server' || behind ? (
                    <Text style={styles.warn}>
                      {compat ? 'Update needed' : 'Update available'}: on the server, run <Text style={styles.mono}>hermes plugins update winglet</Text>, then restart the gateway.
                    </Text>
                  ) : null}
                </View>
                <Button size="sm" variant="ghost" title="Connection" icon={<Activity size={15} color={colors.textMuted} />}
                  onPress={() => router.push(`/diagnostics/${s.id}`)} />
              </View>
            );
          })}
          <Row onPress={() => Linking.openURL('https://github.com/VIKASRP24/winglet')}>
            <ExternalLink size={20} color={colors.textMuted} />
            <Text style={styles.rowText}>Source code & help</Text>
          </Row>
        </View>
      </ScrollView>
    </View>
  );
}

function WebPushSettings({ servers }: { servers: Server[] }) {
  const server = webPushServer(servers);
  const [state, setState] = useState<PushState>(webPushState());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  let body: React.ReactNode;
  if (!server) {
    body = <Text style={styles.note}>Open Winglet from your Hermes server's address to turn on notifications here.</Text>;
  } else if (state === 'insecure') {
    body = <Text style={styles.note}>Browsers only allow notifications over HTTPS. Put your server behind HTTPS (for example `tailscale serve`) and open Winglet from that address.</Text>;
  } else if (state === 'needs-install') {
    body = <Text style={styles.note}>On iPhone, add Winglet to your Home Screen first (Share → Add to Home Screen), then open it from there.</Text>;
  } else if (state === 'unsupported') {
    body = <Text style={styles.note}>This browser doesn't support push notifications.</Text>;
  } else if (state === 'denied') {
    body = <Text style={styles.note}>Notifications are blocked for this site. Allow them in your browser or system settings, then come back.</Text>;
  } else {
    body = (
      <>
        <Text style={styles.note}>
          {state === 'granted'
            ? `You'll be notified when ${server.bot.title} needs you, even when Winglet is closed.`
            : `Get a notification when ${server.bot.title} needs an approval, asks a question, or finishes something.`}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button
            title={state === 'granted' ? 'Re-register this device' : 'Turn on notifications'}
            icon={<BellRing size={17} color={colors.white} />}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                setState(await enableWebPush(server));
                setMsg('');
              } catch (e) {
                setMsg((e as Error).message);
              }
              setBusy(false);
            }}
          />
          {state === 'granted' ? (
            <Button title="Send a test" variant="secondary" onPress={async () => {
              try {
                setMsg(describeTestPush(await sendTestPush(server)));
              } catch (e) {
                setMsg((e as Error).message);
              }
            }} />
          ) : null}
        </View>
      </>
    );
  }
  return (
    <View style={[styles.group, { padding: 14, gap: 12 }]}>
      {body}
      {msg ? <Text style={[styles.note, { color: colors.textDim }]}>{msg}</Text> : null}
    </View>
  );
}

function NtfySettings({ server }: { server: Server }) {
  const [topic, setTopic] = useState<{ server: string; topic: string } | null>(null);
  const [error, setError] = useState('');
  return (
    <View style={[styles.group, { padding: 14, gap: 12 }]}>
      <Text style={styles.botName}>{server.bot.title}</Text>
      <Text style={styles.note}>
        Android notifications come through the free ntfy app, so Winglet doesn't need Google services or a relay. Notifications only say that {server.bot.title} needs you; details stay on your server.
      </Text>
      <Text style={styles.note}>Upgrading an older install? Set up notifications again on each phone, then remove its old shared topic from ntfy.</Text>
      {topic ? (
        <>
          <Text style={styles.note}>Subscribe to this topic in ntfy (server {topic.server}):</Text>
          <Text selectable style={styles.topic}>{topic.topic}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button title="Open in ntfy" onPress={() => openNtfySubscribe(topic.server, topic.topic)} />
            <Button title="Copy topic" variant="secondary" onPress={() => Clipboard.setStringAsync(topic.topic)} />
          </View>
        </>
      ) : (
        <Button
          title="Set up notifications"
          icon={<BellRing size={17} color={colors.white} />}
          onPress={async () => {
            try {
              setTopic(await enableNtfy(server));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      {error ? <Text style={[styles.note, { color: colors.red }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chat },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
  group: { backgroundColor: colors.sidebar, borderRadius: radius.lg, padding: 6, gap: 2 },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  botName: { color: colors.text, fontFamily: fonts.bold, fontSize: 15.5 },
  botUrl: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  rowText: { color: colors.textDim, fontFamily: fonts.semibold, fontSize: 15 },
  note: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  about: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, padding: 10 },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  warn: { color: colors.yellow, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 4 },
  mono: { fontFamily: fonts.mono, color: colors.text },
  topic: { color: colors.text, fontFamily: fonts.mono, fontSize: 15, backgroundColor: colors.rail, padding: 12, borderRadius: radius.md },
});

/** Compare dotted versions numerically: -1 if a is older than b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0), pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}
