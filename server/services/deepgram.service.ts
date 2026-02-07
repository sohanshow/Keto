import { config } from '../config.js';
import WebSocket from 'ws';
import { logger } from '../logger.js';

export interface FluxConfig {
  eotThreshold?: number; // 0.5-0.9, default 0.7
  eagerEotThreshold?: number; // 0.3-0.9, optional - enables EagerEndOfTurn events
  eotTimeoutMs?: number; // 500-10000, default 5000
}

export class DeepgramService {
  /**
   * Create a Deepgram Flux WebSocket connection for real-time STT
   * Using Flux model with end-of-turn detection for natural conversation flow
   * 
   * Flux requires:
   * - Endpoint: /v2/listen (not /v1/listen)
   * - Model: flux-general-en
   * - Audio format: linear16 at 16kHz (or containerized formats)
   * - Optimal chunk size: ~80ms (~2560 bytes at 16kHz)
   */
  createFluxConnection(fluxConfig?: FluxConfig): WebSocket {
    const {
      eotThreshold = 0.7,
      eagerEotThreshold,
      eotTimeoutMs = 5000,
    } = fluxConfig || {};

    // Build query parameters
    const params = new URLSearchParams({
      model: 'flux-general-en',
      encoding: 'linear16',
      sample_rate: '16000',
      eot_threshold: eotThreshold.toString(),
      eot_timeout_ms: eotTimeoutMs.toString(),
    });

    // Add eager_eot_threshold if provided (enables EagerEndOfTurn events)
    if (eagerEotThreshold !== undefined) {
      if (eagerEotThreshold > eotThreshold) {
        logger.warn(
          `⚠️ eager_eot_threshold (${eagerEotThreshold}) should be <= eot_threshold (${eotThreshold}). Using eot_threshold value.`
        );
        params.set('eager_eot_threshold', eotThreshold.toString());
      } else {
        params.set('eager_eot_threshold', eagerEotThreshold.toString());
      }
    }

    const wsUrl = `wss://api.deepgram.com/v2/listen?${params.toString()}`;

    logger.info('🎯 Creating Deepgram Flux connection', {
      eot_threshold: eotThreshold,
      eager_eot_threshold: eagerEotThreshold || 'disabled',
      eot_timeout_ms: eotTimeoutMs,
    });

    const connection = new WebSocket(wsUrl, [], {
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return connection;
  }
}
