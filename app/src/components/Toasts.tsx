import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';
import { BotAvatar } from './BotAvatar';

/** In-app banners for things that happen outside the chat you're looking at. */
export function Toasts() {
  const insets = useSafeAreaInsets();
  const toasts = useApp((s) => s.toasts);
  const servers = useApp((s) => s.servers);
  const dismiss = useApp((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      {toasts.map((t) => {
        const server = servers.find((s) => s.id === t.serverId);
        return (
          <Pressable
            key={t.id}
            style={({ pressed }) => [styles.toast, pressed && { opacity: 0.9 }]}
            onPress={() => {
              dismiss(t.id);
              if (t.href) router.push(t.href as never);
            }}
          >
            {server ? <BotAvatar name={server.bot.name} size={34} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
              <Text style={styles.body} numberOfLines={2}>{t.body}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8, paddingHorizontal: 12, zIndex: 100 },
  toast: {
    width: '100%', maxWidth: 440, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cardRaised,
    borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  body: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, marginTop: 1 },
});
