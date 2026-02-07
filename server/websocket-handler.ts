import { WebSocket, RawData } from 'ws';
import { DeepgramService } from './services/deepgram.service.js';
import { LLMService } from './services/llm.service.js';
import { TTSService } from './services/tts.service.js';
import { ClientSession, WebSocketMessage, OutgoingMessage } from './types.js';
import { logger } from './logger.js';
import { SessionAbortManager } from './abort-controller.js';
import { PromptStore } from './stores/prompt.store.js';
import { ConversationStore } from './stores/conversation.store.js';
import { randomUUID } from 'crypto';

export class WebSocketHandler {
  private deepgramService: DeepgramService;
  private llmService: LLMService;
  private ttsService: TTSService;
  private sessions: Map<WebSocket, ClientSession>;
  private promptStore: PromptStore;
  private conversationStore: ConversationStore;

  constructor() {
    this.deepgramService = new DeepgramService();
    this.llmService = new LLMService();
    this.ttsService = new TTSService();
    this.sessions = new Map();
    this.promptStore = new PromptStore();
    this.conversationStore = new ConversationStore();
  }

  handleConnection(ws: WebSocket): void {
    logger.info('🔌 New WebSocket connection');

    let session: ClientSession | null = null;

    ws.on('message', async (message: Buffer) => {
      try {
        const data: WebSocketMessage = JSON.parse(message.toString());
        // Log all incoming messages (except audio to avoid spam)
        if (data.type !== 'audio') {
          logger.info(`📨 Client message: ${data.type}`);
        }
        await this.handleMessage(ws, data, session);
      } catch (error) {
        logger.error(error, { context: 'websocket_message' });
        this.sendMessage(ws, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    ws.on('close', () => {
      logger.info('🔌 WebSocket connection closed');
      this.cleanupSession(ws, session);
    });

    ws.on('error', (error: Error) => {
      logger.error(error, { context: 'websocket' });
      this.cleanupSession(ws, session);
    });
  }

  private async handleMessage(
    ws: WebSocket,
    data: WebSocketMessage,
    session: ClientSession | null
  ): Promise<void> {
    logger.debug(`📨 Received message type: ${data.type}`);

    if (data.type === 'start') {
      session = await this.handleStart(ws, data.voiceId, data.systemPrompt, data.userName);
    } else if (data.type === 'audio') {
      const storedSession = this.sessions.get(ws);
      await this.handleAudio(ws, data, storedSession ?? null);
    } else if (data.type === 'stop') {
      logger.info('🛑 Received stop message');
      await this.handleStop(ws, this.sessions.get(ws) ?? null);
    } else if (data.type === 'interrupt') {
      logger.info('⚡ Received interrupt message');
      await this.handleInterrupt(ws, this.sessions.get(ws) ?? null);
    }
  }

  private async handleStart(
    ws: WebSocket,
    voiceId?: string,
    systemPrompt?: string,
    userName?: string
  ): Promise<ClientSession> {
    logger.info('🎤 Starting voice session...', { userName });

    const existingSession = this.sessions.get(ws);
    if (existingSession) {
      this.cleanupSession(ws, existingSession);
    }

    const sessionId = randomUUID();

    // Resolve the system prompt using the prompt store
    let resolvedPrompt = systemPrompt;
    if (!resolvedPrompt?.trim()) {
      // Use the default template from prompt store with user's name
      resolvedPrompt = this.promptStore.resolvePrompt('default', { userName });
    } else {
      // Interpolate any template variables in the custom prompt
      resolvedPrompt = this.promptStore.resolveRawPrompt(resolvedPrompt, { userName });
    }

    // Create conversation history for this session
    const conversationHistory = this.conversationStore.getOrCreate(sessionId);

    logger.info('📝 Session configured', {
      sessionId,
      userName: userName || '(anonymous)',
      promptLength: resolvedPrompt.length,
    });

    const session: ClientSession = {
      id: sessionId,
      deepgramConnection: this.deepgramService.createFluxConnection(),
      isListening: true,
      currentTranscript: '',
      voiceId,
      systemPrompt: resolvedPrompt,
      userName,
      abortManager: new SessionAbortManager(),
      conversationHistory,
      sentenceQueue: [], // Initialize the sentence queue
    };

    this.sessions.set(ws, session);
    this.setupDeepgramHandlers(ws, session);
    logger.info('✅ Deepgram connection created');

    return session;
  }

  private setupDeepgramHandlers(ws: WebSocket, session: ClientSession): void {
    const { deepgramConnection } = session;

    deepgramConnection.on('open', () => {
      logger.info('✅ Deepgram Flux connection opened - START SPEAKING NOW!');
      this.sendMessage(ws, { type: 'ready' });
    });

    deepgramConnection.on('message', async (data: RawData) => {
      try {
        const message = JSON.parse(data.toString());
        const messageType = message.type || message.event;
        
        logger.debug(`📥 Deepgram message: ${messageType}`, { 
          hasTranscript: !!message.channel?.alternatives?.[0]?.transcript,
          transcript: message.channel?.alternatives?.[0]?.transcript?.substring(0, 50),
          event: message.event,
        });

        // Handle Flux turn events
        if (messageType === 'TurnInfo' || message.event) {
          await this.handleFluxTurnInfo(ws, session, message);
        } 
        // Handle regular transcription results
        else if (messageType === 'Results') {
          await this.handleDeepgramResults(ws, session, message);
        } 
        // Handle errors
        else if (messageType === 'Error') {
          logger.error(new Error(message.error || 'Deepgram error'));
          this.sendMessage(ws, { type: 'error', message: message.error });
        }
        // Handle connection events
        else if (messageType === 'Connected' || messageType === 'Metadata') {
          logger.debug(`📥 Deepgram ${messageType} event`);
        }
      } catch (error) {
        logger.error(error, { context: 'deepgram_message_parse' });
      }
    });

    deepgramConnection.on('error', (error: Error) => {
      logger.error(error, { context: 'deepgram_ws' });
      this.sendMessage(ws, { type: 'error', message: error.message });
    });

    deepgramConnection.on('close', (code: number) => {
      logger.info('🔌 Deepgram connection closed', { code });
      session.isListening = false;
    });
  }

  private async handleDeepgramResults(
    ws: WebSocket,
    session: ClientSession,
    data: any
  ): Promise<void> {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;

    const isFinal = data.is_final || false;
    session.currentTranscript = transcript;

    this.sendMessage(ws, {
      type: 'transcript',
      transcript,
      isPartial: !isFinal,
      speaker: 'user',
    });

    if (isFinal) {
      // Add user message to conversation history
      session.conversationHistory.addUserMessage(transcript);
      await this.generateLLMResponse(ws, transcript);
    }
  }

  /**
   * Handle Flux turn events: EndOfTurn, EagerEndOfTurn, TurnResumed
   * These events provide turn-taking detection for natural conversation flow
   */
  private async handleFluxTurnInfo(ws: WebSocket, session: ClientSession, data: any): Promise<void> {
    const event = data.event || data.type;
    const transcript = (data.transcript || '').trim();

    // Extract transcript from various possible locations in Flux response
    const transcriptText = transcript || 
      data.channel?.alternatives?.[0]?.transcript?.trim() ||
      data.channel?.alternatives?.[0]?.transcript || 
      '';

    if (!transcriptText && event !== 'TurnResumed') {
      logger.debug(`📥 Flux ${event} event with no transcript`);
      return;
    }

    session.currentTranscript = transcriptText;

    switch (event) {
      case 'EndOfTurn':
        // User has finished speaking - final transcript is ready
        logger.info('🎤 EndOfTurn - User finished speaking', { 
          transcript: transcriptText.substring(0, 50) 
        });
        
        this.sendMessage(ws, {
          type: 'transcript',
          transcript: transcriptText,
          isPartial: false,
          speaker: 'user',
        });

        // Add to conversation history
        session.conversationHistory.addUserMessage(transcriptText);
        await this.generateLLMResponse(ws, transcriptText);
        break;

      case 'EagerEndOfTurn':
        // Early turn detection - user likely finished but may continue
        logger.info('⚡ EagerEndOfTurn - Starting early LLM processing', { 
          transcript: transcriptText.substring(0, 50) 
        });
        
        // Send partial transcript for UI feedback
        this.sendMessage(ws, {
          type: 'transcript',
          transcript: transcriptText,
          isPartial: true,
          speaker: 'user',
        });

        // Add to conversation history (will be used in LLM call)
        session.conversationHistory.addUserMessage(transcriptText);
        // Start LLM response early for reduced latency
        await this.generateLLMResponse(ws, transcriptText);
        break;

      case 'TurnResumed':
        // User continued speaking after EagerEndOfTurn - cancel speculative response
        logger.info('🔄 TurnResumed - User continued speaking, canceling speculative response');
        
        // Clear the sentence queue so no more TTS starts
        session.sentenceQueue.length = 0;
        
        // Abort any in-progress LLM/TTS from EagerEndOfTurn
        session.abortManager.abortAll();
        session.isProcessingResponse = false;
        
        // Send signal to frontend that we're canceling
        this.sendMessage(ws, { type: 'tts_stopped' });
        break;

      default:
        logger.debug(`📥 Unhandled Flux event: ${event}`);
    }
  }

  private async generateLLMResponse(ws: WebSocket, transcript: string): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    if (session.isProcessingResponse) {
      logger.warn('⚠️ Already processing a response, skipping');
      return;
    }

    session.isProcessingResponse = true;
    let fullResponseText = '';
    let processingQueue = false;

    // Clear any leftover sentences from previous responses
    session.sentenceQueue.length = 0;

    const processNextSentence = async () => {
      if (processingQueue || session.sentenceQueue.length === 0) return;

      processingQueue = true;

      while (session.sentenceQueue.length > 0 && !session.abortManager.getTTSController().isAborted()) {
        const sentence = session.sentenceQueue.shift()!;
        await this.streamTTSForSentence(ws, sentence);
      }

      processingQueue = false;
    };

    try {
      await this.llmService.streamResponse(transcript, {
        systemPrompt: session.systemPrompt,
        conversationHistory: session.conversationHistory,
        onSentence: (sentence: string) => {
          if (session.abortManager.getLLMController().isAborted()) return;

          fullResponseText += (fullResponseText ? ' ' : '') + sentence;

          this.sendMessage(ws, {
            type: 'response',
            text: sentence,
            isPartial: true,
            speaker: 'agent',
          });

          session.sentenceQueue.push(sentence);
          processNextSentence().catch((error) => logger.error(error, { context: 'process_tts_queue' }));
        },
        onComplete: async (fullText: string) => {
          const maxWaitTime = 30000;
          const startTime = Date.now();
          while (
            (processingQueue || session.sentenceQueue.length > 0) &&
            Date.now() - startTime < maxWaitTime &&
            !session.abortManager.getLLMController().isAborted()
          ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          if (!session.abortManager.getLLMController().isAborted()) {
            this.sendMessage(ws, {
              type: 'response',
              text: fullText,
              speaker: 'agent',
              isPartial: false,
            });
          }

          session.isProcessingResponse = false;
        },
        onError: (error: Error) => {
          logger.error(error, { context: 'llm_stream_response' });
          this.sendMessage(ws, {
            type: 'error',
            message: 'Failed to generate response',
          });
          session.isProcessingResponse = false;
        },
      });
    } catch (error) {
      logger.error(error, { context: 'llm_generate_response' });
      this.sendMessage(ws, {
        type: 'error',
        message: 'Failed to generate response',
      });
      session.isProcessingResponse = false;
    }
  }

  private async getOrCreateTTSConnection(session: ClientSession): Promise<any> {
    if (session.ttsWebSocket && session.ttsWebSocketReady) {
      return session.ttsWebSocket;
    }

    logger.debug('Creating new TTS WebSocket connection');
    const ttsWs = this.ttsService.createWebSocketConnection();

    await ttsWs.connect();
    session.ttsWebSocket = ttsWs;
    session.ttsWebSocketReady = true;

    session.abortManager.registerCleanup(() => {
      if (ttsWs && typeof ttsWs.disconnect === 'function') {
        logger.info('🛑 Disconnecting TTS WebSocket');
        ttsWs.disconnect();
      }
    });

    return ttsWs;
  }

  private async streamTTSForSentence(ws: WebSocket, sentence: string): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session || session.abortManager.getTTSController().isAborted()) {
      return;
    }

    try {
      const ttsWs = await this.getOrCreateTTSConnection(session);
      const ttsController = session.abortManager.getTTSController();

      const { readingPromise } = await this.ttsService.streamTTSOnConnection(
        ttsWs,
        sentence,
        {
          onAudioChunk: (audioChunk: Buffer) => {
            this.sendMessage(ws, {
              type: 'audio_chunk',
              audio: audioChunk.toString('base64'),
              format: 'pcm_f32le',
              sampleRate: 22050,
            });
          },
          onError: (error: Error) => {
            if (!ttsController.isAborted()) {
              logger.error(error, { context: 'tts_stream_sentence' });
              session.ttsWebSocketReady = false;
            }
          },
          voiceId: session.voiceId,
        },
        ttsController
      );

      await readingPromise;
    } catch (error) {
      if (!session.abortManager.getTTSController().isAborted()) {
        logger.error(error, { context: 'tts_stream_sentence' });
      }
    }
  }

  private audioChunkCount = 0;

  private async handleAudio(
    ws: WebSocket,
    data: WebSocketMessage,
    session: ClientSession | null
  ): Promise<void> {
    if (!session?.deepgramConnection || !session.isListening) return;

    const audioBuffer = Buffer.from(data.audio || '', 'base64');
    if (audioBuffer.length === 0) return;

    this.audioChunkCount++;
    if (this.audioChunkCount % 50 === 1) {
      logger.info(`🎙️ Received audio chunk #${this.audioChunkCount} (${audioBuffer.length} bytes)`);
    }

    if (session.deepgramConnection.readyState === WebSocket.OPEN) {
      session.deepgramConnection.send(audioBuffer);
    } else {
      logger.warn(`⚠️ Deepgram connection not open, state: ${session.deepgramConnection.readyState}`);
    }
  }

  private async handleInterrupt(ws: WebSocket, session: ClientSession | null): Promise<void> {
    if (!session) return;

    logger.info('⚡ User interrupted - aborting TTS and LLM streams');

    // ── CRITICAL: Clear the sentence queue FIRST ──
    // This prevents processNextSentence from picking up more sentences
    // after we abort the current TTS stream.
    const queuedCount = session.sentenceQueue.length;
    session.sentenceQueue.length = 0;
    if (queuedCount > 0) {
      logger.info(`🗑️ Cleared ${queuedCount} queued sentences`);
    }

    // Abort all ongoing TTS and LLM operations
    session.abortManager.abortAll();
    
    // Send TTS stopped event to frontend
    this.sendMessage(ws, { type: 'tts_stopped' });

    // Reset processing flag
    session.isProcessingResponse = false;
    session.ttsWebSocketReady = false;

    if (session.ttsWebSocket) {
      try {
        session.ttsWebSocket.disconnect();
      } catch {
        // Expected during interrupt
      }
      session.ttsWebSocket = null;
    }

    // Create new abort controllers for the next response
    session.abortManager = new SessionAbortManager();

    session.abortManager.registerCleanup(() => {
      if (session.ttsWebSocket && typeof session.ttsWebSocket.disconnect === 'function') {
        logger.info('🛑 Disconnecting TTS WebSocket');
        session.ttsWebSocket.disconnect();
      }
    });

    logger.info('✅ Interruption handled - ready for new input');
  }

  private async handleStop(ws: WebSocket, session: ClientSession | null): Promise<void> {
    logger.info('🛑 Stopping voice session...');

    if (session) {
      // Log conversation summary before cleanup
      const summary = session.conversationHistory.getSummary();
      logger.info('📊 Session conversation summary', { sessionId: session.id, ...summary });

      // Clear the sentence queue
      session.sentenceQueue.length = 0;

      session.abortManager.abortAll();
      session.isListening = false;
      session.isProcessingResponse = false;
      session.ttsWebSocketReady = false;
      session.ttsWebSocket = null;

      if (session.deepgramConnection?.readyState === WebSocket.OPEN) {
        session.deepgramConnection.close(1000, 'Session stopped by user');
      }

      // Clean up conversation history
      this.conversationStore.remove(session.id);
    }

    this.sendMessage(ws, { type: 'tts_stopped' });
    this.sendMessage(ws, { type: 'stopped' });
    this.sessions.delete(ws);
  }

  private sendMessage(ws: WebSocket, message: OutgoingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private cleanupSession(ws: WebSocket, session: ClientSession | null): void {
    if (session) {
      // Clear the sentence queue
      session.sentenceQueue.length = 0;
      
      session.abortManager.abortAll();

      if (session.deepgramConnection?.readyState === WebSocket.OPEN) {
        session.deepgramConnection.close();
      }

      // Clean up conversation history
      this.conversationStore.remove(session.id);

      this.sessions.delete(ws);
    }
  }
}
