import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { Sheet } from '../../components/Sheet';
import { ChevronRight, GitBranch } from '../../components/icons';
import { ListGroup, ListRow, Tap } from '../../components/ui';
import { useApp } from '../../lib/store';
import { makeStyles, useTheme } from '../../lib/themeContext';
import type { BranchState, Server } from '../../lib/types';
import { ancestryLabel, branchChildrenLabel } from './plan';

/** One quiet ancestor line, not ancestry chrome on every bubble. */
export function BranchStrip({ server, chatId, state }: { server: Server; chatId: string; state: BranchState | null }) {
  const t = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const chat = useApp((st) => st.runtime[server.id]?.chats[chatId]);
  const parent = useApp((st) => {
    const branch = st.runtime[server.id]?.chats[chatId]?.branch;
    return branch ? st.runtime[server.id]?.chats[branch.parent_chat_id] : undefined;
  });
  const children = state?.children ?? [];
  const branch = chat?.branch ?? state?.branch;
  if (!branch && !children.length) return null;

  const openParent = () => {
    if (!branch) return;
    if (!parent) {
      useApp.getState().toast({ serverId: server.id, title: 'Original chat deleted', body: 'This branch kept its own copy of the conversation.' });
      return;
    }
    router.push(`/chat/${server.id}/${parent.id}`);
  };

  return (
    <>
      <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutUp.duration(140)}>
        <Tap
          feedback="selection"
          accessibilityLabel={branch
            ? `${ancestryLabel(branch)}. Show the original chat.`
            : `${branchChildrenLabel(children)}. Show branches.`}
          onPress={branch ? openParent : () => setOpen(true)}
          style={({ hovered }) => [s.strip, { borderColor: hovered ? t.colors.borderStrong : t.colors.border }]}
        >
          <View style={s.icon}>
            <GitBranch size={15} color={t.colors.textSecondary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>
              {branch ? ancestryLabel(branch) : branchChildrenLabel(children)}
            </Text>
          </View>
          <ChevronRight size={16} color={t.colors.textTertiary} />
        </Tap>
      </Animated.View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Branches">
        {children.length ? <ListGroup>{children.map((child) => (
          <ListRow key={child.id} icon={<GitBranch />} title={child.title}
            onPress={() => { setOpen(false); router.push(`/chat/${server.id}/${child.id}`); }} />
        ))}</ListGroup> : <Text style={s.empty}>No branches yet.</Text>}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginHorizontal: 12,
    minHeight: 48, paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.md,
    backgroundColor: t.colors.surface, borderWidth: 1,
  },
  icon: { width: 22, alignItems: 'center', justifyContent: 'center' },
  title: { ...t.type.callout, fontFamily: t.fonts.semibold, color: t.colors.text },
  hint: { ...t.type.caption, color: t.colors.textSecondary, marginTop: 1 },
  empty: { ...t.type.callout, color: t.colors.textSecondary, padding: 16 },
}));
