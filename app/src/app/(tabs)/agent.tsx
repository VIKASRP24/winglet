import { cloneElement, memo, useCallback, useState, type ReactElement } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ManageBot } from '../../components/ManageBot';
import { VerifyNotice } from '../../components/VerifyPhone';
import { BotSwitcher } from '../../components/BotSwitcher';
import { HUB_BAR, HubBar, HubGlow } from '../../components/InboxView';
import { LivePet } from '../../components/LivePet';
import {
  Activity, BarChart, Brain, CalendarClock, Check, ChevronRight, Cpu, FileDiff, HeartPulse, Key, MessageCircle, MessageSquareText, PawPrint, Plug,
  ScrollText, ShieldCheck, Sparkles, SquareTerminal, Star, UserRoundPen,
} from '../../components/icons';
import { moodOf } from '../../lib/agent';
import { modelName } from '../../lib/modelOptions';
import { api } from '../../lib/api';
import { useReducedMotion } from '../../lib/motion';
import { useTabBarSpace } from '../../components/TabBar';
import { Button, Footnote, ListGroup, ListRow, SectionHeader, Tap } from '../../components/ui';
import { connectionView } from '../../lib/connection';
import { setMainBot, useMainBot } from '../../lib/mainBot';
import { homeChat, isOwner, useApp, useServerState } from '../../lib/store';
import type { AgentInfo, Server } from '../../lib/types';
import { WIDE_BREAKPOINT } from '../../lib/theme';
import { makeStyles, useTheme } from '../../lib/themeContext';

/** This bot's management. App-wide preferences live in Settings. */
export default function AgentTab() {
  const servers = useApp((st) => st.servers);
  const selection = useApp((st) => st.selection);
  if (!servers.length) return <Redirect href="/pair" />;
  return <AgentHub server={servers.find((x) => x.id === selection.serverId) ?? servers[0]} />;
}

function AgentHub({ server }: { server: Server }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const servers = useApp((st) => st.servers);
  const rt = useServerState(server.id);
  const network = useApp((st) => st.network);
  const mood = useApp((st) => moodOf(st.runtime[server.id]));
  const mainBot = useMainBot();
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const child = !!server.parent;
  const parent = child ? servers.find((x) => x.id === server.parent) : undefined;
  const view = connectionView(network, rt, server.bot.title);
  const owner = isOwner(rt);
  const control = rt?.info?.features?.control && owner;
  const brain = !!rt?.info?.features?.agent && owner;
  const info = useAgentInfo(server, brain);
  const model = info?.configured.model ? modelName(info.configured.model) : undefined;

  const online = view.kind === 'online';
  const status = !online ? view.title : mood === 'waiting' ? 'Needs you' : mood === 'working' ? 'Working' : 'Online';
  const tone = !online ? view.tone === 'error' ? t.colors.danger : t.colors.warning
    : mood === 'waiting' ? t.colors.warning : t.colors.success;

  const brainTiles: TileSpec[] = brain ? [
    { key: 'model', icon: <Cpu />, title: 'Model', value: model, onPress: () => router.push('/model') },
    { key: 'providers', icon: <Key />, title: 'Providers', onPress: () => router.push('/providers') },
    { key: 'persona', icon: <UserRoundPen />, title: 'Persona', onPress: () => router.push('/persona') },
    ...(rt?.info?.features?.pets ? [{ key: 'pet', icon: <PawPrint />, title: 'Pet', value: rt.pet?.name, onPress: () => router.push('/pets') }] : []),
    { key: 'memory', icon: <Brain />, title: 'Memory', onPress: () => router.push('/memory') },
    { key: 'usage', icon: <BarChart />, title: 'Usage', onPress: () => router.push('/usage') },
  ] : [];
  const abilityTiles: TileSpec[] = rt?.info?.features?.abilities && owner ? [
    { key: 'skills', icon: <Sparkles />, title: 'Skills', onPress: () => router.push('/skills') },
    { key: 'tools', icon: <SquareTerminal />, title: 'Tools', onPress: () => router.push('/tools') },
    { key: 'mcp', icon: <Plug />, title: 'MCP servers', onPress: () => router.push('/mcp') },
  ] : [];
  const historyTiles: TileSpec[] = control ? [
    { key: 'schedule', icon: <CalendarClock />, title: 'Schedule', onPress: () => router.push('/schedule') },
    ...(rt.info?.features?.checkpoints ? [{ key: 'checkpoints', icon: <FileDiff />, title: 'Checkpoints', onPress: () => router.push('/checkpoints') }] : []),
    ...(rt.info?.features?.sessions ? [{ key: 'sessions', icon: <MessageSquareText />, title: 'Sessions', onPress: () => router.push('/sessions') }] : []),
    ...(!child ? [{ key: 'logs', icon: <ScrollText />, title: 'Logs', onPress: () => router.push('/logs') }] : []),
  ] : [];

  return (
    <View style={s.root}>
      <HubGlow y={y} server={server} height={460} />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={[s.content, { paddingTop: insets.top + HUB_BAR, paddingBottom: (wide ? t.space.xl : tabSpace) + t.space.sm }]}>
        <View style={s.hero}>
          <LivePet server={server} size={124} glow accessibilityLabel={`${server.bot.title}, ${status}. Tap to poke`} />
          <Text style={s.name} accessibilityRole="header" numberOfLines={2}>{server.bot.title}</Text>
          <View style={s.pills}>
            <View style={s.pill} accessibilityLabel={`Status: ${status}`}>
              <View style={[s.dot, { backgroundColor: tone }]} />
              <Text style={s.pillText} numberOfLines={1}>{status}</Text>
            </View>
            {model ? (
              <View style={s.pill} accessibilityLabel={`Model: ${model}`}>
                <Cpu size={14} color={t.colors.textSecondary} />
                <Text style={s.pillText} numberOfLines={1}>{model}</Text>
              </View>
            ) : null}
          </View>
          <View style={s.heroActions}>
            <Button title="Main chat" style={s.heroButton} icon={<MessageCircle size={18} color={t.colors.onAccent} />}
              onPress={() => router.push(`/chat/${server.id}/${homeChat(rt)}`)} />
            {child ? null : <Button title="Updates" variant="secondary" style={s.heroButton} icon={<Sparkles size={18} color={t.colors.text} />}
              onPress={() => router.push(`/chat/${server.id}/home`)} />}
          </View>
        </View>

        <VerifyNotice server={server} />

        {brainTiles.length ? <><SectionHeader title="Agent" /><TileGrid tiles={brainTiles} delay={0} /></> : null}
        {abilityTiles.length ? <><SectionHeader title="Abilities" /><TileGrid tiles={abilityTiles} delay={4} /></> : null}
        {historyTiles.length ? <><SectionHeader title="Automation & history" /><TileGrid tiles={historyTiles} delay={6} /></> : null}

        <SectionHeader title="Server" />
        <ListGroup>
          {control && !child ? <ListRow icon={<HeartPulse />} iconColor={rt.paused ? t.colors.warning : undefined}
            title="Status" value={rt.paused ? 'Paused' : undefined} onPress={() => router.push('/server')} /> : null}
          <ListRow icon={<Activity />} title="Connection" value={online ? 'Online' : view.title}
            onPress={() => router.push(`/connection/${server.parent ?? server.id}`)} />
          {rt?.info?.features?.config_catalog && owner ? <ListRow icon={<Cpu />} title="Agent configuration" onPress={() => router.push('/advanced-config')} /> : null}
        </ListGroup>

        <SectionHeader title="Access" />
        <ListGroup>
          {!child && rt?.info?.features?.roles ? <ListRow icon={<ShieldCheck />} title="Devices"
            value={rt.me ? rt.me.role === 'owner' ? 'Owner' : 'Member' : undefined} onPress={() => router.push('/devices')} /> : null}
          <ListRow icon={<Star />} title="Open the app on this bot" value={mainBot?.id === server.id ? 'Main' : undefined}
            right={mainBot?.id === server.id ? <Check size={20} color={t.colors.accent} /> : undefined} chevron={false}
            onPress={mainBot?.id === server.id ? undefined : () => setMainBot(server.id)} />
        </ListGroup>
        {child && parent && owner ? <ManageBot server={server} parent={parent} /> : null}

        {rt?.info?.version ? <Footnote style={s.version}>Server plugin {rt.info.version}{rt.info.hermes_version ? ` · Hermes ${rt.info.hermes_version}` : ''}</Footnote> : null}
      </Animated.ScrollView>
      <HubBar y={y} right={<BotSwitcher />} />
    </View>
  );
}

/** The agent's configuration (owners only), refreshed when you come back from the model picker. */
function useAgentInfo(server: Server, enabled: boolean): AgentInfo | null {
  const [loaded, setLoaded] = useState<{ id: string; info: AgentInfo } | null>(null);
  const online = useApp((st) => st.runtime[server.id]?.status === 'online');
  useFocusEffect(useCallback(() => {
    if (!enabled || !online) return;
    api<AgentInfo>(server, '/api/agent').then((info) => setLoaded({ id: server.id, info })).catch(() => undefined);
  }, [server, online, enabled]));
  return enabled && loaded?.id === server.id ? loaded.info : null;
}

type TileSpec = { key: string; icon: ReactElement; title: string; value?: string; onPress: () => void };

/** Two frosted tiles a row; an odd one out takes the whole row. */
function TileGrid({ tiles, delay }: { tiles: TileSpec[]; delay: number }) {
  const s = useStyles();
  const rows: TileSpec[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
  return (
    <View style={s.grid}>
      {rows.map((row, r) => (
        <View key={row[0].key} style={s.gridRow}>
          {row.map((tile, c) => <Tile key={tile.key} tile={tile} wide={row.length === 1} order={delay + r * 2 + c} />)}
        </View>
      ))}
    </View>
  );
}

const Tile = memo(function Tile({ tile, wide, order }: { tile: TileSpec; wide: boolean; order: number }) {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
  return (
    <Animated.View style={s.tileCell} entering={reduced ? undefined : FadeInDown.delay(Math.min(order, 10) * 40).springify().damping(22).stiffness(180)}>
      <Tap feedback="selection" scaleTo={0.96} accessibilityLabel={tile.value ? `${tile.title}, ${tile.value}` : tile.title} onPress={tile.onPress}
        style={({ pressed, hovered }) => [s.tile, wide && s.tileWide, (pressed || hovered) && { borderColor: t.colors.borderStrong }]}>
        <View style={s.tileIcon}>{cloneElement(tile.icon as ReactElement<{ size?: number; color?: string }>, { size: 20, color: t.colors.onAccentSoft })}</View>
        <View style={wide ? s.tileTextWide : s.tileText}>
          <Text style={s.tileTitle} numberOfLines={1}>{tile.title}</Text>
          {tile.value ? <Text style={s.tileValue} numberOfLines={1}>{tile.value}</Text> : null}
        </View>
        {wide ? <ChevronRight size={18} color={t.colors.textTertiary} /> : null}
      </Tap>
    </Animated.View>
  );
});

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: t.space.lg, maxWidth: 680, width: '100%', alignSelf: 'center' },
  hero: {
    alignItems: 'center', gap: t.space.md, marginTop: t.space.sm, paddingTop: t.space.xl, paddingBottom: t.space.xl, paddingHorizontal: t.space.xl,
    backgroundColor: t.colors.card, borderRadius: t.radius.xl, borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  name: { ...t.type.display, color: t.colors.text, textAlign: 'center', marginTop: t.space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.space.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, paddingHorizontal: t.space.md, maxWidth: '100%',
    borderRadius: t.radius.pill, backgroundColor: t.colors.pressed, borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  pillText: { ...t.type.caption, color: t.colors.textSecondary, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: t.radius.pill },
  heroActions: { flexDirection: 'row', gap: t.space.sm, alignSelf: 'stretch', marginTop: t.space.sm },
  heroButton: { flex: 1 },
  grid: { gap: t.space.md },
  gridRow: { flexDirection: 'row', gap: t.space.md },
  tileCell: { flex: 1 },
  tile: {
    minHeight: 104, padding: t.space.lg, gap: t.space.md, justifyContent: 'space-between',
    backgroundColor: t.colors.card, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  tileWide: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingVertical: t.space.md },
  tileIcon: { width: 40, height: 40, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tileText: { gap: 2 },
  tileTextWide: { flex: 1, minWidth: 0, gap: 2 },
  tileTitle: { ...t.type.bodyStrong, color: t.colors.text },
  tileValue: { ...t.type.caption, color: t.colors.textSecondary },
  version: { alignItems: 'center', paddingTop: t.space.xl },
}));
