import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { unlock, useLock } from '../lib/appLock';
import { makeStyles, useTheme } from '../lib/themeContext';
import { Fingerprint } from './icons';
import { Logo } from './Logo';
import { Button } from './ui';

/** Covers everything while the app is locked, and asks for the phone's own unlock straight away. */
export function LockScreen() {
  const t = useTheme();
  const s = useStyles();
  const locked = useLock((st) => st.locked);
  useEffect(() => {
    if (locked) unlock();
  }, [locked]);
  if (!locked) return null;
  return (
    <View style={s.cover} accessibilityViewIsModal>
      <Logo size={72} />
      <Text style={s.title}>Winglet is locked</Text>
      <Button title="Unlock" size="lg" icon={<Fingerprint size={20} color={t.colors.onAccent} />} onPress={() => unlock()} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: t.colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32,
  },
  title: { ...t.type.title, color: t.colors.text },
}));
