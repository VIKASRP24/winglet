import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Aurora } from '../components/Aurora';
import { Glass } from '../components/Glass';
import { Camera, X } from '../components/icons';
import { Button, IconButton, Tap } from '../components/ui';
import { defaultDeviceName, fetchInfo, pair, parsePairLink, verifyDevice } from '../lib/api';
import { spring, useReducedMotion } from '../lib/motion';
import { useApp } from '../lib/store';
import { auroraColors, BRAND, FIXED } from '../lib/theme';
import { makeStyles, useTheme } from '../lib/themeContext';

const FRAME = 250;
const CORNER = 44;

export default function ScanScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const addServer = useApp((s) => s.addServer);
  const updateServer = useApp((s) => s.updateServer);
  const [status, setStatus] = useState<'scanning' | 'pairing' | 'verifying' | 'error'>('scanning');
  const [error, setError] = useState('');
  const handled = useRef(false);

  const onScan = async (data: string) => {
    if (handled.current) return;
    const link = parsePairLink(data);
    if (!link) {
      setError("That QR code isn't a Winglet pairing code.");
      return;
    }
    handled.current = true;
    try {
      // A code from a server this phone already has verifies the phone instead of pairing it twice.
      const info = await fetchInfo(link.url);
      const existing = useApp.getState().servers.find((x) => x.id === info.server_id);
      if (existing && link.fp) {
        setStatus('verifying');
        const verified = await verifyDevice(existing, link.code, link.fp);
        await updateServer(existing.id, { fingerprint: verified.fingerprint }, true);
        useApp.getState().toast({ serverId: existing.id, title: 'Phone verified', body: `You can manage ${existing.bot.title} from this phone now.` });
        router.back();
        return;
      }
      setStatus('pairing');
      const server = await pair(link.url, link.code, defaultDeviceName(), link.fp);
      await addServer(server);
      router.dismissAll();
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) return <AskCamera onAllow={requestPermission} />;

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={status === 'scanning' ? (r) => onScan(r.data) : undefined}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + 8 }]}>
        <IconButton label="Close" onPress={() => router.back()} style={styles.close}>
          <X size={24} color={FIXED.white} />
        </IconButton>
        <Viewfinder still={status !== 'scanning'} />
        <View style={styles.hintBox}>
          {status === 'pairing' || status === 'verifying' ? <ActivityIndicator color={FIXED.white} /> : null}
          <Text style={styles.hint}>
            {status === 'pairing' ? 'Pairing…' : status === 'verifying' ? 'Verifying this phone…'
              : error || 'Scan the code from hermes winglet pair or another phone.'}
          </Text>
          {status === 'error' ? (
            <Button title="Try again" onPress={() => { handled.current = false; setError(''); setStatus('scanning'); }} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Before the camera: why it's needed, over the brand's glow. */
function AskCamera({ onAllow }: { onAllow: () => unknown }) {
  const t = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const glow = useMemo(() => auroraColors(BRAND.from, t.colors.accent), [t.colors.accent]);
  const rise = (i: number) => (reduced ? undefined
    : FadeInDown.delay(80 + i * 70).springify().damping(spring.soft.damping).stiffness(spring.soft.stiffness));
  return (
    <View style={[styles.ask, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Aurora colors={glow} strength={1.2} />
      <Animated.View entering={rise(0)} style={styles.askIcon}>
        <Camera size={40} color={t.colors.onAccentSoft} />
      </Animated.View>
      <Animated.View entering={rise(1)} style={styles.askWords}>
        <Text style={styles.title} accessibilityRole="header">Camera access</Text>
        <Text style={styles.text}>Camera access is only used to scan pairing codes.</Text>
      </Animated.View>
      <Animated.View entering={rise(2)} style={styles.askActions}>
        <Button title="Allow camera" onPress={() => { onAllow(); }} size="lg" />
        <Tap feedback="selection" accessibilityLabel="Enter the code instead" onPress={() => router.back()} style={styles.pillShell}>
          <Glass style={styles.pill} intensity={30}><Text style={styles.pillText}>Enter the code instead</Text></Glass>
        </Tap>
      </Animated.View>
    </View>
  );
}

/** Four lit corners that breathe gently while looking for a code; still while pairing or with reduced motion. */
function Viewfinder({ still }: { still: boolean }) {
  const styles = useStyles();
  const reduced = useReducedMotion() || still;
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(pulse); pulse.value = 0; return; }
    pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  const breathe = useAnimatedStyle(() => ({ opacity: 0.75 + pulse.value * 0.25, transform: [{ scale: 1 + pulse.value * 0.025 }] }));
  return (
    <Animated.View style={[styles.frame, breathe]} pointerEvents="none">
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: FIXED.camera },
  ask: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.xl, paddingHorizontal: t.space.xl, backgroundColor: t.colors.bg },
  askIcon: {
    width: 96, height: 96, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.colors.glassBorder,
  },
  askWords: { gap: t.space.sm, alignItems: 'center' },
  askActions: { width: '100%', maxWidth: 400, gap: t.space.md },
  title: { ...t.type.hero, color: t.colors.text, textAlign: 'center' },
  text: { ...t.type.callout, color: t.colors.textSecondary, textAlign: 'center' },
  pillShell: { alignSelf: 'center', borderRadius: t.radius.pill },
  pill: { minHeight: 48, paddingHorizontal: t.space.xl, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: t.fonts.semibold, fontSize: 15.5, color: t.colors.text },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 60 },
  close: { alignSelf: 'flex-start', marginLeft: 12, backgroundColor: FIXED.cameraScrim, borderRadius: t.radius.pill },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: FIXED.cameraFrame },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 30 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 30 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 30 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 30 },
  hintBox: {
    alignItems: 'center', gap: 12, backgroundColor: FIXED.cameraScrim, borderRadius: t.radius.xl, paddingHorizontal: 20, paddingVertical: 16,
    marginHorizontal: 24,
  },
  hint: { ...t.type.callout, color: FIXED.white, textAlign: 'center' },
}));
