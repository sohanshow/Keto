// Voice configuration for TTS
// These voices are available from Cartesia

export interface Voice {
  id: string;
  name: string;
  gender: 'male' | 'female';
  type: string;
  context: string;
}

export const VOICES: Voice[] = [
  {
    id: '6ccbfb76-1fc6-48f7-b71d-91ac6298247b',
    name: 'Tessa',
    gender: 'female',
    type: 'emotional',
    context: 'Friendly female voice with a warm, conversational tone that feels like chatting with a close friend',
  },
  {
    id: '228fca29-3a0a-435c-8728-5cb483251068',
    name: 'Kiefer',
    gender: 'male',
    type: 'emotional',
    context: 'Confident voice with strong clarity and composed delivery, ideal for presentations and customer interactions',
  },
  {
    id: '86e30c1d-714b-4074-a1f2-1cb6b552fb49',
    name: 'Carson',
    gender: 'male',
    type: 'advertisement',
    context: 'Friendly young adult male for customer support conversations',
  },
  {
    id: '79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e',
    name: 'Theo',
    gender: 'male',
    type: 'entertainment',
    context: 'Steady, enunciating, confident young male for narrations',
  },
  {
    id: 'a33f7a4c-100f-41cf-a1fd-5822e8fc253f',
    name: 'Lauren',
    gender: 'female',
    type: 'live narrator',
    context: 'Expressive female voice for narration, storytelling, and creative content',
  },
];

export const DEFAULT_VOICE_ID = '6ccbfb76-1fc6-48f7-b71d-91ac6298247b';

export function getVoiceById(id: string): Voice | undefined {
  return VOICES.find((v) => v.id === id);
}

export function getVoicesByGender(gender: 'male' | 'female'): Voice[] {
  return VOICES.filter((v) => v.gender === gender);
}

export function getVoicesDescription(): string {
  return VOICES.map((v) => `- ${v.name} (${v.gender}, ${v.type}): ${v.context}`).join('\n');
}
