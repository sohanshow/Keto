'use client';

import { useState } from 'react';
import { MessageSquare, Puzzle, Paintbrush, Settings, LogOut } from 'lucide-react';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
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
    <main className="min-h-screen flex flex-col relative">
      {/* Header with tabs */}
      <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-xl border-b border-white/5">
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
              <Link href="/settings">
                <Button variant="ghost" size="icon" title="Settings">
                  <Settings className="w-4 h-4" />
                </Button>
              </Link>
              <SignOutButton redirectUrl="/">
                <Button variant="ghost" size="icon" className="hover:bg-red-500/10 hover:text-red-400" title="Sign Out">
                  <LogOut className="w-4 h-4" />
                </Button>
              </SignOutButton>
            </div>
          </div>

          {/* Tab navigation */}
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ArenaTab)}>
            <TabsList className="w-full">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                const getActiveStyles = () => {
                  if (!isActive) return '';
                  switch (tab.id) {
                    case 'banter':
                      return 'data-[state=active]:from-gold/20 data-[state=active]:to-amber/20 data-[state=active]:border-gold/30';
                    case 'paint':
                      return 'data-[state=active]:from-rose-500/20 data-[state=active]:to-orange-500/20 data-[state=active]:border-rose-500/30';
                    default:
                      return 'data-[state=active]:from-purple-500/20 data-[state=active]:to-blue-500/20 data-[state=active]:border-purple-500/30';
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
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    disabled={tab.disabled}
                    className={`flex-1 gap-2 ${getActiveStyles()}`}
                  >
                    <Icon className={`w-4 h-4 ${getIconColor()}`} />
                    <span>{tab.label}</span>
                    {tab.disabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">Soon</span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
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
