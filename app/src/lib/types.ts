export type Bot = { name: string; title: string; description: string };

export type Server = {
  id: string; // server_id reported by the plugin
  url: string; // base URL, no trailing slash
  token: string;
  deviceId: string;
  bot: Bot;
  addedAt: number;
  // `since`: ntfy time of the last verified announcement, so later lookups only fetch newer ones.
  recovery?: { server: string; topic: string; key: string; revision: number; since?: number };
  /** The server key's fingerprint, pinned at pairing (from the QR code when there was one). */
  fingerprint?: string;
  /** The server takes the token in the socket's first frame, not the URL. */
  wsAuth?: boolean;
};

export type Role = 'owner' | 'member';

/** Who this phone is on a server: its role, whether it can sign owner actions, and its main chat. */
export type Me = { id: string; name: string; role: Role; verified: boolean; home_chat: string };

export type Device = { id: string; name: string; platform: string; role: Role; verified: boolean;
  created_at: number; last_seen: number; current?: boolean };

export type AuditEntry = { id: number; ts: number; device_id: string; device_name: string; role: string; action: string;
  summary: string; outcome: string };

export type Chat = {
  id: string;
  title: string;
  kind: 'chat' | 'home';
  created_at: number;
  updated_at: number;
  preview: string;
};

export type AttachmentKind = 'image' | 'audio' | 'video' | 'file' | 'voice';

export type Attachment = { url: string; name: string; mime: string; kind: AttachmentKind; size: number; id?: string };

/** A file the server holds for this chat, ready to attach to a message. */
export type Upload = Attachment & { id: string };

/** The message being replied to, as the app shows it above yours. */
export type ReplyRef = { id: string; role: 'user' | 'bot' | 'system'; text: string };

export type Message = {
  id: string;
  position?: number; // server insertion order; absent on optimistic rows and older servers
  chat_id: string;
  role: 'user' | 'bot' | 'system';
  text: string;
  // pending: sending now; queued: waiting for a connection; failed: the server refused it.
  status: 'final' | 'streaming' | 'pending' | 'queued' | 'failed';
  meta: {
    device?: string;
    client_id?: string;
    inbox_id?: string;
    kind?: 'approval' | 'question';
    attachments?: Attachment[];
    reply_to?: ReplyRef;
    /** Set on Hermes status lines (context pressure, fallback…) that update in place. */
    status_key?: string;
  };
  created_at: number;
  updated_at: number;
};

export type InboxItem = {
  id: string;
  kind: 'approval' | 'question' | 'result';
  chat_id: string;
  title: string;
  body: string;
  payload: {
    command?: string;
    description?: string;
    choices?: string[];
    labels?: Record<string, string>;
    styles?: Record<string, string>;
    question?: string;
    multi_select?: boolean;
    message_id?: string;
  };
  status: 'pending' | 'resolved' | 'expired';
  resolution: string;
  created_at: number;
  updated_at: number;
};

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

/** What a server reports about itself in `hello` and `/api/info`. */
export type ServerInfo = {
  version: string;
  protocol: number;
  min_app_protocol: number;
  hermes_version: string;
  features: Record<string, boolean>;
};

/** A file attached in the composer: uploading, ready to send, or failed. */
export type DraftFile = {
  localId: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  size?: number;
  /** A local preview (photos), shown until the message is sent. */
  previewUri?: string;
  progress: number;
  status: 'uploading' | 'ready' | 'failed';
  upload?: Upload;
  error?: string;
  /** Voice notes send themselves as soon as they finish uploading. */
  autoSend?: boolean;
};
