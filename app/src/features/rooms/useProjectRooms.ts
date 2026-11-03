import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useApp } from '../../lib/store';
import type { Server } from '../../lib/types';
import { projectRoomsSupported, type ProjectRoom } from './model';
import { loadProjectRooms } from './projectRoomsApi';

/** Project sync also invalidates room metadata; older gateways still need polling. */
export function useProjectRooms(server: Server) {
  const runtime = useApp(st => st.runtime[server.id]);
  const network = useApp(st => st.network);
  const foreground = useApp(st => st.foreground);
  const supported = projectRoomsSupported(runtime?.info?.features);
  const synced = runtime?.info?.features?.project_rooms_sync === true;
  const online = network && runtime?.status === 'online';
  const role = runtime?.me?.role ?? 'unknown';
  const projects = runtime?.projects;
  const [snapshot, setSnapshot] = useState<{ server: Server; role: string; rooms: ProjectRoom[] }>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useFocusEffect(useCallback(() => {
    setSnapshot(undefined);
    setError('');
    if (!supported || !online || !foreground) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const data = await loadProjectRooms(server);
        if (live) { setSnapshot({ server, role, rooms: data.rooms }); setError(''); }
      } catch (e) {
        if (live) { setSnapshot(undefined); setError((e as Error).message); }
      } finally {
        if (live && !synced) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => { live = false; clearTimeout(timer); };
    // Every project.sync replaces this snapshot, including room metadata-only changes.
  }, [server, supported, synced, online, foreground, role, projects, retry]));

  return {
    rooms: supported && online && foreground && snapshot?.server === server && snapshot.role === role ? snapshot.rooms : [],
    error,
    reload: () => setRetry(value => value + 1),
  };
}
