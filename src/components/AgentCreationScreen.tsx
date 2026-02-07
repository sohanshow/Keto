'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Sparkles, Volume2, Wand2 } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { IncomingMessage } from '@/types';
import { VOICES, DEFAULT_VOICE_ID, Voice } from '@/data/voices';

interface AgentConfig {
  voiceId: string;
  voiceName: string;
  systemPrompt: string;
  personality: {
    humor: number;
    formality: number;
    traits: string[];
  };
}

interface CreationMessage {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

type CreationPhase = 'voice' | 'personality' | 'complete';

interface AgentCreationScreenProps {
  userName: string;
  onComplete: (config: AgentConfig) => void;
}

const STORAGE_KEY = 'keto_agent_config';

export default function AgentCreationScreen({ userName, onComplete }: AgentCreationScreenProps) {
  // ─── State ─────────────────────────────────────────────────────────
  const [isActive, setIsActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<CreationMessage[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [phase, setPhase] = useState<CreationPhase>('voice');
  
  // Agent config being built
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    voiceId: DEFAULT_VOICE_ID,
    voiceName: 'Tessa',
    systemPrompt: '',
    personality: {
      humor: 5,
      formality: 5,
      traits: [],
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  const isReadyRef = useRef(false);
  const hasInterruptedRef = useRef(false);
  const currentVoiceIdRef = useRef(DEFAULT_VOICE_ID);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    currentVoiceIdRef.current = agentConfig.voiceId;
  }, [agentConfig.voiceId]);

  const { queueAudioChunk, stopAudio, resetStopFlag, getAudioLevel, isPlaying } = useTTSAudio();

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((data: IncomingMessage) => {
    switch (data.type) {
      case 'ready':
        console.log('✅ Server ready for agent creation');
        setIsReady(true);
        setError(null);
        break;

      case 'transcript':
        if (data.speaker === 'user') {
          setCurrentUserText(data.transcript || '');
          if (!data.isPartial && data.transcript) {
            const newMessage: CreationMessage = {
              id: Date.now().toString(),
              speaker: 'user',
              text: data.transcript,
              timestamp: new Date(),
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
          const newMessage: CreationMessage = {
            id: Date.now().toString(),
            speaker: 'agent',
            text: data.text,
            timestamp: new Date(),
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

    // Handle agent creation specific messages
    if (data.agentCreation) {
      const { type, voiceId, voiceName, humor, formality, traits, systemPrompt, phase: serverPhase } = data.agentCreation;

      // Update phase from server (source of truth)
      if (serverPhase) {
        console.log('📍 Phase update from server:', serverPhase);
        setPhase(serverPhase);
      }

      // Handle voice selection (only during voice phase)
      if (type === 'voice_selected' && voiceId) {
        console.log('🎤 Voice selected:', voiceName, voiceId);
        setAgentConfig((prev) => ({
          ...prev,
          voiceId,
          voiceName: voiceName || prev.voiceName,
        }));
      }

      // Handle personality updates
      if (type === 'personality_set') {
        console.log('✨ Personality updated', { humor, formality, traits });
        setAgentConfig((prev) => ({
          ...prev,
          personality: {
            humor: humor ?? prev.personality.humor,
            formality: formality ?? prev.personality.formality,
            traits: traits ?? prev.personality.traits,
          },
        }));
      }

      // Handle completion
      if (type === 'creation_complete' && systemPrompt) {
        console.log('🎉 Agent creation complete!');
        setPhase('complete');
        const finalConfig = {
          ...agentConfig,
          voiceId: voiceId || agentConfig.voiceId,
          voiceName: voiceName || agentConfig.voiceName,
          systemPrompt,
          personality: {
            humor: humor ?? agentConfig.personality.humor,
            formality: formality ?? agentConfig.personality.formality,
            traits: traits ?? agentConfig.personality.traits,
          },
        };
        setAgentConfig(finalConfig);
        
        // Save to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalConfig));
        
        // Wait a moment then complete
        setTimeout(() => {
          onComplete(finalConfig);
        }, 2000);
      }
    }
  }, [queueAudioChunk, stopAudio, resetStopFlag, agentConfig, onComplete]);

  const { isConnected, connect, sendMessage, disconnect } = useWebSocket(handleMessage);

  // Audio capture callback
  const onAudioChunk = useCallback(
    (base64Audio: string) => {
      if (isActiveRef.current && isReadyRef.current) {
        sendMessage({ type: 'audio', audio: base64Audio });
      }
    },
    [sendMessage]
  );

  const { startRecording, stopRecording } = useAudioCapture(onAudioChunk);

  // VAD for interruptions
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

  // ─── Start agent creation session ──────────────────────────────────
  const handleStart = async () => {
    try {
      setError(null);
      hasInterruptedRef.current = false;
      resetStopFlag();

      await connect();
      await startRecording();
      await startVAD();

      // Send start message for agent creation mode
      sendMessage({
        type: 'start',
        userName,
        mode: 'agent_creation',
        voiceId: agentConfig.voiceId,
        voices: VOICES,
      });
      setIsActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      setError('Failed to start. Please check your microphone permissions.');
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

  // Get current voice info
  const currentVoice = VOICES.find((v) => v.id === agentConfig.voiceId);

  return (
    <main className="min-h-screen bg-void flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-[200px] transition-all duration-1000"
          style={{
            background: isActive
              ? 'radial-gradient(circle, rgba(147, 51, 234, 0.08) 0%, rgba(212, 168, 83, 0.04) 100%)'
              : 'rgba(147, 51, 234, 0.03)',
          }}
        />
      </div>

      {/* Header */}
      <div
        className="relative z-10 text-center mb-8"
        style={{ animation: 'fadeIn 0.6s ease-out' }}
      >
        <div className="flex items-center justify-center gap-3 mb-3">
          <Wand2 className="w-6 h-6 text-purple-400" />
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
            Create Your Agent
          </h1>
        </div>
        <p className="text-white/40 font-sans text-sm max-w-md mx-auto">
          Let&apos;s build your perfect AI voice agent together, {userName}
        </p>
      </div>

      {/* Phase indicator */}
      <div className="relative z-10 flex items-center gap-2 mb-8">
        <div
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
            phase === 'voice'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : 'bg-white/5 text-white/40 border border-white/10'
          }`}
        >
          Voice
        </div>
        <div className="w-8 h-px bg-white/10" />
        <div
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
            phase === 'personality'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : phase === 'complete'
              ? 'bg-white/5 text-white/40 border border-white/10'
              : 'bg-white/5 text-white/20 border border-white/5'
          }`}
        >
          Personality
        </div>
        <div className="w-8 h-px bg-white/10" />
        <div
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
            phase === 'complete'
              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
              : 'bg-white/5 text-white/20 border border-white/5'
          }`}
        >
          {phase === 'complete' ? '✓ Done' : 'Ready'}
        </div>
      </div>

      {/* Current voice indicator */}
      {currentVoice && (
        <div
          className="relative z-10 mb-6 px-4 py-2 rounded-lg bg-charcoal/50 border border-white/10"
          style={{ animation: 'fadeInUp 0.4s ease-out' }}
        >
          <div className="flex items-center gap-3">
            <Volume2 className="w-4 h-4 text-purple-400" />
            <div>
              <span className="text-white/60 text-xs">Current voice: </span>
              <span className="text-white font-medium text-sm">{currentVoice.name}</span>
              <span className="text-white/40 text-xs ml-2">({currentVoice.gender}, {currentVoice.type})</span>
            </div>
          </div>
        </div>
      )}

      {/* Voice Orb */}
      <div className="relative z-10 mb-8">
        {/* Outer pulse rings */}
        {isActive && (
          <>
            <div
              className="absolute inset-0 rounded-full bg-purple-500/10 animate-pulse-ring"
              style={{ transform: `scale(${1.2 + audioLevel * 0.4})` }}
            />
            <div
              className="absolute inset-0 rounded-full bg-purple-500/5 animate-pulse-ring"
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
          disabled={phase === 'complete'}
          className={`
            relative w-28 h-28 sm:w-36 sm:h-36 rounded-full
            flex items-center justify-center
            transition-all duration-500 ease-out
            ${phase === 'complete' 
              ? 'bg-green-900/30 border-green-500/30 cursor-default'
              : isActive
              ? 'bg-charcoal'
              : 'bg-charcoal hover:bg-graphite'
            }
            border ${isActive ? 'border-purple-500/30' : 'border-white/5 hover:border-purple-500/20'}
            group
          `}
          style={{
            boxShadow: isActive
              ? `0 0 ${30 + audioLevel * 50}px rgba(147, 51, 234, ${0.15 + audioLevel * 0.2})`
              : '0 0 0 rgba(0,0,0,0)',
          }}
        >
          {phase === 'complete' ? (
            <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-green-400" />
          ) : isActive ? (
            <MicOff className="w-10 h-10 sm:w-12 sm:h-12 text-purple-400 group-hover:text-purple-300 transition-colors" />
          ) : (
            <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-white/40 group-hover:text-purple-400 transition-colors" />
          )}

          {/* Speaking indicator */}
          {isSpeaking && (
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-purple-500 px-3 py-1 rounded-full">
              <span className="text-xs font-medium text-white">Speaking</span>
            </div>
          )}
        </button>
      </div>

      {/* Status */}
      <div className="relative z-10 flex items-center gap-4 mb-6">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border ${
            isConnected ? 'border-purple-500/20 text-purple-400' : 'border-white/5 text-white/30'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-purple-400' : 'bg-white/20'}`} />
          <span className="text-xs font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="relative z-10 mb-6 px-5 py-3 bg-charcoal border border-red-500/20 rounded-lg text-red-400 text-sm max-w-md text-center">
          {error}
        </div>
      )}

      {/* Conversation area */}
      <div className="relative z-10 w-full max-w-2xl bg-charcoal/50 border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h2 className="font-sans text-sm font-medium text-white/60">Agent Creation</h2>
        </div>

        <div className="h-64 overflow-y-auto space-y-3 pr-2">
          {messages.length === 0 && !currentUserText && !currentAgentText && (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/20 text-sm text-center max-w-sm">
                {isActive
                  ? "I'm listening... tell me what kind of voice you'd like"
                  : 'Press the mic to start creating your agent'}
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
                      ? 'bg-purple-500/10 text-white/90 rounded-br-sm border border-purple-500/20'
                      : 'bg-white/5 text-white/80 rounded-bl-sm'
                  }
                `}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
              </div>
            </div>
          ))}

          {/* Current user text (partial) */}
          {currentUserText && (
            <div className="flex justify-end">
              <div className="max-w-[80%] px-4 py-2.5 rounded-xl bg-purple-500/5 text-white/50 rounded-br-sm border border-purple-500/10 border-dashed">
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

      {/* Completion message */}
      {phase === 'complete' && (
        <div
          className="relative z-10 mt-6 px-6 py-4 bg-green-900/20 border border-green-500/20 rounded-xl text-center"
          style={{ animation: 'fadeInUp 0.5s ease-out' }}
        >
          <Sparkles className="w-6 h-6 text-green-400 mx-auto mb-2" />
          <p className="text-green-300 font-medium">Your agent is ready!</p>
          <p className="text-green-400/60 text-sm mt-1">Starting conversation...</p>
        </div>
      )}

      {/* Footer hint */}
      <p className="relative z-10 mt-6 text-white/20 text-xs text-center">
        Describe your ideal voice • Set the personality • Create your agent
      </p>
    </main>
  );
}

// Helper to load saved agent config from localStorage
export function loadSavedAgentConfig(): AgentConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    console.error('Failed to load saved agent config');
  }
  return null;
}

// Helper to clear saved agent config
export function clearSavedAgentConfig(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
