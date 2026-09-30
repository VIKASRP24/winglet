import { CheckCircle2, CircleHelp, Clock, ShieldAlert, Sparkles, XCircle } from './icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import type { InboxItem } from '../lib/types';
import { Markdown } from './Markdown';
import { Button, tap } from './ui';

const CHOICE_ORDER = ['once', 'session', 'always', 'deny'];

export function InboxCard({ serverId, item, compact }: { serverId: string; item: InboxItem; compact?: boolean }) {
  if (item.kind === 'approval') return <ApprovalCard serverId={serverId} item={item} compact={compact} />;
  if (item.kind === 'question') return <QuestionCard serverId={serverId} item={item} compact={compact} />;
  return <ResultCard item={item} />;
}

function StatusLine({ item }: { item: InboxItem }) {
  if (item.status === 'pending') return null;
  const expired = item.status === 'expired';
  const label = expired
    ? 'Expired — the agent stopped waiting'
    : item.kind === 'approval'
      ? item.resolution === 'deny' ? 'You denied this' : `Approved (${item.payload.labels?.[item.resolution] ?? item.resolution})`
      : `You answered: ${item.resolution}`;
  const Icon = expired ? Clock : item.resolution === 'deny' ? XCircle : CheckCircle2;
  const color = expired ? colors.textMuted : item.resolution === 'deny' ? colors.red : colors.green;
  return (
    <View style={styles.status}>
      <Icon size={15} color={color} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

function ApprovalCard({ serverId, item, compact }: { serverId: string; item: InboxItem; compact?: boolean }) {
  const respond = useApp((s) => s.respond);
  const [busy, setBusy] = useState<string | null>(null);
  const choices = [...(item.payload.choices ?? [])].sort((a, b) => CHOICE_ORDER.indexOf(a) - CHOICE_ORDER.indexOf(b));
  const pending = item.status === 'pending';
  const act = async (choice: string) => {
    setBusy(choice);
    await respond(serverId, item.id, { choice });
    setBusy(null);
  };
  return (
    <View style={[styles.card, pending && styles.cardWarn]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.yellowSoft }]}>
          <ShieldAlert size={18} color={colors.yellow} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Wants to run a command</Text>
          {item.payload.description ? <Text style={styles.subtitle}>Flagged: {item.payload.description}</Text> : null}
        </View>
      </View>
      <View style={styles.command}>
        <Text selectable style={styles.commandText} numberOfLines={compact ? 4 : undefined}>
          {item.payload.command || item.body}
        </Text>
      </View>
      {pending ? (
        <View style={styles.actions}>
          {choices.map((choice) => (
            <Button
              key={choice}
              size="sm"
              title={item.payload.labels?.[choice] ?? choice}
              variant={choice === 'deny' ? 'danger' : choice === 'once' ? 'success' : 'secondary'}
              loading={busy === choice}
              disabled={!!busy && busy !== choice}
              onPress={() => act(choice)}
            />
          ))}
        </View>
      ) : (
        <StatusLine item={item} />
      )}
    </View>
  );
}

function QuestionCard({ serverId, item }: { serverId: string; item: InboxItem; compact?: boolean }) {
  const respond = useApp((s) => s.respond);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = item.status === 'pending';
  const choices = item.payload.choices ?? [];
  const send = async (answer: string) => {
    if (!answer.trim()) return;
    tap();
    setBusy(true);
    await respond(serverId, item.id, { answer: answer.trim() });
    setBusy(false);
  };
  return (
    <View style={[styles.card, pending && styles.cardAccent]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
          <CircleHelp size={18} color={colors.accent} />
        </View>
        <Text style={[styles.title, { flex: 1 }]}>{item.payload.question || item.body}</Text>
      </View>
      {pending ? (
        <>
          {choices.map((choice) => {
            const recommended = /\(recommended\)\s*$/i.test(choice);
            const label = choice.replace(/\s*\(recommended\)\s*$/i, '');
            return (
              <Pressable key={choice} disabled={busy} onPress={() => send(label)} style={({ pressed, hovered }: any) => [styles.choice, (pressed || hovered) && { backgroundColor: colors.active }]}>
                <Text style={styles.choiceText}>{label}</Text>
                {recommended ? <Text style={styles.recommended}>Recommended</Text> : null}
              </Pressable>
            );
          })}
          <View style={styles.otherRow}>
            <TextInput
              value={other}
              onChangeText={setOther}
              placeholder={choices.length ? 'Something else…' : 'Type your answer…'}
              placeholderTextColor={colors.textFaint}
              style={styles.otherInput}
              onSubmitEditing={() => send(other)}
              returnKeyType="send"
            />
            <Button size="sm" title="Send" onPress={() => send(other)} disabled={!other.trim()} loading={busy && !!other} />
          </View>
        </>
      ) : (
        <StatusLine item={item} />
      )}
    </View>
  );
}

function ResultCard({ item }: { item: InboxItem }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: 'rgba(35,165,90,0.14)' }]}>
          <Sparkles size={18} color={colors.green} />
        </View>
        <Text style={[styles.title, { flex: 1 }]}>{item.title}</Text>
      </View>
      <Markdown text={item.body.length > 1200 ? `${item.body.slice(0, 1200)}…` : item.body} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border, maxWidth: 620,
  },
  cardWarn: { borderColor: 'rgba(240,178,50,0.45)' },
  cardAccent: { borderColor: 'rgba(88,101,242,0.55)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 21 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 },
  command: { backgroundColor: colors.codeBg, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.divider },
  commandText: { color: '#E3E5E8', fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  choice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.input,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
  },
  choiceText: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
  recommended: { color: colors.accent, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  otherInput: {
    flex: 1, backgroundColor: colors.rail, color: colors.text, fontFamily: fonts.regular, fontSize: 15, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 9,
  },
});
