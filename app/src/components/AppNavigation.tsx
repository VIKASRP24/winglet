import { router, usePathname } from 'expo-router';
import { BlurTargetView } from 'expo-blur';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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
import { useActivityClock } from '../lib/useActivityClock';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Chat, Server } from '../lib/types';
import { ChatMenu } from './ChatMenu';
import { ChatFilters } from './ChatFilters';
import { ProjectSection } from '../features/projects/ProjectSection';
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
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const drawerWidth = sidebarDrawerWidth(width);
  const x = useSharedValue(-drawerWidth);
  const opacity = useSharedValue(0);
  useEffect(() => {
    // Closing releases the overlay immediately; interaction must never depend on an animation callback.
    opacity.value = visible ? withTiming(1, { duration: reduced ? 0 : 180 }) : 0;
    x.value = visible ? reduced ? 0 : withSpring(0, spring.snappy) : -drawerWidth;
  }, [visible, drawerWidth, reduced, x, opacity]);
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => back.remove();
  }, [visible, onClose]);
  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const dim = useAnimatedStyle(() => ({ opacity: opacity.value }));
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
        <Animated.View accessibilityViewIsModal style={[{ width: drawerWidth, flex: 1 }, panel]}>
          <Sidebar onClose={onClose} drawer />
        </Animated.View>
      </GestureDetector>}</KeyboardViewport>
      </View>
    </GestureHandlerRootView>
  </View>;
}

function Sidebar({ onClose, drawer = false }: { onClose: () => void; drawer?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const navigation = useAppNavigation();
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
  const newChat = async () => {
    if (!server || creating) return;
    setCreating(true);
    await startNewChat(server.id, (id) => {
      useApp.getState().select(server.id, id);
      go(`/chat/${server.id}/${id}`);
    });
    setCreating(false);
  };
  const tile = (label: string, Icon: typeof Bot, path: string, badge = 0) => <Tap key={path} accessibilityLabel={badge ? `${label}, ${badge} waiting` : label}
    accessibilityState={{ selected: pathname === path }} onPress={() => go(path)}
    style={({ pressed, hovered }) => [s.tile, (pressed || hovered || pathname === path) && s.active]}>
    <Icon size={18} color={t.colors.textSecondary} /><Text style={s.tileText} numberOfLines={1}>{label}</Text>
    {badge ? <Badge count={badge} style={{ marginLeft: 'auto' }} /> : null}
  </Tap>;
  const multiBot = servers.length > 1;
  return <View style={[s.sidebar, { width: drawer ? '100%' : 300, paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }]}>
    {!reducedTransparency ? <BlurTargetView ref={glassTarget} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
    <Glass target={glassTarget} intensity={24} borderless style={StyleSheet.absoluteFill} />
    <View style={s.brandRow}>
      {server ? <Tap accessibilityLabel={`${server.bot.title}, ${view.kind === 'online' ? 'online' : view.title}. Open main chat`} onPress={() => go('/')}
        style={({ pressed }) => [s.brand, pressed && { opacity: 0.7 }]}>
        <AgentFace server={server} size={36} still />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.brandName} numberOfLines={1}>{server.bot.title}</Text>
          <View style={s.brandStatus}>
            <View style={[s.dot, { backgroundColor: view.tone === 'ok' ? t.colors.success : view.tone === 'error' ? t.colors.danger : t.colors.warning }]} />
            <Text style={s.brandStatusText} numberOfLines={1}>{view.kind === 'online' ? 'Online' : view.title}</Text>
          </View>
        </View>
      </Tap> : <View style={{ flex: 1 }} />}
      <IconButton label="Settings" onPress={() => go('/settings')}><Settings size={21} color={t.colors.textSecondary} /></IconButton>
      {drawer ? null : <IconButton label="Collapse sidebar" onPress={onClose}><PanelLeft size={21} color={t.colors.textSecondary} /></IconButton>}
    </View>
    <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" style={s.search} />
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
      {query ? null : <View style={s.tiles}>
        {tile('Inbox', Inbox, '/inbox', waiting)}
        {tile('Rooms', Users, '/rooms')}
        {canSchedule ? tile('Schedule', CalendarClock, '/schedule') : null}
        {tile('All chats', Archive, '/chats')}
      </View>}
      {server && !query ? <ProjectSection server={server} onNavigate={navigation.close} /> : null}
      <ChatFilters value={filter} counts={counts} onChange={(value) => { if (value !== 'archived') setFilter(value); }} />
      {rows.length ? rows.slice(0, query || filter !== 'all' ? 100 : 40).map(({ server: bot, chat, pinned }, index) => {
        const previous = rows[index - 1];
        const group = index === 0 || pinned !== previous?.pinned;
        const active = pathname.startsWith('/chat/') && selected.serverId === bot.id && selected.chatId === chat.id;
        const state = stateOf(bot.id, chat.id);
        const home = chat.id === homeChat(useApp.getState().runtime[bot.id]);
        const title = home ? bot.bot.title : chat.title;
        const draft = draftPreview(drafts[`${bot.id}:${chat.id}`], draftFiles[`${bot.id}:${chat.id}`], !!replyTo[`${bot.id}:${chat.id}`]);
        const status = chatActivityLabel(state);
        const detail = draft ?? status;
        const tone = draft ? t.colors.textSecondary : state.pending ? t.colors.warning : t.colors.accent;
        return <View key={chatKey(bot.id, chat.id)}>
          {group && !query ? <Text style={s.section}>{filter === 'running' ? 'Running' : filter === 'needs-you' ? 'Needs you' : pinned ? 'Pinned' : 'Recent'}</Text> : null}
          <Tap accessibilityLabel={`${home ? `${bot.bot.title} main chat` : chat.title}${multiBot && !home ? `, ${bot.bot.title}` : ''}${pinned ? ', pinned' : ''}${status ? `, ${status}` : ''}${draft ? `, ${draft}` : ''}`}
            accessibilityHint="Long-press for chat options" onLongPress={() => { Keyboard.dismiss(); setMenu({ server: bot, chat }); }} delayLongPress={350}
            accessibilityState={{ selected: active }} onPress={() => { haptic.selection(); useApp.getState().select(bot.id, chat.id); go(`/chat/${bot.id}/${chat.id}`); }}
            style={({ pressed, hovered }) => [s.chatRow, (active || pressed || hovered) && s.active]}>
            {multiBot ? <AgentFace server={bot} size={26} still /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={s.chatTop}>
                {pinned ? <Pin size={13} color={t.colors.textTertiary} /> : null}
                <Text style={s.chatTitle} numberOfLines={1}>{title}</Text>
                <Text style={s.chatTime}>{ago(chat.updated_at)}</Text>
              </View>
              {detail ? <Text numberOfLines={1} style={[s.chatDetail, { color: tone }]}>{detail}</Text> : null}
            </View>
            {HOVER ? <IconButton label={`Options for ${title}`} size={32} onPress={(e) => { e.stopPropagation(); setMenu({ server: bot, chat }); }}>
              <MoreHorizontal size={16} color={t.colors.textTertiary} />
            </IconButton> : null}
          </Tap>
        </View>;
      }) : <Text style={s.noChats}>{query ? 'No matching chats' : filter === 'running' ? 'Nothing running.' : filter === 'needs-you' ? 'Nothing waiting on you.' : 'Your chats will appear here.'}</Text>}
    </ScrollView>
    <View style={s.footer}>
      <Button title={creating ? 'Starting…' : 'New chat'} icon={<SquarePen size={18} color={t.colors.onAccent} />} disabled={creating || !server}
        onPress={newChat} style={{ flex: 1 }} />
    </View>
    {menu ? <ChatMenu server={menu.server} chatId={menu.chat.id} title={menu.chat.title} visible onClose={() => setMenu(null)} /> : null}
  </View>;
}

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
        <Icon size={22} color={active ? t.colors.onAccent : t.colors.textSecondary} />
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
  sidebar: { height: '100%', backgroundColor: t.colors.surface, borderRightWidth: 1, borderRightColor: t.colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { flex: 1, minWidth: 0, ...t.type.heading, color: t.colors.text },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 16, paddingRight: 8, paddingBottom: 12 },
  brand: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  brandName: { ...t.type.heading, color: t.colors.text },
  brandStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  brandStatusText: { ...t.type.footnote, color: t.colors.textSecondary },
  dot: { width: 7, height: 7, borderRadius: 4 },
  search: { marginHorizontal: 12, marginBottom: 8, height: 44 },
  scroll: { paddingHorizontal: 8, paddingBottom: 16 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4, paddingBottom: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 12,
    borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken },
  tileText: { ...t.type.callout, fontFamily: t.fonts.medium, color: t.colors.text, flexShrink: 1 },
  active: { backgroundColor: t.colors.pressed },
  section: { ...t.type.label, color: t.colors.textSecondary, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6 },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingVertical: 7, paddingHorizontal: 12, borderRadius: t.radius.sm },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatTitle: { ...t.type.callout, color: t.colors.text, flex: 1, minWidth: 0 },
  chatTime: { ...t.type.caption, fontFamily: t.fonts.regular, color: t.colors.textTertiary },
  chatDetail: { ...t.type.caption, fontFamily: t.fonts.medium, marginTop: 2 },
  noChats: { ...t.type.callout, color: t.colors.textSecondary, padding: 14 },
  footer: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8 },
  rail: { width: 64, alignItems: 'center', gap: 9, backgroundColor: t.colors.surface, borderRightWidth: 1, borderRightColor: t.colors.border },
  railSlot: { width: 64, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  railButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: t.colors.surfaceRaised },
  railButtonActive: { borderRadius: 15, backgroundColor: t.colors.accentFill },
  railIndicator: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: t.colors.accent },
  railDivider: { width: 26, height: 1, backgroundColor: t.colors.borderStrong, marginVertical: 2 },
}));
