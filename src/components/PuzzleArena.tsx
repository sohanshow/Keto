'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Puzzle, Lightbulb, SkipForward, Trophy, Brain, CheckCircle2, XCircle } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVAD } from '@/hooks/useVAD';
import { useTTSAudio } from '@/hooks/useTTSAudio';
import { IncomingMessage } from '@/types';

interface PuzzleArenaProps {
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

interface PuzzleInfo {
  id: number;
  title: string;
  question: string;
  totalPuzzles: number;
}

export default function PuzzleArena({ userName, agentConfig }: PuzzleArenaProps) {
  // ─── State ─────────────────────────────────────────────────────────
  const [isActive, setIsActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Puzzle-specific state
  const [currentPuzzle, setCurrentPuzzle] = useState<PuzzleInfo | null>(null);
  const [puzzlesSolved, setPuzzlesSolved] = useState(0);
  const [puzzlesRevealed, setPuzzlesRevealed] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [lastAction, setLastAction] = useState<'correct' | 'revealed' | null>(null);

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
        console.log('✅ Puzzle arena ready');
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
        break;
    }

    // Handle puzzle-specific messages
    if ((data as any).puzzle) {
      const puzzleData = (data as any).puzzle;

      if (puzzleData.type === 'puzzle_started' || puzzleData.type === 'next_puzzle') {
        setCurrentPuzzle({
          id: puzzleData.puzzleId,
          title: puzzleData.puzzleTitle,
          question: puzzleData.puzzleQuestion || '',
          totalPuzzles: puzzleData.totalPuzzles,
        });
        setLastAction(null);
      }

      if (puzzleData.type === 'puzzle_correct') {
        setPuzzlesSolved(puzzleData.puzzlesSolved || 0);
        setLastAction('correct');
      }

      if (puzzleData.type === 'puzzle_revealed') {
        setPuzzlesRevealed(puzzleData.puzzlesRevealed || 0);
        setLastAction('revealed');
      }

      if (puzzleData.type === 'puzzles_complete') {
        setIsComplete(true);
        setPuzzlesSolved(puzzleData.puzzlesSolved || 0);
        setPuzzlesRevealed(puzzleData.puzzlesRevealed || 0);
      }
    }
  }, [queueAudioChunk, stopAudio, resetStopFlag]);

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

  // ─── Start puzzle session ──────────────────────────────────────────
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
        mode: 'puzzle',
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
    if (!textInput.trim()) return;

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

  // ─── Request hint ─────────────────────────────────────────────────
  const handleRequestHint = () => {
    sendMessage({ type: 'puzzle_hint' } as any);
  };

  // ─── Skip to next puzzle ──────────────────────────────────────────
  const handleSkipPuzzle = () => {
    sendMessage({ type: 'puzzle_next' } as any);
  };

  return (
    <div className="h-[calc(100vh-140px)] flex">
      {/* Left side - Puzzle info area */}
      <div className="flex-1 flex flex-col p-6">
        {/* Puzzle header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-purple-400" />
            <h2 className="font-display text-lg font-semibold text-white">Brain Teasers</h2>
          </div>
          {currentPuzzle && !isComplete && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRequestHint}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm transition-all"
              >
                <Lightbulb className="w-4 h-4" />
                Hint
              </button>
              <button
                onClick={handleSkipPuzzle}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-all"
              >
                <SkipForward className="w-4 h-4" />
                Skip
              </button>
            </div>
          )}
        </div>

        {/* Main puzzle display */}
        <div className="flex-1 relative rounded-2xl overflow-hidden bg-gradient-to-br from-charcoal to-graphite border border-white/5">
          {/* Initial state - waiting for puzzles */}
          {!currentPuzzle && !isComplete && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
                  <Puzzle className="w-10 h-10 text-purple-400" />
                </div>
                <h3 className="text-xl font-display font-semibold text-white mb-3">
                  Ready to Challenge Your Mind?
                </h3>
                <p className="text-white/40 text-sm leading-relaxed">
                  {isActive ? "Getting your first puzzle ready..." : "Connecting..."}
                </p>
              </div>
            </div>
          )}

          {/* Current puzzle display */}
          {currentPuzzle && !isComplete && (
            <div className="absolute inset-0 flex flex-col p-6 overflow-y-auto">
              {/* Progress indicator */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-purple-500/20">
                    <span className="text-lg font-bold text-purple-300">#{currentPuzzle.id}</span>
                  </div>
                  <span className="text-purple-400 text-sm font-medium">
                    of {currentPuzzle.totalPuzzles}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400 text-sm">{puzzlesSolved}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-rose-400" />
                    <span className="text-rose-400 text-sm">{puzzlesRevealed}</span>
                  </div>
                </div>
              </div>

              {/* Success/Reveal animation */}
              {lastAction && (
                <div 
                  className={`mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-full self-start ${
                    lastAction === 'correct' 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                  style={{ animation: 'fadeIn 0.3s ease-out' }}
                >
                  {lastAction === 'correct' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm font-medium">Correct!</span>
                    </>
                  ) : (
                    <>
                      <Lightbulb className="w-4 h-4" />
                      <span className="text-sm font-medium">Answer Revealed</span>
                    </>
                  )}
                </div>
              )}

              {/* Puzzle content */}
              <div className="flex-1 flex flex-col">
                <h3 className="text-xl font-display font-bold text-white mb-4">
                  {currentPuzzle.title}
                </h3>
                
                {/* Question card */}
                <div className="bg-white/[0.03] rounded-xl p-5 border border-white/10 mb-4">
                  <p className="text-white/80 text-base leading-relaxed">
                    {currentPuzzle.question}
                  </p>
                </div>
                
                <p className="text-white/40 text-sm mt-auto">
                  💡 Think it through and share your answer. I&apos;ll help you brainstorm!
                </p>
              </div>

              {/* Progress bar */}
              <div className="mt-4">
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
                    style={{ width: `${((currentPuzzle.id) / currentPuzzle.totalPuzzles) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Completion screen */}
          {isComplete && (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <div 
                  className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-amber-500/30 to-yellow-500/30 flex items-center justify-center border border-amber-500/30"
                  style={{ animation: 'bounce 1s ease-in-out' }}
                >
                  <Trophy className="w-12 h-12 text-amber-400" />
                </div>
                
                <h3 className="text-3xl font-display font-bold text-white mb-4">
                  Challenge Complete!
                </h3>
                
                <div className="flex items-center justify-center gap-8 mb-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-emerald-400">{puzzlesSolved}</div>
                    <div className="text-white/40 text-sm">Solved</div>
                  </div>
                  <div className="w-px h-12 bg-white/10" />
                  <div className="text-center">
                    <div className="text-3xl font-bold text-rose-400">{puzzlesRevealed}</div>
                    <div className="text-white/40 text-sm">Revealed</div>
                  </div>
                </div>
                
                <p className="text-white/50 text-sm">
                  Great brain workout, {userName}! Come back anytime for more puzzles.
                </p>
              </div>
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
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {isSpeaking && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-purple-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-purple-300 text-xs">Speaking</span>
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
                  ? "I'm listening... share your thoughts!" 
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
                    ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white/90 rounded-br-sm border border-purple-500/20'
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
              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-purple-500/10 text-white/50 rounded-br-sm border border-purple-500/10 border-dashed">
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
              placeholder="Type your answer or thoughts..."
              className="flex-1 px-4 py-2.5 bg-charcoal rounded-xl text-white text-sm placeholder-white/20 outline-none border border-white/5 focus:border-purple-500/30 transition-colors"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          {/* Voice button */}
          <button
            onClick={isActive ? handleStop : handleStart}
            className={`
              w-full flex items-center justify-center gap-2 py-3 rounded-xl
              font-medium text-sm transition-all duration-300
              ${isActive
                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30'
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }
            `}
            style={{
              boxShadow: isActive
                ? `0 0 ${20 + audioLevel * 30}px rgba(168, 85, 247, ${0.1 + audioLevel * 0.15})`
                : 'none',
            }}
          >
            {isActive ? (
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

      {/* Animations */}
      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
