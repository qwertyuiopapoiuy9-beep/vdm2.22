
export type Role = 'USER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  role: Role;
  name: string;
}

export type MessageType = 'general' | 'community_logged' | 'admin_response';

export interface UserFeedback {
  rating: 'up' | 'down';
  comment?: string;
  timestamp: Date;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant' | 'admin';
  content: string;
  type?: MessageType;
  timestamp: Date;
  feedback?: UserFeedback;
  logId?: string; 
  replyToId?: string; // ID of the message being replied to
  replyToContent?: string; // Cached content of the replied message for easier rendering
  sessionId: string; // Grouping messages into distinct conversations
}

export type LogStatus = 'pending' | 'in_progress' | 'resolved';

export interface CommunityLog {
  id: string;
  userId: string;
  userName: string;
  originalMessage: string;
  aiAnalysis: string;
  status: LogStatus;
  adminResponse?: string;
  adminId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthState {
  user: User | null;
  token: string | null;
}
