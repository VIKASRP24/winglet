import { router } from 'expo-router';
import { ArrowUp, ChevronLeft, Clock, FileText, Hash, Inbox, RotateCcw, Square, Sparkles } from './icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { mediaUrl } from '../lib/api';
import { connectionView } from '../lib/connection';
import { draftKey, isTyping, useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import type { InboxItem, Message, Server } from '../lib/types';
import { BotAvatar, botColor, UserAvatar } from './BotAvatar';
import { ConnectionBanner } from './ConnectionBanner';
import { InboxCard } from './InboxCards';
import { Markdown } from './Markdown';
import { Badge, IconButton, tap } from './ui';

const GROUP_WINDOW_S = 7 * 60;
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

export function ChatView({ server, chatId, showBack }: { server: Server; chatId: string; showBack?: boolean }) {
  const insets = useSafeAreaInsets();
  const runtime = useApp((s) => s.runtime[server.id]);
  const loadMessages = useApp((s) => s.loadMessages);
  const hydrateChat = useApp((s) => s.hydrateChat);
  const network = useApp((s) => s.network);
  const setVisibleChat = useApp((s) => s.setVisibleChat);
  const chat = runtime?.chats[chatId];
  const messages = runtime?.messages[chatId];
  const loaded = runtime?.loaded[chatId];
  const pending = runtime?.pending ?? 0;
  const [, forceTick] = useState(0);
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
    const t = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [typing]);

  if (runtime?.status === 'online' && !chat) {
    return (
      <View style={[styles.root, styles.empty, { paddingTop: insets.top }]}>
        <Text style={styles.emptyTitle}>This chat was deleted</Text>
        <Pressable style={styles.suggestion} onPress={() => (showBack ? router.replace('/') : undefined)}>
          <Text style={styles.suggestionText}>{showBack ? 'Back to chats' : 'Pick another chat on the left'}</Text>
        </Pressable>
      </View>
    );
  }

  const title = chat?.kind === 'home' ? 'Updates' : chat?.title ?? 'Chat';
  const view = connectionView(network, runtime, server.bot.title);
  const statusLabel = view.kind === 'online' ? (typing ? 'working…' : 'online') : view.kind === 'connecting' ? 'connecting…'
    : view.kind === 'recovering' ? 'finding new address…' : view.kind === 'unreachable' ? 'offline' : view.title.toLowerCase();

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + (showBack ? 6 : 10) }]}>
        {showBack ? (
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            <ChevronLeft size={24} color={colors.textDim} />
          </IconButton>
        ) : null}
        {chat?.kind === 'home' ? <Sparkles size={20} color={colors.textMuted} /> : <Hash size={20} color={colors.textMuted} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={[styles.headerSub, runtime?.status !== 'online' && { color: colors.yellow }]} numberOfLines={1}>
            {server.bot.title} · {statusLabel}
          </Text>
        </View>
        {showBack ? (
          <IconButton label="Inbox" onPress={() => router.push('/inbox')}>
            <Inbox size={21} color={colors.textDim} />
            <Badge count={pending} style={{ position: 'absolute', top: 0, right: -2 }} />
          </IconButton>
        ) : null}
      </View>
      <ConnectionBanner server={server} />
      <MessageList server={server} chatId={chatId} messages={messages ?? []} loaded={!!loaded || !!messages?.length} typing={typing} />
      <Composer server={server} chatId={chatId} busy={typing} bottomInset={insets.bottom} />
    </KeyboardAvoidingView>
  );
}

function MessageList({ server, chatId, messages, loaded, typing }: {
  server: Server; chatId: string; messages: Message[]; loaded: boolean; typing: boolean;
}) {
  const loadMessages = useApp((s) => s.loadMessages);
  const inbox = useApp((s) => s.runtime[server.id]?.inbox);

  // Inverted list: newest message sits at the bottom and new ones never need a manual scroll.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = messages.map((m, i) => ({
      m, grouped: isGrouped(messages[i - 1], m), live: typing && i === messages.length - 1,
    }));
    return out.reverse();
  }, [messages, typing]);

  if (loaded && messages.length === 0) {
    return <EmptyChat server={server} chatId={chatId} />;
  }

  return (
    <FlatList
      inverted
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
      data={rows}
      keyExtractor={(r) => r.m.id}
      renderItem={({ item }) => (
        <MessageRow
          server={server}
          message={item.m}
          grouped={item.grouped}
          live={item.live}
          inboxItem={item.m.meta?.inbox_id ? inbox?.[item.m.meta.inbox_id] : undefined}
        />
      )}
      onEndReached={() => messages.length >= 60 && loadMessages(server.id, chatId, true)}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={typing ? <TypingRow name={server.bot.title} /> : null}
      keyboardShouldPersistTaps="handled"
    />
  );
}

type Row = { m: Message; grouped: boolean; live: boolean };

function isGrouped(prev: Message | undefined, m: Message) {
  if (!prev || prev.role !== m.role || m.role === 'system' || prev.role === 'system') return false;
  return m.created_at - prev.created_at < GROUP_WINDOW_S;
}

const MessageRow = memo(function MessageRow({ server, message, grouped, live, inboxItem }: {
  server: Server; message: Message; grouped: boolean; live?: boolean; inboxItem?: InboxItem;
}) {
  const resolve = useCallback((url: string) => mediaUrl(server, url), [server]);

  if (message.role === 'system') {
    if (message.meta?.inbox_id && inboxItem) {
      return (
        <View style={styles.systemCard}>
          <InboxCard serverId={server.id} item={inboxItem} />
        </View>
      );
    }
    return (
      <View style={styles.systemLine}>
        <Text style={styles.systemText}>{message.text}</Text>
      </View>
    );
  }

  const isBot = message.role === 'bot';
  const time = formatTime(message.created_at);
  const failed = message.status === 'failed';
  const dim = message.status === 'pending';
  const attachments = message.meta?.attachments ?? [];

  return (
    <View style={[styles.msg, grouped ? styles.msgGrouped : styles.msgFirst]}>
      <View style={styles.gutter}>
        {grouped ? null : isBot ? <BotAvatar name={server.bot.name} size={40} /> : <UserAvatar size={40} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {grouped ? null : (
          <View style={styles.msgHead}>
            <Text style={[styles.author, { color: isBot ? botColor(server.bot.name) : colors.text }]}>
              {isBot ? server.bot.title : 'You'}
            </Text>
            {isBot ? <View style={styles.botTag}><Text style={styles.botTagText}>AGENT</Text></View> : null}
            <Text style={styles.time}>{time}</Text>
          </View>
        )}
        <View style={{ opacity: dim ? 0.55 : 1 }}>
          {message.text ? <Markdown text={message.text} resolveUrl={resolve} /> : null}
          {message.status === 'streaming' && live ? <Cursor /> : null}
        </View>
        {attachments.map((a) =>
          a.kind === 'image' ? (
            <Image key={a.url} source={{ uri: mediaUrl(server, a.url) }} style={styles.attachmentImage} contentFit="cover" />
          ) : (
            <Pressable key={a.url} style={styles.file} onPress={() => openUrl(mediaUrl(server, a.url))}>
              <FileText size={22} color={colors.link} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>{a.name}</Text>
                <Text style={styles.fileSize}>{formatSize(a.size)}</Text>
              </View>
            </Pressable>
          ),
        )}
        {message.status === 'queued' ? (
          <View style={styles.failed}>
            <Clock size={12} color={colors.textMuted} />
            <Text style={[styles.failedText, { color: colors.textMuted }]}>Queued · sends when {server.bot.title} is reachable</Text>
          </View>
        ) : null}
        {failed ? <FailedActions server={server} message={message} /> : null}
      </View>
    </View>
  );
});

/** A message the server refused: try again, take it back into the composer, or drop it. */
function FailedActions({ server, message }: { server: Server; message: Message }) {
  const sendMessage = useApp((s) => s.sendMessage);
  const discard = useApp((s) => s.discardMessage);
  const setDraft = useApp((s) => s.setDraft);
  const clientId = message.meta?.client_id ?? message.id;
  return (
    <View style={styles.failed}>
      <RotateCcw size={13} color={colors.red} />
      <Text style={styles.failedText}>Not delivered</Text>
      <Text accessibilityRole="button" style={styles.failedAction} onPress={() => sendMessage(server.id, message.chat_id, message.text, clientId)}>Retry</Text>
      <Text accessibilityRole="button" style={styles.failedAction} onPress={() => {
        setDraft(server.id, message.chat_id, message.text);
        discard(server.id, message.chat_id, clientId);
      }}>Edit</Text>
      <Text accessibilityRole="button" style={styles.failedAction} onPress={() => discard(server.id, message.chat_id, clientId)}>Delete</Text>
    </View>
  );
}

function Cursor() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.2, duration: 450, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.cursor, { opacity }]} />;
}

function TypingRow({ name }: { name: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0, duration: 300, useNativeDriver: Platform.OS !== 'web' }),
        Animated.delay((2 - i) * 150),
      ])),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.typing}>
      <View style={styles.dots}>
        {dots.map((v, i) => (
          <Animated.View key={i} style={[styles.dot, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }], opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />
        ))}
      </View>
      <Text style={styles.typingText}><Text style={{ fontFamily: fonts.bold, color: colors.textDim }}>{name}</Text> is working…</Text>
    </View>
  );
}

function EmptyChat({ server, chatId }: { server: Server; chatId: string }) {
  const sendMessage = useApp((s) => s.sendMessage);
  const chat = useApp((s) => s.runtime[server.id]?.chats[chatId]);
  const home = chat?.kind === 'home';
  return (
    <View style={styles.empty}>
      <BotAvatar name={server.bot.name} size={84} shape="squircle" />
      <Text style={styles.emptyTitle}>{home ? 'Updates from your routines' : `Say hi to ${server.bot.title}`}</Text>
      <Text style={styles.emptyText}>
        {home
          ? 'When a scheduled routine finishes, its results land here and in your inbox.'
          : server.bot.description || 'Your agent runs on your own machine. Ask it anything: it can use tools, browse, run code, and remember.'}
      </Text>
      {home ? null : (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: colors.active }]} onPress={() => { tap(); sendMessage(server.id, chatId, s); }}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function Composer({ server, chatId, busy, bottomInset }: { server: Server; chatId: string; busy: boolean; bottomInset: number }) {
  // The draft lives in the store, so it survives switching chats, closing the app, and "Edit" on a failed send.
  const text = useApp((s) => s.drafts[draftKey(server.id, chatId)] ?? '');
  const setDraft = useApp((s) => s.setDraft);
  const setText = (value: string) => setDraft(server.id, chatId, value);
  const [height, setHeight] = useState(36);
  const sendMessage = useApp((s) => s.sendMessage);
  const chat = useApp((s) => s.runtime[server.id]?.chats[chatId]);
  const online = useApp((s) => s.runtime[server.id]?.status === 'online');
  const inputRef = useRef<TextInput>(null);

  const send = (value = text) => {
    const v = value.trim();
    if (!v) return;
    tap();
    sendMessage(server.id, chatId, v);
    setText('');
    setHeight(36);
  };

  const commandMatches = text.startsWith('/') && !text.includes(' ')
    ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase()))
    : [];
  const showStop = busy && !text.trim();

  return (
    <View style={[styles.composerWrap, { paddingBottom: Math.max(bottomInset, 10) }]}>
      {commandMatches.length ? (
        <View style={styles.commands}>
          {commandMatches.map((c) => (
            <Pressable key={c.cmd} style={({ pressed, hovered }: any) => [styles.command, (pressed || hovered) && { backgroundColor: colors.hover }]} onPress={() => send(c.cmd)}>
              <Text style={styles.commandName}>{c.cmd}</Text>
              <Text style={styles.commandHint}>{c.hint}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={chat?.kind === 'home' ? `Message ${server.bot.title}` : `Message #${chat?.title ?? 'chat'}`}
          placeholderTextColor={colors.textFaint}
          multiline
          onContentSizeChange={(e) => setHeight(Math.min(140, Math.max(36, e.nativeEvent.contentSize.height)))}
          style={[styles.input, Platform.OS === 'web' ? { height } : null]}
          onKeyPress={(e: any) => {
            if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              send();
            }
          }}
          editable
        />
        {showStop ? (
          <Pressable accessibilityLabel="Stop" style={[styles.sendBtn, { backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }]} onPress={() => send('/stop')}>
            <Square size={14} color={colors.text} fill={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="Send"
            disabled={!text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.accent : colors.input }]}
            onPress={() => send()}
          >
            <ArrowUp size={20} color={text.trim() ? colors.white : colors.textFaint} strokeWidth={2.5} />
          </Pressable>
        )}
      </View>
      {!online ? <Text style={styles.offlineNote}>Offline. Messages you send are queued and go out when {server.bot.title} is back.</Text> : null}
    </View>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${hm}`;
  return `${d.toLocaleDateString()} ${hm}`;
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chat },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.chat,
  },
  headerTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 16.5 },
  headerSub: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12.5, marginTop: 1 },
  msg: { flexDirection: 'row', paddingHorizontal: 14, paddingRight: 18 },
  msgFirst: { marginTop: 14 },
  msgGrouped: { marginTop: 3 },
  gutter: { width: 52 },
  msgHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  author: { fontFamily: fonts.semibold, fontSize: 15.5 },
  botTag: { backgroundColor: colors.accent, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  botTagText: { color: colors.white, fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.3 },
  time: { color: colors.textFaint, fontFamily: fonts.medium, fontSize: 11.5 },
  cursor: { width: 8, height: 16, borderRadius: 2, backgroundColor: colors.accent, marginTop: 4 },
  systemCard: { paddingHorizontal: 14, paddingLeft: 66, marginTop: 12 },
  systemLine: { alignItems: 'center', marginVertical: 10, paddingHorizontal: 24 },
  systemText: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  attachmentImage: { width: 280, height: 200, borderRadius: radius.md, marginTop: 6, backgroundColor: colors.cardRaised },
  file: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: 360,
  },
  fileName: { color: colors.link, fontFamily: fonts.semibold, fontSize: 14.5 },
  fileSize: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  failedText: { color: colors.red, fontFamily: fonts.medium, fontSize: 12.5 },
  failedAction: { color: colors.link, fontFamily: fonts.semibold, fontSize: 12.5, paddingHorizontal: 4 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  dots: { flexDirection: 'row', gap: 3, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: colors.card, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textDim },
  typingText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  emptyTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, textAlign: 'center', marginTop: 6 },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 420 },
  suggestions: { gap: 8, marginTop: 10, width: '100%', maxWidth: 420 },
  suggestion: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
  suggestionText: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 14.5 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: colors.chat },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: colors.input, borderRadius: radius.lg,
    paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
  },
  input: {
    flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, paddingTop: 7, paddingBottom: 7, maxHeight: 140,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  offlineNote: { color: colors.yellow, fontFamily: fonts.medium, fontSize: 12, marginTop: 6, marginLeft: 6 },
  commands: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8, paddingVertical: 4 },
  command: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  commandName: { color: colors.text, fontFamily: fonts.bold, fontSize: 14.5, minWidth: 90 },
  commandHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, flex: 1 },
});
