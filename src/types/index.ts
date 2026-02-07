export interface Message {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}

export interface WebSocketMessage {
  type: 'start' | 'audio' | 'stop' | 'interrupt';
  voiceId?: string;
  systemPrompt?: string;
  userName?: string;
  audio?: string;
}

export interface IncomingMessage {
  type: 'ready' | 'transcript' | 'response' | 'error' | 'stopped' | 'tts_stopped' | 'audio_chunk';
  transcript?: string;
  text?: string;
  message?: string;
  isPartial?: boolean;
  speaker?: 'user' | 'agent';
  audio?: string;
  format?: string;
  sampleRate?: number;
}
