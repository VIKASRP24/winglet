import { router, usePathname } from 'expo-router';
import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { startNewChat } from '../lib/actions';
import { useLock } from '../lib/appLock';
import { chatKey } from '../lib/chatOrganization';
import { chatActivity, chatActivityLabel, draftPreview, matchesChatFilter, type ChatFilter } from '../lib/chatActivity';
import { haptic } from '../lib/haptics';
import { spring, useReducedMotion, useReducedTransparency } from '../lib/motion';
import { navigationWidth, sidebarChats, sidebarDrawerWidth } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { homeChat, isOwner, useApp } from '../lib/store';
import { alpha } from '../lib/theme';
import { useActivityClock } from '../lib/useActivityClock';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Chat, Server } from '../lib/types';
import { ChatMenu } from './ChatMenu';
import { ChatFilters } from './ChatFilters';
import { ProjectSection } from '../features/projects/ProjectSection';
import { Aurora, useAuroraColors } from './Aurora';
import { BotFaces } from './BotSwitcher';
import { Glass } from './Glass';
import { KeyboardViewport } from './KeyboardViewport';
import { Archive, Bot, CalendarClock, Inbox, MessageCircle, MessagesSquare, MoreHorizontal, PanelLeft, Pin, Settings, SquarePen, Users } from './icons';
import { AgentFace } from './AgentFace';
import { Badge, Button, IconButton, SearchField, Tap } from './ui';
import { ago } from '../lib/agent';
import { connectionView } from '../lib/connection';

/** A mouse can't long-press: rows get a visible options button only where there's hover. */
const HOVER = Platform.OS === 'web' && !globalThis.matchMedia?.('(hover: none)').matches;
const Navigation = createContext({ open: () => {}, close: () => {}, home: () => {}, homeRevision: 0, reserved: 0 });
const NO_CHATS = {};
const NO_TYPING = {};
const NO_INBOX = {};
/** Rows past this many arrive without a stagger, so a long list never waits on its tail. */
const STAGGERED = 14;
export const useAppNavigation = () => useContext(Navigation);
export function useContentWidth() { return useWindowDimensions().width - useAppNavigation().reserved; }

/** One navigation shell for the landing chat, conversations and every settings screen. */
export function AppNavigation({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const mode = usePrefs((s) => s.prefs.sidebar);
  const paired = useApp((s) => s.servers.length > 0);
  const locked = useLock((s) => s.locked);
  const pathname = usePathname();
  const [opened, setOpened] = useState(false);
  const [homeRevision, setHomeRevision] = useState(0);
  const reserved = paired && !locked && pathname !== '/pair' ? navigationWidth(width, mode) : 0;
  const close = useCallback(() => setOpened(false), []);
  const open = useCallback(() => { if (useLock.getState().locked) return; Keyboard.dismiss(); setOpened(true); }, []);
  const home = useCallback(() => {
    if (useLock.getState().locked) return;
    Keyboard.dismiss();
    close();
    setHomeRevision((n) => n + 1);
    router.navigate('/');
  }, [close]);
  const value = useMemo(() => ({ open, close, home, homeRevision, reserved }), [open, close, home, homeRevision, reserved]);
  useEffect(close, [pathname, mode, close]);
  useEffect(() => { if (locked) close(); }, [locked, close]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !opened) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [opened, close]);
  return <Navigation.Provider value={value}>
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      {reserved >= 280 ? <Sidebar onClose={() => usePrefs.getState().update({ sidebar: 'drawer' })} /> : reserved ? <NavigationRail /> : null}
      <View style={{ flex: 1, minWidth: 0 }} pointerEvents={locked ? 'none' : 'auto'} aria-hidden={opened || locked} importantForAccessibility={opened || locked ? 'no-hide-descendants' : 'auto'}>{children}</View>
      {locked ? null : <SidebarDrawer visible={opened} onClose={close} />}
    </View>
  </Navigation.Provider>;
}

export function NavigationToggle() {
  const t = useTheme();
  const nav = useAppNavigation();
  return <IconButton label={nav.reserved >= 280 ? 'Collapse sidebar' : 'Open sidebar'} onPress={nav.reserved >= 280 ? () => usePrefs.getState().update({ sidebar: 'drawer' }) : nav.open}>
    <PanelLeft size={22} color={t.colors.text} />
  </IconButton>;
}

export function InboxButton() {
  const t = useTheme();
  const count = useApp((s) => Object.values(s.runtime).reduce((n, rt) => n + (rt?.pending ?? 0), 0));
  return <IconButton label={count ? `Inbox, ${count} waiting` : 'Inbox'} onPress={() => router.navigate('/inbox')}>
    <View><Inbox size={22} color={t.colors.text} /><Badge count={count} style={{ position: 'absolute', top: -9, right: -10 }} /></View>
  </IconButton>;
}

export function NavigationHeader({ title, inbox = false, right }: { title?: string; inbox?: boolean; right?: ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return <View style={[s.header, { paddingTop: insets.top + 6 }]}>
    <NavigationToggle />
    <Text numberOfLines={1} accessibilityRole="header" style={s.headerTitle}>{title}</Text>
    {right}{inbox ? <InboxButton /> : null}
  </View>;
}

function SidebarDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const drawerWidth = sidebarDrawerWidth(width);
  const x = useSharedValue(-drawerWidth);
  useEffect(() => {
    // Closing releases the overlay immediately; interaction must never depend on an animation callback.
    x.value = visible ? reduced ? 0 : withSpring(0, spring.snappy) : -drawerWidth;
  }, [visible, drawerWidth, reduced, x]);
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => back.remove();
  }, [visible, onClose]);
  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // The scrim follows the panel, so dragging it shut lifts the dim with your finger.
  const dim = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, 1 + x.value / drawerWidth)) }));
  const pan = Gesture.Pan().activeOffsetX(-12).failOffsetY([-16, 16])
    .onUpdate((e) => { x.value = Math.min(0, e.translationX); })
    .onEnd((e, success) => {
      if (success && (e.translationX < -drawerWidth * 0.25 || e.velocityX < -650)) runOnJS(onClose)();
      else x.value = reduced ? 0 : withSpring(0, spring.snappy);
    }).onFinalize((_e, success) => { if (!success) x.value = reduced ? 0 : withSpring(0, spring.snappy); });
  if (!visible) return null;
  return <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 30 }]}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: t.colors.overlay }, dim]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sidebar" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ width: drawerWidth, flex: 1 }}>
      <KeyboardViewport>{() => <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View accessibilityViewIsModal style={[{ width: drawerWidth, flex: 1 }, s.drawerPanel, panel]}>
          <View style={s.drawerClip}><Sidebar onClose={onClose} drawer /></View>
        </Animated.View>
      </GestureDetector>}</KeyboardViewport>
      </View>
    </GestureHandlerRootView>
  </View>;
}

type RowTone = 'draft' | 'pending' | 'running';

function Sidebar({ onClose, drawer = false }: { onClose: () => void; drawer?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const navigation = useAppNavigation();
  const reduced = useReducedMotion();
  const servers = useApp((st) => st.servers);
  const selected = useApp((st) => st.selection);
  const chats = useApp(useShallow((st) => Object.fromEntries(st.servers.map((bot) => [bot.id, st.runtime[bot.id]?.chats ?? NO_CHATS]))));
  const prefs = usePrefs((st) => st.prefs);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const typing = useApp(useShallow((st) => Object.fromEntries(st.servers.map((bot) => [bot.id, st.runtime[bot.id]?.typing ?? NO_TYPING]))));
  const inbox = useApp(useShallow((st) => Object.fromEntries(st.servers.map((bot) => [bot.id, st.runtime[bot.id]?.inbox ?? NO_INBOX]))));
  const roles = useApp(useShallow((st) => Object.fromEntries(st.servers.map((bot) => [bot.id, st.runtime[bot.id]?.me?.role ?? 'owner']))));
  const waiting = useApp((st) => Object.values(st.runtime).reduce((n, rt) => n + (rt?.pending ?? 0), 0));
  const drafts = useApp((st) => st.drafts);
  const draftFiles = useApp((st) => st.draftFiles);
  const replyTo = useApp((st) => st.replyTo);
  const network = useApp((st) => st.network);
  const now = useActivityClock(typing);
  const [menu, setMenu] = useState<{ server: Server; chat: Chat } | null>(null);
  const glassTarget = useRef<View>(null);
  const reducedTransparency = useReducedTransparency();
  const server = servers.find((bot) => bot.id === selected.serverId) ?? servers[0];
  const aurora = useAuroraColors(server);
  const rt = useApp((st) => server ? st.runtime[server.id] : undefined);
  const view = connectionView(network, rt, server?.bot.title ?? '');
  const canSchedule = !!rt?.info?.features?.control && isOwner(rt);
  // Actionable chats remain findable even if they were archived on this device.
  const all = useMemo(() => {
    const previews = Object.fromEntries(servers.flatMap((bot) => Object.values(chats[bot.id] ?? {}).map((chat) => {
      const key = `${bot.id}:${chat.id}`;
      return [chatKey(bot.id, chat.id), draftPreview(drafts[key], draftFiles[key], !!replyTo[key])];
    })));
    return sidebarChats(servers, chats, prefs.pinnedChats, filter === 'all' ? prefs.archivedChats : [], query, previews);
  }, [servers, chats, prefs.pinnedChats, prefs.archivedChats, query, filter, drafts, draftFiles, replyTo]);
  const stateOf = (botId: string, chatId: string) => chatActivity({ typing: typing[botId], inbox: inbox[botId], me: { role: roles[botId] } }, chatId, now);
  const rows = all.filter(({ server: bot, chat }) => matchesChatFilter(filter, stateOf(bot.id, chat.id)));
  const counts = servers.reduce((total, bot) => {
    for (const chat of Object.values(chats[bot.id] ?? {})) {
      if (chat.kind !== 'chat') continue;
      const state = stateOf(bot.id, chat.id);
      total.running += Number(state.running);
      total.pending += Number(state.pending > 0);
    }
    return total;
  }, { running: 0, pending: 0 });
  const [creating, setCreating] = useState(false);
  const go = (path: string) => { Keyboard.dismiss(); if (drawer) onClose(); if (path === '/') navigation.home(); else router.navigate(path); };
  // Rows are memoized; they reach the latest navigation through a ref rather than a fresh callback every render.
  const goRef = useRef(go);
  goRef.current = go;
  const openChat = useCallback((bot: Server, chat: Chat) => {
    haptic.selection();
    useApp.getState().select(bot.id, chat.id);
    goRef.current(`/chat/${bot.id}/${chat.id}`);
  }, []);
  const openMenu = useCallback((bot: Server, chat: Chat) => { Keyboard.dismiss(); setMenu({ server: bot, chat }); }, []);
  const newChat = async () => {
    if (!server || creating) return;
    setCreating(true);
    await startNewChat(server.id, (id) => {
      useApp.getState().select(server.id, id);
      go(`/chat/${server.id}/${id}`);
    });
    setCreating(false);
  };
  const enter = (index: number) => reduced || index >= STAGGERED ? undefined
    : FadeInDown.delay(index * 28).springify().damping(spring.soft.damping).stiffness(spring.soft.stiffness);
  const tile = (label: string, Icon: typeof Bot, path: string, index: number, badge = 0) => {
    const on = pathname === path;
    return <Animated.View key={path} entering={enter(index)} style={s.tileSlot}>
      <Tap accessibilityLabel={badge ? `${label}, ${badge} waiting` : label} feedback="selection" scaleTo={0.95}
        accessibilityState={{ selected: on }} onPress={() => go(path)}
        style={({ pressed, hovered }) => [s.tile, on ? s.tileOn : (pressed || hovered) && s.tileHover]}>
        <View style={[s.tileIcon, on && { backgroundColor: t.colors.accentFill }]}>
          <Icon size={17} color={on ? t.colors.onAccent : t.colors.accent} />
        </View>
        <Text style={[s.tileText, on && { color: t.colors.onAccentSoft }]} numberOfLines={1}>{label}</Text>
        {badge ? <Badge count={badge} style={s.tileBadge} /> : null}
      </Tap>
    </Animated.View>;
  };
  const multiBot = servers.length > 1;
  const footer = Math.max(insets.bottom, 12) + 64; // the floating New chat bar
  const Backdrop = reducedTransparency ? View : BlurTargetView;
  return <View style={[s.sidebar, drawer ? null : s.sidebarPinned, { width: drawer ? '100%' : 300 }]}>
    <Backdrop ref={glassTarget} style={{ flex: 1 }}>
      <View pointerEvents="none" style={s.glow}>
        <Aurora colors={aurora} strength={0.6} />
        <LinearGradient pointerEvents="none" colors={[alpha(t.colors.surface, 0), t.colors.surface]} style={s.glowFade} />
      </View>
      <View style={{ paddingTop: insets.top + 10 }}>
        <View style={s.brandRow}>
          {server ? <Tap accessibilityLabel={`${server.bot.title}, ${view.kind === 'online' ? 'online' : view.title}. Open main chat`} onPress={() => go('/')}
            scaleTo={0.98} style={({ pressed }) => [s.brand, pressed && { opacity: 0.8 }]}>
            <View style={s.faceRing}><AgentFace server={server} size={48} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.brandName} numberOfLines={1}>{server.bot.title}</Text>
              <View style={s.brandStatus}>
                <View style={[s.halo, { backgroundColor: view.tone === 'ok' ? t.colors.successSoft : view.tone === 'error' ? t.colors.dangerSoft : t.colors.warningSoft }]}>
                  <View style={[s.dot, { backgroundColor: view.tone === 'ok' ? t.colors.success : view.tone === 'error' ? t.colors.danger : t.colors.warning }]} />
                </View>
                <Text style={s.brandStatusText} numberOfLines={1}>{view.kind === 'online' ? 'Online' : view.title}</Text>
              </View>
            </View>
          </Tap> : <View style={{ flex: 1 }} />}
          <IconButton label="Settings" onPress={() => go('/settings')}><Settings size={21} color={t.colors.textSecondary} /></IconButton>
          {drawer ? null : <IconButton label="Collapse sidebar" onPress={onClose}><PanelLeft size={21} color={t.colors.textSecondary} /></IconButton>}
        </View>
        {multiBot && server ? <BotFaces server={server} /> : null}
        <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" style={s.search} />
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.scroll, { paddingBottom: footer + 8 }]}>
        {query ? null : <View style={s.tiles}>
          {tile('Inbox', Inbox, '/inbox', 0, waiting)}
          {tile('Rooms', Users, '/rooms', 1)}
          {canSchedule ? tile('Schedule', CalendarClock, '/schedule', 2) : null}
          {tile('All chats', Archive, '/chats', 3)}
        </View>}
        {server && !query ? <ProjectSection server={server} onNavigate={navigation.close} /> : null}
        <View style={s.filterRow}>
          <ChatFilters value={filter} counts={counts} onChange={(value) => { if (value !== 'archived') setFilter(value); }} />
        </View>
        {rows.length ? rows.slice(0, query || filter !== 'all' ? 100 : 40).map(({ server: bot, chat, pinned }, index) => {
          const previous = rows[index - 1];
          const group = index === 0 || pinned !== previous?.pinned;
          const active = pathname.startsWith('/chat/') && selected.serverId === bot.id && selected.chatId === chat.id;
          const state = stateOf(bot.id, chat.id);
          const home = chat.id === homeChat(useApp.getState().runtime[bot.id]);
          const title = home ? bot.bot.title : chat.title;
          const draft = draftPreview(drafts[`${bot.id}:${chat.id}`], draftFiles[`${bot.id}:${chat.id}`], !!replyTo[`${bot.id}:${chat.id}`]);
          const status = chatActivityLabel(state);
          const label = `${home ? `${bot.bot.title} main chat` : chat.title}${multiBot && !home ? `, ${bot.bot.title}` : ''}${pinned ? ', pinned' : ''}${status ? `, ${status}` : ''}${draft ? `, ${draft}` : ''}`;
          return <View key={chatKey(bot.id, chat.id)}>
            {group && !query ? <Text style={s.section} accessibilityRole="header">{filter === 'running' ? 'Running' : filter === 'needs-you' ? 'Needs you' : pinned ? 'Pinned' : 'Recent'}</Text> : null}
            <SidebarChatRow bot={bot} chat={chat} title={title} label={label} pinned={pinned} active={active} showFace={multiBot}
              detail={draft ?? status} tone={draft ? 'draft' : state.pending ? 'pending' : 'running'} index={index}
              onOpen={openChat} onMenu={openMenu} />
          </View>;
        }) : <Text style={s.noChats}>{query ? 'No matching chats' : filter === 'running' ? 'Nothing running.' : filter === 'needs-you' ? 'Nothing waiting on you.' : 'Your chats will appear here.'}</Text>}
      </ScrollView>
    </Backdrop>
    <Glass target={reducedTransparency ? undefined : glassTarget} borderless style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Button title={creating ? 'Starting…' : 'New chat'} icon={<SquarePen size={18} color={t.colors.onAccent} />} disabled={creating || !server}
        onPress={newChat} size="lg" />
    </Glass>
    {menu ? <ChatMenu server={menu.server} chatId={menu.chat.id} title={menu.chat.title} visible onClose={() => setMenu(null)} /> : null}
  </View>;
}

/** One conversation in the sidebar: title and time, one line of status or draft, a soft accent pill when open. */
const SidebarChatRow = memo(function SidebarChatRow({ bot, chat, title, label, pinned, active, showFace, detail, tone, index, onOpen, onMenu }: {
  bot: Server; chat: Chat; title: string; label: string; pinned: boolean; active: boolean; showFace: boolean;
  detail: string | null; tone: RowTone; index: number;
  onOpen: (bot: Server, chat: Chat) => void; onMenu: (bot: Server, chat: Chat) => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const color = tone === 'draft' ? t.colors.textSecondary : tone === 'pending' ? t.colors.warning : t.colors.accent;
  const entering = reduced || index >= STAGGERED ? undefined
    : FadeInDown.delay(120 + index * 28).springify().damping(spring.soft.damping).stiffness(spring.soft.stiffness);
  return <Animated.View entering={entering} {...(HOVER ? { onPointerEnter: () => setHover(true), onPointerLeave: () => setHover(false) } : {})}>
    <Tap accessibilityLabel={label} accessibilityHint="Long-press for chat options" scaleTo={0.98}
      onLongPress={() => onMenu(bot, chat)} delayLongPress={350}
      accessibilityState={{ selected: active }} onPress={() => onOpen(bot, chat)}
      style={({ pressed, hovered }) => [s.chatRow, active ? s.chatRowOn : (pressed || hovered) && s.chatRowHover]}>
      {showFace ? <AgentFace server={bot} size={28} still /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.chatTop}>
          {pinned ? <Pin size={12} color={active ? t.colors.onAccentSoft : t.colors.textTertiary} /> : null}
          <Text style={[s.chatTitle, active && s.chatTitleOn]} numberOfLines={1}>{title}</Text>
          <Text style={[s.chatTime, HOVER && hover && { opacity: 0 }]}>{ago(chat.updated_at)}</Text>
        </View>
        {detail ? <Text numberOfLines={1} style={[s.chatDetail, { color }]}>{detail}</Text> : null}
      </View>
      {HOVER ? <IconButton label={`Options for ${title}`} size={32} style={[s.rowMore, { opacity: hover ? 1 : 0 }]}
        onPress={(e) => { e.stopPropagation(); onMenu(bot, chat); }}>
        <MoreHorizontal size={16} color={t.colors.textSecondary} />
      </IconButton> : null}
    </Tap>
  </Animated.View>;
});

function NavigationRail() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const nav = useAppNavigation();
  const pathname = usePathname();
  const count = useApp((st) => Object.values(st.runtime).reduce((n, rt) => n + (rt?.pending ?? 0), 0));
  const item = (label: string, Icon: typeof Bot, path?: string, action?: () => void) => {
    const active = path === '/' ? pathname === '/' || pathname.startsWith('/chat/') : !!path && pathname === path;
    return <View key={label} style={s.railSlot}>
      {active ? <View style={s.railIndicator} /> : null}
      <Tap accessibilityLabel={label} accessibilityState={{ selected: active }} feedback="selection"
        onPress={action ?? (() => router.navigate(path!))} style={({ pressed, hovered }) => [s.railButton, active && s.railButtonActive,
          (pressed || hovered) && !active && { backgroundColor: t.colors.pressed, borderRadius: 16 }]}>
        <Icon size={22} color={active ? t.colors.onAccentSoft : t.colors.textSecondary} />
        {path === '/inbox' ? <Badge count={count} style={{ position: 'absolute', right: -2, top: -3 }} /> : null}
      </Tap>
    </View>;
  };
  return <View style={[s.rail, { paddingTop: insets.top + 8, paddingBottom: Math.max(12, insets.bottom) }]}>
    {item('Open sidebar', PanelLeft, undefined, nav.open)}
    <View style={s.railDivider} />
    {item('Chat', MessageCircle, '/', nav.home)}
    {item('All chats', MessagesSquare, '/chats')}
    {item('Inbox', Inbox, '/inbox')}
    <View style={{ flex: 1 }} />
    <View style={s.railDivider} />
    {item('Rooms', Users, '/rooms')}
    {item('Agent', Bot, '/agent')}
    {item('Settings', Settings, '/settings')}
  </View>;
}

const useStyles = makeStyles((t) => ({
  sidebar: { height: '100%', backgroundColor: t.colors.surface, overflow: 'hidden' },
  sidebarPinned: { borderRightWidth: 1, borderRightColor: t.colors.border },
  drawerPanel: {
    borderTopRightRadius: t.radius.xl, borderBottomRightRadius: t.radius.xl, backgroundColor: t.colors.surface,
    shadowColor: t.colors.shadow, shadowOpacity: t.scheme === 'dark' ? 0.5 : 0.18, shadowRadius: 28, shadowOffset: { width: 6, height: 0 }, elevation: 16,
  },
  drawerClip: { flex: 1, borderTopRightRadius: t.radius.xl, borderBottomRightRadius: t.radius.xl, overflow: 'hidden',
    borderRightWidth: StyleSheet.hairlineWidth * 2, borderRightColor: t.colors.glassBorder },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  glowFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { flex: 1, minWidth: 0, ...t.type.heading, color: t.colors.text },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 14, paddingRight: 8, paddingBottom: 10 },
  brand: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  faceRing: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.glassBorder },
  brandName: { ...t.type.title, fontSize: 20, lineHeight: 25, color: t.colors.text },
  brandStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  brandStatusText: { ...t.type.footnote, fontFamily: t.fonts.medium, color: t.colors.textSecondary, flexShrink: 1 },
  halo: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  search: { marginHorizontal: 12, marginTop: 8, marginBottom: 6, height: 44 },
  scroll: { paddingHorizontal: 8, paddingTop: 6 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4, paddingBottom: 10 },
  tileSlot: { flexGrow: 1, flexBasis: '45%' },
  tile: { flexDirection: 'column', alignItems: 'flex-start', gap: 8, minHeight: 78, padding: 12,
    borderRadius: t.radius.lg, backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.cardBorder },
  tileOn: { backgroundColor: t.colors.accentSoft, borderColor: 'transparent' },
  tileHover: { backgroundColor: t.colors.pressed },
  tileIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft },
  tileText: { ...t.type.callout, fontFamily: t.fonts.semibold, color: t.colors.text, flexShrink: 1 },
  tileBadge: { position: 'absolute', top: 10, right: 10 },
  filterRow: { paddingTop: 6 },
  section: { ...t.type.label, color: t.colors.textTertiary, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8, paddingHorizontal: 14, borderRadius: t.radius.lg },
  chatRowOn: { backgroundColor: t.colors.accentSoft },
  chatRowHover: { backgroundColor: t.colors.pressed },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatTitle: { ...t.type.callout, fontFamily: t.fonts.medium, color: t.colors.text, flex: 1, minWidth: 0 },
  chatTitleOn: { fontFamily: t.fonts.semibold, color: t.colors.onAccentSoft },
  chatTime: { ...t.type.caption, fontFamily: t.fonts.regular, color: t.colors.textTertiary },
  chatDetail: { ...t.type.caption, fontFamily: t.fonts.medium, marginTop: 2 },
  rowMore: { position: 'absolute', right: 6, top: 10 },
  noChats: { ...t.type.callout, color: t.colors.textSecondary, padding: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: t.colors.glassBorder },
  rail: { width: 64, alignItems: 'center', gap: 9, backgroundColor: t.colors.surface, borderRightWidth: 1, borderRightColor: t.colors.border },
  railSlot: { width: 64, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  railButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: t.colors.card },
  railButtonActive: { borderRadius: 16, backgroundColor: t.colors.accentSoft },
  railIndicator: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: t.colors.accent },
  railDivider: { width: 26, height: 1, backgroundColor: t.colors.borderStrong, marginVertical: 2 },
}));
