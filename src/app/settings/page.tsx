'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Settings, 
  Bell, 
  Moon, 
  Globe, 
  Volume2, 
  Shield, 
  User, 
  LogOut,
  ArrowLeft,
  Check
} from 'lucide-react';
import { SignOutButton, useUser, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="text-white/40">Loading...</div>
      </div>
    );
  }
  
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <SettingsContent router={router} user={user} />
      </SignedIn>
    </>
  );
}

function SettingsContent({ router, user }: { router: ReturnType<typeof useRouter>, user: any }) {
  
  // Dummy settings state
  const [notifications, setNotifications] = useState({
    email: true,
    push: false,
    sms: false,
  });
  
  const [preferences, setPreferences] = useState({
    theme: 'dark',
    language: 'en',
    volume: 75,
    autoPlay: true,
  });

  const [privacy, setPrivacy] = useState({
    profileVisibility: 'public',
    dataSharing: false,
    analytics: true,
  });

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-void">
      {/* Subtle radial gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gold/[0.02] rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white/60 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-gold" />
            <h1 className="font-display text-3xl font-bold text-white">Settings</h1>
          </div>
          <p className="mt-2 text-white/40 text-sm">Manage your account and preferences</p>
        </div>

        {/* Profile Section */}
        <section className="mb-8 bg-charcoal/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-gold" />
            <h2 className="font-display text-xl font-semibold text-white">Profile</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-white/60 text-sm mb-2">Email</label>
              <div className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
                {user?.primaryEmailAddress?.emailAddress || 'Not set'}
              </div>
            </div>
            
            <div>
              <label className="block text-white/60 text-sm mb-2">Username</label>
              <div className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
                {user?.username || user?.firstName || 'Not set'}
              </div>
            </div>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="mb-8 bg-charcoal/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5 text-gold" />
            <h2 className="font-display text-xl font-semibold text-white">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            {Object.entries(notifications).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium capitalize">{key}</label>
                  <p className="text-white/40 text-sm">
                    {key === 'email' && 'Receive email notifications'}
                    {key === 'push' && 'Receive push notifications'}
                    {key === 'sms' && 'Receive SMS notifications'}
                  </p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, [key]: !value })}
                  className={`
                    relative w-12 h-6 rounded-full transition-colors duration-300
                    ${value ? 'bg-gold' : 'bg-white/10'}
                  `}
                >
                  <div
                    className={`
                      absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300
                      ${value ? 'translate-x-6' : 'translate-x-0'}
                    `}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Preferences Section */}
        <section className="mb-8 bg-charcoal/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Moon className="w-5 h-5 text-gold" />
            <h2 className="font-display text-xl font-semibold text-white">Preferences</h2>
          </div>
          
          <div className="space-y-6">
            {/* Theme */}
            <div>
              <label className="block text-white font-medium mb-3">Theme</label>
              <div className="flex gap-2">
                {['dark', 'light', 'auto'].map((theme) => (
                  <button
                    key={theme}
                    onClick={() => setPreferences({ ...preferences, theme })}
                    className={`
                      flex-1 px-4 py-2 rounded-lg border transition-all
                      ${preferences.theme === theme
                        ? 'bg-gold/20 border-gold/50 text-white'
                        : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20'
                      }
                    `}
                  >
                    <span className="capitalize">{theme}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="block text-white font-medium mb-3">Language</label>
              <div className="flex gap-2">
                {['en', 'es', 'fr', 'de'].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setPreferences({ ...preferences, language: lang })}
                    className={`
                      px-4 py-2 rounded-lg border transition-all
                      ${preferences.language === lang
                        ? 'bg-gold/20 border-gold/50 text-white'
                        : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20'
                      }
                    `}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Volume */}
            <div>
              <label className="block text-white font-medium mb-3">
                Volume: {preferences.volume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={preferences.volume}
                onChange={(e) => setPreferences({ ...preferences, volume: parseInt(e.target.value) })}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-gold"
              />
            </div>

            {/* Auto-play */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-white font-medium">Auto-play audio</label>
                <p className="text-white/40 text-sm">Automatically play agent responses</p>
              </div>
              <button
                onClick={() => setPreferences({ ...preferences, autoPlay: !preferences.autoPlay })}
                className={`
                  relative w-12 h-6 rounded-full transition-colors duration-300
                  ${preferences.autoPlay ? 'bg-gold' : 'bg-white/10'}
                `}
              >
                <div
                  className={`
                    absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300
                    ${preferences.autoPlay ? 'translate-x-6' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="mb-8 bg-charcoal/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-5 h-5 text-gold" />
            <h2 className="font-display text-xl font-semibold text-white">Privacy</h2>
          </div>
          
          <div className="space-y-6">
            {/* Profile Visibility */}
            <div>
              <label className="block text-white font-medium mb-3">Profile Visibility</label>
              <div className="flex gap-2">
                {['public', 'private', 'friends'].map((visibility) => (
                  <button
                    key={visibility}
                    onClick={() => setPrivacy({ ...privacy, profileVisibility: visibility })}
                    className={`
                      flex-1 px-4 py-2 rounded-lg border transition-all capitalize
                      ${privacy.profileVisibility === visibility
                        ? 'bg-gold/20 border-gold/50 text-white'
                        : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20'
                      }
                    `}
                  >
                    {visibility}
                  </button>
                ))}
              </div>
            </div>

            {/* Data Sharing */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-white font-medium">Data Sharing</label>
                <p className="text-white/40 text-sm">Allow data to be used for improvements</p>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, dataSharing: !privacy.dataSharing })}
                className={`
                  relative w-12 h-6 rounded-full transition-colors duration-300
                  ${privacy.dataSharing ? 'bg-gold' : 'bg-white/10'}
                `}
              >
                <div
                  className={`
                    absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300
                    ${privacy.dataSharing ? 'translate-x-6' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>

            {/* Analytics */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-white font-medium">Analytics</label>
                <p className="text-white/40 text-sm">Help us improve by sharing usage data</p>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, analytics: !privacy.analytics })}
                className={`
                  relative w-12 h-6 rounded-full transition-colors duration-300
                  ${privacy.analytics ? 'bg-gold' : 'bg-white/10'}
                `}
              >
                <div
                  className={`
                    absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300
                    ${privacy.analytics ? 'translate-x-6' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Logout Section */}
        <section className="bg-charcoal/50 border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <LogOut className="w-5 h-5 text-red-400" />
            <h2 className="font-display text-xl font-semibold text-white">Account</h2>
          </div>
          
          <SignOutButton redirectUrl="/">
            <button className="w-full px-6 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg font-medium transition-all duration-300 flex items-center justify-center gap-2">
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </SignOutButton>
        </section>
      </div>
    </div>
  );
}
