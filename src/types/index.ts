export interface Message {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  timestamp: Date;
  isPartial?: boolean;
}

export interface Voice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  type: string;
  context: string;
}

export interface WebSocketMessage {
  type: 'start' | 'audio' | 'stop' | 'interrupt';
  voiceId?: string;
  systemPrompt?: string;
  userName?: string;
  audio?: string;
  mode?: 'normal' | 'agent_creation';
  voices?: Voice[];
}

export interface AgentCreationData {
  type?: 'voice_selected' | 'personality_set' | 'creation_complete';
  voiceId?: string;
  voiceName?: string;
  humor?: number;
  formality?: number;
  traits?: string[];
  systemPrompt?: string;
  phase?: 'voice' | 'personality' | 'complete';
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
  agentCreation?: AgentCreationData;
}
