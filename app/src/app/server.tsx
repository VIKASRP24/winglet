import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { JobSheet } from '../components/JobSheet';
import {
  CalendarClock, Check, CircleAlert, CircleArrowUp, CirclePause, CircleHelp, RefreshCw, RotateCw, ScrollText, ShieldCheck,
} from '../components/icons';
import { Screen } from '../components/Screen';
import { withSelectedServer } from '../components/ServerScreen';
import { Sheet } from '../components/Sheet';
import { Button, ListGroup, ListRow, SectionHeader, Skeleton, Toggle } from '../components/ui';
import { VerifyNotice } from '../components/VerifyPhone';
import { agoText } from '../lib/agent';
import { api, ApiError, signedApi } from '../lib/api';
import { bytes, duration, idempotencyKey } from '../lib/control';
import { haptic } from '../lib/haptics';
import { useApp, useServerState } from '../lib/store';
import { makeStyles, useTheme } from '../lib/themeContext';
import type { Job, PauseState, SystemInfo, UpdatesInfo } from '../lib/types';

type Confirm = 'restart' | 'hermes' | 'winglet';
const JOB_LABEL: Record<Job['kind'], string> = {
  restart: 'Restart', hermes_update: 'Hermes update', winglet_update: 'Winglet update',
  skill_install: 'Skill install', skill_uninstall: 'Skill removal', mcp_install: 'MCP server install',
  pet_install: 'Pet install',
};

/** The machine your agent runs on: how it's doing, and the few controls that keep it running. */
export default withSelectedServer(ServerScreen);

function ServerScreen() {
  const t = useTheme();
  const s = useStyles();
  const server = useApp((st) => st.servers.find((x) => x.id === st.selection.serverId) ?? st.servers[0]);
  const rt = useServerState(server?.id);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [updates, setUpdates] = useState<UpdatesInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [pausing, setPausing] = useState(false);

  const load = useCallback(() => {
    if (!server) return;
    api<SystemInfo>(server, '/api/system').then((d) => { setInfo(d); setError(''); }).catch((e) => setError((e as Error).message));
  }, [server]);
  const check = useCallback((force = false) => {
    if (!server) return;
    setChecking(true);
    api<UpdatesInfo>(server, `/api/system/updates${force ? '?force=1' : ''}`).then(setUpdates)
      .catch(() => undefined).finally(() => setChecking(false));
  }, [server]);

  // Health is live: refresh while the screen is open, and again when the server comes back.
  useFocusEffect(useCallback(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]));
  useEffect(() => { check(); }, [check]);
  const online = rt?.status === 'online';
  const wasOnline = useRef(online);
  useEffect(() => { if (online && !wasOnline.current) load(); wasOnline.current = online; }, [online, load]);

  if (!server) return null;
  const paused: PauseState = rt?.paused !== undefined ? rt.paused : info?.paused ?? null;

  const setPaused = async (on: boolean) => {
    setPausing(true);
    try {
      const r = await signedApi<{ paused: PauseState }>(server, 'POST', '/api/system/pause', { paused: on });
      useApp.setState((st) => ({ runtime: { ...st.runtime, [server.id]: { ...st.runtime[server.id], paused: r.paused } } }));
      haptic.success();
    } catch (e) {
      haptic.error();
      useApp.getState().toast({ serverId: server.id, title: on ? "Couldn't pause" : "Couldn't resume", body: (e as Error).message });
    } finally {
      setPausing(false);
    }
  };

  const start = async (what: Confirm) => {
    setConfirm(null);
    const path = what === 'restart' ? '/api/system/restart' : '/api/system/update';
    const body = { ...(what === 'restart' ? {} : { target: what }), idempotency_key: idempotencyKey() };
    const send = () => signedApi<{ job: Job }>(server, 'POST', path, body);
    try {
      // The same key on a retry returns the job the first try started, so a dropped reply is safe.
      const r = await send().catch((e) => (e instanceof ApiError && e.status === 0 ? send() : Promise.reject(e)));
      setJob(r.job);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.job) { setJob(e.data.job as Job); return; }
      haptic.error();
      useApp.getState().toast({ serverId: server.id, title: "Couldn't start", body: (e as Error).message });
    }
  };

  const host = info?.host;
  return (
    <Screen title="Server">
      {error && !info ? <Text style={s.error}>{error}</Text> : null}
      <VerifyNotice server={server} />
      <StatusCard info={info} paused={paused} online={online} />

      <SectionHeader title="Health" />
      {!host ? <Skeleton height={150} radius={20} /> : (
        <ListGroup>
          {host.cpu_percent !== undefined ? <Meter label="Processor" percent={host.cpu_percent}
            detail={host.cpu_count ? `${host.cpu_count} cores` : ''} /> : null}
          {host.memory ? <Meter label="Memory" percent={host.memory.percent} detail={`${bytes(host.memory.used)} / ${bytes(host.memory.total)}`} /> : null}
          {host.disk ? <Meter label="Disk" percent={host.disk.percent} detail={`${bytes(host.disk.used)} / ${bytes(host.disk.total)}`} /> : null}
          {!host.memory && host.load_avg ? <ListRow title="Load" value={host.load_avg.map((n) => n.toFixed(2)).join(' / ')} /> : null}
          {host.system ? <ListRow title="System" value={host.system} /> : null}
          {host.arch ? <ListRow title="Architecture" value={host.arch} /> : null}
          {host.uptime_seconds ? <ListRow title="Machine uptime" value={duration(host.uptime_seconds)} /> : null}
        </ListGroup>
      )}

      <SectionHeader title="Controls" />
      <ListGroup>
        {info?.can_pause !== false ? (
          <ListRow icon={<CirclePause size={18} color={paused ? t.colors.warning : t.colors.onAccentSoft} />}
            iconColor={paused ? t.colors.warning : undefined} title="Pause new work"
            subtitle="New work waits; running tasks finish."
            right={<Toggle label="Pause new work" value={!!paused} onValueChange={(on) => !pausing && setPaused(on)} />} />
        ) : null}
        <ListRow icon={<RotateCw size={18} color={t.colors.onAccentSoft} />} title="Restart"
          onPress={() => setConfirm('restart')} />
      </ListGroup>

      <SectionHeader title="Updates" right={(
        <Button size="sm" variant="ghost" title={checking ? 'Checking…' : 'Check now'} disabled={checking}
          icon={<RefreshCw size={14} color={t.colors.textSecondary} />} onPress={() => check(true)} />
      )} />
      <ListGroup>
        <UpdateRow name="Hermes" version={info?.hermes_version || updates?.hermes.current_version} {...hermesUpdate(updates)}
          onUpdate={() => setConfirm('hermes')} />
        <UpdateRow name="Winglet" version={info?.version ?? updates?.winglet.version} {...wingletUpdate(updates)}
          onUpdate={() => setConfirm('winglet')} />
      </ListGroup>

      <SectionHeader title="Tools" />
      <ListGroup>
        <ListRow icon={<CalendarClock size={18} color={t.colors.onAccentSoft} />} title="Schedule"
          onPress={() => router.push('/schedule')} />
        <ListRow icon={<ScrollText size={18} color={t.colors.onAccentSoft} />} title="Logs"
          onPress={() => router.push('/logs')} />
        <ListRow icon={<ShieldCheck size={18} color={t.colors.onAccentSoft} />} title="Activity"
          onPress={() => router.push('/activity')} />
      </ListGroup>

      {info?.jobs.length ? (
        <>
          <SectionHeader title="Recent" />
          <ListGroup>
            {info.jobs.map((j) => (
              <ListRow key={j.id} title={JOB_LABEL[j.kind]} subtitle={j.detail.message} value={agoText(j.created_at)}
                icon={j.state === 'succeeded' ? <Check size={18} color={t.colors.success} />
                  : j.state === 'failed' ? <CircleAlert size={18} color={t.colors.danger} />
                  : j.state === 'running' ? <RotateCw size={18} color={t.colors.onAccentSoft} /> : <CircleHelp size={18} color={t.colors.warning} />}
                iconColor={j.state === 'succeeded' ? t.colors.success : j.state === 'failed' ? t.colors.danger : undefined}
                onPress={() => setJob(j)} />
            ))}
          </ListGroup>
        </>
      ) : null}

      <ConfirmSheet what={confirm} bot={server.bot.title} onCancel={() => setConfirm(null)} onConfirm={start} />
      <JobSheet server={server} job={job} onClose={() => setJob(null)} onDone={() => { load(); check(); }} />
    </Screen>
  );
}

function hermesUpdate(u: UpdatesInfo | null): { status: string; available: boolean } {
  const h = u?.hermes;
  if (!h) return { status: 'Checking…', available: false };
  if (h.error) return { status: h.error, available: false };
  if (h.update_available) {
    const what = h.behind && h.behind > 0 ? `${h.behind} new change${h.behind === 1 ? '' : 's'}` : 'An update is ready';
    return h.can_apply ? { status: what, available: true }
      : { status: `${what}. Update with \`${h.update_command || 'hermes update'}\` on the server.`, available: false };
  }
  return { status: h.message || 'Up to date', available: false };
}

function wingletUpdate(u: UpdatesInfo | null): { status: string; available: boolean } {
  const w = u?.winglet;
  if (!w) return { status: 'Checking…', available: false };
  if (w.update_available) return { status: 'A new version is ready', available: true };
  if (w.update_available === false) return { status: 'Up to date', available: false };
  if (/provenance|not installed from git/i.test(w.reason ?? '')) return { status: 'Installed from a copy, so update it on the server.', available: false };
  return { status: w.reason || "Couldn't tell", available: false };
}

function StatusCard({ info, paused, online }: { info: SystemInfo | null; paused: PauseState; online: boolean }) {
  const t = useTheme();
  const tone = !online ? t.colors.textTertiary : paused ? t.colors.warning : t.colors.success;
  const label = !online ? 'Offline' : paused ? 'Paused' : 'Running';
  if (!info) return <Skeleton height={112} radius={t.radius.lg} style={{ marginTop: t.space.lg }} />;
  return <>
    <SectionHeader title="Status" />
    <ListGroup>
      <ListRow title={label} icon={<View style={{ width: 8, height: 8, borderRadius: t.radius.pill, backgroundColor: tone }} />}
        value={`Up ${duration(info.uptime_seconds)}`}
        subtitle={paused ? `${paused.reason || 'New work is on hold.'}${paused.engaged_at ? ` Since ${new Date(paused.engaged_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}` : undefined} />
      <ListRow title="Hermes" value={info.hermes_version || '—'} />
      <ListRow title="Winglet" value={info.version} />
      <ListRow title="Phones" value={String(info.devices)} />
    </ListGroup>
  </>;
}

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return <ListRow title={label} value={`${Math.round(percent)}%`}
    subtitle={[detail, percent >= 90 ? 'Nearly full' : ''].filter(Boolean).join(' — ')} />;
}

function UpdateRow({ name, version, status, available, onUpdate }: {
  name: string; version?: string; status: string; available: boolean; onUpdate: () => void;
}) {
  const t = useTheme();
  return (
    <ListRow icon={<CircleArrowUp size={18} color={available ? t.colors.success : t.colors.onAccentSoft} />}
      iconColor={available ? t.colors.success : undefined} title={name} value={version} subtitle={status}
      right={available ? <Button size="sm" title="Update" onPress={onUpdate} /> : undefined} />
  );
}

function ConfirmSheet({ what, bot, onCancel, onConfirm }: { what: Confirm | null; bot: string; onCancel: () => void; onConfirm: (w: Confirm) => void }) {
  const s = useStyles();
  const [last, setLast] = useState<Confirm | null>(what);
  if (what && what !== last) setLast(what);
  const w = what ?? last;
  if (!w) return null;
  const copy = {
    restart: { title: 'Restart now?', body: `${bot} stops and starts again. Every platform reconnects within a few seconds, and a reply that's being written is cut off.`, action: 'Restart' },
    hermes: { title: 'Update Hermes?', body: 'Hermes downloads the update, installs it and restarts. Chats pause for a minute or two. If something goes wrong, the log shows why.', action: 'Update and restart' },
    winglet: { title: 'Update Winglet?', body: 'The server downloads the new Winglet and restarts to load it. Chats pause for a few seconds. Update this app too if it asks.', action: 'Update and restart' },
  }[w];
  return (
    <Sheet visible={!!what} onClose={onCancel} title={copy.title}>
      <View style={{ gap: 14, paddingHorizontal: 4 }}>
        <Text style={s.confirmBody}>{copy.body}</Text>
        <Button title={copy.action} onPress={() => onConfirm(w)} />
        <Button title="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  error: { ...t.type.callout, color: t.colors.danger, marginTop: 10 },
  note: { ...t.type.caption, color: t.colors.textSecondary },
  confirmBody: { ...t.type.body, color: t.colors.textSecondary },
}));
