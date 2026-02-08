'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Volume2, MessageSquare, Zap } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { Message, IncomingMessage } from '@/types';

interface BanterArenaProps {
  userName: string;
  agentConfig: {
    voiceId: string;
    voiceName: string;
    systemPrompt: string;
    personality: {
      humor: number;
      formality: number;
      traits: string[];
    };
  };
}

export default function BanterArena({ userName, agentConfig }: BanterArenaProps) {
  // ─── Voice agent state ───────────────────────────────────────────
  const [isActive, setIsActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Use refs to avoid stale closure issues in callbacks
  const isActiveRef = useRef(false);
  const isReadyRef = useRef(false);
  // Tracks whether we interrupted TTS — used for recovery when new audio arrives
  const hasInterruptedRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  const { queueAudioChunk, stopAudio, resetStopFlag, getAudioLevel, isPlaying } = useTTSAudio();

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((data: IncomingMessage) => {
    switch (data.type) {
      case 'ready':
        console.log('✅ Server ready');
        setIsReady(true);
        setError(null);
        break;

      case 'transcript':
        if (data.speaker === 'user') {
          setCurrentUserText(data.transcript || '');
          if (!data.isPartial && data.transcript) {
            const newMessage: Message = {
              id: Date.now().toString(),
              speaker: 'user',
              text: data.transcript,
              timestamp: new Date(),
              isPartial: false,
            };
            setMessages((prev) => [...prev, newMessage]);
            setCurrentUserText('');
          }
        }
        break;

      case 'response':
        if (data.isPartial) {
          setCurrentAgentText((prev) => prev + ' ' + (data.text || ''));
        } else if (data.text) {
          const newMessage: Message = {
            id: Date.now().toString(),
            speaker: 'agent',
            text: data.text,
            timestamp: new Date(),
            isPartial: false,
          };
          setMessages((prev) => [...prev, newMessage]);
          setCurrentAgentText('');
        }
        break;

      case 'audio_chunk':
        if (data.audio && data.sampleRate) {
          if (hasInterruptedRef.current) {
            console.log('📦 New audio after interruption — resetting for new playback');
            hasInterruptedRef.current = false;
            resetStopFlag();
          }
          queueAudioChunk(data.audio, data.sampleRate);
        }
        break;

      case 'tts_stopped':
        console.log('🛑 TTS stopped by server');
        stopAudio();
        break;

      case 'stopped':
        console.log('🛑 Session stopped');
        setIsActive(false);
        setIsReady(false);
        break;

      case 'error':
        console.error('❌ Server error:', data.message);
        setError(data.message || 'Unknown error');
        break;
    }
  }, [queueAudioChunk, stopAudio, resetStopFlag]);

  const { isConnected, connect, sendMessage, disconnect } = useWebSocket(handleMessage);

  // Audio capture callback - use refs to avoid stale closure
  const onAudioChunk = useCallback(
    (base64Audio: string) => {
      if (isActiveRef.current && isReadyRef.current) {
        sendMessage({ type: 'audio', audio: base64Audio });
      }
    },
    [sendMessage]
  );

  const { startRecording, stopRecording } = useAudioCapture(onAudioChunk);

  // ─── VAD: Handle user interruptions ─────────────────────────────
  const handleSpeechStart = useCallback(() => {
    if (!isActiveRef.current) return;

    if (isPlaying()) {
      console.log('🗣️ User started speaking — stopping TTS and sending interrupt');
      hasInterruptedRef.current = true;
      stopAudio();
      sendMessage({ type: 'interrupt' });
    }
  }, [stopAudio, sendMessage, isPlaying]);

  const { startVAD, stopVAD, isSpeaking } = useVAD({
    onSpeechStart: handleSpeechStart,
    enabled: isActive,
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentUserText, currentAgentText]);

  // Audio level animation
  useEffect(() => {
    const updateLevel = () => {
      if (isPlaying()) {
        setAudioLevel(getAudioLevel());
      } else {
        setAudioLevel(0);
      }
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, getAudioLevel, isPlaying]);

  // ─── Voice session controls ──────────────────────────────────────
  const handleStart = async () => {
    try {
      setError(null);
      hasInterruptedRef.current = false;
      resetStopFlag();

      await connect();
      await startRecording();
      await startVAD();

      // Send start message with the user's name and agent config
      sendMessage({
        type: 'start',
        userName,
        voiceId: agentConfig?.voiceId,
        systemPrompt: agentConfig?.systemPrompt,
      });
      setIsActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      setError('Failed to start voice session. Please check your microphone permissions.');
    }
  };

  const handleStop = () => {
    sendMessage({ type: 'stop' });
    stopRecording();
    stopVAD();
    stopAudio();
    disconnect();
    setIsActive(false);
    setIsReady(false);
    setCurrentUserText('');
    setCurrentAgentText('');
    hasInterruptedRef.current = false;
  };

  // ─── Auto-start on mount ──────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isActive) {
        handleStart();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (isActiveRef.current) {
        stopAudio();
        disconnect();
      }
    };
  }, [stopAudio, disconnect]);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Subtle ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[180px] transition-opacity duration-1000"
          style={{
            background: isActive ? 'rgba(212, 168, 83, 0.04)' : 'transparent',
          }}
        />
      </div>

      {/* Voice Orb */}
      <div className="relative z-10 mb-8">
        {/* Outer pulse rings */}
        {isActive && (
          <>
            <div
              className="absolute inset-0 rounded-full bg-gold/10 animate-pulse-ring"
              style={{ transform: `scale(${1.2 + audioLevel * 0.4})` }}
            />
            <div
              className="absolute inset-0 rounded-full bg-gold/5 animate-pulse-ring"
              style={{
                animationDelay: '0.7s',
                transform: `scale(${1.1 + audioLevel * 0.2})`,
              }}
            />
          </>
        )}

        {/* Main button */}
        <button
          onClick={isActive ? handleStop : handleStart}
          className={`
            relative w-24 h-24 sm:w-28 sm:h-28 rounded-full
            flex items-center justify-center
            transition-all duration-500 ease-out
            ${isActive ? 'bg-charcoal' : 'bg-charcoal hover:bg-graphite'}
            border ${isActive ? 'border-gold/30' : 'border-white/5 hover:border-gold/20'}
            group
          `}
          style={{
            boxShadow: isActive
              ? `0 0 ${30 + audioLevel * 50}px rgba(212, 168, 83, ${0.15 + audioLevel * 0.2})`
              : '0 0 0 rgba(0,0,0,0)',
          }}
        >
          {isActive ? (
            <MicOff className="w-8 h-8 sm:w-10 sm:h-10 text-gold/80 group-hover:text-gold transition-colors" />
          ) : (
            <Mic className="w-8 h-8 sm:w-10 sm:h-10 text-white/40 group-hover:text-gold transition-colors" />
          )}

          {/* Speaking indicator */}
          {isSpeaking && (
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-gold px-3 py-1 rounded-full">
              <span className="text-xs font-medium text-void">Speaking</span>
            </div>
          )}
        </button>
      </div>

      {/* Status indicators */}
      <div className="relative z-10 flex items-center gap-4 mb-6">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border ${
            isConnected ? 'border-gold/20 text-gold/80' : 'border-white/5 text-white/30'
          }`}
        >
          <Zap className="w-3 h-3" />
          <span className="text-xs font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border ${
            isPlaying() ? 'border-gold/20 text-gold/80' : 'border-white/5 text-white/30'
          }`}
        >
          <Volume2 className="w-3 h-3" />
          <span className="text-xs font-medium">{isPlaying() ? 'Playing' : 'Silent'}</span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="relative z-10 mb-6 px-5 py-3 bg-charcoal border border-red-500/20 rounded-lg text-red-400 text-sm max-w-md text-center">
          {error}
        </div>
      )}

      {/* Transcript area */}
      <div className="relative z-10 w-full max-w-2xl bg-charcoal/50 border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
          <MessageSquare className="w-4 h-4 text-gold/60" />
          <h2 className="font-sans text-sm font-medium text-white/60">Conversation</h2>
        </div>

        <div className="h-64 overflow-y-auto space-y-3 pr-2">
          {messages.length === 0 && !currentUserText && !currentAgentText && (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/20 text-sm text-center">
                {isActive ? "I'm listening... speak naturally" : 'Press the mic to start chatting'}
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`
                  max-w-[80%] px-4 py-2.5 rounded-xl
                  ${
                    message.speaker === 'user'
                      ? 'bg-gold/10 text-white/90 rounded-br-sm'
                      : 'bg-white/5 text-white/80 rounded-bl-sm'
                  }
                `}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
                <span className="text-xs text-white/30 mt-1 block">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {/* Current user text (partial) */}
          {currentUserText && (
            <div className="flex justify-end">
              <div className="max-w-[80%] px-4 py-2.5 rounded-xl bg-gold/5 text-white/50 rounded-br-sm border border-gold/10 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentUserText}</p>
              </div>
            </div>
          )}

          {/* Current agent text (partial) */}
          {currentAgentText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-2.5 rounded-xl bg-white/[0.02] text-white/50 rounded-bl-sm border border-white/5 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentAgentText}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer hint */}
      <p className="relative z-10 mt-6 text-white/20 text-xs text-center">
        Speak naturally • Interrupt anytime • Click mic to stop
      </p>
    </div>
  );
}
