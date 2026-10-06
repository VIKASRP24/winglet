import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { Check, Search } from '../components/icons';
import { shortModel } from '../components/PickerCard';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Button, Card, ListGroup, ListRow, SectionHeader, Skeleton } from '../components/ui';
import { api, signedApi } from '../lib/api';
import { haptic } from '../lib/haptics';
import { useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';

type Options = { model: string; provider: string; providers: { slug: string; name: string; models: string[] }[] };
type Result = { ok: boolean; confirm_required?: boolean; confirm_message?: string; model?: string; provider?: string };

/** The model new chats start with. A chat can still switch on its own from the model chip. */
export default function ModelScreen() {
  const t = useTheme();
  const s = useStyles();
  const server = useApp((st) => st.servers.find((x) => x.id === st.selection.serverId) ?? st.servers[0]);
  const [options, setOptions] = useState<Options | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ provider: string; model: string; message: string } | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    if (!server) return;
    api<Options>(server, '/api/models').then(setOptions).catch((e) => setError((e as Error).message));
  };
  useEffect(load, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = async (provider: string, model: string, confirmed = false) => {
    if (!server) return;
    setBusy(`${provider}/${model}`);
    setError('');
    try {
      const result = await signedApi<Result>(server, 'PUT', '/api/models/default', { provider, model, ...(confirmed ? { confirm: true } : {}) });
      if (result.confirm_required) {
        setConfirm({ provider, model, message: result.confirm_message ?? '' });
      } else {
        haptic.success();
        setConfirm(null);
        load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const q = query.trim().toLowerCase();
  const providers = useMemo(() => (options?.providers ?? []).map((p) => ({
    ...p, models: q ? p.models.filter((m) => m.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : p.models,
  })).filter((p) => p.models.length), [options, q]);

  return (
    <Screen title="Default model" subtitle="New chats start with this model. Each chat can switch on its own from the model button at the top.">
      {options ? (
        <Card style={s.current}>
          <Text style={s.label}>Now</Text>
          <Text style={s.currentModel}>{shortModel(options.model) || 'Not set'}</Text>
          <Text style={s.note}>{options.providers.find((p) => p.slug === options.provider)?.name ?? options.provider}</Text>
        </Card>
      ) : null}
      <View style={s.search}>
        <Search size={17} color={t.colors.textTertiary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Find a model" placeholderTextColor={t.colors.textTertiary}
          style={s.searchInput} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find a model" />
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!options ? (
        <View style={{ gap: 10, marginTop: 16 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={52} radius={16} />)}</View>
      ) : providers.length === 0 ? (
        <Card style={{ marginTop: 16 }}><Text style={s.note}>{q ? `No model matches “${query}”.` : 'No providers are set up yet. Add one under Providers.'}</Text></Card>
      ) : providers.map((p) => (
        <View key={p.slug}>
          <SectionHeader title={p.name} />
          <ListGroup>
            {p.models.slice(0, q ? 60 : 30).map((m) => {
              const current = m === options.model && p.slug === options.provider;
              const key = `${p.slug}/${m}`;
              return (
                <ListRow key={key} title={shortModel(m)} subtitle={m !== shortModel(m) ? m : undefined} chevron={false}
                  right={busy === key ? <ActivityIndicator color={t.colors.accent} /> : current ? <Check size={18} color={t.colors.accent} /> : undefined}
                  onPress={current || busy ? undefined : () => set(p.slug, m)} />
              );
            })}
          </ListGroup>
        </View>
      ))}
      <Sheet visible={!!confirm} onClose={() => setConfirm(null)} title="Use an expensive model?">
        <View style={{ gap: 14, paddingHorizontal: 4 }}>
          <Text style={s.sheetText}>{confirm?.message}</Text>
          <Button title={`Use ${shortModel(confirm?.model ?? '')}`} variant="danger" loading={!!busy}
            onPress={() => confirm && set(confirm.provider, confirm.model, true)} />
          <Button title="Cancel" variant="secondary" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  current: { gap: 2, marginTop: 4 },
  label: { ...t.type.label, fontSize: 11.5, color: t.colors.textSecondary },
  currentModel: { ...t.type.title, color: t.colors.text },
  note: { ...t.type.callout, color: t.colors.textSecondary },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 46, borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, marginTop: 16,
  },
  searchInput: { flex: 1, ...t.type.body, color: t.colors.text, ...({ outlineStyle: 'none' } as object) },
  error: { ...t.type.callout, color: t.colors.danger, marginTop: 10 },
  sheetText: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center' },
}));
