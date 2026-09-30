import { router } from 'expo-router';
import { Hash, Inbox, MoreHorizontal, Plus, Settings, Sparkles, Trash2, Pencil } from './icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isTyping, useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import type { Chat, Server } from '../lib/types';
import { BotAvatar } from './BotAvatar';
import { Logo } from './Logo';
import { Badge, Button, IconButton, Row, SectionLabel, tap } from './ui';

/** The far-left column: one round face per paired bot. */
export function Rail({ mode, onInbox, onSelect }: { mode: 'bots' | 'inbox'; onInbox: () => void; onSelect: (serverId: string) => void }) {
  const insets = useSafeAreaInsets();
  const servers = useApp((s) => s.servers);
  const runtime = useApp((s) => s.runtime);
  const selected = useApp((s) => s.selection.serverId);
  const totalPending = Object.values(runtime).reduce((n, r) => n + (r?.pending ?? 0), 0);

  return (
    <View style={[styles.rail, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}>
      <RailItem active={mode === 'inbox'} onPress={onInbox} label="Inbox" badge={totalPending}>
        <Logo size={48} />
      </RailItem>
      <View style={styles.railDivider} />
      <ScrollView contentContainerStyle={{ alignItems: 'center', gap: 8 }} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
        {servers.map((s) => {
          const r = runtime[s.id];
          const busy = r ? Object.keys(r.chats).some((c) => isTyping(r, c)) : false;
          const status = r?.status === 'online' ? (busy ? 'busy' : 'online') : r?.status === 'connecting' ? 'connecting' : 'offline';
          return (
            <RailItem key={s.id} active={mode === 'bots' && selected === s.id} onPress={() => onSelect(s.id)} label={s.bot.title} badge={r?.pending ?? 0}>
              <BotAvatar name={s.bot.name} size={48} status={status} ringColor={colors.rail} shape={mode === 'bots' && selected === s.id ? 'squircle' : 'circle'} />
            </RailItem>
          );
        })}
        <RailItem onPress={() => router.push('/pair')} label="Add a bot">
          <View style={styles.addBot}>
            <Plus size={24} color={colors.green} />
          </View>
        </RailItem>
      </ScrollView>
      <View style={{ flex: 1 }} />
      <RailItem onPress={() => router.push('/settings')} label="Settings">
        <View style={[styles.addBot, { backgroundColor: 'transparent' }]}>
          <Settings size={22} color={colors.textMuted} />
        </View>
      </RailItem>
    </View>
  );
}

function RailItem({ children, active, onPress, badge = 0, label }: { children: React.ReactNode; active?: boolean; onPress: () => void; badge?: number; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={styles.railItem}
    >
      <View style={[styles.pill, { height: active ? 40 : hover ? 20 : 0, opacity: active || hover ? 1 : 0 }]} />
      <View style={{ transform: [{ scale: hover && !active ? 1.04 : 1 }] }}>{children}</View>
      {badge ? <Badge count={badge} style={styles.railBadge} /> : null}
    </Pressable>
  );
}

/** Second column: the selected bot's inbox, updates and chats. */
export function ChannelList({ server, activeChatId, onOpenChat, onOpenInbox, wide }: {
  server: Server; activeChatId?: string; onOpenChat: (chatId: string) => void; onOpenInbox: () => void; wide?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const runtime = useApp((s) => s.runtime[server.id]);
  const createChat = useApp((s) => s.createChat);
  const [menuChat, setMenuChat] = useState<Chat | null>(null);
  const chats = useMemo(
    () => Object.values(runtime?.chats ?? {}).filter((c) => c.kind === 'chat').sort((a, b) => b.updated_at - a.updated_at),
    [runtime?.chats],
  );
  const home = runtime?.chats.home;
  const status = runtime?.status ?? 'connecting';

  const newChat = async () => {
    try {
      const chat = await createChat(server.id);
      if (chat) onOpenChat(chat.id);
    } catch {
      // offline; the + button just does nothing
    }
  };

  return (
    <View style={[styles.channels, { paddingTop: insets.top }]}>
      <View style={styles.botHeader}>
        <BotAvatar name={server.bot.name} size={44} shape="squircle" />
        <View style={{ flex: 1 }}>
          <Text style={styles.botTitle} numberOfLines={1}>{server.bot.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.statusDot, { backgroundColor: status === 'online' ? colors.green : status === 'unauthorized' ? colors.red : colors.yellow }]} />
            <Text style={styles.botSub} numberOfLines={1}>
              {status === 'online' ? hostOf(server.url) : status === 'unauthorized' ? 'This phone was unpaired' : status === 'offline' ? 'Offline · retrying' : 'Connecting…'}
            </Text>
          </View>
        </View>
      </View>
      {server.bot.description ? <Text style={styles.botDesc} numberOfLines={3}>{server.bot.description}</Text> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: insets.bottom + 16 }}>
        <Row onPress={onOpenInbox} style={{ marginTop: 8 }}>
          <Inbox size={20} color={colors.textMuted} />
          <Text style={styles.rowText}>Inbox</Text>
          <Badge count={runtime?.pending ?? 0} />
        </Row>
        {home ? (
          <Row onPress={() => onOpenChat('home')} active={wide && activeChatId === 'home'}>
            <Sparkles size={20} color={colors.textMuted} />
            <Text style={[styles.rowText, activeChatId === 'home' && wide && styles.rowTextActive]}>Updates</Text>
          </Row>
        ) : null}
        <SectionLabel right={<IconButton label="New chat" onPress={newChat} style={{ width: 28, height: 28 }}><Plus size={18} color={colors.textMuted} /></IconButton>}>
          Chats
        </SectionLabel>
        {chats.map((c) => {
          const active = wide && activeChatId === c.id;
          const typing = isTyping(runtime, c.id);
          return (
            <Row key={c.id} active={active} onPress={() => onOpenChat(c.id)} onLongPress={() => setMenuChat(c)}>
              <Hash size={20} color={active ? colors.textDim : colors.textFaint} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>{c.title}</Text>
                {!wide && c.preview ? <Text style={styles.preview} numberOfLines={1}>{typing ? 'working…' : c.preview}</Text> : null}
              </View>
              {typing ? <View style={styles.workingDot} /> : null}
              {c.id !== 'general' ? (
                <IconButton label="Chat options" onPress={() => setMenuChat(c)} style={{ width: 26, height: 26 }}>
                  <MoreHorizontal size={16} color={colors.textFaint} />
                </IconButton>
              ) : null}
            </Row>
          );
        })}
        <Row onPress={newChat}>
          <Plus size={20} color={colors.textFaint} />
          <Text style={[styles.rowText, { color: colors.textFaint }]}>New chat</Text>
        </Row>
      </ScrollView>
      <ChatMenu server={server} chat={menuChat} onClose={() => setMenuChat(null)} />
    </View>
  );
}

function ChatMenu({ server, chat, onClose }: { server: Server; chat: Chat | null; onClose: () => void }) {
  const renameChat = useApp((s) => s.renameChat);
  const deleteChat = useApp((s) => s.deleteChat);
  const [title, setTitle] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal visible={!!chat} transparent animationType="fade" onRequestClose={onClose} onShow={() => { setTitle(chat?.title ?? ''); setConfirm(false); }}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>#{chat?.title}</Text>
          <View style={styles.renameRow}>
            <Pencil size={16} color={colors.textMuted} />
            <TextInput value={title} onChangeText={setTitle} style={styles.renameInput} placeholder="Chat name" placeholderTextColor={colors.textFaint} />
          </View>
          <Button title="Save name" onPress={async () => { if (chat) await renameChat(server.id, chat.id, title); onClose(); }} />
          {chat?.id !== 'general' ? (
            <Button
              title={confirm ? 'Tap again to delete' : 'Delete chat'}
              variant={confirm ? 'danger' : 'ghost'}
              icon={<Trash2 size={16} color={confirm ? colors.white : colors.red} />}
              onPress={async () => {
                if (!confirm) return setConfirm(true);
                if (chat) await deleteChat(server.id, chat.id);
                onClose();
              }}
            />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '');
}

const styles = StyleSheet.create({
  rail: { width: 72, backgroundColor: colors.rail, alignItems: 'center', gap: 8 },
  railItem: { width: 72, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.white },
  railBadge: { position: 'absolute', right: 10, bottom: -2, borderWidth: 3, borderColor: colors.rail, height: 22, minWidth: 22, borderRadius: 11 },
  railDivider: { width: 32, height: 2, borderRadius: 1, backgroundColor: colors.active, marginVertical: 2 },
  addBot: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.sidebar, alignItems: 'center', justifyContent: 'center' },
  channels: { flex: 1, backgroundColor: colors.sidebar },
  botHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  botTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 19 },
  botSub: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12.5, flexShrink: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  botDesc: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 6 },
  rowText: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 15.5, flexShrink: 1 },
  rowTextActive: { color: colors.text },
  preview: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 1 },
  workingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.yellow },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 400, backgroundColor: colors.chat, borderRadius: radius.lg, padding: 18, gap: 12 },
  sheetTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 18 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.rail, borderRadius: radius.md, paddingHorizontal: 12 },
  renameInput: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 16, paddingVertical: 12 },
});
