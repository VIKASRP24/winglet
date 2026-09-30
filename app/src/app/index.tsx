import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ChatView } from '../components/ChatView';
import { InboxView } from '../components/InboxView';
import { ChannelList, Rail } from '../components/Sidebar';
import { useApp } from '../lib/store';
import { colors, WIDE_BREAKPOINT } from '../lib/theme';

function pairFromHash(): string | null {
  if (Platform.OS !== 'web') return null;
  const m = (globalThis.location?.hash ?? '').match(/pair=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}

export default function Home() {
  const servers = useApp((s) => s.servers);
  const selection = useApp((s) => s.selection);
  const select = useApp((s) => s.select);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const [mode, setMode] = useState<'bots' | 'inbox'>('bots');
  const hashCode = pairFromHash();

  useEffect(() => {
    if (!selection.serverId && servers[0]) select(servers[0].id, 'general');
  }, [selection.serverId, servers, select]);

  if (hashCode) {
    globalThis.history?.replaceState(null, '', '/');
    return <Redirect href={{ pathname: '/pair', params: { code: hashCode, url: globalThis.location.origin } }} />;
  }
  if (!servers.length) return <Redirect href="/pair" />;

  const server = servers.find((s) => s.id === selection.serverId) ?? servers[0];
  const chatId = selection.chatId ?? 'general';

  const openChat = (id: string) => {
    select(server.id, id);
    if (!wide) router.push(`/chat/${server.id}/${id}`);
  };
  const openInbox = () => {
    if (wide) setMode('inbox');
    else router.push('/inbox');
  };

  return (
    <View style={styles.root}>
      <Rail
        mode={wide ? mode : 'bots'}
        onInbox={openInbox}
        onSelect={(id) => {
          setMode('bots');
          select(id, id === server.id ? chatId : 'general');
        }}
      />
      {wide && mode === 'inbox' ? (
        <View style={{ flex: 1 }}><InboxView /></View>
      ) : (
        <>
          <View style={wide ? styles.channelsWide : styles.channelsNarrow}>
            <ChannelList server={server} activeChatId={chatId} wide={wide} onOpenChat={openChat} onOpenInbox={openInbox} />
          </View>
          {wide ? (
            <View style={{ flex: 1 }}>
              <ChatView key={`${server.id}:${chatId}`} server={server} chatId={chatId} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.rail },
  channelsWide: { width: 264, borderTopLeftRadius: 12, overflow: 'hidden' },
  channelsNarrow: { flex: 1, borderTopLeftRadius: 16, overflow: 'hidden' },
});
