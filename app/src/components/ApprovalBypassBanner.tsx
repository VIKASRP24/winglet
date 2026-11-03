import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { bypassKey, useApprovalBypass } from '../lib/approvalBypass';
import { haptic } from '../lib/haptics';
import { isOwner, useApp } from '../lib/store';
import { makeStyles } from '../lib/themeContext';
import type { Server } from '../lib/types';
import { Button } from './ui';

/** The server is the source of truth, including after navigating away or reconnecting. */
export function ApprovalBypassBanner({ server, chatId }: { server: Server; chatId: string }) {
  const s = useStyles();
  const runtime = useApp((st) => st.runtime[server.id]);
  const supported = runtime?.info?.features?.chat_approval_bypass === true;
  const owner = isOwner(runtime);
  const online = runtime?.status === 'online';
  const enabled = useApprovalBypass((st) => st.enabled[bypassKey(server, chatId)]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supported || !online || !owner) return;
    const refresh = () => void useApprovalBypass.getState().refresh(server, chatId).catch(() => {});
    refresh();
    // Other owners can change this without creating an inbox event.
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [server, chatId, supported, online, owner, runtime?.inbox]);

  if (!supported || !enabled || !owner) return null;
  const disable = async () => {
    if (busy || !isOwner(useApp.getState().runtime[server.id])) return;
    setBusy(true);
    try {
      await useApprovalBypass.getState().disable(server, chatId);
      haptic.success();
    } catch (e) {
      haptic.error();
      useApp.getState().toast({ serverId: server.id, title: "Couldn't change approvals", body: (e as Error).message });
      void useApprovalBypass.getState().refresh(server, chatId).catch(() => {});
    } finally { setBusy(false); }
  };
  return <View style={s.banner} accessibilityRole="alert">
    <Text style={s.title}>Approvals off in this chat</Text>
    <Text style={s.detail}>Commands can run without asking for approval. Turn approvals back on here before choosing Smart in Tools.</Text>
    <View style={s.actions}>
      <Button size="sm" variant="secondary" title="Turn back on" disabled={!online || busy} onPress={() => void disable()} />
      <Button size="sm" variant="secondary" title="Use Smart approvals instead" disabled={busy} onPress={() => {
        if (!isOwner(useApp.getState().runtime[server.id])) return;
        useApp.getState().select(server.id, chatId);
        router.push('/tools');
      }} />
    </View>
  </View>;
}

const useStyles = makeStyles((t) => ({
  banner: { marginHorizontal: t.space.md, marginTop: t.space.sm, padding: t.space.md, gap: t.space.sm, backgroundColor: t.colors.warningSoft, borderColor: t.colors.warning, borderWidth: 1, borderRadius: t.radius.md },
  title: { ...t.type.bodyStrong, color: t.colors.text },
  detail: { ...t.type.callout, color: t.colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
}));
