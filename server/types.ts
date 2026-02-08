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
  /** Mode: normal conversation, agent creation, paint arena, or puzzle */
  mode?: 'normal' | 'agent_creation' | 'paint_arena' | 'puzzle';
  /** Agent creation state (only used in agent_creation mode) */
  agentCreation?: AgentCreationState;
  /** Paint arena state (only used in paint_arena mode) */
  paintArena?: PaintArenaState;
  /** Puzzle state (only used in puzzle mode) */
  puzzle?: PuzzleState;
}

export interface Voice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  type: string;
  context: string;
}

export interface WebSocketMessage {
  type: 'start' | 'audio' | 'stop' | 'interrupt' | 'text_input' | 'paint_reset' | 'puzzle_next' | 'puzzle_hint';
  voiceId?: string;
  systemPrompt?: string;
  userName?: string;
  audio?: string;
  mode?: 'normal' | 'agent_creation' | 'paint_arena' | 'puzzle';
  voices?: Voice[];
  text?: string; // For text input messages
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

export interface PaintArenaData {
  type: 'generation_started' | 'image_generated' | 'image_edited' | 'generation_failed';
  prompt?: string;
  imageBase64?: string;
  error?: string;
}

export interface PaintArenaMessage {
  type: 'response';
  text: string;
  speaker: 'agent';
  isPartial?: boolean;
  paintArena?: PaintArenaData;
}

export interface PaintArenaState {
  phase: 'asking' | 'generating' | 'viewing' | 'editing';
  currentPrompt?: string;
  currentImageBase64?: string;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface PuzzleState {
  phase: 'intro' | 'asking' | 'discussing' | 'revealed' | 'complete';
  currentPuzzleIndex: number;
  hintsGiven: number;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  puzzlesSolved: number[];
  puzzlesRevealed: number[];
}

export interface PuzzleData {
  type: 'puzzle_started' | 'puzzle_correct' | 'puzzle_revealed' | 'next_puzzle' | 'puzzles_complete';
  puzzleId?: number;
  puzzleTitle?: string;
  puzzleQuestion?: string;
  totalPuzzles?: number;
  puzzlesSolved?: number;
  puzzlesRevealed?: number;
}

export interface PuzzleMessage {
  type: 'response';
  text: string;
  speaker: 'agent';
  isPartial?: boolean;
  puzzle?: PuzzleData;
}

export type OutgoingMessage =
  | TranscriptMessage
  | ResponseMessage
  | ErrorMessage
  | ReadyMessage
  | StoppedMessage
  | TTSStoppedMessage
  | AudioChunkMessage
  | AgentCreationMessage
  | PaintArenaMessage
  | PuzzleMessage;
