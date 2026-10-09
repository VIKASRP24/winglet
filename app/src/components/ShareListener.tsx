import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { MAX_FILES } from '../lib/media';
import { fromShare } from '../lib/share';
import { usePendingShare } from '../lib/shareStore';

/** Catches what other apps share to Winglet (Android) and asks which chat it's for. */
export function ShareListener() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: Platform.OS !== 'android' });
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = fromShare(shareIntent, MAX_FILES);
    resetShareIntent();
    if (!shared) return;
    usePendingShare.setState({ shared });
    router.push('/share');
  }, [hasShareIntent, shareIntent, resetShareIntent]);
  return null;
}
