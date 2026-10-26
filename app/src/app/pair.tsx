import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotAvatar } from '../components/BotAvatar';
import { ArrowLeft, QrCode, Share, SquarePlus } from '../components/icons';
import { Logo } from '../components/Logo';
import { Button, Card, Field, IconButton } from '../components/ui';
import { defaultDeviceName, fetchInfo, normalizeUrl, pair, parsePairLink } from '../lib/api';
import { isIOS, isStandalone } from '../lib/push';
import { useApp } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';

export default function PairScreen() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; url?: string; fp?: string }>();
  const hasServers = useApp((st) => st.servers.length > 0);
  const addServer = useApp((st) => st.addServer);
  const [url, setUrl] = useState(params.url ?? '');
  const [code, setCode] = useState(params.code ?? '');
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [manual, setManual] = useState(!!params.code || Platform.OS === 'web');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);
  const iosBrowser = isIOS() && !isStandalone();
  const [skipInstall, setSkipInstall] = useState(false);

  // On the web app served by a Winglet server, default to that server.
  useEffect(() => {
    if (Platform.OS !== 'web' || url) return;
    const origin = globalThis.location?.origin;
    if (!origin || origin.startsWith('http://localhost:8081')) return;
    fetchInfo(origin).then(() => setUrl(origin)).catch(() => undefined);
  }, [url]);

  const connect = async (u = url, c = code, fp = params.fp) => {
    const link = parsePairLink(u);
    const target = link ? link.url : normalizeUrl(u);
    const theCode = link ? link.code : c;
    const fingerprint = link ? link.fp : fp;
    if (!target || !theCode) {
      setError('Enter your server address and the code from `hermes winglet pair`.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const server = await pair(target, theCode, deviceName.trim() || defaultDeviceName(), fingerprint);
      await addServer(server);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Links like https://box/#pair=CODE pair straight away (unless iPhone should install first).
  useEffect(() => {
    if (params.code && params.url && !autoTried.current && (!iosBrowser || skipInstall)) {
      autoTried.current = true;
      connect(params.url, params.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.url, iosBrowser, skipInstall]);

  const showInstall = iosBrowser && !skipInstall;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        {hasServers ? (
          <IconButton label="Back" style={{ alignSelf: 'flex-start' }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
            <ArrowLeft size={22} color={t.colors.text} />
          </IconButton>
        ) : null}

        <View style={s.family}>
          <BotAvatar name="atlas" size={44} mood="happy" animated style={{ marginRight: -8, marginTop: 16 }} />
          <BotAvatar name="hermes" size={72} mood="idle" animated glow />
          <BotAvatar name="nova" size={44} mood="idle" animated style={{ marginLeft: -8, marginTop: 16 }} />
        </View>
        <View style={s.hero}>
          <View style={s.brandRow}><Logo size={28} /><Text style={s.brand}>Winglet</Text></View>
          <Text style={s.tagline}>{showInstall ? 'Install on your iPhone' : params.code ? 'Pairing…' : hasServers ? 'Add another bot' : 'Your agents, in your pocket'}</Text>
          <Text style={s.context}>{showInstall ? 'Add Winglet to your Home Screen for notifications.' : <>Run <Text style={s.code}>hermes winglet pair</Text> on your server.</>}</Text>
        </View>

        <Card style={s.card}>
          {showInstall ? (
            <>
              <View style={s.step}><Share size={18} color={t.colors.accent} /><Text style={s.stepText}>Tap <Text style={s.bold}>Share</Text> in Safari's toolbar</Text></View>
              <View style={s.step}><SquarePlus size={18} color={t.colors.accent} /><Text style={s.stepText}>Choose <Text style={s.bold}>Add to Home Screen</Text></Text></View>
              <View style={s.step}><QrCode size={18} color={t.colors.accent} /><Text style={s.stepText}>Open Winglet there{params.code ? <> and enter <Text style={s.code}>{formatCode(params.code)}</Text></> : null}</Text></View>
              <Button title="Continue in Safari instead" variant="ghost" onPress={() => setSkipInstall(true)} />
            </>
          ) : (
            <>
              {Platform.OS !== 'web' ? (
                <Button size="lg" title="Scan QR code" icon={<QrCode size={20} color={t.colors.onAccent} />} onPress={() => router.push('/scan')} />
              ) : null}
              {manual ? (
                <View style={{ gap: 14, marginTop: 4 }}>
                  <Field label="Server address" value={url} onChangeText={setUrl} placeholder="192.168.1.20:8787 or https://box.ts.net" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                  <Field label="Pairing code" value={code} onChangeText={setCode} placeholder="ABCD-2345" autoCapitalize="characters" autoCorrect={false}
                    style={s.codeInput} onSubmitEditing={() => connect()} />
                  <Field label="This device's name" value={deviceName} onChangeText={setDeviceName} placeholder="My phone" />
                  <Button size="lg" title="Connect" loading={busy} onPress={() => connect()} variant={Platform.OS === 'web' ? 'primary' : 'secondary'} />
                </View>
              ) : (
                <Button title="Enter a code instead" variant="ghost" onPress={() => setManual(true)} />
              )}
              {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            </>
          )}
        </Card>

        <Button title="Set up the server plugin" variant="ghost" onPress={() => Linking.openURL('https://github.com/VIKASRP24/winglet')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: t.space.lg, alignItems: 'center', gap: t.space.xl },
  family: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: t.space.lg },
  hero: { alignItems: 'center', gap: t.space.sm, maxWidth: 440 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  brand: { ...t.type.heading, color: t.colors.text },
  tagline: { ...t.type.display, color: t.colors.text, textAlign: 'center' },
  context: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center' },
  card: { width: '100%', maxWidth: 440, gap: t.space.lg },
  code: { ...t.type.callout, fontFamily: t.fonts.mono, color: t.colors.text },
  codeInput: { ...t.type.title, letterSpacing: 4, textAlign: 'center' },
  bold: { fontFamily: t.fonts.semibold, color: t.colors.text },
  step: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm },
  stepText: { flex: 1, ...t.type.callout, color: t.colors.text },
  error: { ...t.type.callout, color: t.colors.danger },
}));
