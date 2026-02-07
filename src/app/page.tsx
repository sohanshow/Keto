'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Volume2, MessageSquare, Zap } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { Message, IncomingMessage } from '@/types';
import LandingScreen from '@/components/LandingScreen';

type AppScreen = 'landing' | 'agent';

export default function VoiceAgentPage() {
  // ─── App-level state ─────────────────────────────────────────────
  const [screen, setScreen] = useState<AppScreen>('landing');
  const [userName, setUserName] = useState('');

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
  const userNameRef = useRef('');
  // Tracks whether we interrupted TTS — used for recovery when new audio arrives
  const hasInterruptedRef = useRef(false);
  
  // Keep refs in sync with state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  
  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

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
        // Handle streaming TTS audio chunks
        if (data.audio && data.sampleRate) {
          // ── Interrupt recovery ──
          // After an interruption, isStoppedRef is true (set by stopAudio).
          // We need to reset it when the FIRST new audio chunk arrives so
          // the new response can actually be heard.
          if (hasInterruptedRef.current) {
            console.log('📦 New audio after interruption — resetting for new playback');
            hasInterruptedRef.current = false;
            resetStopFlag(); // sets isStoppedRef = false → audio can be queued again
          }

          queueAudioChunk(data.audio, data.sampleRate);
        }
        break;

      case 'tts_stopped':
        // Backend confirmed abort — second safety net to kill any audio
        // that arrived between the client-side stopAudio() and backend abort.
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
  // When Silero VAD detects speech while TTS is playing, we:
  //   1. Mark that we interrupted (so audio_chunk recovery knows)
  //   2. Stop TTS audio playback immediately (client-side)
  //   3. Send interrupt message to backend to abort LLM + TTS streams
  const handleSpeechStart = useCallback(() => {
    // Guard: only interrupt when we're in an active recording session
    if (!isActiveRef.current) return;

    // Only interrupt if TTS is actually playing — otherwise the user
    // is just speaking normally (e.g. giving a new utterance).
    if (isPlaying()) {
      console.log('🗣️ User started speaking — stopping TTS and sending interrupt');
      hasInterruptedRef.current = true;

      // Stop TTS audio playback immediately (client-side) — clears queue
      // and sets isStoppedRef = true so late-arriving chunks are dropped
      stopAudio();

      // Tell backend to abort TTS/LLM streams
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

  // ─── Landing flow ────────────────────────────────────────────────
  const handleNameSubmit = (name: string) => {
    setUserName(name);
    setScreen('agent');
  };

  // ─── Voice session controls ──────────────────────────────────────
  const handleStart = async () => {
    try {
      setError(null);
      hasInterruptedRef.current = false;
      resetStopFlag();
      
      await connect();
      await startRecording();
      await startVAD();
      
      // Send start message with the user's name
      sendMessage({ type: 'start', userName });
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

  // ─── Landing Screen ──────────────────────────────────────────────
  if (screen === 'landing') {
    return <LandingScreen onNameSubmit={handleNameSubmit} />;
  }

  // ─── Voice Agent Screen ──────────────────────────────────────────
  return (
    <main className="min-h-screen bg-void flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Subtle ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[180px] transition-opacity duration-1000"
          style={{ 
            background: isActive ? 'rgba(212, 168, 83, 0.04)' : 'transparent',
          }}
        />
      </div>

      {/* Header */}
      <div 
        className="relative z-10 text-center mb-10"
        style={{ animation: 'fadeIn 0.6s ease-out' }}
      >
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mb-2">
          Voice Agent
        </h1>
        <p className="text-white/40 font-sans text-sm">
          Hey <span className="text-gold">{userName}</span> — press the mic to start
        </p>
      </div>

      {/* Voice Orb */}
      <div className="relative z-10 mb-10">
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
                transform: `scale(${1.1 + audioLevel * 0.2})` 
              }}
            />
          </>
        )}
        
        {/* Main button */}
        <button
          onClick={isActive ? handleStop : handleStart}
          className={`
            relative w-28 h-28 sm:w-36 sm:h-36 rounded-full
            flex items-center justify-center
            transition-all duration-500 ease-out
            ${isActive 
              ? 'bg-charcoal' 
              : 'bg-charcoal hover:bg-graphite'
            }
            border ${isActive ? 'border-gold/30' : 'border-white/5 hover:border-gold/20'}
            group
          `}
          style={{
            boxShadow: isActive 
              ? `0 0 ${30 + audioLevel * 50}px rgba(212, 168, 83, ${0.15 + audioLevel * 0.2})` 
              : '0 0 0 rgba(0,0,0,0)'
          }}
        >
          {isActive ? (
            <MicOff className="w-10 h-10 sm:w-12 sm:h-12 text-gold/80 group-hover:text-gold transition-colors" />
          ) : (
            <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-white/40 group-hover:text-gold transition-colors" />
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
      <div className="relative z-10 flex items-center gap-4 mb-8">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border ${isConnected ? 'border-gold/20 text-gold/80' : 'border-white/5 text-white/30'}`}>
          <Zap className="w-3 h-3" />
          <span className="text-xs font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border ${isPlaying() ? 'border-gold/20 text-gold/80' : 'border-white/5 text-white/30'}`}>
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

        <div className="h-56 overflow-y-auto space-y-3 pr-2">
          {messages.length === 0 && !currentUserText && !currentAgentText && (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/20 text-sm text-center">
                {isActive 
                  ? "I'm listening... speak naturally" 
                  : 'Start speaking to begin the conversation'
                }
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
                  ${message.speaker === 'user'
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
    </main>
  );
}
