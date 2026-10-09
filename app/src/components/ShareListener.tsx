import { router, usePathname } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { MAX_FILES } from '../lib/media';
import { fromShare } from '../lib/share';
import { usePendingShare } from '../lib/shareStore';
import { useApp } from '../lib/store';

/** Catches what other apps share to Winglet (Android) and asks which chat it's for. */
export function ShareListener() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: Platform.OS !== 'android' });
  const pathname = usePathname();
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = fromShare(shareIntent, MAX_FILES);
    resetShareIntent();
    if (!shared) {
      // Some apps share a text file or a caption in a way that arrives empty: say so rather than do nothing.
      useApp.getState().toast({ serverId: '', title: 'Nothing to share', body: "Winglet didn't receive anything it can send from that app." });
      return;
    }
    usePendingShare.setState({ shared });
    // A second share while the picker is open replaces the first instead of stacking another picker.
    if (pathname !== '/share') router.push('/share');
  }, [hasShareIntent, shareIntent, resetShareIntent, pathname]);
  return null;
}
