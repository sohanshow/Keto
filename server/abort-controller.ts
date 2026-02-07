import { logger } from './logger.js';

/**
 * AbortController for managing TTS stream cancellation
 * Provides clean, immediate termination of TTS-related operations
 */
export class TTSAbortController {
  private aborted: boolean = false;
  private abortCallbacks: Set<() => void> = new Set();

  isAborted(): boolean {
    return this.aborted;
  }

  onAbort(callback: () => void): () => void {
    this.abortCallbacks.add(callback);
    return () => {
      this.abortCallbacks.delete(callback);
    };
  }

  abort(): void {
    if (this.aborted) return;

    logger.info('🛑 AbortController: Aborting TTS operations');
    this.aborted = true;

    const callbacks = Array.from(this.abortCallbacks);
    callbacks.forEach((callback) => {
      try {
        callback();
      } catch {
        // Errors expected during abort
      }
    });

    this.abortCallbacks.clear();
  }

  reset(): void {
    this.aborted = false;
    this.abortCallbacks.clear();
  }
}

/**
 * Session-level abort manager
 * Manages abort controllers and cleanup for a session
 */
export class SessionAbortManager {
  private ttsController: TTSAbortController;
  private llmController: TTSAbortController;
  private cleanupCallbacks: Set<() => void> = new Set();

  constructor() {
    this.ttsController = new TTSAbortController();
    this.llmController = new TTSAbortController();
  }

  getTTSController(): TTSAbortController {
    return this.ttsController;
  }

  getLLMController(): TTSAbortController {
    return this.llmController;
  }

  registerCleanup(callback: () => void): void {
    this.cleanupCallbacks.add(callback);
  }

  abortAll(): void {
    logger.info('🛑 SessionAbortManager: Aborting all operations');

    this.ttsController.abort();
    this.llmController.abort();

    this.cleanupCallbacks.forEach((callback) => {
      try {
        callback();
      } catch {
        // Errors expected during cleanup
      }
    });
    this.cleanupCallbacks.clear();
  }

  reset(): void {
    this.ttsController.reset();
    this.llmController.reset();
    this.cleanupCallbacks.clear();
  }
}
