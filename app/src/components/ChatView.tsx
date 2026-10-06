import { BlurTargetView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moodOf } from '../lib/agent';
import { mediaUrl } from '../lib/api';
import { connectionView } from '../lib/connection';
import { haptic } from '../lib/haptics';
import { useReducedMotion } from '../lib/motion';
import { usePrefs } from '../lib/prefs';
import { draftKey, isTyping, useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { InboxItem, Message, Server } from '../lib/types';
import { BotAvatar, botColor, UserAvatar } from './BotAvatar';
import { ConnectionBanner } from './ConnectionBanner';
import { Glass } from './Glass';
import { Activity, ArrowUp, ChevronLeft, Clock, FileText, MoreHorizontal, Pencil, RotateCcw, Square, Trash2 } from './icons';
import { InboxCard } from './InboxCards';
import { Markdown } from './Markdown';
import { Sheet, SheetAction } from './Sheet';
import { Button, Chip, Field, IconButton, Tap } from './ui';

const GROUP_WINDOW_S = 7 * 60;
/** One line of body text plus the input's vertical padding. */
const MIN_INPUT = 41;
const COMMANDS = [
  { cmd: '/new', hint: 'Start a fresh conversation' },
  { cmd: '/stop', hint: 'Stop what the agent is doing' },
  { cmd: '/retry', hint: 'Retry the last reply' },
  { cmd: '/undo', hint: 'Remove the last exchange' },
  { cmd: '/model', hint: 'Show or switch the model' },
  { cmd: '/compress', hint: 'Compress the conversation context' },
  { cmd: '/usage', hint: 'Token usage for this session' },
  { cmd: '/help', hint: 'Everything Hermes can do' },
];
const SUGGESTIONS = ['What can you do?', "What's on my plate today?", 'Check disk space on this machine'];

type Row =
  | { kind: 'msg'; key: string; m: Message; first: boolean; last: boolean; live: boolean; fresh: boolean }
  | { kind: 'day'; key: string; label: string };

export function ChatView({ server, chatId, showBack, embedded }: { server: Server; chatId: string; showBack?: boolean; embedded?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const runtime = useApp((st) => st.runtime[server.id]);
  const network = useApp((st) => st.network);
  const loadMessages = useApp((st) => st.loadMessages);
  const hydrateChat = useApp((st) => st.hydrateChat);
  const setVisibleChat = useApp((st) => st.setVisibleChat);
  const chat = runtime?.chats[chatId];
  const messages = runtime?.messages[chatId];
  const loaded = runtime?.loaded[chatId];
  const [, forceTick] = useState(0);
  const [headerH, setHeaderH] = useState(insets.top + 64);
  const [composerH, setComposerH] = useState(80);
  const [menu, setMenu] = useState(false);
  const target = useRef<View>(null);
  const typing = isTyping(runtime, chatId);

  useEffect(() => {
    setVisibleChat({ serverId: server.id, chatId });
    return () => setVisibleChat(undefined);
  }, [server.id, chatId, setVisibleChat]);

  // Show what this phone remembers straight away; the server's copy replaces it when it arrives.
  useEffect(() => {
    hydrateChat(server.id, chatId);
  }, [server.id, chatId, hydrateChat]);

  useEffect(() => {
    if (runtime?.status === 'online' && !loaded) loadMessages(server.id, chatId);
  }, [runtime?.status, loaded, server.id, chatId, loadMessages]);

  // Typing indicators expire client-side; re-render while one is showing.
  useEffect(() => {
    if (!typing) return;
    const id = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, [typing]);

  if (runtime?.status === 'online' && !chat) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Text style={s.emptyTitle}>This chat was deleted</Text>
        {showBack ? <Button title="Back to chats" variant="secondary" onPress={() => router.replace('/chats')} /> : null}
      </View>
    );
  }

  const view = connectionView(network, runtime, server.bot.title);
  const title = chatId === 'general' ? server.bot.title : chat?.kind === 'home' ? 'Updates' : `#${chat?.title ?? 'Chat'}`;
  const status = view.kind === 'online' ? (typing ? 'working…' : 'online') : view.kind === 'connecting' ? 'connecting…'
    : view.kind === 'recovering' ? 'finding new address…' : view.kind === 'unreachable' ? 'offline' : view.title.toLowerCase();
  const topPad = embedded ? 0 : insets.top;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>
        <MessageList server={server} chatId={chatId} messages={messages ?? []} loaded={!!loaded || !!messages?.length}
          typing={typing} top={headerH} bottom={composerH} />
      </BlurTargetView>
      <View style={s.headerWrap} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)} pointerEvents="box-none">
        <Glass target={target} borderless style={[s.header, { paddingTop: topPad + 8 }]}>
          {showBack ? (
            <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
              <ChevronLeft size={26} color={t.colors.text} />
            </IconButton>
          ) : <View style={{ width: 4 }} />}
          <BotAvatar name={server.bot.name} size={38} mood={moodOf(runtime)} animated={typing} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[s.statusDot, { backgroundColor: view.kind !== 'online' ? t.colors.warning : typing ? t.colors.accent : t.colors.success }]} />
              <Text style={s.headerSub} numberOfLines={1}>{chatId === 'general' ? status : `${server.bot.title} · ${status}`}</Text>
            </View>
          </View>
          <IconButton label="Chat options" onPress={() => setMenu(true)}><MoreHorizontal size={22} color={t.colors.text} /></IconButton>
        </Glass>
        <View style={s.hairline} />
        <ConnectionBanner server={server} compact />
      </View>
      <Composer server={server} chatId={chatId} busy={typing} bottomInset={embedded ? 12 : insets.bottom} target={target}
        onHeight={setComposerH} placeholder={chatId === 'general' ? `Message ${server.bot.title}` : chat?.kind === 'home' ? `Message ${server.bot.title}` : `Message #${chat?.title ?? 'chat'}`} />
      <ChatMenu server={server} chatId={chatId} visible={menu} onClose={() => setMenu(false)} />
    </KeyboardAvoidingView>
  );
}

function MessageList({ server, chatId, messages, loaded, typing, top, bottom }: {
  server: Server; chatId: string; messages: Message[]; loaded: boolean; typing: boolean; top: number; bottom: number;
}) {
  const loadMessages = useApp((st) => st.loadMessages);
  const inbox = useApp((st) => st.runtime[server.id]?.inbox);
  const layout = usePrefs((st) => st.prefs.layout);
  // Messages already here when the chat opened don't animate in; only new arrivals do.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && loaded) seen.current = new Set(messages.map((m) => m.id));

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let day = '';
    messages.forEach((m, i) => {
      const label = dayLabel(m.created_at);
      if (label !== day) {
        out.push({ kind: 'day', key: `day-${label}-${i}`, label });
        day = label;
      }
      const prev = messages[i - 1];
      const next = messages[i + 1];
      out.push({
        kind: 'msg', key: m.id, m,
        first: !sameGroup(prev, m) || dayLabel(prev!.created_at) !== label,
        last: !sameGroup(m, next) || (next ? dayLabel(next.created_at) !== label : true),
        live: typing && i === messages.length - 1,
        fresh: !!seen.current && !seen.current.has(m.id),
      });
    });
    return out.reverse(); // inverted: newest at the bottom without manual scrolling
  }, [messages, typing]);

  if (loaded && messages.length === 0) return <EmptyChat server={server} chatId={chatId} top={top} bottom={bottom} />;

  return (
    <FlatList
      inverted
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: bottom + 10, paddingBottom: top + 10 }}
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={({ item }) => item.kind === 'day' ? <DayChip label={item.label} /> : (
        <MessageRow server={server} message={item.m} first={item.first} last={item.last} live={item.live} fresh={item.fresh}
          layout={layout} inboxItem={item.m.meta?.inbox_id ? inbox?.[item.m.meta.inbox_id] : undefined} />
      )}
      onEndReached={() => messages.length >= 60 && loadMessages(server.id, chatId, true)}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={typing ? <TypingRow server={server} /> : null}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={18}
      maxToRenderPerBatch={12}
      windowSize={11}
      removeClippedSubviews={Platform.OS === 'android'}
    />
  );
}

function sameGroup(a: Message | undefined, b: Message | undefined) {
  if (!a || !b || a.role !== b.role || a.role === 'system' || b.role === 'system') return false;
  return Math.abs(b.created_at - a.created_at) < GROUP_WINDOW_S;
}

function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function timeOf(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function DayChip({ label }: { label: string }) {
  const s = useStyles();
  return (
    <View style={s.dayWrap} accessibilityRole="header">
      <Text style={s.day}>{label}</Text>
    </View>
  );
}

const MessageRow = memo(function MessageRow({ server, message, first, last, live, fresh, layout, inboxItem }: {
  server: Server; message: Message; first: boolean; last: boolean; live?: boolean; fresh: boolean; layout: 'bubbles' | 'compact'; inboxItem?: InboxItem;
}) {
  const t = useTheme();
  const s = useStyles();
  const resolve = useCallback((url: string) => mediaUrl(server, url), [server]);
  const entering = fresh ? FadeInDown.springify().damping(18).stiffness(180) : undefined;

  if (message.role === 'system') {
    if (message.meta?.inbox_id && inboxItem) {
      return <Animated.View entering={entering} style={s.systemCard}><InboxCard serverId={server.id} item={inboxItem} /></Animated.View>;
    }
    return <View style={s.systemLine}><Text style={s.systemText}>{message.text}</Text></View>;
  }

  const isBot = message.role === 'bot';
  const attachments = message.meta?.attachments ?? [];
  const body = (onAccent: boolean) => (
    <>
      {message.text ? <Markdown text={message.text} resolveUrl={resolve} tone={onAccent ? 'onAccent' : 'default'} /> : null}
      {message.status === 'streaming' && live ? <Cursor onAccent={onAccent} /> : null}
      {attachments.map((a) => a.kind === 'image' ? (
        <Image key={a.url} source={{ uri: mediaUrl(server, a.url) }} style={s.attachmentImage} contentFit="cover" accessibilityLabel={a.name} />
      ) : (
        <Pressable key={a.url} accessibilityRole="link" accessibilityLabel={`Open ${a.name}`} style={s.file} onPress={() => openUrl(mediaUrl(server, a.url))}>
          <View style={s.fileIcon}><FileText size={20} color={t.colors.onAccentSoft} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.fileName} numberOfLines={1}>{a.name}</Text>
            <Text style={s.fileSize}>{formatSize(a.size)}</Text>
          </View>
        </Pressable>
      ))}
    </>
  );
  const footer = (
    <>
      {message.status === 'queued' ? (
        <View style={[s.state, !isBot && layout === 'bubbles' && s.stateRight]}>
          <Clock size={12} color={t.colors.textSecondary} />
          <Text style={s.stateText}>Queued · sends when {server.bot.title} is reachable</Text>
        </View>
      ) : null}
      {message.status === 'failed' ? <FailedActions server={server} message={message} right={!isBot && layout === 'bubbles'} /> : null}
    </>
  );

  if (layout === 'compact') {
    return (
      <Animated.View entering={entering} style={[s.compact, first ? { marginTop: 14 } : { marginTop: 2 }]}>
        <View style={s.gutter}>{first ? (isBot ? <BotAvatar name={server.bot.name} size={36} /> : <UserAvatar size={36} />) : null}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {first ? (
            <View style={s.compactHead}>
              <Text style={[s.author, { color: isBot ? botColor(server.bot.name) : t.colors.text }]}>{isBot ? server.bot.title : 'You'}</Text>
              <Text style={s.time}>{timeOf(message.created_at)}</Text>
            </View>
          ) : null}
          <View style={{ opacity: message.status === 'pending' ? 0.6 : 1 }}>{body(false)}</View>
          {footer}
        </View>
      </Animated.View>
    );
  }

  if (isBot) {
    return (
      <Animated.View entering={entering} style={[s.botRow, first ? { marginTop: 16 } : { marginTop: 4 }]}>
        {first ? (
          <View style={s.botHead}>
            <BotAvatar name={server.bot.name} size={26} />
            <Text style={s.botName}>{server.bot.title}</Text>
            <Text style={s.time}>{timeOf(message.created_at)}</Text>
          </View>
        ) : null}
        <View style={s.botBody}>{body(false)}</View>
        {footer}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={entering} style={[s.userRow, first ? { marginTop: 14 } : { marginTop: 3 }]}>
      <LinearGradient colors={[t.colors.accentFillLight, t.colors.accentFill]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[s.bubble, last && s.bubbleTail, { opacity: message.status === 'pending' ? 0.75 : 1 }]}>
        {body(true)}
      </LinearGradient>
      {last && message.status === 'final' ? <Text style={[s.time, { marginTop: 4, marginRight: 6 }]}>{timeOf(message.created_at)}</Text> : null}
      {footer}
    </Animated.View>
  );
});

/** A message the server refused: try again, take it back into the composer, or drop it. */
function FailedActions({ server, message, right }: { server: Server; message: Message; right?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const sendMessage = useApp((st) => st.sendMessage);
  const discard = useApp((st) => st.discardMessage);
  const setDraft = useApp((st) => st.setDraft);
  const clientId = message.meta?.client_id ?? message.id;
  return (
    <View style={[s.state, right && s.stateRight]} accessibilityLiveRegion="polite">
      <RotateCcw size={13} color={t.colors.danger} />
      <Text style={[s.stateText, { color: t.colors.danger }]}>Not delivered</Text>
      <Text accessibilityRole="button" style={s.stateAction} onPress={() => sendMessage(server.id, message.chat_id, message.text, clientId)}>Retry</Text>
      <Text accessibilityRole="button" style={s.stateAction} onPress={() => { setDraft(server.id, message.chat_id, message.text); discard(server.id, message.chat_id, clientId); }}>Edit</Text>
      <Text accessibilityRole="button" style={s.stateAction} onPress={() => discard(server.id, message.chat_id, clientId)}>Delete</Text>
    </View>
  );
}

function Cursor({ onAccent }: { onAccent: boolean }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    o.value = withRepeat(withSequence(withTiming(0.2, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    return () => cancelAnimation(o);
  }, [reduced, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 9, height: 17, borderRadius: 3, marginTop: 4, backgroundColor: onAccent ? t.colors.onAccent : t.colors.accent }, style]} />;
}

function TypingRow({ server }: { server: Server }) {
  const s = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(200)} style={s.typing} accessibilityLiveRegion="polite" accessibilityLabel={`${server.bot.title} is working`}>
      <BotAvatar name={server.bot.name} size={30} mood="working" animated />
      <View style={s.typingBubble}><Dots /></View>
    </Animated.View>
  );
}

function Dots() {
  const t = useTheme();
  const reduced = useReducedMotion();
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', height: 14 }}>
      {[0, 1, 2].map((i) => <Dot key={i} delay={i * 150} reduced={reduced} color={t.colors.textSecondary} />)}
    </View>
  );
}

function Dot({ delay, reduced, color }: { delay: number; reduced: boolean; color: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-4, { duration: 280 }), withTiming(0, { duration: 280 }), withTiming(0, { duration: 300 })), -1));
    return () => cancelAnimation(y);
  }, [reduced, delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

function EmptyChat({ server, chatId, top, bottom }: { server: Server; chatId: string; top: number; bottom: number }) {
  const t = useTheme();
  const s = useStyles();
  const sendMessage = useApp((st) => st.sendMessage);
  const chat = useApp((st) => st.runtime[server.id]?.chats[chatId]);
  const home = chat?.kind === 'home';
  return (
    <View style={[s.center, { flex: 1, paddingTop: top, paddingBottom: bottom, paddingHorizontal: 28, gap: 12 }]}>
      <Animated.View entering={ZoomIn.springify().damping(14)}>
        <BotAvatar name={server.bot.name} size={92} mood="idle" animated glow />
      </Animated.View>
      <Text style={s.emptyTitle}>{home ? 'Updates from your routines' : `Say hi to ${server.bot.title}`}</Text>
      <Text style={s.emptyText}>
        {home ? 'When a scheduled routine finishes, its results land here and in your inbox.'
          : server.bot.description || 'Your agent runs on your own machine. Ask it anything: it can use tools, browse, run code, and remember.'}
      </Text>
      {home ? null : (
        <View style={s.suggestions}>
          {SUGGESTIONS.map((q) => <Chip key={q} label={q} onPress={() => { haptic.light(); sendMessage(server.id, chatId, q); }} />)}
        </View>
      )}
    </View>
  );
}

function Composer({ server, chatId, busy, bottomInset, target, onHeight, placeholder }: {
  server: Server; chatId: string; busy: boolean; bottomInset: number; target: React.RefObject<View | null>;
  onHeight: (h: number) => void; placeholder: string;
}) {
  const t = useTheme();
  const s = useStyles();
  // The draft lives in the store, so it survives switching chats, closing the app, and "Edit" on a failed send.
  const text = useApp((st) => st.drafts[draftKey(server.id, chatId)] ?? '');
  const setDraft = useApp((st) => st.setDraft);
  const sendMessage = useApp((st) => st.sendMessage);
  const online = useApp((st) => st.runtime[server.id]?.status === 'online');
  const [height, setHeight] = useState(MIN_INPUT);
  const setText = (value: string) => setDraft(server.id, chatId, value);

  const send = (value = text) => {
    const v = value.trim();
    if (!v) return;
    haptic.light();
    sendMessage(server.id, chatId, v);
    setText('');
    setHeight(MIN_INPUT);
  };

  const matches = text.startsWith('/') && !text.includes(' ') ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];
  const showStop = busy && !text.trim();
  const canSend = !!text.trim();

  return (
    <View style={[s.composerWrap, { paddingBottom: Math.max(bottomInset, 10) }]} onLayout={(e) => onHeight(e.nativeEvent.layout.height)} pointerEvents="box-none">
      {matches.length ? (
        <Glass target={target} style={s.commands}>
          {matches.map((c) => (
            <Pressable key={c.cmd} accessibilityRole="button" accessibilityLabel={`${c.cmd}: ${c.hint}`}
              style={({ pressed, hovered }: any) => [s.command, (pressed || hovered) && { backgroundColor: t.colors.pressed }]} onPress={() => send(c.cmd)}>
              <Text style={s.commandName}>{c.cmd}</Text>
              <Text style={s.commandHint} numberOfLines={1}>{c.hint}</Text>
            </Pressable>
          ))}
        </Glass>
      ) : null}
      {!online ? <Text style={s.offlineNote}>Offline. Messages you send are queued and go out when {server.bot.title} is back.</Text> : null}
      <Glass target={target} style={s.composer} intensity={50}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={t.colors.textTertiary}
          multiline
          accessibilityLabel={placeholder}
          onContentSizeChange={(e) => setHeight(Math.min(150, Math.max(MIN_INPUT, e.nativeEvent.contentSize.height)))}
          style={[s.input, Platform.OS === 'web' ? { height } : null]}
          onKeyPress={(e: any) => {
            if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              send();
            }
          }}
        />
        {showStop ? (
          <Tap key="stop" feedback="light" accessibilityLabel="Stop the current task" onPress={() => send('/stop')} style={[s.sendBtn, s.stopBtn]}>
            <Animated.View entering={ZoomIn.duration(160)}><Square size={14} color={t.colors.text} fill={t.colors.text} /></Animated.View>
          </Tap>
        ) : (
          <Tap key="send" feedback="none" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={() => send()} scaleTo={0.9}
            style={[s.sendBtn, { backgroundColor: canSend ? t.colors.accentFill : t.colors.surfaceSunken }]}>
            <ArrowUp size={20} color={canSend ? t.colors.onAccent : t.colors.textTertiary} strokeWidth={2.5} />
          </Tap>
        )}
      </Glass>
    </View>
  );
}

function ChatMenu({ server, chatId, visible, onClose }: { server: Server; chatId: string; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const chat = useApp((st) => st.runtime[server.id]?.chats[chatId]);
  const renameChat = useApp((st) => st.renameChat);
  const deleteChat = useApp((st) => st.deleteChat);
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [title, setTitle] = useState('');
  const side = chat?.kind === 'chat' && chatId !== 'general';
  const close = () => { setMode('menu'); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title={chatId === 'general' ? server.bot.title : chat?.kind === 'home' ? 'Updates' : `#${chat?.title ?? ''}`}>
      {mode === 'menu' ? (
        <>
          {side ? <SheetAction icon={<Pencil size={20} color={t.colors.text} />} label="Rename" onPress={() => { setTitle(chat?.title ?? ''); setMode('rename'); }} /> : null}
          <SheetAction icon={<Activity size={20} color={t.colors.text} />} label="Connection details" onPress={() => { close(); router.push(`/diagnostics/${server.id}`); }} />
          {side ? <SheetAction icon={<Trash2 size={20} color={t.colors.danger} />} label="Delete chat" destructive onPress={() => setMode('delete')} /> : null}
        </>
      ) : mode === 'rename' ? (
        <View style={{ gap: 14, paddingHorizontal: 4 }}>
          <Field value={title} onChangeText={setTitle} placeholder="Chat name" autoFocus />
          <Button title="Save" onPress={async () => { await renameChat(server.id, chatId, title); close(); }} />
        </View>
      ) : (
        <View style={{ gap: 14, paddingHorizontal: 4 }}>
          <Text style={{ ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center' }}>
            This removes the chat from Winglet on every device. Hermes keeps its own session history.
          </Text>
          <Button title="Delete chat" variant="danger" onPress={async () => { await deleteChat(server.id, chatId); close(); router.replace('/chats'); }} />
          <Button title="Cancel" variant="secondary" onPress={() => setMode('menu')} />
        </View>
      )}
    </Sheet>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function openUrl(url: string) {
  if (Platform.OS === 'web') globalThis.open?.(url, '_blank', 'noopener');
  else import('react-native').then(({ Linking }) => Linking.openURL(url));
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  headerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingBottom: 10 },
  hairline: { height: 1, backgroundColor: t.colors.border },
  headerTitle: { ...t.type.heading, color: t.colors.text },
  headerSub: { ...t.type.caption, color: t.colors.textSecondary },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  dayWrap: { alignItems: 'center', marginTop: 20, marginBottom: 4 },
  day: {
    ...t.type.caption, color: t.colors.textSecondary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden',
  },
  botRow: { paddingHorizontal: 16 },
  botHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  botName: { ...t.type.caption, fontSize: 13.5, fontFamily: t.fonts.semibold, color: t.colors.text },
  botBody: { paddingLeft: 34, paddingRight: 8 },
  userRow: { paddingHorizontal: 14, alignItems: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11 },
  bubbleTail: { borderBottomRightRadius: 6 },
  time: { ...t.type.caption, fontSize: 11.5, color: t.colors.textTertiary },
  compact: { flexDirection: 'row', paddingHorizontal: 14, paddingRight: 18 },
  gutter: { width: 48 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  author: { fontFamily: t.fonts.semibold, fontSize: 15 },
  systemCard: { paddingHorizontal: 14, marginTop: 14 },
  systemLine: { alignItems: 'center', marginVertical: 10, paddingHorizontal: 24 },
  systemText: { ...t.type.caption, color: t.colors.textSecondary, textAlign: 'center' },
  attachmentImage: { width: 260, height: 190, borderRadius: t.radius.md, marginTop: 6, backgroundColor: t.colors.surfaceSunken },
  file: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, padding: 10, borderRadius: t.radius.md,
    backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, maxWidth: 340,
  },
  fileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft },
  fileName: { ...t.type.callout, fontFamily: t.fonts.semibold, color: t.colors.text },
  fileSize: { ...t.type.caption, color: t.colors.textSecondary },
  state: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  stateRight: { justifyContent: 'flex-end' },
  stateText: { ...t.type.caption, color: t.colors.textSecondary },
  stateAction: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.accent, paddingHorizontal: 6, paddingVertical: 6 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  typingBubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border },
  emptyTitle: { ...t.type.title, color: t.colors.text, textAlign: 'center', marginTop: 8 },
  emptyText: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center', maxWidth: 400 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8, maxWidth: 440 },
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingTop: 6 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: t.radius.xl, paddingLeft: 18, paddingRight: 6, paddingVertical: 6,
    maxWidth: 820, width: '100%', alignSelf: 'center',
  },
  input: {
    flex: 1, ...t.type.body, color: t.colors.text, paddingTop: 9, paddingBottom: 9, maxHeight: 150,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stopBtn: { backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.borderStrong },
  offlineNote: { ...t.type.caption, color: t.colors.warning, marginBottom: 6, marginLeft: 12, maxWidth: 820, alignSelf: 'center', width: '100%' },
  commands: { borderRadius: t.radius.lg, marginBottom: 8, paddingVertical: 4, maxWidth: 820, width: '100%', alignSelf: 'center' },
  command: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 44 },
  commandName: { fontFamily: t.fonts.bold, fontSize: 14.5, color: t.colors.text, minWidth: 90 },
  commandHint: { ...t.type.callout, color: t.colors.textSecondary, flex: 1 },
}));
