import { useCallback, useState } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentFace } from '../../components/AgentFace';
import { ManageBot } from '../../components/ManageBot';
import { VerifyNotice } from '../../components/VerifyPhone';
import { BotSwitcher } from '../../components/BotSwitcher';
import { NavigationToggle } from '../../components/AppNavigation';
import {
  Activity, BarChart, Brain, CalendarClock, Check, Cpu, FileDiff, HeartPulse, Key, MessageCircle, MessageSquareText, PawPrint, Plug, ScrollText,
  ShieldCheck, Sparkles, SquareTerminal, Star, UserRoundPen,
} from '../../components/icons';
import { modelName } from '../../lib/modelOptions';
import { api } from '../../lib/api';
import { useTabBarSpace } from '../../components/TabBar';
import { Chip, Footnote, ListGroup, ListRow, SectionHeader } from '../../components/ui';
import { connectionView } from '../../lib/connection';
import { setMainBot, useMainBot } from '../../lib/mainBot';
import { homeChat, isOwner, type ServerState, useApp, useServerState } from '../../lib/store';
import type { AgentInfo, Server } from '../../lib/types';
import { WIDE_BREAKPOINT } from '../../lib/theme';
import { makeStyles, useTheme } from '../../lib/themeContext';

/** This bot's management. App-wide preferences live in Settings. */
export default function AgentTab() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const servers = useApp((st) => st.servers);
  const selection = useApp((st) => st.selection);
  const rt = useServerState((servers.find((x) => x.id === selection.serverId) ?? servers[0])?.id);
  const network = useApp((st) => st.network);
  const mainBot = useMainBot();
  if (!servers.length) return <Redirect href="/pair" />;
  const server = servers.find((x) => x.id === selection.serverId) ?? servers[0];
  const child = !!server.parent;
  const parent = child ? servers.find((x) => x.id === server.parent) : undefined;
  const view = connectionView(network, rt, server.bot.title);
  const control = rt?.info?.features?.control && isOwner(rt);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + t.space.sm, paddingBottom: (wide ? t.space.xl : tabSpace) + t.space.sm }]}>
        <View style={s.topRow}><NavigationToggle /><View style={{ flex: 1 }} /><BotSwitcher /></View>
        <View style={s.profile}>
          <AgentFace server={server} size={64} animated glow />
          <View style={s.identity}>
            <Text style={s.name} accessibilityRole="header">{server.bot.title}</Text>
            <Chip label={view.kind === 'online' ? 'Online' : view.title}
              icon={<View style={[s.statusDot, { backgroundColor: view.tone === 'ok' ? t.colors.success : view.tone === 'error' ? t.colors.danger : t.colors.warning }]} />} />
          </View>
        </View>

        <SectionHeader title="Chats" />
        <ListGroup>
          <ListRow icon={<MessageCircle />} title="Main chat" onPress={() => router.push(`/chat/${server.id}/${homeChat(rt)}`)} />
          {child ? null : <ListRow icon={<Sparkles />} title="Updates" onPress={() => router.push(`/chat/${server.id}/home`)} />}
        </ListGroup>

        <VerifyNotice server={server} />
        {rt?.info?.features?.agent && isOwner(rt) ? <>
          <SectionHeader title="Agent" />
          <BrainRows server={server} rt={rt} />
        </> : null}

        {rt?.info?.features?.abilities && isOwner(rt) ? <>
          <SectionHeader title="Abilities" />
          <ListGroup>
            <ListRow icon={<Sparkles />} title="Skills" onPress={() => router.push('/skills')} />
            <ListRow icon={<SquareTerminal />} title="Tools" onPress={() => router.push('/tools')} />
            <ListRow icon={<Plug />} title="MCP servers" onPress={() => router.push('/mcp')} />
          </ListGroup>
        </> : null}

        {control ? <>
          <SectionHeader title="Automation & history" />
          <ListGroup>
            <ListRow icon={<CalendarClock />} title="Schedule" onPress={() => router.push('/schedule')} />
            {rt.info?.features?.checkpoints ? <ListRow icon={<FileDiff />} title="Checkpoints" onPress={() => router.push('/checkpoints')} /> : null}
            {rt.info?.features?.sessions ? <ListRow icon={<MessageSquareText />} title="Sessions" onPress={() => router.push('/sessions')} /> : null}
            {!child ? <ListRow icon={<ScrollText />} title="Logs" onPress={() => router.push('/logs')} /> : null}
          </ListGroup>
        </> : null}

        <SectionHeader title="Server" />
        <ListGroup>
          {control && !child ? <ListRow icon={<HeartPulse />} iconColor={rt.paused ? t.colors.warning : undefined}
            title="Status" value={rt.paused ? 'Paused' : undefined} onPress={() => router.push('/server')} /> : null}
          <ListRow icon={<Activity />} title="Connection" value={view.kind === 'online' ? 'Online' : view.title}
            onPress={() => router.push(`/connection/${server.parent ?? server.id}`)} />
          {rt?.info?.features?.config_catalog && isOwner(rt) ? <ListRow icon={<Cpu />} title="Agent configuration" onPress={() => router.push('/advanced-config')} /> : null}
        </ListGroup>

        <SectionHeader title="Access" />
        <ListGroup>
          {!child && rt?.info?.features?.roles ? <ListRow icon={<ShieldCheck />} title="Devices"
            value={rt.me ? rt.me.role === 'owner' ? 'Owner' : 'Member' : undefined} onPress={() => router.push('/devices')} /> : null}
          <ListRow icon={<Star />} title="Open the app on this bot" value={mainBot?.id === server.id ? 'Main' : undefined}
            right={mainBot?.id === server.id ? <Check size={20} color={t.colors.accent} /> : undefined} chevron={false}
            onPress={mainBot?.id === server.id ? undefined : () => setMainBot(server.id)} />
        </ListGroup>
        {child && parent && isOwner(rt) ? <ManageBot server={server} parent={parent} /> : null}

        {rt?.info?.version ? <Footnote>Server plugin {rt.info.version}{rt.info.hermes_version ? ` · Hermes ${rt.info.hermes_version}` : ''}</Footnote> : null}
      </ScrollView>
    </View>
  );
}

/** Owners only; refresh the model value when returning from the model picker. */
function BrainRows({ server, rt }: { server: Server; rt?: ServerState }) {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const online = rt?.status === 'online';
  useFocusEffect(useCallback(() => {
    if (!online) return;
    api<AgentInfo>(server, '/api/agent').then(setInfo).catch(() => undefined);
  }, [server, online]));
  return (
    <ListGroup>
      <ListRow icon={<Cpu />} title="Default model" value={info?.configured.model ? modelName(info.configured.model) : undefined} onPress={() => router.push('/model')} />
      <ListRow icon={<Key />} title="Providers" onPress={() => router.push('/providers')} />
      <ListRow icon={<UserRoundPen />} title="Persona" onPress={() => router.push('/persona')} />
      {rt?.info?.features?.pets ? <ListRow icon={<PawPrint />} title="Pet" value={rt.pet?.name} onPress={() => router.push('/pets')} /> : null}
      <ListRow icon={<Brain />} title="Memory" onPress={() => router.push('/memory')} />
      <ListRow icon={<BarChart />} title="Usage" onPress={() => router.push('/usage')} />
    </ListGroup>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: t.space.lg, maxWidth: 680, width: '100%', alignSelf: 'center' },
  topRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', paddingTop: t.space.md, gap: t.space.lg },
  identity: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: t.space.sm },
  name: { ...t.type.title, color: t.colors.text },
  statusDot: { width: 8, height: 8, borderRadius: t.radius.pill },
}));
