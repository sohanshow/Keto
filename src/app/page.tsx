'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Volume2, MessageSquare, Zap, Sparkles } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { Message, IncomingMessage } from '@/types';

export default function VoiceAgentPage() {
  const [isActive, setIsActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Use refs to avoid stale closure issues in audio callback
  const isActiveRef = useRef(false);
  const isReadyRef = useRef(false);
  
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
        if (data.audio) {
          queueAudioChunk(data.audio, data.sampleRate || 22050);
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
  }, [queueAudioChunk, stopAudio]);

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

  // VAD for interruption handling
  const { startVAD, stopVAD, isSpeaking } = useVAD({
    onSpeechStart: () => {
      if (isPlaying()) {
        console.log('⚡ User speaking while TTS playing - sending interrupt');
        sendMessage({ type: 'interrupt' });
        stopAudio();
      }
    },
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

  // Start voice session
  const handleStart = async () => {
    try {
      setError(null);
      resetStopFlag();
      
      await connect();
      await startRecording();
      await startVAD();
      
      sendMessage({ type: 'start' });
      setIsActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      setError('Failed to start voice session. Please check your microphone permissions.');
    }
  };

  // Stop voice session
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
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Header */}
      <div className="text-center mb-8 animate-[fadeIn_0.6s_ease-out]">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-6 h-6 text-accent" />
          <h1 className="font-display text-4xl sm:text-5xl font-bold bg-gradient-to-r from-accent via-mint to-coral bg-clip-text text-transparent">
            Voice Agent
          </h1>
          <Sparkles className="w-6 h-6 text-coral" />
        </div>
        <p className="text-white/60 font-sans text-sm sm:text-base">
          Press the mic to start a conversation
        </p>
      </div>

      {/* Voice Orb */}
      <div className="relative mb-8">
        {/* Outer rings */}
        {isActive && (
          <>
            <div 
              className="absolute inset-0 rounded-full bg-accent/20 animate-pulse-ring"
              style={{ transform: `scale(${1.3 + audioLevel * 0.5})` }}
            />
            <div 
              className="absolute inset-0 rounded-full bg-mint/20 animate-pulse-ring"
              style={{ 
                animationDelay: '0.5s',
                transform: `scale(${1.2 + audioLevel * 0.3})` 
              }}
            />
          </>
        )}
        
        {/* Main button */}
        <button
          onClick={isActive ? handleStop : handleStart}
          className={`
            relative w-32 h-32 sm:w-40 sm:h-40 rounded-full
            flex items-center justify-center
            transition-all duration-500 ease-out
            ${isActive 
              ? 'bg-gradient-to-br from-accent/30 to-mint/30 animate-breathe' 
              : 'bg-gradient-to-br from-deep to-midnight hover:from-accent/20 hover:to-mint/20'
            }
            border-2 ${isActive ? 'border-accent/50' : 'border-white/10 hover:border-accent/30'}
            shadow-2xl
            group
          `}
          style={{
            boxShadow: isActive 
              ? `0 0 ${40 + audioLevel * 60}px rgba(0, 217, 255, ${0.4 + audioLevel * 0.4})` 
              : undefined
          }}
        >
          {isActive ? (
            <MicOff className="w-12 h-12 sm:w-16 sm:h-16 text-coral group-hover:scale-110 transition-transform" />
          ) : (
            <Mic className="w-12 h-12 sm:w-16 sm:h-16 text-accent group-hover:scale-110 transition-transform" />
          )}
          
          {/* Speaking indicator */}
          {isSpeaking && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-mint px-3 py-1 rounded-full">
              <span className="text-xs font-medium text-midnight">Speaking</span>
            </div>
          )}
        </button>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-6 mb-8">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full glass ${isConnected ? 'text-mint' : 'text-white/40'}`}>
          <Zap className="w-4 h-4" />
          <span className="text-sm font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full glass ${isPlaying() ? 'text-accent' : 'text-white/40'}`}>
          <Volume2 className="w-4 h-4" />
          <span className="text-sm font-medium">{isPlaying() ? 'Playing' : 'Silent'}</span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-6 px-6 py-3 bg-coral/20 border border-coral/30 rounded-xl text-coral text-sm max-w-md text-center">
          {error}
        </div>
      )}

      {/* Transcript area */}
      <div className="w-full max-w-2xl glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/10">
          <MessageSquare className="w-5 h-5 text-accent" />
          <h2 className="font-display text-lg font-semibold">Conversation</h2>
        </div>

        <div className="h-64 overflow-y-auto space-y-4 pr-2">
          {messages.length === 0 && !currentUserText && !currentAgentText && (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/30 text-center">
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
                  max-w-[80%] px-4 py-3 rounded-2xl
                  ${message.speaker === 'user'
                    ? 'bg-accent/20 text-white rounded-br-md'
                    : 'bg-white/10 text-white/90 rounded-bl-md'
                  }
                `}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
                <span className="text-xs text-white/40 mt-1 block">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {/* Current user text (partial) */}
          {currentUserText && (
            <div className="flex justify-end">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-accent/10 text-white/70 rounded-br-md border border-accent/20 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentUserText}</p>
              </div>
            </div>
          )}

          {/* Current agent text (partial) */}
          {currentAgentText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-white/5 text-white/70 rounded-bl-md border border-white/10 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentAgentText}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer hint */}
      <p className="mt-6 text-white/30 text-xs text-center">
        Speak naturally • Interrupt anytime • Click mic to stop
      </p>
    </main>
  );
}
