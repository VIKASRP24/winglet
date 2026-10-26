import { Platform, Text, View } from 'react-native';
import { BotAvatar } from '../components/BotAvatar';
import { Check, Monitor, Moon, Sun } from '../components/icons';
import { Screen } from '../components/Screen';
import { Card, Footnote, ListGroup, ListRow, SectionHeader, Segmented, Tap, Toggle } from '../components/ui';
import { usePrefs, type Prefs } from '../lib/prefs';
import { ACCENT_NAMES, ACCENTS } from '../lib/theme';
import { makeStyles, useTheme } from '../lib/themeContext';

/** Every change applies at once. Sidebar placement is in Settings. */
export default function AppearanceScreen() {
  const t = useTheme();
  const s = useStyles();
  const prefs = usePrefs((st) => st.prefs);
  const update = usePrefs((st) => st.update);
  const set = <K extends keyof Prefs>(key: K) => (value: Prefs[K]) => update({ [key]: value } as Partial<Prefs>);
  const icon = (I: typeof Sun) => <I size={16} color={t.colors.textSecondary} />;

  return (
    <Screen title="Appearance">
      <Preview />

      <SectionHeader title="Theme" />
      <ListGroup>
        <View style={s.control}>
          <Segmented label="Theme" value={prefs.theme} onChange={set('theme')} options={[
            { value: 'system', label: 'System', icon: icon(Monitor) },
            { value: 'light', label: 'Light', icon: icon(Sun) },
            { value: 'dark', label: 'Dark', icon: icon(Moon) },
          ]} />
        </View>
        {prefs.theme !== 'light' ? <ListRow title="Pure black" right={<Toggle label="Pure black" value={prefs.pureBlack} onValueChange={set('pureBlack')} />} /> : null}
      </ListGroup>
      {prefs.theme !== 'light' ? <Footnote>Uses a true-black background in dark mode.</Footnote> : null}

      <SectionHeader title="Accent" />
      <Card>
        <View style={s.swatches} accessibilityRole="radiogroup" accessibilityLabel="Accent colour">
          {ACCENT_NAMES.map((name) => {
            const a = ACCENTS[name];
            const on = prefs.accent === name;
            return (
              <Tap key={name} feedback="selection" accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={a.label}
                onPress={() => update({ accent: name })} style={s.swatchCell}>
                <View style={[s.swatchRing, on && { borderColor: t.scheme === 'dark' ? a.dark : a.light }]}>
                  <View style={[s.swatch, { backgroundColor: a.fill }]}>
                    {on ? <Check size={20} color={t.colors.onAccent} strokeWidth={3} /> : null}
                  </View>
                </View>
                <Text style={[s.swatchLabel, on && { color: t.colors.text }]}>{a.label}</Text>
              </Tap>
            );
          })}
        </View>
      </Card>

      <SectionHeader title="Chat layout" />
      <Card>
        <Segmented label="Chat layout" value={prefs.layout} onChange={set('layout')} options={[
          { value: 'bubbles', label: 'Bubbles' }, { value: 'compact', label: 'Compact' },
        ]} />
      </Card>

      <SectionHeader title="Motion & transparency" />
      <ListGroup>
        <View style={s.control}>
          <Text style={s.label}>Animation</Text>
          <Segmented label="Animation" value={prefs.motion} onChange={set('motion')} options={[
            { value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduced' }, { value: 'full', label: 'Full' },
          ]} />
        </View>
        <View style={s.control}>
          <Text style={s.label}>Transparency</Text>
          <Segmented label="Transparency" value={prefs.transparency} onChange={set('transparency')} options={[
            { value: 'system', label: 'System' }, { value: 'reduce', label: 'Solid' }, { value: 'full', label: 'Glass' },
          ]} />
        </View>
      </ListGroup>

      <SectionHeader title="Feedback" />
      <ListGroup>
        <ListRow title="Haptics" value={Platform.OS === 'web' ? 'Unavailable on web' : undefined}
          right={<Toggle label="Haptics" value={prefs.haptics} onValueChange={set('haptics')} />} />
        <ListRow title="Sounds" right={<Toggle label="Sounds" value={prefs.sounds} onValueChange={set('sounds')} />} />
      </ListGroup>
    </Screen>
  );
}

/** A live sample of the current theme, accent and layout. */
function Preview() {
  const t = useTheme();
  const s = useStyles();
  const layout = usePrefs((st) => st.prefs.layout);
  return (
    <Card style={s.preview} accessibilityLabel="Preview">
      <View style={s.previewBot} accessibilityRole="image" accessibilityLabel="Conversation preview">
        <BotAvatar name="hermes" size={26} mood="happy" />
        <Text style={s.previewText}>Want a weekly disk check?</Text>
      </View>
      {layout === 'bubbles' ? (
        <View style={[s.previewBubble, { backgroundColor: t.colors.accentFill }]}>
          <Text style={[s.previewText, { color: t.colors.onAccent }]}>Yes, every Monday</Text>
        </View>
      ) : (
        <View style={s.previewBot}>
          <View style={s.previewMe} />
          <Text style={s.previewText}>Yes, every Monday</Text>
        </View>
      )}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  control: { padding: t.space.lg, gap: t.space.sm },
  label: { ...t.type.body, color: t.colors.text },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, justifyContent: 'space-between' },
  swatchCell: { alignItems: 'center', gap: t.space.xs, minWidth: 48, minHeight: 48 },
  swatchRing: { padding: t.space.xs, borderRadius: t.radius.pill, borderWidth: 2, borderColor: 'transparent' },
  swatch: { width: 36, height: 36, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
  swatchLabel: { ...t.type.caption, color: t.colors.textSecondary },
  preview: { marginTop: t.space.md, gap: t.space.md },
  previewBot: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  previewMe: { width: 26, height: 26, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken },
  previewText: { ...t.type.callout, color: t.colors.text, flexShrink: 1 },
  previewBubble: { alignSelf: 'flex-end', borderRadius: t.radius.lg, borderBottomRightRadius: 6, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm },
}));
