import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5001', 10),
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  cartesiaApiKey: process.env.CARTESIA_API_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

// Validate required config
const requiredKeys = ['deepgramApiKey', 'anthropicApiKey', 'cartesiaApiKey'] as const;
for (const key of requiredKeys) {
  if (!config[key]) {
    console.error(`❌ ERROR: ${key} is not set in environment variables!`);
  } else {
    console.log(`✅ ${key} is set (${config[key].substring(0, 8)}...)`);
  }
}
