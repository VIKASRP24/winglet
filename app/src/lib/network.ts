import { Platform } from 'react-native';
import * as Network from 'expo-network';

/** Whether the phone has a network at all. "No internet" and "server unreachable" need different help. */
export function watchNetwork(onChange: (online: boolean) => void): () => void {
  if (Platform.OS === 'web') {
    const on = () => onChange(true);
    const off = () => onChange(false);
    globalThis.addEventListener?.('online', on);
    globalThis.addEventListener?.('offline', off);
    if (globalThis.navigator?.onLine === false) onChange(false);
    return () => {
      globalThis.removeEventListener?.('online', on);
      globalThis.removeEventListener?.('offline', off);
    };
  }
  const read = (state: Network.NetworkState) =>
    onChange(state.isConnected !== false && state.isInternetReachable !== false);
  Network.getNetworkStateAsync().then(read).catch(() => undefined);
  const sub = Network.addNetworkStateListener(read);
  return () => sub.remove();
}
