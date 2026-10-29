import { api, signedApi } from '../../lib/api';
import type { Project, ProjectSnapshot, Server } from '../../lib/types';
import { projectRoomMoveBody, type ProjectRoom } from './model';

export const loadProjectRooms = (server: Server) => api<{rooms: ProjectRoom[]}>(server, '/api/project-rooms');
export const loadRoomProjects = (server: Server) => api<{projects: ProjectSnapshot}>(server, '/api/projects');
export function moveProjectRoom(server: Server, roomId: string, source: ProjectRoom | undefined, target: Project | null, clientId: string) {
  const current = source ? {id: source.project_id, revision: source.project_revision} : null;
  return signedApi<{projects?: ProjectSnapshot}>(server, 'POST', `/api/project-rooms/${encodeURIComponent(roomId)}`,
    projectRoomMoveBody(current, target, clientId));
}
export function createProjectRoom(server: Server, body: Record<string, unknown>) {
  return signedApi<{id?: string; filed?: boolean; file_error?: string; projects?: ProjectSnapshot}>(server, 'POST', '/api/rooms', body);
}
