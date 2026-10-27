import { ScrollView, Text, View } from 'react-native';
import type { ChatFilter } from '../lib/chatActivity';
import { makeStyles, useTheme } from '../lib/themeContext';
import { Tap } from './ui';

/** All / Running / Needs you (/ Archived) as a row of soft pills; the chosen one is tinted with the accent. */
export function ChatFilters({ value, onChange, counts, archived }: {
  value: ChatFilter | 'archived'; onChange: (value: ChatFilter | 'archived') => void;
  counts: { running: number; pending: number }; archived?: number;
}) {
  const t = useTheme();
  const s = useStyles();
  const options: { value: ChatFilter | 'archived'; label: string; count?: number; tone?: 'warning' }[] = [
    { value: 'all', label: 'All' }, { value: 'running', label: 'Running', count: counts.running },
    { value: 'needs-you', label: 'Needs you', count: counts.pending, tone: 'warning' },
    ...(archived === undefined ? [] : [{ value: 'archived' as const, label: 'Archived', count: archived }]),
  ];
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scroll} contentContainerStyle={s.filters}
    keyboardShouldPersistTaps="handled" accessibilityRole="tablist" accessibilityLabel="Filter chats">
    {options.map((option) => {
      const on = value === option.value;
      return <Tap key={option.value} feedback="selection" scaleTo={0.94} accessibilityRole="tab"
        accessibilityLabel={`${option.label} chats${option.count ? `, ${option.count}` : ''}`}
        aria-selected={on}
        accessibilityState={{ selected: on }} onPress={() => onChange(option.value)} style={s.target}>
        <View style={[s.pill, on && s.selected]}>
          <Text style={[s.label, on && { color: t.colors.onAccentSoft }]}>{option.label}</Text>
          {option.count ? <View style={[s.bubble, on ? { backgroundColor: t.colors.accentSoft } : option.tone === 'warning' ? { backgroundColor: t.colors.warningSoft } : null]}>
            <Text style={[s.count, { color: on ? t.colors.onAccentSoft : option.tone === 'warning' ? t.colors.warning : t.colors.textSecondary }]}>{option.count}</Text>
          </View> : null}
        </View>
      </Tap>;
    })}
  </ScrollView>;
}

const useStyles = makeStyles((t) => ({
  scroll: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: 2, paddingHorizontal: 4, alignItems: 'center' },
  // The pill is drawn smaller than its 44pt touch target.
  target: { minHeight: 44, justifyContent: 'center' },
  pill: { minHeight: 34, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: t.radius.pill,
    borderWidth: 1, borderColor: t.colors.cardBorder, backgroundColor: t.colors.card },
  selected: { backgroundColor: t.colors.accentSoft, borderColor: 'transparent' },
  label: { ...t.type.caption, fontSize: 13, color: t.colors.textSecondary, fontFamily: t.fonts.semibold },
  bubble: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.pressed },
  count: { fontFamily: t.fonts.bold, fontSize: 11, lineHeight: 14 },
}));
