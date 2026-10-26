import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { mainFirst } from '../lib/bots';
import { connectionView } from '../lib/connection';
import { usePrefs } from '../lib/prefs';
import { homeChat, useApp } from '../lib/store';
import { useTheme } from '../lib/themeContext';
import { useAddBot } from './AddBot';
import { AgentFace } from './AgentFace';
import { Check, Plus, Settings } from './icons';
import { Sheet } from './Sheet';
import { Badge, Chip, ListGroup, ListRow } from './ui';

/** Switch bots, or add and manage them, from the same picker everywhere. */
export function BotSwitcher() {
  const t = useTheme();
  const servers = useApp((st) => st.servers);
  const runtime = useApp((st) => st.runtime);
  const network = useApp((st) => st.network);
  const selection = useApp((st) => st.selection);
  const select = useApp((st) => st.select);
  const chosen = usePrefs((st) => st.prefs.mainBot);
  const [open, setOpen] = useState(false);
  const addBot = useAddBot();
  const server = servers.find((x) => x.id === selection.serverId) ?? servers[0];
  if (!server) return null;
  const others = servers.filter((x) => x.id !== server.id).reduce((n, x) => n + (runtime[x.id]?.pending ?? 0), 0);

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs, maxWidth: 240 }}>
        <Chip label={server.bot.title} icon={<AgentFace server={server} size={28} still />}
          accessibilityLabel={`${server.bot.title}. Switch bot`} onPress={() => setOpen(true)} />
        {others ? <Badge count={others} dot /> : null}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Your bots" scrollable>
        <ListGroup>
          {mainFirst(servers, chosen).map((x, i) => {
            const rt = runtime[x.id];
            const view = connectionView(network, rt, x.bot.title);
            const on = x.id === server.id;
            return <ListRow key={x.id} title={x.bot.title} value={i === 0 ? 'Main' : undefined}
              icon={<View><AgentFace server={x} size={28} still /></View>}
              subtitle={view.kind === 'online' ? 'Online' : view.title} chevron={false}
              right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                {rt?.pending ? <Badge count={rt.pending} /> : null}
                {on ? <Check size={20} color={t.colors.accent} accessibilityLabel="Current bot" /> : null}
              </View>}
              onPress={() => { if (!on) select(x.id, homeChat(useApp.getState().runtime[x.id])); setOpen(false); }} />;
          })}
        </ListGroup>
        <ListGroup style={{ marginTop: t.space.md }}>
          <ListRow icon={<Plus />} title="Add a bot" onPress={() => { setOpen(false); addBot.open(); }} />
          <ListRow icon={<Settings />} title="Manage bots" onPress={() => { setOpen(false); router.push('/bots'); }} />
        </ListGroup>
      </Sheet>
      {addBot.sheet}
    </>
  );
}
