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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <div className="min-h-screen relative">
      {/* Subtle radial gradient overlay */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gold/[0.02] rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-white/[0.01] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8" style={{ position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-gold" />
            <h1 className="font-display text-3xl font-bold text-white">Settings</h1>
          </div>
          <p className="mt-2 text-white/40 text-sm">Manage your account and preferences</p>
        </div>

        {/* Profile Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <User className="w-5 h-5 text-gold" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white/60">Email</Label>
              <Input 
                value={user?.primaryEmailAddress?.emailAddress || 'Not set'} 
                disabled
                className="bg-white/5"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-white/60">Username</Label>
              <Input 
                value={user?.username || user?.firstName || 'Not set'} 
                disabled
                className="bg-white/5"
              />
            </div>
          </CardContent>
        </Card>

        {/* Notifications Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-gold" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(notifications).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-white font-medium capitalize">{key}</Label>
                  <CardDescription>
                    {key === 'email' && 'Receive email notifications'}
                    {key === 'push' && 'Receive push notifications'}
                    {key === 'sms' && 'Receive SMS notifications'}
                  </CardDescription>
                </div>
                <Switch
                  checked={value}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, [key]: checked })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Preferences Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Moon className="w-5 h-5 text-gold" />
              Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Theme */}
            <div className="space-y-2">
              <Label className="text-white font-medium">Theme</Label>
              <div className="flex gap-2">
                {['dark', 'light', 'auto'].map((theme) => (
                  <Button
                    key={theme}
                    variant={preferences.theme === theme ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPreferences({ ...preferences, theme })}
                    className={preferences.theme === theme ? '' : 'flex-1'}
                  >
                    <span className="capitalize">{theme}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="space-y-2">
              <Label className="text-white font-medium">Language</Label>
              <div className="flex gap-2">
                {['en', 'es', 'fr', 'de'].map((lang) => (
                  <Button
                    key={lang}
                    variant={preferences.language === lang ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPreferences({ ...preferences, language: lang })}
                  >
                    {lang.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Volume */}
            <div className="space-y-2">
              <Label className="text-white font-medium">
                Volume: {preferences.volume}%
              </Label>
              <Slider
                value={[preferences.volume]}
                onValueChange={(value) => setPreferences({ ...preferences, volume: value[0] })}
                max={100}
                min={0}
                step={1}
                className="w-full"
              />
            </div>

            {/* Auto-play */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-white font-medium">Auto-play audio</Label>
                <CardDescription>Automatically play agent responses</CardDescription>
              </div>
              <Switch
                checked={preferences.autoPlay}
                onCheckedChange={(checked) => setPreferences({ ...preferences, autoPlay: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Privacy Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-gold" />
              Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Profile Visibility */}
            <div className="space-y-2">
              <Label className="text-white font-medium">Profile Visibility</Label>
              <div className="flex gap-2">
                {['public', 'private', 'friends'].map((visibility) => (
                  <Button
                    key={visibility}
                    variant={privacy.profileVisibility === visibility ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPrivacy({ ...privacy, profileVisibility: visibility })}
                    className="flex-1 capitalize"
                  >
                    {visibility}
                  </Button>
                ))}
              </div>
            </div>

            {/* Data Sharing */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-white font-medium">Data Sharing</Label>
                <CardDescription>Allow data to be used for improvements</CardDescription>
              </div>
              <Switch
                checked={privacy.dataSharing}
                onCheckedChange={(checked) => setPrivacy({ ...privacy, dataSharing: checked })}
              />
            </div>

            {/* Analytics */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-white font-medium">Analytics</Label>
                <CardDescription>Help us improve by sharing usage data</CardDescription>
              </div>
              <Switch
                checked={privacy.analytics}
                onCheckedChange={(checked) => setPrivacy({ ...privacy, analytics: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Logout Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <LogOut className="w-5 h-5 text-red-400" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SignOutButton redirectUrl="/">
              <Button variant="destructive" className="w-full" size="lg">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </SignOutButton>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
