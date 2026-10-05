import Constants from 'expo-constants';
import { Redirect, router } from 'expo-router';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotAvatar } from '../../components/BotAvatar';
import { BotSwitcher } from '../../components/BotSwitcher';
import { Activity, Bell, Info, MessageCircle, Palette, Plus, Smartphone, Sparkles } from '../../components/icons';
import { useTabBarSpace } from '../../components/TabBar';
import { ListGroup, ListRow, SectionHeader } from '../../components/ui';
import { moodOf } from '../../lib/agent';
import { connectionView } from '../../lib/connection';
import { usePrefs } from '../../lib/prefs';
import { useApp } from '../../lib/store';
import { ACCENTS, WIDE_BREAKPOINT } from '../../lib/theme';
import { makeStyles, useTheme } from '../../lib/themeContext';

/** Your agent's card, and everything you can set from the phone. Sections appear as the server supports them. */
export default function AgentTab() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const servers = useApp((st) => st.servers);
  const selection = useApp((st) => st.selection);
  const runtime = useApp((st) => st.runtime);
  const network = useApp((st) => st.network);
  const prefs = usePrefs((st) => st.prefs);
  if (!servers.length) return <Redirect href="/pair" />;
  const server = servers.find((x) => x.id === selection.serverId) ?? servers[0];
  const rt = runtime[server.id];
  const view = connectionView(network, rt, server.bot.title);
  const themeLabel = prefs.theme === 'system' ? 'System' : prefs.theme === 'dark' ? 'Dark' : 'Light';

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: (wide ? 24 : tabSpace) + 8 }]}>
        <View style={s.topRow}>{wide ? null : <BotSwitcher />}</View>
        <View style={s.profile}>
          <BotAvatar name={server.bot.name} size={88} mood={moodOf(rt)} animated glow />
          <Text style={s.name} accessibilityRole="header">{server.bot.title}</Text>
          {server.bot.description ? <Text style={s.description}>{server.bot.description}</Text> : null}
          <View style={s.statusChip}>
            <View style={[s.statusDot, { backgroundColor: view.tone === 'ok' ? t.colors.success : view.tone === 'error' ? t.colors.danger : t.colors.warning }]} />
            <Text style={s.statusText}>{view.kind === 'online' ? 'Online' : view.title}</Text>
          </View>
          {rt?.info?.version ? (
            <Text style={s.versions}>Winglet {rt.info.version}{rt.info.hermes_version ? ` · Hermes ${rt.info.hermes_version}` : ''}</Text>
          ) : null}
        </View>

        <SectionHeader title="This bot" />
        <ListGroup>
          <ListRow icon={<MessageCircle size={18} color={t.colors.onAccentSoft} />} title="Main chat" onPress={() => router.push(`/chat/${server.id}/general`)} />
          <ListRow icon={<Sparkles size={18} color={t.colors.success} />} iconColor={t.colors.success} title="Updates" subtitle="Results from scheduled routines"
            onPress={() => router.push(`/chat/${server.id}/home`)} />
          <ListRow icon={<Activity size={18} color={t.colors.onAccentSoft} />} title="Connection" value={view.kind === 'online' ? 'Online' : view.title}
            onPress={() => router.push(`/diagnostics/${server.id}`)} />
        </ListGroup>

        <SectionHeader title="Bots" />
        <ListGroup>
          <ListRow icon={<Smartphone size={18} color={t.colors.onAccentSoft} />} title="Your bots" value={String(servers.length)} onPress={() => router.push('/bots')} />
          <ListRow icon={<Plus size={18} color={t.colors.success} />} iconColor={t.colors.success} title="Add a bot" onPress={() => router.push('/pair')} />
        </ListGroup>

        <SectionHeader title="App" />
        <ListGroup>
          <ListRow icon={<Palette size={18} color={t.colors.onAccentSoft} />} title="Appearance" value={`${themeLabel} · ${ACCENTS[prefs.accent].label}`} onPress={() => router.push('/appearance')} />
          <ListRow icon={<Bell size={18} color={t.colors.onAccentSoft} />} title="Notifications" onPress={() => router.push('/notifications')} />
          <ListRow icon={<Info size={18} color={t.colors.onAccentSoft} />} title="About & storage" onPress={() => router.push('/about')} />
        </ListGroup>
        <Text style={s.footer}>Winglet {Constants.expoConfig?.version ?? ''} · open source · not affiliated with Nous Research</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  topRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  profile: { alignItems: 'center', paddingTop: 16, paddingBottom: 6, gap: 6 },
  name: { ...t.type.title, color: t.colors.text, marginTop: 12 },
  description: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center', maxWidth: 420 },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 6, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, marginTop: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...t.type.caption, color: t.colors.text },
  versions: { ...t.type.caption, color: t.colors.textTertiary, marginTop: 2 },
  footer: { ...t.type.caption, color: t.colors.textTertiary, textAlign: 'center', marginTop: 24 },
}));
