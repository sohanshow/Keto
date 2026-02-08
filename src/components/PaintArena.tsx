'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Paintbrush, Sparkles, RefreshCw, Download, Loader2 } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { IncomingMessage } from '@/types';

interface PaintArenaProps {
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

interface ChatMessage {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

type PaintPhase = 'asking' | 'generating' | 'viewing' | 'editing';

export default function PaintArena({ userName, agentConfig }: PaintArenaProps) {
  // ─── State ─────────────────────────────────────────────────────────
  const [isActive, setIsActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Paint-specific state
  const [phase, setPhase] = useState<PaintPhase>('asking');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isActiveRef = useRef(false);
  const isReadyRef = useRef(false);
  const hasInterruptedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
        console.log('✅ Paint arena ready');
        setIsReady(true);
        setError(null);
        break;

      case 'transcript':
        if (data.speaker === 'user') {
          setCurrentUserText(data.transcript || '');
          if (!data.isPartial && data.transcript) {
            const newMessage: ChatMessage = {
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
          const newMessage: ChatMessage = {
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
            hasInterruptedRef.current = false;
            resetStopFlag();
          }
          queueAudioChunk(data.audio, data.sampleRate);
        }
        break;

      case 'tts_stopped':
        stopAudio();
        break;

      case 'stopped':
        setIsActive(false);
        setIsReady(false);
        break;

      case 'error':
        console.error('❌ Server error:', data.message);
        setError(data.message || 'Unknown error');
        setIsGenerating(false);
        break;
    }

    // Handle paint-specific messages
    if ((data as any).paintArena) {
      const paintData = (data as any).paintArena;
      
      if (paintData.type === 'generation_started') {
        setIsGenerating(true);
        setPhase('generating');
        if (paintData.prompt) {
          setCurrentPrompt(paintData.prompt);
        }
      }
      
      if (paintData.type === 'image_generated') {
        setIsGenerating(false);
        setPhase('viewing');
        if (paintData.imageBase64) {
          setGeneratedImage(`data:image/png;base64,${paintData.imageBase64}`);
        }
      }
      
      if (paintData.type === 'image_edited') {
        setIsGenerating(false);
        setPhase('viewing');
        if (paintData.imageBase64) {
          setGeneratedImage(`data:image/png;base64,${paintData.imageBase64}`);
        }
      }

      if (paintData.type === 'generation_failed') {
        setIsGenerating(false);
        setPhase(generatedImage ? 'viewing' : 'asking');
        setError(paintData.error || 'Failed to generate image');
      }
    }
  }, [queueAudioChunk, stopAudio, resetStopFlag, generatedImage]);

  const { isConnected, connect, sendMessage, disconnect } = useWebSocket(handleMessage);

  // Audio capture callback
  const onAudioChunk = useCallback(
    (base64Audio: string) => {
      if (isActiveRef.current && isReadyRef.current && !isGenerating) {
        sendMessage({ type: 'audio', audio: base64Audio });
      }
    },
    [sendMessage, isGenerating]
  );

  const { startRecording, stopRecording } = useAudioCapture(onAudioChunk);

  // VAD for interruptions
  const handleSpeechStart = useCallback(() => {
    if (!isActiveRef.current || isGenerating) return;
    if (isPlaying()) {
      hasInterruptedRef.current = true;
      stopAudio();
      sendMessage({ type: 'interrupt' });
    }
  }, [stopAudio, sendMessage, isPlaying, isGenerating]);

  const { startVAD, stopVAD, isSpeaking } = useVAD({
    onSpeechStart: handleSpeechStart,
    enabled: isActive && !isGenerating,
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

  // ─── Start paint session ──────────────────────────────────────────
  const handleStart = useCallback(async () => {
    try {
      setError(null);
      hasInterruptedRef.current = false;
      resetStopFlag();

      await connect();
      await startRecording();
      await startVAD();

      sendMessage({
        type: 'start',
        userName,
        mode: 'paint_arena',
        voiceId: agentConfig.voiceId,
      } as any);
      setIsActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      setError('Failed to start. Please check your microphone permissions.');
    }
  }, [connect, startRecording, startVAD, sendMessage, userName, agentConfig.voiceId, resetStopFlag]);

  const handleStop = useCallback(() => {
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
  }, [sendMessage, stopRecording, stopVAD, stopAudio, disconnect]);

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

  // ─── Text input submission ────────────────────────────────────────
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || isGenerating) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      speaker: 'user',
      text: textInput.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Send as text message to server
    sendMessage({
      type: 'text_input',
      text: textInput.trim(),
    } as any);

    setTextInput('');
  };

  // ─── Reset/New drawing ────────────────────────────────────────────
  const handleNewDrawing = () => {
    setGeneratedImage(null);
    setCurrentPrompt('');
    setPhase('asking');
    
    // Send reset message to server
    sendMessage({
      type: 'paint_reset',
    } as any);
  };

  // ─── Download image ───────────────────────────────────────────────
  const handleDownload = () => {
    if (!generatedImage) return;
    
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `keto-art-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-[calc(100vh-140px)] flex">
      {/* Left side - Canvas area */}
      <div className="flex-1 flex flex-col p-6">
        {/* Canvas header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Paintbrush className="w-5 h-5 text-rose-400" />
            <h2 className="font-display text-lg font-semibold text-white">Canvas</h2>
          </div>
          {generatedImage && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewDrawing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                New
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-sm transition-all"
              >
                <Download className="w-4 h-4" />
                Save
              </button>
            </div>
          )}
        </div>

        {/* Canvas display */}
        <div className="flex-1 relative rounded-2xl overflow-hidden bg-gradient-to-br from-charcoal to-graphite border border-white/5">
          {/* Empty state / Asking phase */}
          {phase === 'asking' && !generatedImage && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-rose-500/20 to-orange-500/20 flex items-center justify-center border border-rose-500/20">
                  <Sparkles className="w-10 h-10 text-rose-400" />
                </div>
                <h3 className="text-xl font-display font-semibold text-white mb-3">
                  What would you like to draw?
                </h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  Describe your vision and I&apos;ll bring it to life. You can speak or type your idea.
                </p>
              </div>
            </div>
          )}

          {/* Generating phase - Loading skeleton */}
          {phase === 'generating' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                {/* Animated skeleton */}
                <div className="relative w-64 h-64 mx-auto mb-6">
                  {/* Pulsing background */}
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-rose-500/10 to-orange-500/10 animate-pulse" />
                  
                  {/* Shimmer effect */}
                  <div className="absolute inset-0 rounded-2xl overflow-hidden">
                    <div 
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                      style={{
                        animation: 'shimmer 2s infinite',
                        transform: 'translateX(-100%)',
                      }}
                    />
                  </div>
                  
                  {/* Center loader */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                      <Loader2 className="w-12 h-12 text-rose-400 animate-spin" />
                      <div className="absolute inset-0 w-12 h-12 rounded-full bg-rose-500/20 animate-ping" />
                    </div>
                  </div>
                </div>
                
                <p className="text-white/60 text-sm font-medium mb-2">Creating your artwork...</p>
                {currentPrompt && (
                  <p className="text-white/30 text-xs max-w-xs mx-auto truncate">
                    &quot;{currentPrompt}&quot;
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Generated image display */}
          {generatedImage && phase !== 'generating' && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <img
                src={generatedImage}
                alt="Generated artwork"
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                style={{ animation: 'fadeIn 0.5s ease-out' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right side - Chat area */}
      <div className="w-96 flex flex-col border-l border-white/5 bg-charcoal/30">
        {/* Chat header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-white/20'}`} />
              <span className="text-white/60 text-sm">
                {isGenerating ? 'Generating...' : isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {isSpeaking && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-rose-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                <span className="text-rose-300 text-xs">Speaking</span>
              </div>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && !currentUserText && !currentAgentText && (
            <div className="h-full flex items-center justify-center">
              <p className="text-white/20 text-sm text-center px-4">
                {isActive 
                  ? "I'm listening... describe what you'd like to create" 
                  : 'Connecting...'}
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
                  max-w-[85%] px-4 py-2.5 rounded-2xl
                  ${message.speaker === 'user'
                    ? 'bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-white/90 rounded-br-sm border border-rose-500/20'
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
              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-rose-500/10 text-white/50 rounded-br-sm border border-rose-500/10 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentUserText}</p>
              </div>
            </div>
          )}

          {/* Current agent text (partial) */}
          {currentAgentText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-white/[0.02] text-white/50 rounded-bl-sm border border-white/5 border-dashed">
                <p className="text-sm leading-relaxed italic">{currentAgentText}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error display */}
        {error && (
          <div className="mx-4 mb-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Input area */}
        <div className="p-4 border-t border-white/5">
          {/* Text input */}
          <form onSubmit={handleTextSubmit} className="flex items-center gap-2 mb-3">
            <input
              ref={inputRef}
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={isGenerating ? "Please wait..." : "Type your message..."}
              disabled={isGenerating}
              className="flex-1 px-4 py-2.5 bg-charcoal rounded-xl text-white text-sm placeholder-white/20 outline-none border border-white/5 focus:border-rose-500/30 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || isGenerating}
              className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          {/* Voice button */}
          <button
            onClick={isActive ? handleStop : handleStart}
            disabled={isGenerating}
            className={`
              w-full flex items-center justify-center gap-2 py-3 rounded-xl
              font-medium text-sm transition-all duration-300
              ${isGenerating 
                ? 'bg-white/5 text-white/30 cursor-not-allowed'
                : isActive
                ? 'bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-white border border-rose-500/30'
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }
            `}
            style={{
              boxShadow: isActive && !isGenerating
                ? `0 0 ${20 + audioLevel * 30}px rgba(244, 63, 94, ${0.1 + audioLevel * 0.15})`
                : 'none',
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : isActive ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Stop Listening</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Start Voice</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Shimmer animation style */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}
