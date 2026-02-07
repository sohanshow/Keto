'use client';

import { useRef, useCallback, useState } from 'react';

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
 * Detects when user starts and stops speaking for interruption handling
 */
export function useVAD(options: UseVADOptions = {}): UseVADReturn {
  const { onSpeechStart, onSpeechEnd, onVADMisfire, enabled = true } = options;

  const vadRef = useRef<any>(null);
  const [isVADActive, setIsVADActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const startVAD = useCallback(async () => {
    if (!enabled || vadRef.current) {
      console.log('⚠️ VAD already active or disabled');
      return;
    }

    console.log('🎤 Initializing VAD...');

    // Dynamic import of VAD library
    if (!MicVAD) {
      const vadWeb = await import('@ricky0123/vad-web');
      MicVAD = vadWeb.MicVAD;
    }

    // Configure ONNX Runtime for WASM
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
      ort.env.wasm.numThreads = 1;
    } catch (e) {
      console.warn('ONNX Runtime config warning:', e);
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const vad = await MicVAD.new({
        onSpeechStart: () => {
          console.log('🗣️ VAD: Speech started');
          setIsSpeaking(true);
          onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          console.log('🔇 VAD: Speech ended');
          setIsSpeaking(false);
          onSpeechEnd?.(audio);
        },
        onVADMisfire: () => {
          console.log('⚠️ VAD: Misfire detected');
          setIsSpeaking(false);
          onVADMisfire?.();
        },
        // Use CDN URLs for model files
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/',
        baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        // Sensitivity settings
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.35,
      });

      vadRef.current = vad;
      vad.start();
      setIsVADActive(true);
      console.log('✅ VAD started successfully');
    } catch (error) {
      console.error('❌ Error initializing VAD:', error);
      throw error;
    }
  }, [enabled, onSpeechStart, onSpeechEnd, onVADMisfire]);

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
