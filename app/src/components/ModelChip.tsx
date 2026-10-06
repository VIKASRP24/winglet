import { useEffect, useState } from 'react';
import { Text, useWindowDimensions } from 'react-native';
import { api } from '../lib/api';
import { haptic } from '../lib/haptics';
import { isOwner, useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { AgentInfo, Server } from '../lib/types';
import { ChevronDown, Cpu } from './icons';
import { shortModel } from './PickerCard';
import { Tap } from './ui';

/**
 * The model this chat is using, in the header. Tapping asks Hermes for its model picker, which
 * arrives as a card in the chat; the choice applies to this chat only.
 */
export function ModelChip({ server, chatId }: { server: Server; chatId: string }) {
  const t = useTheme();
  const s = useStyles();
  // On a phone the chip gives up its icon and some width so the chat's name stays readable.
  const compact = useWindowDimensions().width < 430;
  const rt = useApp((st) => st.runtime[server.id]);
  const owner = isOwner(rt);
  const ready = !!rt?.info?.features?.agent && !!rt?.info?.features?.pickers && rt?.status === 'online';
  // Re-read after a model card in this chat is answered.
  const picks = useApp((st) => (st.runtime[server.id]?.messages[chatId] ?? [])
    .filter((m) => m.meta?.picker?.kind === 'model' && m.meta.picker.status === 'done').length);
  const [info, setInfo] = useState<AgentInfo | null>(null);

  useEffect(() => {
    if (!ready || !owner) return;
    let alive = true;
    api<AgentInfo>(server, `/api/agent?chat=${encodeURIComponent(chatId)}`).then((i) => alive && setInfo(i)).catch(() => undefined);
    return () => { alive = false; };
  }, [server, chatId, ready, owner, picks]);

  if (!ready || !owner || !info?.configured.model) return null;
  const model = info.chat?.model || info.configured.model;
  const differs = info.chat?.source === 'chat';

  const ask = () => {
    haptic.light();
    api(server, `/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: '/model', hidden: true, client_id: `c-${Date.now().toString(36)}-model` }),
    }).catch((e) => useApp.getState().toast({ serverId: server.id, title: "Couldn't open the model picker", body: (e as Error).message }));
  };

  return (
    <Tap feedback="none" scaleTo={0.95} onPress={ask}
      style={({ hovered }) => [s.chip, compact && s.compact, differs && s.chipChat, hovered && { borderColor: t.colors.borderStrong }]}
      accessibilityLabel={`Model: ${model}${differs ? ', chosen for this chat' : ''}. Change the model for this chat`}>
      {compact ? null : <Cpu size={13} color={differs ? t.colors.onAccentSoft : t.colors.textSecondary} />}
      <Text style={[s.text, differs && { color: t.colors.onAccentSoft }]} numberOfLines={1}>{shortModel(model)}</Text>
      <ChevronDown size={14} color={differs ? t.colors.onAccentSoft : t.colors.textSecondary} />
    </Tap>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 10, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border, maxWidth: 150,
  },
  compact: { maxWidth: 116, paddingHorizontal: 9, gap: 3 },
  chipChat: { backgroundColor: t.colors.accentSoft, borderColor: 'transparent' },
  text: { fontFamily: t.fonts.semibold, fontSize: 12.5, color: t.colors.textSecondary, flexShrink: 1 },
}));
