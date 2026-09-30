import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { X } from '../components/icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton } from '../components/ui';
import { defaultDeviceName, pair, parsePairLink } from '../lib/api';
import { useApp } from '../lib/store';
import { colors, fonts, radius } from '../lib/theme';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const addServer = useApp((s) => s.addServer);
  const [status, setStatus] = useState<'scanning' | 'pairing' | 'error'>('scanning');
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
    setStatus('pairing');
    try {
      const server = await pair(link.url, link.code, defaultDeviceName());
      await addServer(server);
      router.dismissAll();
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center, { padding: 24 }]}>
        <Text style={styles.title}>Camera access</Text>
        <Text style={styles.text}>Winglet needs the camera only to scan the pairing code shown by `hermes winglet pair`.</Text>
        <Button title="Allow camera" onPress={requestPermission} size="lg" style={{ alignSelf: 'stretch' }} />
        <Button title="Enter the code instead" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

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
          <X size={24} color={colors.white} />
        </IconButton>
        <View style={styles.frame} />
        <View style={styles.hintBox}>
          {status === 'pairing' ? <ActivityIndicator color={colors.white} /> : null}
          <Text style={styles.hint}>
            {status === 'pairing' ? 'Pairing…' : error || 'Point at the QR code from `hermes winglet pair`'}
          </Text>
          {status === 'error' ? (
            <Button title="Try again" onPress={() => { handled.current = false; setError(''); setStatus('scanning'); }} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.rail },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22 },
  text: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 60 },
  close: { alignSelf: 'flex-start', marginLeft: 12, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20 },
  frame: { width: 250, height: 250, borderRadius: 28, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  hintBox: { alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radius.lg, paddingHorizontal: 18, paddingVertical: 14, marginHorizontal: 24 },
  hint: { color: colors.white, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
});
