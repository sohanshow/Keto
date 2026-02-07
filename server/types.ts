import { SessionAbortManager } from './abort-controller.js';
import type { ConversationHistory } from './stores/conversation.store.js';

export interface AgentCreationState {
  phase: 'voice' | 'personality' | 'complete';
  voiceId: string;
  voiceName: string;
  humor: number;
  formality: number;
  traits: string[];
  availableVoices: Voice[];
}

export interface ClientSession {
  id: string;
  deepgramConnection: any;
  isListening: boolean;
  currentTranscript: string;
  voiceId?: string;
  systemPrompt?: string;
  userName?: string;
  ttsWebSocket?: any;
  ttsWebSocketReady?: boolean;
  isProcessingResponse?: boolean;
  abortManager: SessionAbortManager;
  conversationHistory: ConversationHistory;
  /** Sentence queue for TTS - stored on session so we can clear it on interrupt */
  sentenceQueue: string[];
  /** Mode: normal conversation or agent creation */
  mode?: 'normal' | 'agent_creation';
  /** Agent creation state (only used in agent_creation mode) */
  agentCreation?: AgentCreationState;
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

export interface TranscriptMessage {
  type: 'transcript';
  transcript: string;
  isPartial: boolean;
  speaker?: 'user' | 'agent';
}

export interface ResponseMessage {
  type: 'response';
  text: string;
  speaker: 'agent';
  isPartial?: boolean;
}

export interface AudioChunkMessage {
  type: 'audio_chunk';
  audio: string;
  format?: string;
  sampleRate?: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ReadyMessage {
  type: 'ready';
}

export interface StoppedMessage {
  type: 'stopped';
}

export interface TTSStoppedMessage {
  type: 'tts_stopped';
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

export interface AgentCreationMessage {
  type: 'response';
  text: string;
  speaker: 'agent';
  isPartial?: boolean;
  agentCreation?: AgentCreationData;
}

export type OutgoingMessage =
  | TranscriptMessage
  | ResponseMessage
  | ErrorMessage
  | ReadyMessage
  | StoppedMessage
  | TTSStoppedMessage
  | AudioChunkMessage
  | AgentCreationMessage;
