import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BotAvatar } from '../components/BotAvatar';
import { Activity, ExternalLink, HardDrive } from '../components/icons';
import { Logo } from '../components/Logo';
import { Screen } from '../components/Screen';
import { Button, Card, ListGroup, ListRow, SectionHeader } from '../components/ui';
import { APP_PROTOCOL, useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import { compareVersions } from '../lib/version';

/** Versions on both sides, what to update, and the on-device cache. */
export default function AboutScreen() {
  const t = useTheme();
  const s = useStyles();
  const servers = useApp((st) => st.servers);
  const runtime = useApp((st) => st.runtime);
  const clearCache = useApp((st) => st.clearCache);
  const [cleared, setCleared] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? '';
  return (
    <Screen title="About">
      <View style={s.hero}>
        <Logo size={64} />
        <Text style={s.app}>Winglet {appVersion}</Text>
        <Text style={s.small}>Protocol {APP_PROTOCOL} · open source · not affiliated with Nous Research</Text>
      </View>

      <SectionHeader title="Your bots" />
      <View style={{ gap: 10 }}>
        {servers.map((srv) => {
          const info = runtime[srv.id]?.info;
          const compat = runtime[srv.id]?.compat;
          const behind = !!info?.version && !!appVersion && compareVersions(info.version, appVersion) < 0;
          return (
            <Card key={srv.id} style={{ gap: 10 }}>
              <View style={s.botRow}>
                <BotAvatar name={srv.bot.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.botName}>{srv.bot.title}</Text>
                  <Text style={s.small}>{info ? `Winglet ${info.version || '?'} · Hermes ${info.hermes_version || 'unknown'}` : 'Versions show once connected'}</Text>
                </View>
                <Button size="sm" variant="secondary" title="Connection" icon={<Activity size={15} color={t.colors.text} />} onPress={() => router.push(`/diagnostics/${srv.id}`)} />
              </View>
              {compat === 'update-app' ? (
                <Text style={s.warn}>This app is too old for {srv.bot.title}. Install the latest Winglet app.</Text>
              ) : compat === 'update-server' || behind ? (
                <Text style={s.warn}>
                  {compat ? 'Update needed' : 'Update available'}: on the server, run <Text style={s.mono}>hermes plugins update winglet</Text>, then restart the gateway.
                </Text>
              ) : null}
            </Card>
          );
        })}
      </View>

      <SectionHeader title="Storage" />
      <Card style={{ gap: 12 }}>
        <Text style={s.note}>Recent messages are kept on this device so chats open instantly and can be read offline. Your server keeps the full history.</Text>
        <Button title={cleared ? 'Cleared' : 'Clear cached messages'} variant="secondary" icon={<HardDrive size={16} color={t.colors.text} />}
          onPress={async () => { await clearCache(); setCleared(true); }} />
      </Card>

      <SectionHeader title="Help" />
      <ListGroup>
        <ListRow icon={<ExternalLink size={18} color={t.colors.onAccentSoft} />} title="Source code & help" onPress={() => Linking.openURL('https://github.com/VIKASRP24/winglet')} />
      </ListGroup>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hero: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  app: { ...t.type.title, color: t.colors.text, marginTop: 8 },
  small: { ...t.type.caption, color: t.colors.textSecondary, textAlign: 'center' },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  botName: { ...t.type.bodyStrong, color: t.colors.text },
  warn: { ...t.type.callout, color: t.colors.warning },
  mono: { fontFamily: t.fonts.mono, color: t.colors.text },
  note: { ...t.type.callout, color: t.colors.textSecondary },
}));
