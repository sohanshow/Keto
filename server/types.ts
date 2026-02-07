import { SessionAbortManager } from './abort-controller.js';
import type { ConversationHistory } from './stores/conversation.store.js';

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
}

export interface WebSocketMessage {
  type: 'start' | 'audio' | 'stop' | 'interrupt';
  voiceId?: string;
  systemPrompt?: string;
  userName?: string;
  audio?: string;
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

export type OutgoingMessage =
  | TranscriptMessage
  | ResponseMessage
  | ErrorMessage
  | ReadyMessage
  | StoppedMessage
  | TTSStoppedMessage
  | AudioChunkMessage;
