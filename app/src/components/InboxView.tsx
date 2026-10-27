import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { ago } from '../lib/agent';
import { useReducedMotion } from '../lib/motion';
import { useApp, useServerState } from '../lib/store';
import { WIDE_BREAKPOINT } from '../lib/theme';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { InboxItem, Server } from '../lib/types';
import { AgentFace } from './AgentFace';
import { NavigationToggle } from './AppNavigation';
import { Aurora, useAuroraColors } from './Aurora';
import { Glass } from './Glass';
import { ArrowRight } from './icons';
import { InboxCard } from './InboxCards';
import { LivePet } from './LivePet';
import { useTabBarSpace } from './TabBar';
import { Chip, Segmented, Tap } from './ui';

type Entry = { server: Server; item: InboxItem };

/** Height of a hub screen's top bar below the status bar. */
export const HUB_BAR = 56;
/** How far a hub screen's large title scrolls before the small one appears in the bar. */
const TITLE_SWAP = 44;

/**
 * The top bar of a hub screen (Inbox, Agent): it floats over the content and turns to frosted glass once something
 * scrolls under it, like a pushed screen's bar. `title` fades in once the large title has scrolled away.
 */
export function HubBar({ y, title, right }: { y: SharedValue<number>; title?: string; right?: ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const frost = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, TITLE_SWAP + 8], [0, 1], 'clamp') }));
  const small = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [TITLE_SWAP - 12, TITLE_SWAP + 8], [0, 1], 'clamp') }));
  return (
    <View style={[s.bar, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, frost]}>
        <Glass borderless style={StyleSheet.absoluteFill} />
        <View style={s.barRule} />
      </Animated.View>
      <View style={s.barInner}>
        <NavigationToggle />
        <Animated.Text style={[s.smallTitle, small]} numberOfLines={1} accessible={false}>{title ?? ''}</Animated.Text>
        {right}
      </View>
    </View>
  );
}

/** The bot's glow behind the top of a hub screen; it drifts up and away as you scroll. */
export function HubGlow({ y, server, height = 380 }: { y: SharedValue<number>; server?: Server; height?: number }) {
  const colors = useAuroraColors(server);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, y.value) * 0.6 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height }, slide]}>
      <Aurora colors={colors} strength={0.75} />
    </Animated.View>
  );
}

/** Everything that needs you, across every paired bot, with a filter per bot. */
export function InboxView() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ item?: string; server?: string }>();
  const servers = useApp((st) => st.servers);
  const selectedId = useApp((st) => st.selection.serverId);
  // Each bot's inbox and count, not its messages: a reply streaming in doesn't re-render the inbox.
  const inboxes = useApp(useShallow((st) => st.servers.map((x) => st.runtime[x.id]?.inbox)));
  const pendings = useApp(useShallow((st) => st.servers.map((x) => st.runtime[x.id]?.pending ?? 0)));
  const loadInbox = useApp((st) => st.loadInbox);
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [only, setOnly] = useState<string | null>(null);
  const list = useRef<FlatList<Entry>>(null);
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  // The glow and the empty state follow the bot you're filtering to, or the one you're on.
  const focus = servers.find((x) => x.id === only) ?? servers.find((x) => x.id === selectedId) ?? servers[0];

  useEffect(() => {
    servers.forEach((srv) => loadInbox(srv.id));
  }, [servers, loadInbox]);

  const entries = useMemo(() => {
    const all: Entry[] = [];
    servers.forEach((server, i) => {
      if (only && server.id !== only) return;
      for (const item of Object.values(inboxes[i] ?? {})) all.push({ server, item });
    });
    all.sort((a, b) => b.item.created_at - a.item.created_at);
    const pending = all.filter((e) => e.item.status === 'pending');
    return view === 'pending' ? pending : [...pending, ...all.filter((e) => e.item.status !== 'pending').slice(0, 60)];
  }, [servers, inboxes, only, view]);

  const pendingCount = servers.reduce((n, x, i) => n + (only && x.id !== only ? 0 : pendings[i] ?? 0), 0);

  // A notification opens the exact card it was about, once: scrolling away afterwards isn't undone.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!params.item || scrolledTo.current === params.item) return;
    const target = entries.findIndex((e) => e.item.id === params.item);
    if (target < 0) {
      if (view === 'pending') setView('all');
      return;
    }
    scrolledTo.current = params.item;
    setTimeout(() => list.current?.scrollToIndex({ index: target, animated: true, viewPosition: 0.1 }), 300);
  }, [params.item, entries, view]);

  const renderItem = useCallback(({ item: e, index }: { item: Entry; index: number }) => (
    <Animated.View entering={reduced ? undefined : FadeInDown.delay(Math.min(index, 6) * 55).springify().damping(22).stiffness(180)}>
      <InboxEntry server={e.server} item={e.item} highlighted={params.item === e.item.id} />
    </Animated.View>
  ), [reduced, params.item]);

  return (
    <View style={s.root}>
      <HubGlow y={y} server={focus} />
      <Animated.FlatList
        ref={list}
        data={entries}
        keyExtractor={(e) => `${e.server.id}:${e.item.id}`}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollToIndexFailed={() => undefined}
        contentContainerStyle={[s.content, {
          paddingTop: insets.top + HUB_BAR,
          paddingBottom: (width >= WIDE_BREAKPOINT ? 24 : tabSpace) + 8,
        }]}
        ListHeaderComponent={
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">Inbox</Text>
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[{ value: 'pending', label: pendingCount ? `Needs you (${pendingCount})` : 'Needs you' }, { value: 'all', label: 'Everything' }]}
            />
            {servers.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm }}>
                <Chip label="All bots" selected={!only} onPress={() => setOnly(null)} />
                {servers.map((srv, i) => (
                  <Chip key={srv.id} label={`${srv.bot.title}${pendings[i] ? ` (${pendings[i]})` : ''}`}
                    icon={<AgentFace server={srv} size={20} still />} selected={only === srv.id} onPress={() => setOnly(only === srv.id ? null : srv.id)} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={
          <View style={s.empty}>
            {focus ? <LivePet server={focus} size={104} glow /> : null}
            <Text style={s.emptyText}>{view === 'pending' ? 'Nothing needs you right now.' : 'Approvals, questions and results appear here.'}</Text>
          </View>
        }
        renderItem={renderItem}
      />
      <HubBar y={y} title="Inbox" />
    </View>
  );
}

function Gap() {
  const t = useTheme();
  return <View style={{ height: t.space.md }} />;
}

/** One notification: which bot and chat it's from, then the card itself. */
const InboxEntry = memo(function InboxEntry({ server, item, highlighted }: { server: Server; item: InboxItem; highlighted: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const rt = useServerState(server.id);
  const chat = rt?.chats[item.chat_id];
  return (
    <View style={[s.entry, highlighted && s.highlight]}>
      <View style={s.meta}>
        <AgentFace server={server} size={34} still />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.metaBot} numberOfLines={1}>{server.bot.title}</Text>
          <Text style={s.metaText} numberOfLines={1}>
            {chat?.kind === 'home' ? 'Updates' : chat?.title ?? item.chat_id} · {ago(item.created_at)}
          </Text>
        </View>
        <Tap feedback="selection" accessibilityRole="link" accessibilityLabel="Open chat" hitSlop={6} scaleTo={0.94}
          onPress={() => router.push(`/chat/${server.id}/${item.chat_id}`)}
          style={({ hovered }) => [s.open, hovered && { opacity: 0.85 }]}>
          <Text style={s.openText}>Open chat</Text>
          <ArrowRight size={14} color={t.colors.onAccentSoft} />
        </Tap>
      </View>
      <InboxCard serverId={server.id} item={item} bare />
    </View>
  );
});

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 },
  barRule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: t.colors.border },
  barInner: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, minHeight: 52, paddingHorizontal: t.space.sm, maxWidth: 696, width: '100%', alignSelf: 'center' },
  smallTitle: { ...t.type.heading, color: t.colors.text, flex: 1, minWidth: 0, marginLeft: t.space.xs },
  content: { paddingHorizontal: t.space.lg, flexGrow: 1, maxWidth: 680, width: '100%', alignSelf: 'center' },
  head: { gap: t.space.lg, marginBottom: t.space.lg },
  title: { ...t.type.display, color: t.colors.text, marginTop: t.space.xs },
  entry: {
    backgroundColor: t.colors.card, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.cardBorder,
    padding: t.space.lg, gap: t.space.md,
  },
  highlight: { borderColor: t.colors.accent, borderWidth: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  metaBot: { ...t.type.label, color: t.colors.text },
  metaText: { ...t.type.caption, color: t.colors.textSecondary, marginTop: 1 },
  open: {
    flexDirection: 'row', alignItems: 'center', gap: t.space.xs, minHeight: 34, paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill, backgroundColor: t.colors.accentSoft,
  },
  openText: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.onAccentSoft },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xxl, gap: t.space.xl, minHeight: 360 },
  emptyText: { ...t.type.body, color: t.colors.textSecondary, textAlign: 'center', maxWidth: 320 },
}));
