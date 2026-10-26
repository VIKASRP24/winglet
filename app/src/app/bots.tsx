import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useAddBot } from '../components/AddBot';
import { AgentFace } from '../components/AgentFace';
import { Plus, Trash2 } from '../components/icons';
import { Screen } from '../components/Screen';
import { Button, Footnote, ListGroup, ListRow, SectionHeader } from '../components/ui';
import { mainFirst } from '../lib/bots';
import { connectionView } from '../lib/connection';
import { usePrefs } from '../lib/prefs';
import { homeChat, useApp } from '../lib/store';
import { useTheme } from '../lib/themeContext';

/** Every bot this phone is paired with. Removing one unpairs this phone from it. */
export default function BotsScreen() {
  const t = useTheme();
  const servers = useApp((st) => st.servers);
  const runtime = useApp((st) => st.runtime);
  const network = useApp((st) => st.network);
  const removeServer = useApp((st) => st.removeServer);
  const select = useApp((st) => st.select);
  const [confirm, setConfirm] = useState<string | null>(null);
  const addBot = useAddBot();
  const chosenMain = usePrefs((st) => st.prefs.mainBot);
  return (
    <Screen title="Your bots">
      <SectionHeader title={`${servers.length} paired`} />
      <ListGroup>
        {mainFirst(servers, chosenMain).map((srv, i) => {
          const view = connectionView(network, runtime[srv.id], srv.bot.title);
          const parent = srv.parent ? servers.find((x) => x.id === srv.parent) : undefined;
          return (
            <View key={srv.id}>
              <ListRow icon={<AgentFace server={srv} size={32} still />} iconColor="transparent"
                title={`${srv.bot.title}${i === 0 ? ' (main)' : ''}`} value={view.kind === 'online' ? 'Online' : view.title}
                subtitle={parent ? `On ${parent.bot.title}'s server` : undefined}
                onPress={() => { select(srv.id, homeChat(useApp.getState().runtime[srv.id])); router.navigate('/agent'); }} right={parent ? undefined : (
                  <Button size="sm" variant={confirm === srv.id ? 'danger' : 'ghost'} title={confirm === srv.id ? 'Remove' : ''}
                    accessibilityLabel={confirm === srv.id ? `Confirm removing ${srv.bot.title}` : `Remove ${srv.bot.title}`}
                    icon={<Trash2 size={16} color={t.colors.danger} />}
                    onPress={() => { if (confirm !== srv.id) setConfirm(srv.id); else { setConfirm(null); removeServer(srv.id); } }} />
                )} chevron={false} />
            </View>
          );
        })}
        <ListRow icon={<Plus size={18} color={t.colors.success} />} iconColor={t.colors.success} title="Add a bot" onPress={addBot.open} />
      </ListGroup>
      {addBot.sheet}
      <Footnote>Removing a server unpairs all its bots from this phone. Chats stay on the server; you can pair again.</Footnote>
    </Screen>
  );
}

