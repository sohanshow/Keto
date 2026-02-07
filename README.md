# Keto Voice Agent

A real-time AI voice assistant with natural conversation flow, featuring speech-to-text, language model responses, and text-to-speech synthesis.

![Voice Agent](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- 🎤 **Real-time Speech-to-Text** - Powered by Deepgram Flux model with end-of-turn detection
- 🤖 **AI Responses** - Claude Haiku for natural, conversational responses
- 🔊 **Text-to-Speech** - Cartesia for high-quality, low-latency voice synthesis
- ⚡ **Interruption Handling** - Speak anytime to interrupt the AI
- 🎨 **Beautiful UI** - Modern glassmorphism design with real-time audio visualization

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Audio       │  │ VAD          │  │ TTS Audio            │    │
│  │ Capture     │──│ (Speech      │──│ Playback             │    │
│  │             │  │  Detection)  │  │                      │    │
│  └──────┬──────┘  └──────────────┘  └──────────▲───────────┘    │
│         │                                       │               │
│         └──────────────┬────────────────────────┘               │
│                        │ WebSocket                              │
└────────────────────────┼────────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────────┐
│                        ▼                                        │
│                  WebSocket Server                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Deepgram    │  │ Claude       │  │ Cartesia             │    │
│  │ STT         │──│ LLM          │──│ TTS                  │    │
│  │             │  │              │  │                      │    │
│  └─────────────┘  └──────────────┘  └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
DEEPGRAM_API_KEY=your_deepgram_key
ANTHROPIC_API_KEY=your_anthropic_key
CARTESIA_API_KEY=your_cartesia_key
```

### 3. Run Development Server

```bash
npm run dev
```

This starts both:
- **Frontend**: http://localhost:3000
- **WebSocket Server**: ws://localhost:5001/ws

### 4. Open in Browser

Navigate to [http://localhost:3000](http://localhost:3000) and click the microphone to start talking!

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and server in development mode |
| `npm run dev:client` | Start only the Next.js frontend |
| `npm run dev:server` | Start only the WebSocket server |
| `npm run build` | Build the Next.js frontend for production |
| `npm run build:server` | Compile the server TypeScript |
| `npm run start` | Start the production Next.js server |

## Deployment

### Frontend → Vercel

The Next.js frontend deploys seamlessly to Vercel:

```bash
vercel
```

Set the environment variable in Vercel:
- `NEXT_PUBLIC_WS_URL` = `wss://your-server-domain.com/ws`

### Server → Railway / Fly.io / Render

The WebSocket server needs a platform that supports persistent connections:

**Railway:**
```bash
# Install Railway CLI and deploy
railway login
railway init
railway up
```

**Fly.io:**
```bash
# Install Fly CLI and deploy
fly launch
fly deploy
```

Set these environment variables on your server platform:
- `DEEPGRAM_API_KEY`
- `ANTHROPIC_API_KEY`
- `CARTESIA_API_KEY`
- `FRONTEND_URL` (your Vercel URL for CORS)

## Project Structure

```
keto/
├── src/                    # Next.js frontend source
│   ├── app/               # App router pages
│   │   ├── page.tsx       # Main voice agent UI
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Global styles
│   ├── hooks/             # React hooks
│   │   ├── useWebSocket.ts    # WebSocket connection
│   │   ├── useAudioCapture.ts # Microphone recording
│   │   ├── useVAD.ts          # Voice activity detection
│   │   └── useTTSAudio.ts     # TTS audio playback
│   └── types/             # TypeScript types
├── server/                # WebSocket server
│   ├── index.ts          # Server entry point
│   ├── websocket-handler.ts  # WebSocket logic
│   ├── config.ts         # Configuration
│   └── services/         # External service integrations
│       ├── deepgram.service.ts  # Speech-to-text
│       ├── llm.service.ts       # Language model
│       └── tts.service.ts       # Text-to-speech
├── package.json          # Dependencies and scripts
├── .env.example          # Environment template
└── README.md
```

## API Keys

| Service | Purpose | Get Key |
|---------|---------|---------|
| **Deepgram** | Speech-to-Text | [console.deepgram.com](https://console.deepgram.com) |
| **Anthropic** | Language Model | [console.anthropic.com](https://console.anthropic.com) |
| **Cartesia** | Text-to-Speech | [play.cartesia.ai](https://play.cartesia.ai) |

## Customization

### Change the AI Voice

Edit `server/services/tts.service.ts` and update the `DEFAULT_VOICE_ID`:

```typescript
// Browse voices at https://play.cartesia.ai/voices
const DEFAULT_VOICE_ID = 'your-preferred-voice-id';
```

### Change the System Prompt

Edit `server/services/llm.service.ts`:

```typescript
export const DEFAULT_SYSTEM_PROMPT = `Your custom system prompt here`;
```

Or pass a custom prompt when starting a session from the frontend.

### Change the LLM Model

Edit `server/services/llm.service.ts`:

```typescript
this.llm = new ChatAnthropic({
  modelName: 'claude-haiku-4-5-20251001',  // or 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', etc.
  // ...
});
```

## Troubleshooting

### Microphone not working
- Ensure your browser has microphone permissions
- Check that you're using HTTPS in production (required for `getUserMedia`)

### WebSocket connection failed
- Verify the server is running on port 5001
- Check `NEXT_PUBLIC_WS_URL` matches your server URL
- Ensure CORS is configured with your frontend URL

### No audio playback
- Click somewhere on the page first (browsers require user interaction for audio)
- Check browser console for audio context errors

## License

MIT
