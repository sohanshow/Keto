import { SessionAbortManager } from './abort-controller.js';

export interface ClientSession {
  deepgramConnection: any;
  isListening: boolean;
  currentTranscript: string;
  voiceId?: string;
  systemPrompt?: string;
  ttsWebSocket?: any;
  ttsWebSocketReady?: boolean;
  isProcessingResponse?: boolean;
  abortManager: SessionAbortManager;
}

export interface WebSocketMessage {
  type: 'start' | 'audio' | 'stop' | 'interrupt';
  voiceId?: string;
  systemPrompt?: string;
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
