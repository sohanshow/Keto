'use client';

import { useRef, useCallback, useState, useEffect } from 'react';

// Dynamic import to avoid SSR issues
let MicVAD: any = null;

interface UseVADOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVADMisfire?: () => void;
  enabled?: boolean;
}

interface UseVADReturn {
  isVADActive: boolean;
  isSpeaking: boolean;
  startVAD: () => Promise<void>;
  stopVAD: () => void;
  pauseVAD: () => void;
  resumeVAD: () => void;
}

/**
 * Hook for Voice Activity Detection (VAD) using @ricky0123/vad-web
 * Detects when user starts and stops speaking for interruption handling.
 *
 * Under the hood, MicVAD runs the Silero VAD v5 ONNX model via ONNX Runtime
 * (WASM) inside an AudioWorklet. Each ~30ms frame gets a speech probability
 * score (0-1). Two thresholds control the state machine:
 *   positiveSpeechThreshold — frame must score >= this to be "speech"
 *   negativeSpeechThreshold — frame must score <= this to be "silence"
 */
export function useVAD(options: UseVADOptions = {}): UseVADReturn {
  const { onSpeechStart, onSpeechEnd, onVADMisfire, enabled = true } = options;

  const vadRef = useRef<any>(null);
  const [isVADActive, setIsVADActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // ── Callback refs ──────────────────────────────────────────────────
  // MicVAD.new() captures the callbacks at creation time. If the parent
  // component's handler identity changes on re-render, the VAD would
  // call the stale version. Using refs ensures the VAD always invokes
  // the *latest* callback.
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  const onVADMisfireRef = useRef(onVADMisfire);

  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current = onSpeechEnd; }, [onSpeechEnd]);
  useEffect(() => { onVADMisfireRef.current = onVADMisfire; }, [onVADMisfire]);

  // ── startVAD ──────────────────────────────────────────────────────
  // NOTE: We intentionally do NOT gate on `enabled` here. The caller
  // controls when to call startVAD() / stopVAD(). The `enabled` prop
  // is used below to auto-pause/resume the running VAD instance.
  const startVAD = useCallback(async () => {
    if (vadRef.current) {
      console.log('⚠️ VAD already active');
      return;
    }

    console.log('🎤 Initializing VAD...');

    // Dynamic import of VAD library (avoids SSR / bundling issues)
    if (!MicVAD) {
      const vadWeb = await import('@ricky0123/vad-web');
      MicVAD = vadWeb.MicVAD;
    }

    // Build the config once — callbacks go through refs so they're
    // always up-to-date, no matter when MicVAD fires them.
    const vadConfig = {
      onSpeechStart: () => {
        console.log('🗣️ VAD: Speech started');
        setIsSpeaking(true);
        onSpeechStartRef.current?.();
      },
      onSpeechEnd: (audio: Float32Array) => {
        console.log('🔇 VAD: Speech ended');
        setIsSpeaking(false);
        onSpeechEndRef.current?.(audio);
      },
      onVADMisfire: () => {
        console.log('⚠️ VAD: Misfire detected');
        setIsSpeaking(false);
        onVADMisfireRef.current?.();
      },
      // Sensitivity settings
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.35,
    };

    // Try CDN first, then fallback to local files
    const tryCDN = async () => {
      console.log('🌐 Trying to load VAD from CDN...');
      return await MicVAD.new({
        ...vadConfig,
        // Use CDN URLs — let MicVAD handle all ONNX Runtime setup internally.
        // Do NOT import/configure onnxruntime-web separately; it conflicts.
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/',
        baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };

    const tryLocal = async () => {
      console.log('📁 Falling back to local VAD files...');
      return await MicVAD.new(vadConfig);
    };

    try {
      // Small delay ensures AudioContext is ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      let vad;
      try {
        vad = await tryCDN();
      } catch (cdnError) {
        console.warn('⚠️ CDN VAD load failed, trying local:', cdnError);
        vad = await tryLocal();
      }

      vadRef.current = vad;
      vad.start();
      setIsVADActive(true);
      console.log('✅ VAD started successfully');
    } catch (error) {
      console.error('❌ Error initializing VAD:', error);
      throw error;
    }
  }, []); // No deps — callbacks go through refs, so startVAD is stable

  // ── Auto-pause / resume based on `enabled` ─────────────────────
  useEffect(() => {
    if (!vadRef.current) return;

    if (enabled) {
      vadRef.current.start();
    } else {
      vadRef.current.pause();
    }
  }, [enabled]);

  const stopVAD = useCallback(() => {
    if (vadRef.current) {
      console.log('🛑 Stopping VAD...');
      vadRef.current.destroy();
      vadRef.current = null;
      setIsVADActive(false);
      setIsSpeaking(false);
      console.log('✅ VAD stopped');
    }
  }, []);

  const pauseVAD = useCallback(() => {
    if (vadRef.current) {
      console.log('⏸️ Pausing VAD...');
      vadRef.current.pause();
    }
  }, []);

  const resumeVAD = useCallback(() => {
    if (vadRef.current) {
      console.log('▶️ Resuming VAD...');
      vadRef.current.start();
    }
  }, []);

  return {
    isVADActive,
    isSpeaking,
    startVAD,
    stopVAD,
    pauseVAD,
    resumeVAD,
  };
}
