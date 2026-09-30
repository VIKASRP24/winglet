import { router } from 'expo-router';
import { ChevronLeft, Inbox as InboxIcon } from './icons';
import { useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/store';
import { colors, fonts } from '../lib/theme';
import type { InboxItem, Server } from '../lib/types';
import { BotAvatar } from './BotAvatar';
import { InboxCard } from './InboxCards';
import { IconButton, SectionLabel } from './ui';

type Entry = { server: Server; item: InboxItem } | { header: string };

/** Everything that needs you, across every paired bot. */
export function InboxView({ showBack, onlyServerId }: { showBack?: boolean; onlyServerId?: string }) {
  const insets = useSafeAreaInsets();
  const servers = useApp((s) => s.servers);
  const runtime = useApp((s) => s.runtime);
  const loadInbox = useApp((s) => s.loadInbox);

  useEffect(() => {
    servers.forEach((s) => (!onlyServerId || s.id === onlyServerId) && loadInbox(s.id));
  }, [servers, onlyServerId, loadInbox]);

  const entries = useMemo(() => {
    const all: { server: Server; item: InboxItem }[] = [];
    for (const server of servers) {
      if (onlyServerId && server.id !== onlyServerId) continue;
      for (const item of Object.values(runtime[server.id]?.inbox ?? {})) all.push({ server, item });
    }
    all.sort((a, b) => b.item.created_at - a.item.created_at);
    const pending = all.filter((e) => e.item.status === 'pending');
    const earlier = all.filter((e) => e.item.status !== 'pending').slice(0, 30);
    const out: Entry[] = [];
    if (pending.length) out.push({ header: `Needs you · ${pending.length}` }, ...pending);
    if (earlier.length) out.push({ header: 'Recent' }, ...earlier);
    return out;
  }, [servers, runtime, onlyServerId]);

  const title = onlyServerId ? `${servers.find((s) => s.id === onlyServerId)?.bot.title ?? ''} inbox` : 'Inbox';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {showBack ? (
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            <ChevronLeft size={24} color={colors.textDim} />
          </IconButton>
        ) : null}
        <InboxIcon size={20} color={colors.textMuted} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e, i) => ('header' in e ? `h${i}` : e.item.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24, gap: 12, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><InboxIcon size={34} color={colors.accent} /></View>
            <Text style={styles.emptyTitle}>You're all caught up</Text>
            <Text style={styles.emptyText}>Approvals, questions and routine results from your bots show up here. You'll get a notification when something needs you.</Text>
          </View>
        }
        renderItem={({ item: e }) =>
          'header' in e ? (
            <SectionLabel>{e.header}</SectionLabel>
          ) : (
            <View style={{ gap: 8 }}>
              <View style={styles.meta}>
                <BotAvatar name={e.server.bot.name} size={22} />
                <Text style={styles.metaText} numberOfLines={1}>
                  <Text style={styles.metaBot}>{e.server.bot.title}</Text>
                  {'  ·  '}#{runtime[e.server.id]?.chats[e.item.chat_id]?.title ?? e.item.chat_id}
                  {'  ·  '}{ago(e.item.created_at)}
                </Text>
                <Text
                  style={styles.open}
                  onPress={() => router.push(`/chat/${e.server.id}/${e.item.chat_id}`)}
                >
                  Open chat
                </Text>
              </View>
              <InboxCard serverId={e.server.id} item={e.item} />
            </View>
          )
        }
      />
    </View>
  );
}

function ago(ts: number) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chat },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { flex: 1, color: colors.textMuted, fontFamily: fonts.medium, fontSize: 12.5 },
  metaBot: { color: colors.textDim, fontFamily: fonts.bold },
  open: { color: colors.link, fontFamily: fonts.semibold, fontSize: 12.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 21 },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, textAlign: 'center', maxWidth: 380 },
});
