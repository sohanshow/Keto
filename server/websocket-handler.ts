import { WebSocket, RawData } from 'ws';
import { DeepgramService } from './services/deepgram.service.js';
import { LLMService } from './services/llm.service.js';
import { TTSService } from './services/tts.service.js';
import { AgentCreationService } from './services/agent-creation.service.js';
import { PaintArenaService } from './services/paint-arena.service.js';
import { PuzzleService } from './services/puzzle.service.js';
import { ClientSession, WebSocketMessage, OutgoingMessage, Voice, AgentCreationState, PaintArenaState, PuzzleState } from './types.js';
import { logger } from './logger.js';
import { SessionAbortManager } from './abort-controller.js';
import { PromptStore } from './stores/prompt.store.js';
import { ConversationStore } from './stores/conversation.store.js';
import { randomUUID } from 'crypto';

// Default voice for agent creation
const DEFAULT_CREATION_VOICE_ID = '6ccbfb76-1fc6-48f7-b71d-91ac6298247b';
const DEFAULT_CREATION_VOICE_NAME = 'Tessa';

export class WebSocketHandler {
  private deepgramService: DeepgramService;
  private llmService: LLMService;
  private ttsService: TTSService;
  private agentCreationService: AgentCreationService;
  private paintArenaService: PaintArenaService;
  private puzzleService: PuzzleService;
  private sessions: Map<WebSocket, ClientSession>;
  private promptStore: PromptStore;
  private conversationStore: ConversationStore;

  constructor() {
    this.deepgramService = new DeepgramService();
    this.llmService = new LLMService();
    this.ttsService = new TTSService();
    this.agentCreationService = new AgentCreationService();
    this.paintArenaService = new PaintArenaService();
    this.puzzleService = new PuzzleService();
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
      session = await this.handleStart(
        ws, 
        data.voiceId, 
        data.systemPrompt, 
        data.userName,
        data.mode,
        data.voices
      );
    } else if (data.type === 'audio') {
      const storedSession = this.sessions.get(ws);
      await this.handleAudio(ws, data, storedSession ?? null);
    } else if (data.type === 'stop') {
      logger.info('🛑 Received stop message');
      await this.handleStop(ws, this.sessions.get(ws) ?? null);
    } else if (data.type === 'interrupt') {
      logger.info('⚡ Received interrupt message');
      await this.handleInterrupt(ws, this.sessions.get(ws) ?? null);
    } else if (data.type === 'text_input') {
      // Handle text input (for paint arena and other modes)
      const storedSession = this.sessions.get(ws);
      if (storedSession && data.text) {
        await this.handleTextInput(ws, storedSession, data.text);
      }
    } else if (data.type === 'paint_reset') {
      // Handle paint arena reset
      const storedSession = this.sessions.get(ws);
      if (storedSession?.paintArena) {
        await this.handlePaintReset(ws, storedSession);
      }
    } else if (data.type === 'puzzle_next') {
      // Handle puzzle skip to next
      const storedSession = this.sessions.get(ws);
      if (storedSession?.puzzle) {
        await this.handlePuzzleNext(ws, storedSession);
      }
    } else if (data.type === 'puzzle_hint') {
      // Handle puzzle hint request
      const storedSession = this.sessions.get(ws);
      if (storedSession?.puzzle) {
        await this.handlePuzzleHint(ws, storedSession);
      }
    }
  }

  private async handleStart(
    ws: WebSocket,
    voiceId?: string,
    systemPrompt?: string,
    userName?: string,
    mode?: 'normal' | 'agent_creation' | 'paint_arena' | 'puzzle',
    voices?: Voice[]
  ): Promise<ClientSession> {
    logger.info('🎤 Starting voice session...', { userName, mode: mode || 'normal' });

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
      mode: mode || 'normal',
    });

    // Initialize agent creation state if in creation mode
    let agentCreation: AgentCreationState | undefined;
    if (mode === 'agent_creation') {
      const initialVoiceId = voiceId || DEFAULT_CREATION_VOICE_ID;
      const initialVoice = voices?.find(v => v.id === initialVoiceId);
      
      agentCreation = {
        phase: 'voice',
        voiceId: initialVoiceId,
        voiceName: initialVoice?.name || DEFAULT_CREATION_VOICE_NAME,
        humor: 5,
        formality: 5,
        traits: [],
        availableVoices: voices || [],
      };
    }

    // Initialize paint arena state if in paint mode
    let paintArena: PaintArenaState | undefined;
    if (mode === 'paint_arena') {
      paintArena = {
        phase: 'asking',
        chatHistory: [],
      };
    }

    // Initialize puzzle state if in puzzle mode
    let puzzle: PuzzleState | undefined;
    if (mode === 'puzzle') {
      puzzle = {
        phase: 'intro',
        currentPuzzleIndex: 0,
        hintsGiven: 0,
        chatHistory: [],
        puzzlesSolved: [],
        puzzlesRevealed: [],
      };
    }

    const session: ClientSession = {
      id: sessionId,
      deepgramConnection: this.deepgramService.createFluxConnection(),
      isListening: true,
      currentTranscript: '',
      voiceId: mode === 'agent_creation' ? (voiceId || DEFAULT_CREATION_VOICE_ID) : voiceId,
      systemPrompt: resolvedPrompt,
      userName,
      abortManager: new SessionAbortManager(),
      conversationHistory,
      sentenceQueue: [],
      mode: mode || 'normal',
      agentCreation,
      paintArena,
      puzzle,
    };

    this.sessions.set(ws, session);
    this.setupDeepgramHandlers(ws, session);
    logger.info('✅ Deepgram connection created');

    // If in agent creation mode, send initial greeting after connection is ready
    if (mode === 'agent_creation') {
      this.sendAgentCreationGreeting(ws, session);
    }

    // If in paint arena mode, send initial greeting
    if (mode === 'paint_arena') {
      this.sendPaintArenaGreeting(ws, session);
    }

    // If in puzzle mode, send initial greeting
    if (mode === 'puzzle') {
      this.sendPuzzleGreeting(ws, session);
    }

    return session;
  }

  /**
   * Send the initial greeting for agent creation mode
   */
  private async sendAgentCreationGreeting(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.agentCreation) return;

    // Wait a moment for connection to be fully established
    setTimeout(async () => {
      const greeting = await this.agentCreationService.generateInitialGreeting(
        session.userName || 'there',
        session.agentCreation!.voiceName
      );

      // Add to conversation history
      session.conversationHistory.addAssistantMessage(greeting);

      // Send the greeting text
      this.sendMessage(ws, {
        type: 'response',
        text: greeting,
        speaker: 'agent',
        isPartial: false,
      });

      // TTS the greeting
      session.sentenceQueue.push(greeting);
      this.processAgentCreationTTSQueue(ws, session);
    }, 500);
  }

  /**
   * Process TTS queue for agent creation (uses dynamic voice ID)
   */
  private async processAgentCreationTTSQueue(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.agentCreation) return;

    while (session.sentenceQueue.length > 0 && !session.abortManager.getTTSController().isAborted()) {
      const sentence = session.sentenceQueue.shift()!;
      
      // Use the current voice ID from agent creation state
      const currentVoiceId = session.agentCreation.voiceId;
      
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
                logger.error(error, { context: 'agent_creation_tts' });
                session.ttsWebSocketReady = false;
              }
            },
            voiceId: currentVoiceId,
          },
          ttsController
        );

        await readingPromise;
      } catch (error) {
        if (!session.abortManager.getTTSController().isAborted()) {
          logger.error(error, { context: 'agent_creation_tts' });
        }
      }
    }
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
          transcript: transcriptText.substring(0, 50),
          mode: session.mode || 'normal',
        });
        
        this.sendMessage(ws, {
          type: 'transcript',
          transcript: transcriptText,
          isPartial: false,
          speaker: 'user',
        });

        // Add to conversation history
        session.conversationHistory.addUserMessage(transcriptText);
        
        // Route to appropriate handler based on mode
        if (session.mode === 'agent_creation') {
          await this.handleAgentCreationInput(ws, session, transcriptText);
        } else if (session.mode === 'paint_arena') {
          await this.handlePaintArenaInput(ws, session, transcriptText);
        } else if (session.mode === 'puzzle') {
          await this.handlePuzzleInput(ws, session, transcriptText);
        } else {
          await this.generateLLMResponse(ws, transcriptText);
        }
        break;

      case 'EagerEndOfTurn':
        // Early turn detection - user likely finished but may continue
        logger.info('⚡ EagerEndOfTurn - Starting early LLM processing', { 
          transcript: transcriptText.substring(0, 50),
          mode: session.mode || 'normal',
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
        
        // Route to appropriate handler based on mode
        if (session.mode === 'agent_creation') {
          await this.handleAgentCreationInput(ws, session, transcriptText);
        } else if (session.mode === 'paint_arena') {
          await this.handlePaintArenaInput(ws, session, transcriptText);
        } else if (session.mode === 'puzzle') {
          await this.handlePuzzleInput(ws, session, transcriptText);
        } else {
          await this.generateLLMResponse(ws, transcriptText);
        }
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

  /**
   * Handle user input during agent creation mode
   */
  private async handleAgentCreationInput(
    ws: WebSocket, 
    session: ClientSession, 
    transcript: string
  ): Promise<void> {
    if (!session.agentCreation) {
      logger.warn('⚠️ Agent creation input received but no creation state');
      return;
    }

    if (session.isProcessingResponse) {
      logger.warn('⚠️ Already processing agent creation response, skipping');
      return;
    }

    session.isProcessingResponse = true;

    try {
      // Get conversation history for context
      const history = session.conversationHistory.getMessagesForLLM();
      
      // Process the input through agent creation service
      const result = await this.agentCreationService.processAgentCreationInput(
        transcript,
        session.agentCreation,
        session.userName || 'there',
        history
      );

      // Update voice ID if changed
      if (result.newVoiceId) {
        session.agentCreation.voiceId = result.newVoiceId;
        session.voiceId = result.newVoiceId;
        
        // Disconnect existing TTS connection so next TTS uses new voice
        if (session.ttsWebSocket) {
          try {
            session.ttsWebSocket.disconnect();
          } catch {
            // Expected
          }
          session.ttsWebSocket = null;
          session.ttsWebSocketReady = false;
        }
      }

      // Update agent creation state based on result
      if (result.agentCreation) {
        const { type, voiceId, voiceName, humor, formality, traits } = result.agentCreation;

        if (type === 'voice_selected') {
          // Only allow voice changes during voice phase
          if (session.agentCreation.phase === 'voice') {
            if (voiceId) session.agentCreation.voiceId = voiceId;
            if (voiceName) session.agentCreation.voiceName = voiceName;
            logger.info('🎤 Voice updated', { voiceName, phase: session.agentCreation.phase });
          } else {
            logger.warn('⚠️ Ignoring voice change - not in voice phase', { phase: session.agentCreation.phase });
            // Clear the newVoiceId so TTS doesn't switch
            result.newVoiceId = undefined;
          }
        }

        if (type === 'personality_set') {
          // Update personality values if provided
          if (humor !== undefined) session.agentCreation.humor = humor;
          if (formality !== undefined) session.agentCreation.formality = formality;
          if (traits && traits.length > 0) session.agentCreation.traits = traits;
          
          // Move to personality phase if we were in voice phase (voice is now confirmed)
          if (session.agentCreation.phase === 'voice') {
            session.agentCreation.phase = 'personality';
            logger.info('✅ Phase transition: voice → personality', { voiceName: session.agentCreation.voiceName });
          }
        }

        if (type === 'creation_complete') {
          session.agentCreation.phase = 'complete';
          logger.info('🎉 Agent creation complete');
        }
      }

      // Add response to conversation history
      session.conversationHistory.addAssistantMessage(result.response);

      // Include current phase in the agent creation data
      const agentCreationWithPhase = result.agentCreation 
        ? { ...result.agentCreation, phase: session.agentCreation.phase }
        : { phase: session.agentCreation.phase };

      // Send response with agent creation data
      this.sendMessage(ws, {
        type: 'response',
        text: result.response,
        speaker: 'agent',
        isPartial: false,
        agentCreation: agentCreationWithPhase,
      });

      // Queue TTS for the response
      session.sentenceQueue.push(result.response);
      await this.processAgentCreationTTSQueue(ws, session);

    } catch (error) {
      logger.error(error, { context: 'agent_creation_input' });
      this.sendMessage(ws, {
        type: 'error',
        message: 'Failed to process agent creation input',
      });
    } finally {
      session.isProcessingResponse = false;
    }
  }

  private async generateLLMResponse(ws: WebSocket, transcript: string, searchContext?: string): Promise<void> {
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
        searchContext,
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
        onToolCall: async (tool: string, query: string, filler: string) => {
          if (tool === 'web_search') {
            logger.info('🔍 Web search tool called', { query });

            // Send the filler message and TTS it
            this.sendMessage(ws, {
              type: 'response',
              text: filler,
              isPartial: false,
              speaker: 'agent',
              toolCall: { tool: 'web_search', status: 'searching' },
            } as any);

            session.sentenceQueue.push(filler);
            processNextSentence().catch((error) => logger.error(error, { context: 'process_tts_queue' }));

            // Perform the search
            try {
              const searchResults = await this.llmService.performWebSearch(query);
              
              // Send search complete event
              this.sendMessage(ws, {
                type: 'response',
                text: '',
                speaker: 'agent',
                toolCall: { tool: 'web_search', status: 'complete' },
              } as any);

              // Reset processing flag so we can generate the follow-up response
              session.isProcessingResponse = false;

              // Generate response with search context
              await this.generateLLMResponse(ws, transcript, searchResults);
            } catch (error) {
              logger.error(error, { context: 'web_search' });
              session.isProcessingResponse = false;
              
              // Fall back to regular response without search
              await this.generateLLMResponse(ws, transcript, 'Web search failed. Please answer based on your knowledge.');
            }
          }
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PAINT ARENA METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send the initial greeting for paint arena mode
   */
  private async sendPaintArenaGreeting(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.paintArena) return;

    // Wait a moment for connection to be fully established
    setTimeout(async () => {
      const greeting = await this.paintArenaService.generateInitialGreeting(
        session.userName || 'there'
      );

      // Add to chat history
      session.paintArena!.chatHistory.push({ role: 'assistant', content: greeting });

      // Send the greeting text
      this.sendMessage(ws, {
        type: 'response',
        text: greeting,
        speaker: 'agent',
        isPartial: false,
      });

      // TTS the greeting
      session.sentenceQueue.push(greeting);
      this.processPaintArenaTTSQueue(ws, session);
    }, 500);
  }

  /**
   * Process TTS queue for paint arena
   */
  private async processPaintArenaTTSQueue(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.paintArena) return;

    while (session.sentenceQueue.length > 0 && !session.abortManager.getTTSController().isAborted()) {
      const sentence = session.sentenceQueue.shift()!;

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
                logger.error(error, { context: 'paint_arena_tts' });
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
          logger.error(error, { context: 'paint_arena_tts' });
        }
      }
    }
  }

  /**
   * Handle user input during paint arena mode
   */
  private async handlePaintArenaInput(
    ws: WebSocket,
    session: ClientSession,
    transcript: string
  ): Promise<void> {
    if (!session.paintArena) {
      logger.warn('⚠️ Paint arena input received but no paint state');
      return;
    }

    // Don't process if we're currently generating an image
    if (session.paintArena.phase === 'generating') {
      logger.warn('⚠️ Ignoring input - image generation in progress');
      return;
    }

    if (session.isProcessingResponse) {
      logger.warn('⚠️ Already processing paint arena response, skipping');
      return;
    }

    session.isProcessingResponse = true;

    try {
      // Add user message to chat history
      session.paintArena.chatHistory.push({ role: 'user', content: transcript });

      // Process the input through paint arena service
      const result = await this.paintArenaService.processInput(
        transcript,
        session.paintArena,
        session.userName || 'there'
      );

      // Add assistant response to chat history
      session.paintArena.chatHistory.push({ role: 'assistant', content: result.response });

      // Send the response text
      this.sendMessage(ws, {
        type: 'response',
        text: result.response,
        speaker: 'agent',
        isPartial: false,
      });

      // TTS the response
      session.sentenceQueue.push(result.response);
      await this.processPaintArenaTTSQueue(ws, session);

      // If we should generate an image, do it
      if (result.shouldGenerateImage && result.imagePrompt) {
        await this.handlePaintArenaImageGeneration(
          ws,
          session,
          result.imagePrompt,
          result.isEditRequest || false
        );
      }
    } catch (error) {
      logger.error(error, { context: 'paint_arena_input' });
      this.sendMessage(ws, {
        type: 'error',
        message: 'Failed to process paint arena input',
      });
    } finally {
      session.isProcessingResponse = false;
    }
  }

  /**
   * Handle text input (for paint arena text chat)
   */
  private async handleTextInput(
    ws: WebSocket,
    session: ClientSession,
    text: string
  ): Promise<void> {
    logger.info('📝 Received text input', { text: text.substring(0, 50), mode: session.mode });

    // Send the text as a user transcript
    this.sendMessage(ws, {
      type: 'transcript',
      transcript: text,
      isPartial: false,
      speaker: 'user',
    });

    // Route based on mode
    if (session.mode === 'paint_arena') {
      await this.handlePaintArenaInput(ws, session, text);
    } else {
      // For other modes, treat as regular LLM input
      session.conversationHistory.addUserMessage(text);
      await this.generateLLMResponse(ws, text);
    }
  }

  /**
   * Handle paint arena image generation
   */
  private async handlePaintArenaImageGeneration(
    ws: WebSocket,
    session: ClientSession,
    prompt: string,
    isEdit: boolean
  ): Promise<void> {
    if (!session.paintArena) return;

    logger.info('🎨 Starting image generation', { prompt: prompt.substring(0, 50), isEdit });

    // Update phase and notify client
    session.paintArena.phase = 'generating';
    session.paintArena.currentPrompt = prompt;

    this.sendMessage(ws, {
      type: 'response',
      text: '',
      speaker: 'agent',
      paintArena: {
        type: 'generation_started',
        prompt,
      },
    });

    try {
      let result: { imageBase64: string; text?: string };

      if (isEdit && session.paintArena.currentImageBase64) {
        // Edit existing image
        result = await this.paintArenaService.editImage(
          prompt,
          session.paintArena.currentImageBase64
        );
      } else {
        // Generate new image
        result = await this.paintArenaService.generateImage(prompt);
      }

      // Store the generated image
      session.paintArena.currentImageBase64 = result.imageBase64;
      session.paintArena.phase = 'viewing';

      // Send the generated image to client
      this.sendMessage(ws, {
        type: 'response',
        text: '',
        speaker: 'agent',
        paintArena: {
          type: isEdit ? 'image_edited' : 'image_generated',
          imageBase64: result.imageBase64,
        },
      });

      // Send "do you like it" response
      const postGenResponse = this.paintArenaService.getPostGenerationResponse();
      session.paintArena.chatHistory.push({ role: 'assistant', content: postGenResponse });

      this.sendMessage(ws, {
        type: 'response',
        text: postGenResponse,
        speaker: 'agent',
        isPartial: false,
      });

      // TTS the post-generation response
      session.sentenceQueue.push(postGenResponse);
      await this.processPaintArenaTTSQueue(ws, session);

    } catch (error) {
      logger.error(error, { context: 'paint_arena_image_generation' });
      
      session.paintArena.phase = session.paintArena.currentImageBase64 ? 'viewing' : 'asking';

      this.sendMessage(ws, {
        type: 'response',
        text: '',
        speaker: 'agent',
        paintArena: {
          type: 'generation_failed',
          error: error instanceof Error ? error.message : 'Failed to generate image',
        },
      });

      // Send error message via TTS
      const errorResponse = "Oops, I couldn't create that image. Could you try describing it differently?";
      session.paintArena.chatHistory.push({ role: 'assistant', content: errorResponse });

      this.sendMessage(ws, {
        type: 'response',
        text: errorResponse,
        speaker: 'agent',
        isPartial: false,
      });

      session.sentenceQueue.push(errorResponse);
      await this.processPaintArenaTTSQueue(ws, session);
    }
  }

  /**
   * Handle paint arena reset (new drawing)
   */
  private async handlePaintReset(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.paintArena) return;

    logger.info('🔄 Resetting paint arena');

    // Reset state
    session.paintArena.phase = 'asking';
    session.paintArena.currentPrompt = undefined;
    session.paintArena.currentImageBase64 = undefined;
    session.paintArena.chatHistory = [];

    // Send greeting for new session
    const greeting = "Alright, fresh canvas! What would you like to create this time?";
    session.paintArena.chatHistory.push({ role: 'assistant', content: greeting });

    this.sendMessage(ws, {
      type: 'response',
      text: greeting,
      speaker: 'agent',
      isPartial: false,
    });

    session.sentenceQueue.push(greeting);
    await this.processPaintArenaTTSQueue(ws, session);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUZZLE MODE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send the initial greeting for puzzle mode
   */
  private async sendPuzzleGreeting(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.puzzle) return;

    // Wait a moment for connection to be fully established
    setTimeout(async () => {
      const greeting = await this.puzzleService.generateInitialGreeting(
        session.userName || 'there'
      );

      // Add to chat history
      session.puzzle!.chatHistory.push({ role: 'assistant', content: greeting });

      // Send the greeting text
      this.sendMessage(ws, {
        type: 'response',
        text: greeting,
        speaker: 'agent',
        isPartial: false,
      });

      // TTS the greeting
      session.sentenceQueue.push(greeting);
      await this.processPuzzleTTSQueue(ws, session);

      // After greeting, send the first puzzle
      setTimeout(async () => {
        const puzzleIntro = this.puzzleService.getCurrentPuzzleIntro(session.puzzle!);
        session.puzzle!.chatHistory.push({ role: 'assistant', content: puzzleIntro });
        session.puzzle!.phase = 'discussing';

        const puzzle = this.puzzleService.getPuzzle(session.puzzle!.currentPuzzleIndex);

        this.sendMessage(ws, {
          type: 'response',
          text: puzzleIntro,
          speaker: 'agent',
          isPartial: false,
          puzzle: {
            type: 'puzzle_started',
            puzzleId: puzzle?.id,
            puzzleTitle: puzzle?.title,
            puzzleQuestion: puzzle?.question,
            totalPuzzles: this.puzzleService.getPuzzles().length,
          },
        });

        session.sentenceQueue.push(puzzleIntro);
        await this.processPuzzleTTSQueue(ws, session);
      }, 500);
    }, 500);
  }

  /**
   * Process TTS queue for puzzle mode
   */
  private async processPuzzleTTSQueue(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.puzzle) return;

    while (session.sentenceQueue.length > 0 && !session.abortManager.getTTSController().isAborted()) {
      const sentence = session.sentenceQueue.shift()!;

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
                logger.error(error, { context: 'puzzle_tts' });
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
          logger.error(error, { context: 'puzzle_tts' });
        }
      }
    }
  }

  /**
   * Handle user input during puzzle mode
   */
  private async handlePuzzleInput(
    ws: WebSocket,
    session: ClientSession,
    transcript: string
  ): Promise<void> {
    if (!session.puzzle) {
      logger.warn('⚠️ Puzzle input received but no puzzle state');
      return;
    }

    if (session.isProcessingResponse) {
      logger.warn('⚠️ Already processing puzzle response, skipping');
      return;
    }

    session.isProcessingResponse = true;

    try {
      // Add user message to chat history
      session.puzzle.chatHistory.push({ role: 'user', content: transcript });

      // Process the input through puzzle service
      const result = await this.puzzleService.processInput(
        transcript,
        session.puzzle,
        session.userName || 'there'
      );

      // Add assistant response to chat history
      session.puzzle.chatHistory.push({ role: 'assistant', content: result.response });

      // Handle different actions
      let puzzleData: any = undefined;

      switch (result.action) {
        case 'correct':
          // User solved the puzzle!
          session.puzzle.puzzlesSolved.push(session.puzzle.currentPuzzleIndex);
          puzzleData = {
            type: 'puzzle_correct',
            puzzleId: this.puzzleService.getPuzzle(session.puzzle.currentPuzzleIndex)?.id,
            puzzlesSolved: session.puzzle.puzzlesSolved.length,
          };
          break;

        case 'reveal':
          // Answer was revealed
          session.puzzle.puzzlesRevealed.push(session.puzzle.currentPuzzleIndex);
          session.puzzle.phase = 'revealed';
          puzzleData = {
            type: 'puzzle_revealed',
            puzzleId: this.puzzleService.getPuzzle(session.puzzle.currentPuzzleIndex)?.id,
            puzzlesRevealed: session.puzzle.puzzlesRevealed.length,
          };
          break;

        case 'discuss':
          // Still discussing, maybe give a hint
          if (result.giveHint) {
            session.puzzle.hintsGiven++;
          }
          break;

        case 'next_puzzle':
          // Move to next puzzle
          session.puzzle.currentPuzzleIndex++;
          session.puzzle.hintsGiven = 0;
          session.puzzle.phase = 'discussing';
          
          const nextPuzzle = this.puzzleService.getPuzzle(session.puzzle.currentPuzzleIndex);
          if (nextPuzzle) {
            puzzleData = {
              type: 'next_puzzle',
              puzzleId: nextPuzzle.id,
              puzzleTitle: nextPuzzle.title,
              puzzleQuestion: nextPuzzle.question,
              totalPuzzles: this.puzzleService.getPuzzles().length,
            };
          }
          break;

        case 'complete':
          // All puzzles done
          session.puzzle.phase = 'complete';
          puzzleData = {
            type: 'puzzles_complete',
            puzzlesSolved: session.puzzle.puzzlesSolved.length,
            puzzlesRevealed: session.puzzle.puzzlesRevealed.length,
            totalPuzzles: this.puzzleService.getPuzzles().length,
          };
          break;
      }

      // Send the response
      this.sendMessage(ws, {
        type: 'response',
        text: result.response,
        speaker: 'agent',
        isPartial: false,
        puzzle: puzzleData,
      });

      // TTS the response
      session.sentenceQueue.push(result.response);
      await this.processPuzzleTTSQueue(ws, session);

      // If moving to next puzzle, send the puzzle intro after a delay
      if (result.action === 'next_puzzle' || result.action === 'correct' || result.action === 'reveal') {
        // For correct/reveal, we need to also move to next after the response
        if (result.action === 'correct' || result.action === 'reveal') {
          setTimeout(async () => {
            if (!session.puzzle) return;
            
            session.puzzle.currentPuzzleIndex++;
            session.puzzle.hintsGiven = 0;
            session.puzzle.phase = 'discussing';

            const puzzleIntro = this.puzzleService.getNextPuzzleIntro(session.puzzle, session.userName || 'there');
            session.puzzle.chatHistory.push({ role: 'assistant', content: puzzleIntro });

            const puzzle = this.puzzleService.getPuzzle(session.puzzle.currentPuzzleIndex);
            
            this.sendMessage(ws, {
              type: 'response',
              text: puzzleIntro,
              speaker: 'agent',
              isPartial: false,
              puzzle: puzzle ? {
                type: 'next_puzzle',
                puzzleId: puzzle.id,
                puzzleTitle: puzzle.title,
                puzzleQuestion: puzzle.question,
                totalPuzzles: this.puzzleService.getPuzzles().length,
              } : {
                type: 'puzzles_complete',
                puzzlesSolved: session.puzzle.puzzlesSolved.length,
                puzzlesRevealed: session.puzzle.puzzlesRevealed.length,
                totalPuzzles: this.puzzleService.getPuzzles().length,
              },
            });

            session.sentenceQueue.push(puzzleIntro);
            await this.processPuzzleTTSQueue(ws, session);
          }, 1500);
        }
      }
    } catch (error) {
      logger.error(error, { context: 'puzzle_input' });
      this.sendMessage(ws, {
        type: 'error',
        message: 'Failed to process puzzle input',
      });
    } finally {
      session.isProcessingResponse = false;
    }
  }

  /**
   * Handle puzzle skip to next
   */
  private async handlePuzzleNext(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.puzzle) return;

    logger.info('⏭️ Skipping to next puzzle');

    // Mark current as revealed (skipped)
    session.puzzle.puzzlesRevealed.push(session.puzzle.currentPuzzleIndex);
    session.puzzle.currentPuzzleIndex++;
    session.puzzle.hintsGiven = 0;
    session.puzzle.phase = 'discussing';

    const puzzleIntro = this.puzzleService.getNextPuzzleIntro(session.puzzle, session.userName || 'there');
    session.puzzle.chatHistory.push({ role: 'assistant', content: puzzleIntro });

    const puzzle = this.puzzleService.getPuzzle(session.puzzle.currentPuzzleIndex);

    this.sendMessage(ws, {
      type: 'response',
      text: puzzleIntro,
      speaker: 'agent',
      isPartial: false,
      puzzle: puzzle ? {
        type: 'next_puzzle',
        puzzleId: puzzle.id,
        puzzleTitle: puzzle.title,
        puzzleQuestion: puzzle.question,
        totalPuzzles: this.puzzleService.getPuzzles().length,
      } : {
        type: 'puzzles_complete',
        puzzlesSolved: session.puzzle.puzzlesSolved.length,
        puzzlesRevealed: session.puzzle.puzzlesRevealed.length,
        totalPuzzles: this.puzzleService.getPuzzles().length,
      },
    });

    session.sentenceQueue.push(puzzleIntro);
    await this.processPuzzleTTSQueue(ws, session);
  }

  /**
   * Handle puzzle hint request
   */
  private async handlePuzzleHint(ws: WebSocket, session: ClientSession): Promise<void> {
    if (!session.puzzle) return;

    logger.info('💡 Requesting puzzle hint');

    const hint = this.puzzleService.getHint(session.puzzle);

    if (hint) {
      session.puzzle.hintsGiven++;
      const hintResponse = `Here's a hint: ${hint}`;
      session.puzzle.chatHistory.push({ role: 'assistant', content: hintResponse });

      this.sendMessage(ws, {
        type: 'response',
        text: hintResponse,
        speaker: 'agent',
        isPartial: false,
      });

      session.sentenceQueue.push(hintResponse);
      await this.processPuzzleTTSQueue(ws, session);
    } else {
      const noMoreHints = "I've given you all the hints I have for this one. Want me to reveal the answer, or do you want to keep trying?";
      session.puzzle.chatHistory.push({ role: 'assistant', content: noMoreHints });

      this.sendMessage(ws, {
        type: 'response',
        text: noMoreHints,
        speaker: 'agent',
        isPartial: false,
      });

      session.sentenceQueue.push(noMoreHints);
      await this.processPuzzleTTSQueue(ws, session);
    }
  }
}
