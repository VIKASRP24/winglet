import { Redirect } from 'expo-router';

/** Settings now live in the Agent tab. Kept so older links still land somewhere sensible. */
export default function SettingsRedirect() {
  return <Redirect href="/agent" />;
}
