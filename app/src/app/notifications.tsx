import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { BotAvatar } from '../components/BotAvatar';
import { BellRing, Copy } from '../components/icons';
import { Screen } from '../components/Screen';
import { Button, Card, SectionHeader } from '../components/ui';
import { describeTestPush, enableNtfy, enableWebPush, openNtfySubscribe, sendTestPush, webPushServer, webPushState, type PushState } from '../lib/push';
import { useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Server } from '../lib/types';

/** Turn on notifications: Web Push in the web app, the free ntfy app on Android. */
export default function NotificationsScreen() {
  const servers = useApp((st) => st.servers);
  return (
    <Screen title="Notifications" subtitle="Get a nudge when a bot needs an approval, asks a question, or finishes something. Tapping a notification opens exactly that item.">
      {Platform.OS === 'web' ? <WebPushSettings servers={servers} /> : servers.map((srv) => <NtfySettings key={srv.id} server={srv} />)}
    </Screen>
  );
}

function WebPushSettings({ servers }: { servers: Server[] }) {
  const t = useTheme();
  const s = useStyles();
  const server = webPushServer(servers);
  const [state, setState] = useState<PushState>(webPushState());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  let body: React.ReactNode;
  if (!server) body = <Text style={s.note}>Open Winglet from your Hermes server's address to turn on notifications here.</Text>;
  else if (state === 'insecure') body = <Text style={s.note}>Browsers only allow notifications over HTTPS. Open Winglet from your server's HTTPS address.</Text>;
  else if (state === 'needs-install') body = <Text style={s.note}>On iPhone, add Winglet to your Home Screen first (Share → Add to Home Screen), then open it from there.</Text>;
  else if (state === 'unsupported') body = <Text style={s.note}>This browser doesn't support push notifications.</Text>;
  else if (state === 'denied') body = <Text style={s.note}>Notifications are blocked for this site. Allow them in your browser or system settings, then come back.</Text>;
  else {
    body = (
      <>
        <Text style={s.note}>
          {state === 'granted' ? `You'll be notified when ${server.bot.title} needs you, even when Winglet is closed.`
            : `Get a notification when ${server.bot.title} needs an approval, asks a question, or finishes something.`}
        </Text>
        <View style={s.buttons}>
          <Button title={state === 'granted' ? 'Re-register this device' : 'Turn on notifications'} icon={<BellRing size={17} color={t.colors.onAccent} />}
            loading={busy} onPress={async () => {
              setBusy(true);
              try { setState(await enableWebPush(server)); setMsg(''); } catch (e) { setMsg((e as Error).message); }
              setBusy(false);
            }} />
          {state === 'granted' ? (
            <Button title="Send a test" variant="secondary" onPress={async () => {
              try { setMsg(describeTestPush(await sendTestPush(server))); } catch (e) { setMsg((e as Error).message); }
            }} />
          ) : null}
        </View>
      </>
    );
  }
  return (
    <>
      <SectionHeader title="This device" />
      <Card style={{ gap: 14 }}>
        {body}
        {msg ? <Text style={[s.note, { color: t.colors.text }]} accessibilityLiveRegion="polite">{msg}</Text> : null}
      </Card>
    </>
  );
}

function NtfySettings({ server }: { server: Server }) {
  const t = useTheme();
  const s = useStyles();
  const [topic, setTopic] = useState<{ server: string; topic: string } | null>(null);
  const [error, setError] = useState('');
  return (
    <>
      <SectionHeader title={server.bot.title} />
      <Card style={{ gap: 14 }}>
        <View style={s.botRow}>
          <BotAvatar name={server.bot.name} size={36} />
          <Text style={[s.note, { flex: 1 }]}>
            Android notifications come through the free ntfy app, so Winglet needs no Google services or relay. They only say that {server.bot.title} needs you; details stay on your server.
          </Text>
        </View>
        {topic ? (
          <>
            <Text style={s.note}>Subscribe to this topic in ntfy (server {topic.server}):</Text>
            <Text selectable style={s.topic}>{topic.topic}</Text>
            <View style={s.buttons}>
              <Button title="Open in ntfy" onPress={() => openNtfySubscribe(topic.server, topic.topic)} />
              <Button title="Copy topic" variant="secondary" icon={<Copy size={16} color={t.colors.text} />} onPress={() => Clipboard.setStringAsync(topic.topic)} />
            </View>
          </>
        ) : (
          <Button title="Set up notifications" icon={<BellRing size={17} color={t.colors.onAccent} />} onPress={async () => {
            try { setTopic(await enableNtfy(server)); } catch (e) { setError((e as Error).message); }
          }} />
        )}
        {error ? <Text style={[s.note, { color: t.colors.danger }]}>{error}</Text> : null}
      </Card>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...t.type.callout, color: t.colors.textSecondary },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  botRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  topic: { fontFamily: t.fonts.mono, fontSize: 15, color: t.colors.text, backgroundColor: t.colors.surfaceSunken, padding: 12, borderRadius: t.radius.md },
}));
