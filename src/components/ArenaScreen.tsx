'use client';

import { useState } from 'react';
import { MessageSquare, Puzzle, Paintbrush, Settings, LogOut } from 'lucide-react';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';
import PaintArena from './PaintArena';
import BanterArena from './BanterArena';
import PuzzleArena from './PuzzleArena';

type ArenaTab = 'banter' | 'puzzles' | 'paint';

interface ArenaScreenProps {
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

export default function ArenaScreen({ userName, agentConfig }: ArenaScreenProps) {
  const [activeTab, setActiveTab] = useState<ArenaTab>('banter');

  const tabs = [
    { id: 'banter' as const, label: 'Banter', icon: MessageSquare, disabled: false },
    { id: 'puzzles' as const, label: 'Puzzles', icon: Puzzle, disabled: false },
    { id: 'paint' as const, label: 'Paint', icon: Paintbrush, disabled: false },
  ];

  return (
    <main className="min-h-screen bg-void flex flex-col">
      {/* Header with tabs */}
      <header className="sticky top-0 z-50 bg-void/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 py-4">
          {/* Logo and user greeting */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="font-display text-xl font-semibold text-white/80">Keto</span>
              <span className="text-white/20">|</span>
              <span className="text-white/40 text-sm">Hey, <span className="text-gold">{userName}</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-charcoal border border-white/5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white/60 text-xs">{agentConfig.voiceName}</span>
              </div>
              <Link
                href="/settings"
                className="p-2 rounded-lg bg-charcoal/50 border border-white/10 hover:bg-charcoal hover:border-gold/30 text-white/60 hover:text-gold transition-all duration-300"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
              <SignOutButton redirectUrl="/">
                <button
                  className="p-2 rounded-lg bg-charcoal/50 border border-white/10 hover:bg-red-500/10 hover:border-red-500/30 text-white/60 hover:text-red-400 transition-all duration-300"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </SignOutButton>
            </div>
          </div>

          {/* Tab navigation */}
          <nav className="flex items-center gap-1 p-1 bg-charcoal/50 rounded-xl">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              // Different colors for different tabs
              const getActiveStyles = () => {
                if (!isActive) return '';
                switch (tab.id) {
                  case 'banter':
                    return 'bg-gradient-to-r from-gold/20 to-amber/20 text-white border border-gold/30';
                  case 'paint':
                    return 'bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-white border border-rose-500/30';
                  default:
                    return 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-white border border-purple-500/30';
                }
              };

              const getIconColor = () => {
                if (!isActive) return '';
                switch (tab.id) {
                  case 'banter':
                    return 'text-gold';
                  case 'paint':
                    return 'text-rose-400';
                  default:
                    return 'text-purple-400';
                }
              };
              
              return (
                <button
                  key={tab.id}
                  onClick={() => !tab.disabled && setActiveTab(tab.id)}
                  disabled={tab.disabled}
                  className={`
                    flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                    font-medium text-sm transition-all duration-300
                    ${isActive 
                      ? getActiveStyles()
                      : tab.disabled 
                        ? 'text-white/20 cursor-not-allowed' 
                        : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    }
                  `}
                >
                  <Icon className={`w-4 h-4 ${getIconColor()}`} />
                  <span>{tab.label}</span>
                  {tab.disabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">Soon</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Arena content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'banter' && (
          <BanterArena userName={userName} agentConfig={agentConfig} />
        )}

        {activeTab === 'puzzles' && (
          <PuzzleArena userName={userName} agentConfig={agentConfig} />
        )}

        {activeTab === 'paint' && (
          <PaintArena userName={userName} agentConfig={agentConfig} />
        )}
      </div>
    </main>
  );
}
