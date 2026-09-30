export type Bot = { name: string; title: string; description: string };

export type Server = {
  id: string; // server_id reported by the plugin
  url: string; // base URL, no trailing slash
  token: string;
  deviceId: string;
  bot: Bot;
  addedAt: number;
};

export type Chat = {
  id: string;
  title: string;
  kind: 'chat' | 'home';
  created_at: number;
  updated_at: number;
  preview: string;
};

export type Attachment = { url: string; name: string; mime: string; kind: 'image' | 'audio' | 'video' | 'file'; size: number };

export type Message = {
  id: string;
  position?: number; // server insertion order; absent on optimistic rows and older servers
  chat_id: string;
  role: 'user' | 'bot' | 'system';
  text: string;
  status: 'final' | 'streaming' | 'pending' | 'failed';
  meta: {
    device?: string;
    client_id?: string;
    inbox_id?: string;
    kind?: 'approval' | 'question';
    attachments?: Attachment[];
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
