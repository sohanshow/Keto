'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowRight, User, Settings } from 'lucide-react';
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

interface LandingScreenProps {
  onNameSubmit: (name: string) => void;
}

export default function LandingScreen({ onNameSubmit }: LandingScreenProps) {
  const [name, setName] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount (only when signed in)
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    // Small delay for the exit animation
    setTimeout(() => {
      onNameSubmit(trimmed);
    }, 600);
  };

  return (
    <div
      className={`
        min-h-screen bg-void flex flex-col items-center justify-center px-6
        transition-all duration-700 ease-out
        ${isSubmitting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}
      `}
    >
      {/* Subtle radial gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gold/[0.02] rounded-full blur-[150px]" />
      </div>

      {/* User button and settings in top right when signed in */}
      <SignedIn>
        <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
          <a
            href="/settings"
            className="p-2 rounded-lg bg-charcoal/50 border border-white/10 hover:bg-charcoal hover:border-gold/30 text-white/60 hover:text-gold transition-all duration-300"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </a>
          <UserButton 
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: 'w-10 h-10',
                userButtonPopoverCard: 'bg-charcoal border border-white/10',
                userButtonPopoverActionButton: 'text-white/80 hover:text-gold hover:bg-white/5',
              }
            }}
          />
        </div>
      </SignedIn>

      {/* Content */}
      <div className="relative z-10 w-full max-w-lg text-center">
        {/* Logo / Brand */}
        <div 
          className="mb-16"
          style={{ animation: 'fadeIn 1s ease-out' }}
        >
          <span className="font-display text-2xl font-semibold tracking-tight text-white/80">
            Welcome to Keto
          </span>
        </div>

        {/* Auth UI - Show when signed out */}
        <SignedOut>
          <div
            className="mb-12"
            style={{ animation: 'fadeInUp 0.8s ease-out 0.2s both' }}
          >
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight mb-8">
              Welcome to
              <br />
              <span className="text-gold">Keto</span>
            </h1>
            <p className="text-white/60 text-lg mb-8 font-sans">
              Sign in to start your voice agent journey
            </p>
          </div>

          <div
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            style={{ animation: 'fadeInUp 0.8s ease-out 0.5s both' }}
          >
            <SignInButton 
              appearance={{
                elements: {
                  rootBox: 'w-full sm:w-auto',
                  button: 'px-8 py-4 bg-gold text-void font-sans font-semibold rounded-xl hover:bg-amber transition-all duration-300 hover:scale-105 active:scale-95',
                }
              }}
            />
            <SignUpButton 
              appearance={{
                elements: {
                  rootBox: 'w-full sm:w-auto',
                  button: 'px-8 py-4 bg-charcoal text-white border border-white/20 font-sans font-semibold rounded-xl hover:bg-white/5 hover:border-gold/30 transition-all duration-300 hover:scale-105 active:scale-95',
                }
              }}
            />
          </div>
        </SignedOut>

        {/* Name Input - Show when signed in */}
        <SignedIn>
          {/* Main heading */}
          <div
            className="mb-12"
            style={{ animation: 'fadeInUp 0.8s ease-out 0.2s both' }}
          >
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight">
              What should we
              <br />
              <span className="text-gold">call you?</span>
            </h1>
          </div>

          {/* Input form */}
          <form
            onSubmit={handleSubmit}
            className="relative"
            style={{ animation: 'fadeInUp 0.8s ease-out 0.5s both' }}
          >
            <div
              className={`
                relative rounded-xl transition-all duration-300
                ${isFocused ? 'shadow-[0_0_30px_rgba(212,168,83,0.08)]' : 'shadow-none'}
              `}
            >
              {/* Border effect */}
              <div
                className={`
                  absolute -inset-[1px] rounded-xl transition-opacity duration-300
                  bg-gradient-to-r from-gold/30 via-gold/10 to-gold/30
                  ${isFocused ? 'opacity-100' : 'opacity-0'}
                `}
              />

              <div className="relative flex items-center bg-charcoal rounded-xl overflow-hidden">
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder="Enter your name"
                  className="
                    w-full px-6 py-5 bg-transparent
                    text-lg text-white placeholder-white/20
                    font-sans font-medium
                    outline-none
                    caret-gold
                  "
                  maxLength={50}
                  autoComplete="off"
                  spellCheck={false}
                />

                <button
                  type="submit"
                  disabled={!name.trim()}
                  className={`
                    flex-shrink-0 mr-3 p-3 rounded-lg
                    transition-all duration-300 ease-out
                    ${name.trim()
                      ? 'bg-gold text-void hover:bg-amber hover:scale-105 active:scale-95 cursor-pointer'
                      : 'bg-smoke text-white/20 cursor-not-allowed'
                    }
                  `}
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Hint text */}
            <p
              className="mt-6 text-white/20 text-sm font-sans"
              style={{ animation: 'fadeInUp 0.8s ease-out 0.8s both' }}
            >
              This is how your AI agent will address you
            </p>
          </form>
        </SignedIn>
      </div>

      {/* Bottom subtle branding */}
      <div
        className="absolute bottom-8 text-white/10 text-xs font-mono tracking-widest uppercase"
        style={{ animation: 'fadeIn 1s ease-out 1.2s both' }}
      >
        Voice Agent Platform
      </div>
    </div>
  );
}
