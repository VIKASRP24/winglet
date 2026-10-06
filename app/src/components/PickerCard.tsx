import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { api, ApiError } from '../lib/api';
import { haptic } from '../lib/haptics';
import { isOwner, useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Message, Picker, Server } from '../lib/types';
import { Check, Clock, Cpu, Search, ShieldQuestion, SlidersHorizontal } from './icons';
import { Markdown } from './Markdown';
import { Button, Chip } from './ui';

const SHOWN_PER_PROVIDER = 8;

/** The short name of a model id: "anthropic/claude-sonnet-4" → "claude-sonnet-4", and Bedrock's
 * "us.anthropic.claude-sonnet-4" → "claude-sonnet-4". */
export const shortModel = (id: string) => (id.split('/').pop() || id)
  .replace(/^(us|eu|apac|global)\./, '')
  .replace(/^(anthropic|openai|meta|amazon|mistral|cohere|ai21|deepseek|qwen|writer)\./, '');

/**
 * Hermes asks a question with fixed answers (/model, /reasoning, /fast, a command to confirm): tap
 * one and Hermes applies it. The card then shows what was chosen and Hermes's reply.
 */
export function PickerCard({ server, message }: { server: Server; message: Message }) {
  const t = useTheme();
  const s = useStyles();
  const picker = message.meta.picker as Picker;
  const owner = useApp((st) => isOwner(st.runtime[server.id]));
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const open = picker.status === 'open' && picker.expires_at * 1000 > Date.now();

  const choose = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    haptic.selection();
    try {
      await api(server, `/api/pickers/${picker.id}/select`, { method: 'POST', body: JSON.stringify({ ...body, message_id: message.id }) });
      haptic.success();
    } catch (e) {
      haptic.error();
      const expired = e instanceof ApiError && e.status === 410;
      useApp.getState().toast({ serverId: server.id, title: expired ? 'Too late' : "Couldn't choose",
        body: expired ? 'That choice expired. Run the command again.' : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const icon = picker.kind === 'model' ? <Cpu size={18} color={t.colors.onAccentSoft} />
    : picker.kind === 'confirm' ? <ShieldQuestion size={18} color={t.colors.warning} /> : <SlidersHorizontal size={18} color={t.colors.onAccentSoft} />;

  const q = query.trim().toLowerCase();
  const providers = useMemo(() => (picker.providers ?? []).map((p) => ({
    ...p, models: q ? p.models.filter((m) => m.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : p.models,
  })).filter((p) => p.models.length), [picker.providers, q]);
  const total = (picker.providers ?? []).reduce((n, p) => n + p.models.length, 0);

  return (
    <Animated.View entering={FadeIn.duration(180)} style={[s.card, open && picker.kind === 'confirm' && { borderColor: t.colors.warning }]}>
      <View style={s.head}>
        <View style={[s.icon, { backgroundColor: picker.kind === 'confirm' ? t.colors.warningSoft : t.colors.accentSoft }]}>{icon}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{picker.kind === 'model' ? 'Model for this chat' : picker.kind === 'confirm' ? 'Confirm' : 'Choose a setting'}</Text>
          {picker.kind === 'model' && picker.current_model ? (
            <Text style={s.sub}>Now: {shortModel(picker.current_model)}{picker.current_label ? ` · ${picker.current_label}` : ''}</Text>
          ) : null}
        </View>
      </View>
      {/* Hermes's own wording (it uses Markdown) for settings and confirmations, while they're open. */}
      {open && picker.kind !== 'model' ? <Markdown text={message.text} /> : null}

      {picker.status === 'done' ? (
        <View style={{ gap: 8 }}>
          <View style={s.chosen}>
            <Check size={14} color={t.colors.success} />
            <Text style={s.chosenText}>{picker.selected}{picker.by ? ` · ${picker.by}` : ''}</Text>
          </View>
          <Markdown text={message.text} />
        </View>
      ) : !open ? (
        <View style={s.chosen}>
          <Clock size={14} color={t.colors.textSecondary} />
          <Text style={[s.chosenText, { color: t.colors.textSecondary }]}>This expired. Run the command again for a new one.</Text>
        </View>
      ) : !owner ? (
        <Text style={s.sub}>Only an owner can choose here.</Text>
      ) : picker.kind === 'model' ? (
        <View style={{ gap: 12 }}>
          {total > 12 ? (
            <View style={s.search}>
              <Search size={16} color={t.colors.textTertiary} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Find a model" placeholderTextColor={t.colors.textTertiary}
                style={s.searchInput} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find a model" />
            </View>
          ) : null}
          {providers.map((p) => {
            const all = expanded[p.slug] || !!q;
            const models = all ? p.models : p.models.slice(0, SHOWN_PER_PROVIDER);
            return (
              <View key={p.slug} style={{ gap: 8 }}>
                <Text style={s.provider}>{p.name}</Text>
                <View style={s.chips}>
                  {models.map((m) => {
                    const current = m === picker.current_model && p.slug === picker.current_provider;
                    const key = `${p.slug}/${m}`;
                    return (
                      <Chip key={key} label={shortModel(m)} selected={current} accessibilityLabel={`${m} from ${p.name}${current ? ', current' : ''}`}
                        icon={busy === key ? <ActivityIndicator size="small" color={t.colors.accent} /> : current ? <Check size={14} color={t.colors.onAccentSoft} /> : undefined}
                        onPress={() => !busy && choose(key, { provider: p.slug, model: m })} />
                    );
                  })}
                  {!all && p.models.length > SHOWN_PER_PROVIDER ? (
                    <Chip label={`+${p.models.length - SHOWN_PER_PROVIDER} more`} onPress={() => setExpanded((e) => ({ ...e, [p.slug]: true }))} />
                  ) : null}
                </View>
              </View>
            );
          })}
          {!providers.length ? <Text style={s.sub}>No model matches “{query}”.</Text> : null}
        </View>
      ) : picker.kind === 'confirm' ? (
        <View style={{ gap: 12 }}>
          {picker.detail ? <Markdown text={picker.detail} /> : null}
          <View style={s.buttons}>
            {(picker.choices ?? []).map((c) => (
              <Button key={c.value} size="sm" title={c.label} loading={busy === c.value} disabled={!!busy && busy !== c.value}
                variant={c.value === 'once' ? 'primary' : c.value === 'cancel' ? 'ghost' : 'secondary'} onPress={() => choose(c.value, { value: c.value })} />
            ))}
          </View>
        </View>
      ) : (
        <View style={s.chips}>
          {(picker.choices ?? []).map((c) => (
            <Chip key={c.value} label={c.label} selected={c.current}
              icon={busy === c.value ? <ActivityIndicator size="small" color={t.colors.accent} /> : c.current ? <Check size={14} color={t.colors.onAccentSoft} /> : undefined}
              onPress={() => !busy && choose(c.value, { value: c.value })} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: 12, padding: 14, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border,
    marginTop: 4, maxWidth: 560,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { ...t.type.bodyStrong, color: t.colors.text },
  sub: { ...t.type.caption, color: t.colors.textSecondary, marginTop: 2 },
  provider: { ...t.type.label, fontSize: 11.5, color: t.colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chosenText: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.success },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
  },
  searchInput: { flex: 1, ...t.type.callout, color: t.colors.text, ...({ outlineStyle: 'none' } as object) },
}));
