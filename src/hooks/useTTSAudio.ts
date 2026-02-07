import { useRef, useCallback } from 'react';

/**
 * Hook to handle TTS audio playback from streaming audio chunks.
 * Converts PCM_F32LE audio chunks to playable audio via the Web Audio API.
 *
 * Interrupt-safe design:
 *   - stopAudio() sets isStoppedRef = true, disconnects + stops all sources,
 *     and clears the queue. Any late-arriving chunks are silently dropped.
 *   - resetStopFlag() sets isStoppedRef = false so new audio can be queued
 *     again (called when the first audio_chunk arrives after an interruption).
 */
export function useTTSAudio() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isStoppedRef = useRef(false);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.3;

      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = 1.0;

      gainNodeRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);

      dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
    }
    return audioContextRef.current;
  }, []);

  const getAudioLevel = useCallback((): number => {
    if (!analyserRef.current || !dataArrayRef.current || !isPlayingRef.current) {
      return 0;
    }

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);

    let sum = 0;
    const length = dataArrayRef.current.length;
    for (let i = 0; i < length; i++) {
      const normalized = dataArrayRef.current[i] / 255;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / length);

    return Math.min(1, rms * 2.5);
  }, []);

  const isPlaying = useCallback((): boolean => {
    return isPlayingRef.current;
  }, []);

  const scheduleAudioChunks = useCallback((audioContext: AudioContext, sampleRate: number) => {
    const currentTime = audioContext.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime;
    }

    let scheduledCount = 0;
    while (audioQueueRef.current.length > 0) {
      // If stopped mid-scheduling, bail out
      if (isStoppedRef.current) break;

      const float32Array = audioQueueRef.current.shift()!;
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < float32Array.length; i++) {
        channelData[i] = float32Array[i];
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current!);

      activeSourcesRef.current.push(source);
      source.start(nextStartTimeRef.current);

      source.onended = () => {
        const index = activeSourcesRef.current.indexOf(source);
        if (index > -1) {
          activeSourcesRef.current.splice(index, 1);
        }
      };

      const duration = audioBuffer.length / sampleRate;
      nextStartTimeRef.current += duration;
      scheduledCount++;

      isPlayingRef.current = true;
    }

    return scheduledCount;
  }, []);

  const startPlaybackMonitoring = useCallback(
    (audioContext: AudioContext, sampleRate: number) => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
        checkTimeoutRef.current = null;
      }

      const checkForMore = () => {
        // If stopped, don't reschedule
        if (isStoppedRef.current) return;

        const currentTime = audioContext.currentTime;

        if (audioQueueRef.current.length > 0) {
          scheduleAudioChunks(audioContext, sampleRate);
          checkTimeoutRef.current = setTimeout(checkForMore, 50);
        } else if (currentTime >= nextStartTimeRef.current - 0.1) {
          isPlayingRef.current = false;
          nextStartTimeRef.current = 0;
          checkTimeoutRef.current = null;
          console.log('🔇 Audio playback completed');
        } else {
          checkTimeoutRef.current = setTimeout(checkForMore, 50);
        }
      };
      checkTimeoutRef.current = setTimeout(checkForMore, 50);
    },
    [scheduleAudioChunks]
  );

  const playQueuedAudio = useCallback(
    (audioContext: AudioContext, sampleRate: number) => {
      const scheduledCount = scheduleAudioChunks(audioContext, sampleRate);

      if (scheduledCount > 0 && !checkTimeoutRef.current) {
        startPlaybackMonitoring(audioContext, sampleRate);
      }
    },
    [scheduleAudioChunks, startPlaybackMonitoring]
  );

  const queueAudioChunk = useCallback(
    async (audioData: string, sampleRate: number = 22050) => {
      // If we've been stopped (interrupted), silently drop this chunk.
      // The stop flag will be reset by resetStopFlag() when recovery happens.
      if (isStoppedRef.current) {
        return;
      }

      const audioContext = getAudioContext();

      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const float32Array = new Float32Array(bytes.buffer);

      audioQueueRef.current.push(float32Array);

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (!isPlayingRef.current) {
        playQueuedAudio(audioContext, sampleRate);
      }
    },
    [getAudioContext, playQueuedAudio]
  );

  /**
   * Immediately stop all audio playback and clear the queue.
   * Sets isStoppedRef = true so any late-arriving chunks are dropped.
   */
  const stopAudio = useCallback(() => {
    console.log(`🛑 Stopping ${activeSourcesRef.current.length} active audio sources`);

    // Mark as stopped to prevent new chunks from being queued
    isStoppedRef.current = true;

    // Stop and disconnect all active audio sources immediately.
    // disconnect() first prevents scheduled-but-not-yet-playing sources
    // from ever producing output; stop(0) halts currently-playing ones.
    activeSourcesRef.current.forEach((source) => {
      try {
        source.disconnect();
        source.stop(0);
      } catch {
        // Errors are expected for sources that haven't started yet —
        // disconnect() will still prevent them from playing.
      }
    });
    activeSourcesRef.current = [];

    // Clear the queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;

    // Clear monitoring timeout
    if (checkTimeoutRef.current) {
      clearTimeout(checkTimeoutRef.current);
      checkTimeoutRef.current = null;
    }

    console.log('🛑 TTS audio stopped and queue cleared');
  }, []);

  /**
   * Reset the stop flag so new audio chunks can be queued again.
   * Called when the first audio_chunk arrives after an interruption.
   */
  const resetStopFlag = useCallback(() => {
    isStoppedRef.current = false;
  }, []);

  return {
    queueAudioChunk,
    stopAudio,
    resetStopFlag,
    getAudioLevel,
    isPlaying,
  };
}
