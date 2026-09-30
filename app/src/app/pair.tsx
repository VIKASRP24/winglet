import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, ChevronLeft, QrCode, Server as ServerIcon, ShieldCheck, Share, SquarePlus } from '../components/icons';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '../components/Logo';
import { Button, Field, GradientButton, IconButton } from '../components/ui';
import { defaultDeviceName, fetchInfo, normalizeUrl, pair, parsePairLink } from '../lib/api';
import { isIOS, isStandalone } from '../lib/push';
import { useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';

const FEATURES = [
  { icon: ServerIcon, title: 'Runs on your machine', text: 'Your Hermes agents, your models, your data.' },
  { icon: BellRing, title: 'Taps you when needed', text: 'Approvals, questions and results as notifications.' },
  { icon: ShieldCheck, title: 'One tap to approve', text: 'Stay in control of anything risky, from anywhere.' },
];

export default function PairScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; url?: string }>();
  const hasServers = useApp((s) => s.servers.length > 0);
  const addServer = useApp((s) => s.addServer);
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

  const connect = async (u = url, c = code) => {
    const link = parsePairLink(u);
    const target = link ? link.url : normalizeUrl(u);
    const theCode = link ? link.code : c;
    if (!target || !theCode) {
      setError('Enter your server address and the code from `hermes winglet pair`.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const server = await pair(target, theCode, deviceName.trim() || defaultDeviceName());
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.rail }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#2A2170', '#1E1F22']} locations={[0, 0.55]} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {hasServers ? (
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ alignSelf: 'flex-start' }}>
            <ChevronLeft size={26} color={colors.textDim} />
          </IconButton>
        ) : null}
        <View style={styles.hero}>
          <Logo size={84} />
          <Text style={styles.brand}>Winglet</Text>
          <Text style={styles.tagline}>{hasServers ? 'Add another bot' : 'Your agents, in your pocket.'}</Text>
        </View>

        {!hasServers ? (
          <View style={styles.features}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <View key={title} style={styles.feature}>
                <View style={styles.featureIcon}><Icon size={20} color="#B9C0FF" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{title}</Text>
                  <Text style={styles.featureText}>{text}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          {showInstall ? (
            <>
              <Text style={styles.cardTitle}>Install Winglet on your iPhone</Text>
              <Text style={styles.cardText}>Notifications on iPhone need Winglet on your Home Screen. It takes 5 seconds:</Text>
              <View style={styles.step}><Share size={18} color={colors.link} /><Text style={styles.stepText}>Tap <Text style={styles.bold}>Share</Text> in Safari's toolbar</Text></View>
              <View style={styles.step}><SquarePlus size={18} color={colors.link} /><Text style={styles.stepText}>Choose <Text style={styles.bold}>Add to Home Screen</Text></Text></View>
              <View style={styles.step}><QrCode size={18} color={colors.link} /><Text style={styles.stepText}>Open Winglet from your Home Screen and enter code <Text style={styles.code}>{formatCode(params.code ?? '')}</Text></Text></View>
              <Button title="Continue in Safari instead" variant="ghost" onPress={() => setSkipInstall(true)} />
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>{params.code ? 'Pairing…' : 'Connect to your Hermes'}</Text>
              <Text style={styles.cardText}>
                On the machine running Hermes, run <Text style={styles.code}>hermes winglet pair</Text> and {Platform.OS === 'web' ? 'enter the code below.' : 'scan the QR code it shows.'}
              </Text>
              {Platform.OS !== 'web' ? (
                <GradientButton title="Scan QR code" icon={<QrCode size={20} color={colors.white} />} onPress={() => router.push('/scan')} />
              ) : null}
              {manual ? (
                <View style={{ gap: 14, marginTop: 4 }}>
                  <Field label="Server address" value={url} onChangeText={setUrl} placeholder="192.168.1.20:8787 or https://box.ts.net" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                  <Field
                    label="Pairing code"
                    value={code}
                    onChangeText={setCode}
                    placeholder="ABCD-2345"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.codeInput}
                    onSubmitEditing={() => connect()}
                  />
                  <Field label="This device's name" value={deviceName} onChangeText={setDeviceName} placeholder="My phone" />
                  {Platform.OS === 'web' ? (
                    <GradientButton title="Connect" loading={busy} onPress={() => connect()} />
                  ) : (
                    <Button title="Connect" loading={busy} onPress={() => connect()} size="lg" />
                  )}
                </View>
              ) : (
                <Button title="Enter a code instead" variant="ghost" onPress={() => setManual(true)} />
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          )}
        </View>

        <Text style={styles.footer}>
          New to this? Winglet is an app for <Text style={styles.bold}>Hermes Agent</Text>. Install the Winglet plugin on your Hermes machine first — see github.com/VIKASRP24/winglet
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 20, alignItems: 'center', gap: 22 },
  hero: { alignItems: 'center', gap: 6, marginTop: 20 },
  brand: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 36, letterSpacing: -0.8, marginTop: 10 },
  tagline: { color: '#C9CDFB', fontFamily: fonts.medium, fontSize: 17 },
  features: { width: '100%', maxWidth: 440, gap: 14 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(88,101,242,0.22)', alignItems: 'center', justifyContent: 'center' },
  featureTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15.5 },
  featureText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, marginTop: 1 },
  card: {
    width: '100%', maxWidth: 440, backgroundColor: colors.chat, borderRadius: radius.xl, padding: 20, gap: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 21 },
  cardText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  code: { fontFamily: fonts.mono, color: colors.text, backgroundColor: colors.rail, fontSize: 14 },
  codeInput: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: 4, textAlign: 'center' },
  bold: { fontFamily: fonts.bold, color: colors.text },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.rail, borderRadius: radius.md, padding: 12 },
  stepText: { flex: 1, color: colors.textDim, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  error: { color: colors.red, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  footer: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 400 },
});
