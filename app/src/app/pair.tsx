import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Aurora } from '../components/Aurora';
import { BotAvatar } from '../components/BotAvatar';
import { Glass } from '../components/Glass';
import { ArrowLeft, ExternalLink, KeyRound, QrCode, Share, SquarePlus } from '../components/icons';
import { Logo } from '../components/Logo';
import { Button, Field, IconButton, Tap } from '../components/ui';
import { defaultDeviceName, fetchInfo, normalizeUrl, pair, parsePairLink } from '../lib/api';
import { spring, useReducedMotion } from '../lib/motion';
import { isIOS, isStandalone } from '../lib/push';
import { useApp } from '../lib/store';
import { auroraColors, BRAND } from '../lib/theme';
import { makeStyles, useTheme } from '../lib/themeContext';

/** Things arriving one after another, settling into place; nothing moves when motion is reduced. */
const rise = (reduced: boolean, i: number) => (reduced ? undefined
  : FadeInDown.delay(80 + i * 70).springify().damping(spring.soft.damping).stiffness(spring.soft.stiffness));

export default function PairScreen() {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReducedMotion();
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
  // Winglet's own colours: before there's a bot, the glow is the brand's.
  const glow = useMemo(() => auroraColors(BRAND.from, t.colors.accent), [t.colors.accent]);

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
    <View style={s.root}>
      <Aurora colors={glow} strength={1.3} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
          {hasServers ? (
            <IconButton label="Back" style={{ alignSelf: 'flex-start' }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
              <ArrowLeft size={22} color={t.colors.text} />
            </IconButton>
          ) : null}

          <View style={s.column}>
            <Animated.View entering={rise(reduced, 0)} style={{ alignSelf: 'center' }}>
              <Glass style={s.brand} intensity={30}>
                <Logo size={24} />
                <Text style={s.brandText}>Winglet</Text>
              </Glass>
            </Animated.View>

            <Float reduced={reduced}>
              <View style={s.family}>
                <BotAvatar name="atlas" size={52} mood="happy" animated style={{ marginRight: -10, marginTop: 30 }} />
                <BotAvatar name="hermes" size={104} mood="idle" animated glow />
                <BotAvatar name="nova" size={52} mood="idle" animated style={{ marginLeft: -10, marginTop: 30 }} />
              </View>
            </Float>

            <Animated.View entering={rise(reduced, 1)} style={s.hero}>
              <Text style={s.tagline} accessibilityRole="header">
                {showInstall ? 'Install on your iPhone' : params.code ? 'Pairing…' : hasServers ? 'Add another bot' : 'Your agents, in your pocket'}
              </Text>
              <Text style={s.context}>{showInstall ? 'Add Winglet to your Home Screen for notifications.' : <>Run <Text style={s.code}>hermes winglet pair</Text> on your server.</>}</Text>
            </Animated.View>

            {showInstall ? (
              <Animated.View entering={rise(reduced, 2)} style={s.actions}>
                <Glass style={s.panel}>
                  <Step n={1} icon={<Share size={18} color={t.colors.onAccentSoft} />}>Tap <Text style={s.bold}>Share</Text> in Safari's toolbar</Step>
                  <Step n={2} icon={<SquarePlus size={18} color={t.colors.onAccentSoft} />}>Choose <Text style={s.bold}>Add to Home Screen</Text></Step>
                  <Step n={3} icon={<QrCode size={18} color={t.colors.onAccentSoft} />}>
                    Open Winglet there{params.code ? <> and enter <Text style={s.code}>{formatCode(params.code)}</Text></> : null}
                  </Step>
                </Glass>
                <GlassPill title="Continue in Safari instead" onPress={() => setSkipInstall(true)} />
              </Animated.View>
            ) : (
              <Animated.View entering={rise(reduced, 2)} style={s.actions}>
                {Platform.OS !== 'web' ? (
                  <Button size="lg" title="Scan QR code" icon={<QrCode size={20} color={t.colors.onAccent} />} onPress={() => router.push('/scan')} />
                ) : null}
                {manual ? (
                  <Glass style={[s.panel, { gap: t.space.md }]}>
                    <Field label="Server address" value={url} onChangeText={setUrl} placeholder="192.168.1.20:8787 or https://box.ts.net" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                    <Field label="Pairing code" value={code} onChangeText={setCode} placeholder="ABCD-2345" autoCapitalize="characters" autoCorrect={false}
                      style={s.codeInput} onSubmitEditing={() => connect()} />
                    <Field label="This device's name" value={deviceName} onChangeText={setDeviceName} placeholder="My phone" />
                    <Button size="lg" title="Connect" loading={busy} onPress={() => connect()} variant={Platform.OS === 'web' ? 'primary' : 'secondary'} />
                  </Glass>
                ) : (
                  <GlassPill title="Enter a code instead" icon={<KeyRound size={17} color={t.colors.text} />} onPress={() => setManual(true)} />
                )}
                {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
              </Animated.View>
            )}

            <Animated.View entering={rise(reduced, 3)} style={{ alignSelf: 'center' }}>
              <GlassPill title="Set up the server plugin" quiet icon={<ExternalLink size={15} color={t.colors.textSecondary} />}
                onPress={() => Linking.openURL('https://github.com/VIKASRP24/winglet')} />
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A slow float, as if the bots were hovering in the glow. Still when motion is reduced. */
function Float({ children, reduced }: { children: ReactNode; reduced: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(y); y.value = 0; return; }
    y.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (y.value - 0.5) * 12 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A secondary choice: a frosted pill over the glow. */
function GlassPill({ title, icon, onPress, quiet }: { title: string; icon?: ReactNode; onPress: () => void; quiet?: boolean }) {
  const s = useStyles();
  return (
    <Tap feedback="selection" accessibilityLabel={title} onPress={onPress} style={s.pillShell}>
      <Glass style={[s.pill, quiet && { minHeight: 44 }]} intensity={30}>
        {icon}
        <Text style={[s.pillText, quiet && s.pillQuiet]} numberOfLines={1}>{title}</Text>
      </Glass>
    </Tap>
  );
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.step}>
      <View style={s.stepIcon}>{icon}</View>
      <Text style={s.stepText}><Text style={s.stepNumber}>{n}. </Text>{children}</Text>
    </View>
  );
}

function formatCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  scroll: { flexGrow: 1, paddingHorizontal: t.space.lg },
  column: { flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center', justifyContent: 'center', gap: t.space.xl, paddingVertical: t.space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingLeft: 6, paddingRight: t.space.lg, paddingVertical: 6, borderRadius: t.radius.pill },
  brandText: { ...t.type.heading, color: t.colors.text },
  family: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: t.space.sm },
  tagline: { ...t.type.hero, color: t.colors.text, textAlign: 'center' },
  context: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center' },
  actions: { gap: t.space.md },
  panel: { borderRadius: t.radius.xl, padding: t.space.lg, gap: t.space.xs },
  code: { ...t.type.callout, fontFamily: t.fonts.mono, color: t.colors.text },
  codeInput: { ...t.type.title, letterSpacing: 4, textAlign: 'center' },
  bold: { fontFamily: t.fonts.semibold, color: t.colors.text },
  step: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm },
  stepIcon: { width: 36, height: 36, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { fontFamily: t.fonts.semibold, color: t.colors.textSecondary },
  stepText: { flex: 1, ...t.type.callout, color: t.colors.text },
  pillShell: { borderRadius: t.radius.pill },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.space.sm, minHeight: 50,
    paddingHorizontal: t.space.xl, borderRadius: t.radius.pill,
  },
  pillText: { fontFamily: t.fonts.semibold, fontSize: 15.5, color: t.colors.text, flexShrink: 1 },
  pillQuiet: { fontFamily: t.fonts.medium, fontSize: 14, color: t.colors.textSecondary },
  error: { ...t.type.callout, color: t.colors.danger, textAlign: 'center' },
}));
