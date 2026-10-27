import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Plus } from '../../components/icons';
import { haptic } from '../../lib/haptics';
import { useApp } from '../../lib/store';
import { makeStyles, useTheme } from '../../lib/themeContext';
import type { Project, Server } from '../../lib/types';
import { IconButton, Tap } from '../../components/ui';
import { ProjectCreateSheet, ProjectMenuSheet } from './ProjectSheets';
import { projectCountLabel } from './logic';

const useStyles = makeStyles((t) => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingLeft: 12, paddingRight: 8, borderRadius: t.radius.pill },
  heading: { ...t.type.label, color: t.colors.textSecondary, flex: 1 },
  count: { ...t.type.caption, fontFamily: t.fonts.regular, color: t.colors.textTertiary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingLeft: 8, paddingRight: 2, borderRadius: t.radius.pill },
  hover: { backgroundColor: t.colors.pressed },
  active: { backgroundColor: t.colors.accentSoft },
  icon: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.card,
    borderWidth: 1, borderColor: t.colors.cardBorder },
  iconOn: { backgroundColor: t.colors.accentSoft, borderColor: 'transparent' },
  name: { ...t.type.callout, color: t.colors.text, flex: 1 },
  nameOn: { fontFamily: t.fonts.semibold, color: t.colors.onAccentSoft },
  small: { ...t.type.caption, fontFamily: t.fonts.regular, color: t.colors.textTertiary, paddingHorizontal: 12, paddingVertical: 6 },
  more: { ...t.type.caption, fontFamily: t.fonts.semibold, color: t.colors.textSecondary },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4, paddingTop: 4 },
  linkPill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 12, borderRadius: t.radius.pill,
    backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.cardBorder },
}));

/**
 * The compact Projects group in the existing sidebar. It lists the selected bot's active projects,
 * collapses to one row, and treats archived projects as a separate place in All projects.
 */
export function ProjectSection({ server, onNavigate }: { server: Server; onNavigate?: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const pathname = usePathname();
  const snapshot = useApp((st) => st.runtime[server.id]?.projects);
  const runtime = useApp((st) => st.runtime[server.id]);
  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const feature = !!runtime?.info?.features?.projects;
  const online = feature && runtime?.status === 'online';
  if (!snapshot) return null;
  const active = snapshot.projects.filter((p) => !p.archived);
  const archived = snapshot.projects.filter((p) => p.archived);
  const shown = active.slice(0, 6);
  const open = (project: Project) => {
    haptic.selection();
    onNavigate?.();
    useApp.getState().select(server.id);
    router.navigate(`/project/${server.id}/${project.id}`);
  };
  return (
    <>
      <Tap accessibilityRole="button" accessibilityLabel={`Projects, ${active.length} active`}
        accessibilityState={{ expanded }} accessibilityHint={expanded ? 'Collapse projects' : 'Expand projects'}
        onPress={() => { haptic.selection(); setExpanded((v) => !v); }} style={({ hovered }) => [s.head, hovered && s.hover]}>
        {expanded ? <ChevronDown size={16} color={t.colors.textSecondary} /> : <ChevronRight size={16} color={t.colors.textSecondary} />}
        <Text style={s.heading}>Projects</Text>
        {active.length ? <Text style={s.count}>{active.length}</Text> : null}
      </Tap>
      {expanded ? (
        <>
          {shown.map((project) => {
            const selected = pathname === `/project/${server.id}/${project.id}`;
            return (
              <Tap key={project.id} accessibilityLabel={`${project.name}, ${projectCountLabel(project)}`}
                accessibilityHint={project.can_manage && online ? 'Long-press for project options' : undefined}
                accessibilityState={{ selected }}
                onPress={() => open(project)} onLongPress={() => { if (project.can_manage && online) setMenu(project.id); }}
                delayLongPress={350} style={({ pressed, hovered }) => [s.row, selected ? s.active : (pressed || hovered) && s.hover]}>
                <View style={[s.icon, selected && s.iconOn]}><Folder size={15} color={selected ? t.colors.onAccentSoft : t.colors.textSecondary} /></View>
                <Text style={[s.name, selected && s.nameOn]} numberOfLines={1}>{project.name}</Text>
                <Text style={s.count} accessibilityElementsHidden>{project.chat_count || ''}</Text>
                {project.can_manage && online ? (
                  <IconButton label={`Options for ${project.name}`} size={30} onPress={(e) => { e.stopPropagation(); setMenu(project.id); }}>
                    <MoreHorizontal size={14} color={t.colors.textTertiary} />
                  </IconButton>
                ) : <View style={{ width: 4 }} />}
              </Tap>
            );
          })}
          
          {active.length > 6 ? <Text style={s.small}>{active.length - 6} more in All projects</Text> : null}
          <View style={s.links}>
            <Tap accessibilityLabel={`All projects${archived.length ? `, ${archived.length} archived` : ''}`} scaleTo={0.95} hitSlop={5}
              onPress={() => { onNavigate?.(); useApp.getState().select(server.id); router.navigate('/projects'); }}
              style={({ pressed, hovered }) => [s.linkPill, (pressed || hovered) && s.hover]}>
              <Folder size={14} color={t.colors.textSecondary} />
              <Text style={s.more}>All projects</Text>
              {archived.length ? <Text style={s.count}>{archived.length} archived</Text> : null}
            </Tap>
            {online ? <Tap accessibilityLabel="New project" scaleTo={0.95} hitSlop={5} onPress={() => { haptic.selection(); setCreating(true); }}
              style={({ pressed, hovered }) => [s.linkPill, (pressed || hovered) && s.hover]}>
              <Plus size={14} color={t.colors.textSecondary} />
              <Text style={s.more}>New project</Text>
            </Tap> : null}
          </View>
        </>
      ) : null}
      <ProjectCreateSheet server={server} visible={creating} onClose={() => setCreating(false)}
        onCreated={(id) => { onNavigate?.(); useApp.getState().select(server.id); router.navigate(`/project/${server.id}/${id}`); }} />
      <ProjectMenuSheet server={server} projectId={menu ?? ''} visible={!!menu} onClose={() => setMenu(null)}
        onDeleted={() => setMenu(null)} />
    </>
  );
}
