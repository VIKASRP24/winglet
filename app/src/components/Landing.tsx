import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeInDown, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { headline } from '../lib/agent';
import { mainFirst } from '../lib/bots';
import { chatKey } from '../lib/chatOrganization';
import { haptic } from '../lib/haptics';
import { useReducedMotion } from '../lib/motion';
import { usePrefs } from '../lib/prefs';
import { homeChat, useApp, useServerState } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Server } from '../lib/types';
import { AgentFace, useAvatarColor } from './AgentFace';
import type { DockPetFrame } from './ChatPet';
import { CalendarClock, Inbox, MessageCircle, Plus, Sparkles, Sun } from './icons';
import { LivePet } from './LivePet';
import { Tap } from './ui';


export type LandingMode = 'bot' | 'new-chat';

type Suggestion = { key: string; kicker: string; title: string; icon: 'inbox' | 'chat' | 'sun' | 'spark' | 'calendar'; tone?: 'warning'; onPress: () => void };

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * The landing above the message box: the bot's pet glowing in its own colour, a greeting, a few things worth doing next
 * (what's waiting, chats to pick up, ideas to start from) and the bots to switch between. Everything else is in the
 * sidebar.
 */
export const Landing = memo(function Landing({ server, mode, focused, onPetLayout, onSuggest, onAddBot, onMode }: {
  server: Server; mode: LandingMode; focused: boolean; onPetLayout: (frame: DockPetFrame) => void;
  onSuggest: (text: string) => void; onAddBot: () => void; onMode: (mode: LandingMode) => void;
}) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const rt = useServerState(server.id);
  const color = useAvatarColor(server);
  const pending = useApp((st) => Object.values(st.runtime).reduce((n, r) => n + (r?.pending ?? 0), 0));
  const archived = usePrefs((st) => st.prefs.archivedChats);
  // Shorter screens get a smaller pet, so the landing always fits between the header and the message box.
  const short = useWindowDimensions().height < 780;
  const PET = short ? 80 : 104;
  const [centerY, setCenterY] = useState(0);
  useEffect(() => { if (centerY) onPetLayout({ centerY, size: PET }); }, [centerY, PET, onPetLayout]);

  const bot = server.bot.title;
  const status = headline(rt, bot).title;
  const fresh = mode === 'new-chat';
  const recent = useMemo(() => {
    if (!rt || fresh) return [];
    const home = homeChat(rt);
    // Untitled chats ("New chat") say nothing about what you'd pick up, so they stay in the sidebar.
    return Object.values(rt.chats).filter((c) => c.id !== home && c.kind !== 'home' && c.title && c.title !== 'New chat'
      && !archived.includes(chatKey(server.id, c.id)))
      .sort((a, b) => b.updated_at - a.updated_at).slice(0, 3);
  }, [rt?.chats, fresh, archived, server.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions: Suggestion[] = [
    ...(pending && !fresh ? [{ key: 'inbox', kicker: 'Inbox', title: `${pending} waiting on you`, icon: 'inbox' as const, tone: 'warning' as const,
      onPress: () => router.navigate('/inbox') }] : []),
    ...recent.map((c) => ({ key: c.id, kicker: 'Pick up', title: c.title || 'Untitled chat', icon: 'chat' as const,
      onPress: () => { useApp.getState().select(server.id, c.id); router.navigate(`/chat/${server.id}/${c.id}`); } })),
    { key: 'catch-up', kicker: 'Ask', title: 'Catch me up on what I missed', icon: 'sun', onPress: () => onSuggest('Catch me up on what I missed.') },
    { key: 'plan', kicker: 'Ask', title: 'Plan my day with me', icon: 'calendar', onPress: () => onSuggest('Help me plan my day.') },
    { key: 'can', kicker: 'Ask', title: `What can you do, ${bot}?`, icon: 'spark', onPress: () => onSuggest('What can you do for me?') },
  ];

  return <View style={s.root} pointerEvents={focused ? 'none' : 'box-none'}>
    <View style={[s.petStage, { width: PET * 2.4, height: PET * 1.7 }]} onLayout={(e) => setCenterY(e.nativeEvent.layout.y + e.nativeEvent.layout.height / 2)}>
      <Halo color={color} size={PET * 2.4} />
      {/* The message box's pet takes over (and flies down to it) while you type, so this one steps aside. */}
      <Float reduced={reduced || focused} style={{ opacity: focused ? 0 : 1 }}>
        <LivePet server={server} size={PET} bare draggable={false} active={!focused} />
      </Float>
    </View>
    <Animated.View entering={reduced ? undefined : FadeInDown.duration(420)} style={s.words}>
      <Text style={s.hello} accessibilityRole="header">{fresh ? 'New chat' : greeting()}</Text>
      <Text style={s.sub} numberOfLines={2}>{fresh ? `Start fresh with ${bot}` : status === 'All quiet' ? `What can ${bot} do for you?` : status}</Text>
    </Animated.View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rail} contentContainerStyle={s.railContent}
      keyboardShouldPersistTaps="handled" accessibilityLabel="Suggestions">
      {suggestions.map((x, i) => <Animated.View key={x.key} entering={reduced ? undefined : FadeInDown.delay(120 + i * 60).duration(380)}>
        <SuggestionCard item={x} />
      </Animated.View>)}
    </ScrollView>
    <BotRow server={server} mode={mode} onMode={onMode} onAddBot={onAddBot} />
  </View>;
});

function SuggestionCard({ item }: { item: Suggestion }) {
  const s = useStyles();
  const t = useTheme();
  const Icon = { inbox: Inbox, chat: MessageCircle, sun: Sun, spark: Sparkles, calendar: CalendarClock }[item.icon];
  const tint = item.tone === 'warning' ? t.colors.warning : t.colors.accent;
  return <Tap feedback="selection" scaleTo={0.96} onPress={item.onPress} accessibilityLabel={`${item.kicker}: ${item.title}`} style={s.card}>
    <View style={[s.cardIcon, { backgroundColor: item.tone === 'warning' ? t.colors.warningSoft : t.colors.accentSoft }]}>
      <Icon size={17} color={tint} />
    </View>
    <Text style={s.kicker} numberOfLines={1}>{item.kicker}</Text>
    <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
  </Tap>;
}

/** Your bots as faces: tap one to talk to it, + to add another, and a new-chat bubble to start fresh. */
function BotRow({ server, mode, onMode, onAddBot }: { server: Server; mode: LandingMode; onMode: (mode: LandingMode) => void; onAddBot: () => void }) {
  const s = useStyles();
  const t = useTheme();
  const servers = useApp((st) => st.servers);
  const chosen = usePrefs((st) => st.prefs.mainBot);
  const ordered = useMemo(() => mainFirst(servers, chosen), [servers, chosen]);
  const pick = (bot: Server) => {
    onMode('bot');
    const st = useApp.getState();
    if (st.selection.serverId !== bot.id) st.select(bot.id, homeChat(st.runtime[bot.id]));
  };
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.botScroll} contentContainerStyle={s.bots}
    keyboardShouldPersistTaps="handled" accessibilityLabel="Your bots">
    <Tap feedback="selection" accessibilityLabel="Start a new chat" accessibilityState={{ selected: mode === 'new-chat' }}
      onPress={() => onMode(mode === 'new-chat' ? 'bot' : 'new-chat')} style={[s.botRing, mode === 'new-chat' && { borderColor: t.colors.accent }]}>
      <View style={[s.botPlus, { backgroundColor: mode === 'new-chat' ? t.colors.accentSoft : t.colors.card }]}>
        <MessageCircle size={18} color={mode === 'new-chat' ? t.colors.accent : t.colors.textSecondary} />
      </View>
    </Tap>
    {ordered.map((bot) => {
      const active = mode === 'bot' && bot.id === server.id;
      return <Tap key={bot.id} feedback="none" accessibilityLabel={active ? `${bot.bot.title}, selected` : `Switch to ${bot.bot.title}`}
        accessibilityState={{ selected: active }} onPress={() => { haptic.selection(); pick(bot); }}
        style={[s.botRing, active && { borderColor: t.colors.accent }]}>
        <AgentFace server={bot} size={36} still />
      </Tap>;
    })}
    <Tap feedback="selection" accessibilityLabel="Add a bot" onPress={onAddBot} style={s.botRing}>
      <View style={[s.botPlus, { backgroundColor: t.colors.card }]}><Plus size={18} color={t.colors.textSecondary} /></View>
    </Tap>
  </ScrollView>;
}

/** A soft disc of the bot's colour behind its pet. */
function Halo({ color, size }: { color: string; size: number }) {
  const t = useTheme();
  const a = t.scheme === 'dark' ? 0.55 : 0.4;
  return <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size }}>
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="landing-halo" cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={a} />
          <Stop offset="0.5" stopColor={color} stopOpacity={a * 0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#landing-halo)" />
    </Svg>
  </View>;
}

/** A slow bob, so the pet feels like it's hovering there for you. */
function Float({ reduced, children, style }: { reduced: boolean; children: React.ReactNode; style?: object }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(y); y.value = withTiming(0, { duration: 200 }); return; }
    y.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const pose = useAnimatedStyle(() => ({ transform: [{ translateY: -7 * y.value }] }));
  return <Animated.View style={[style, pose]}>{children}</Animated.View>;
}

const useStyles = makeStyles((t) => ({
  root: { width: '100%', alignItems: 'center' },
  petStage: { alignItems: 'center', justifyContent: 'center' },
  words: { alignItems: 'center', paddingHorizontal: t.space.xl, gap: 6, marginTop: -4 },
  hello: { ...t.type.hero, color: t.colors.text, textAlign: 'center' },
  sub: { ...t.type.body, color: t.colors.textSecondary, textAlign: 'center', maxWidth: 340 },
  rail: { flexGrow: 0, width: '100%', marginTop: t.space.xl },
  railContent: { paddingHorizontal: 20, gap: 10 },
  card: {
    width: 152, minHeight: 112, padding: 14, gap: 6, borderRadius: t.radius.lg, backgroundColor: t.colors.card,
    borderWidth: 1, borderColor: t.colors.cardBorder,
  },
  cardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  kicker: { ...t.type.caption, color: t.colors.textTertiary },
  cardTitle: { fontFamily: t.fonts.semibold, fontSize: 15, lineHeight: 20, color: t.colors.text },
  botScroll: { flexGrow: 0, width: '100%', marginTop: t.space.xl },
  bots: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 20 },
  botRing: { padding: 3, borderRadius: 999, borderWidth: 2, borderColor: 'transparent' },
  botPlus: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.cardBorder },
}));
