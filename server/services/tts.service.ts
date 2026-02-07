import { StreamingTTSClient } from '@cartesia/cartesia-js/wrapper/StreamingTTSClient';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Default voice ID - Katie (American English, stable for voice agents)
const DEFAULT_VOICE_ID = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

export interface TTSStreamOptions {
  onAudioChunk: (audioChunk: Buffer) => void;
  onError?: (error: Error) => void;
  voiceId?: string;
  modelId?: string;
}

export class TTSService {
  private client: StreamingTTSClient;

  constructor() {
    this.client = new StreamingTTSClient({
      apiKey: config.cartesiaApiKey,
    });
  }

  /**
   * Create a new WebSocket connection for TTS
   */
  createWebSocketConnection(): any {
    return this.client.websocket({
      sampleRate: 22050,
      container: 'raw',
      encoding: 'pcm_f32le',
    });
  }

  /**
   * Stream TTS audio on an existing WebSocket connection
   */
  async streamTTSOnConnection(
    ws: any,
    text: string,
    options: TTSStreamOptions,
    abortSignal?: { isAborted: () => boolean }
  ): Promise<{ stop: () => void; readingPromise: Promise<void> }> {
    const { onAudioChunk, onError, voiceId = DEFAULT_VOICE_ID, modelId = 'sonic-3' } = options;

    logger.info(`🔊 Starting TTS for: "${text.substring(0, 50)}..."`);

    try {
      const result = await ws.send(
        {
          modelId: modelId,
          transcript: text,
          voice: {
            mode: 'id',
            id: voiceId,
          },
          outputFormat: {
            container: 'raw' as const,
            encoding: 'pcm_f32le' as const,
            sampleRate: 22050,
          },
        },
        { timeout: 0 }
      );

      const { source, stop, on } = result;
      let sourceChunkCount = 0;
      let sourceClosed = false;

      on('message', (message: string) => {
        logger.debug(`📨 TTS message: ${message}`);
      });

      source.on('close', () => {
        sourceClosed = true;
        logger.debug('📦 TTS source closed');
      });

      const readAudioChunks = async (): Promise<void> => {
        try {
          const bufferSize = 4096;
          const buffer = new Float32Array(bufferSize);
          let consecutiveEmptyReads = 0;
          const maxEmptyReads = 100;

          while (true) {
            if (abortSignal?.isAborted()) {
              logger.info(`🛑 TTS reading aborted (${sourceChunkCount} chunks read)`);
              break;
            }

            try {
              const samplesRead = await source.read(buffer);

              if (samplesRead === 0) {
                consecutiveEmptyReads++;

                const hasData = source.writeIndex > source.readIndex;
                const isComplete = sourceClosed && !hasData;

                if (isComplete || (!hasData && consecutiveEmptyReads > maxEmptyReads)) {
                  logger.info(`📦 TTS complete (${sourceChunkCount} chunks)`);
                  break;
                }

                await new Promise((resolve) => setTimeout(resolve, 10));
                continue;
              }

              consecutiveEmptyReads = 0;
              sourceChunkCount++;

              const audioBuffer = Buffer.from(buffer.buffer, 0, samplesRead * 4);
              onAudioChunk(audioBuffer);
            } catch (readError: unknown) {
              const err = readError instanceof Error ? readError : new Error(String(readError));
              if (err.message?.includes('closed') || err.message?.includes('ended')) {
                logger.info(`📦 TTS source closed (${sourceChunkCount} chunks)`);
                break;
              }
              throw readError;
            }
          }
        } catch (error) {
          logger.debug('TTS reading completed', { error, chunksRead: sourceChunkCount });
        }
      };

      const readingPromise = readAudioChunks();

      return { stop: stop as () => void, readingPromise };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(err, { context: 'tts_stream', text: text.substring(0, 50) });
      onError?.(err);
      throw err;
    }
  }

  disconnect(ws: any, stop?: () => void): void {
    try {
      if (stop && typeof stop === 'function') {
        stop();
      }
      if (ws && typeof ws.disconnect === 'function') {
        ws.disconnect();
      }
    } catch (error) {
      logger.error(error, { context: 'tts_disconnect' });
    }
  }
}
