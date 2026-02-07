import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Voice, AgentCreationState, AgentCreationData } from '../types.js';

/**
 * Agent Creation Service
 * 
 * Simplified flow:
 * 1. VOICE phase: User picks a voice. When they confirm, Claude sends "PHASE:PERSONALITY" event.
 * 2. PERSONALITY phase: User sets personality. Voice is LOCKED. When done, Claude sends "PHASE:COMPLETE" event.
 * 3. COMPLETE: Generate final system prompt and finish.
 */

const VOICE_PHASE_PROMPT = `You are Keto, helping a user pick a voice for their AI agent. You are currently speaking with the voice shown below.

USER'S NAME: {{userName}}
CURRENT VOICE: {{currentVoice}} ({{currentVoiceGender}}, {{currentVoiceType}})

AVAILABLE VOICES:
{{voicesList}}

CONVERSATION SO FAR:
{{conversationHistory}}

USER JUST SAID: "{{userInput}}"

YOUR TASK:
- If the user wants a DIFFERENT voice, respond with a JSON selecting a new voice
- If the user is HAPPY with the current voice (says yes, sounds good, this works, I like it, etc.), signal to move to personality phase
- Keep responses SHORT (1-2 sentences) since you're speaking out loud

RESPOND WITH ONLY ONE OF THESE JSON FORMATS:

If selecting a new voice:
{"action": "change_voice", "voiceId": "the-voice-id", "voiceName": "Name", "response": "How about this? I'm [Name]. Does this work for you?"}

If user confirms current voice is good:
{"action": "confirm_voice", "response": "Great choice! Now let's shape the personality. On a scale of 1 to 10, how humorous should I be?"}

If you need clarification:
{"action": "clarify", "response": "Your question to the user"}`;

const PERSONALITY_PHASE_PROMPT = `You are Keto, helping a user configure their AI agent's personality. The voice has already been selected and is LOCKED - do NOT change it.

USER'S NAME: {{userName}}
SELECTED VOICE: {{currentVoice}} (this is final, do not change)

CURRENT PERSONALITY SETTINGS:
- Humor: {{humor}}/10
- Formality: {{formality}}/10
- Traits: {{traits}}

CONVERSATION SO FAR:
{{conversationHistory}}

USER JUST SAID: "{{userInput}}"

YOUR TASK:
- Extract any personality preferences (humor level, formality, traits like "friendly", "professional", etc.)
- If user says they're done/finished/that's all/ready/let's go, signal completion
- Keep responses SHORT (1-2 sentences)
- Do NOT mention or change the voice - it's already set

RESPOND WITH ONLY ONE OF THESE JSON FORMATS:

If updating personality settings:
{"action": "update_personality", "humor": number_or_null, "formality": number_or_null, "traits": ["trait1"] or null, "response": "Your response acknowledging and asking if there's anything else"}

If user is done with personality:
{"action": "complete", "response": "Perfect! Your agent is ready. Let's dive in!"}

If you need clarification:
{"action": "clarify", "response": "Your question"}`;

const GENERATE_SYSTEM_PROMPT = `Generate a system prompt for an AI voice assistant with these settings:

User's name: {{userName}}
Voice: {{voiceName}}
Humor level: {{humor}}/10 (1=serious, 10=very funny)
Formality level: {{formality}}/10 (1=very casual, 10=very formal)
Personality traits: {{traits}}

Create a concise system prompt (max 150 words) that:
1. Defines the personality based on humor and formality levels
2. Incorporates the traits naturally
3. Mentions addressing the user by name occasionally
4. Emphasizes keeping responses short (2-3 sentences) for voice

Respond with ONLY the system prompt text, nothing else.`;

export class AgentCreationService {
  private llm: ChatAnthropic;

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 1024,
      anthropicApiKey: config.anthropicApiKey,
    });
  }

  /**
   * Generate the initial greeting for agent creation
   */
  async generateInitialGreeting(userName: string, voiceName: string): Promise<string> {
    return `Hi ${userName}! I'm ${voiceName}. Do you like this voice, or would you prefer something different?`;
  }

  /**
   * Process user input during agent creation
   */
  async processAgentCreationInput(
    userInput: string,
    state: AgentCreationState,
    userName: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    response: string;
    agentCreation?: AgentCreationData;
    newVoiceId?: string;
  }> {
    const { phase } = state;

    logger.info('🎨 Processing agent creation input', {
      phase,
      userInput: userInput.substring(0, 50),
      currentVoice: state.voiceName,
      historyLength: conversationHistory.length,
    });

    switch (phase) {
      case 'voice':
        return this.handleVoicePhase(userInput, state, userName, conversationHistory);

      case 'personality':
        return this.handlePersonalityPhase(userInput, state, userName, conversationHistory);

      case 'complete':
        return { response: `Your agent is all set! Let's start chatting.` };

      default:
        return { response: `Let's start fresh - do you like this voice?` };
    }
  }

  /**
   * Handle voice selection phase
   */
  private async handleVoicePhase(
    userInput: string,
    state: AgentCreationState,
    userName: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    response: string;
    agentCreation?: AgentCreationData;
    newVoiceId?: string;
  }> {
    const currentVoice = state.availableVoices.find(v => v.id === state.voiceId);
    
    const historyText = this.formatConversationHistory(conversationHistory);
    const voicesList = state.availableVoices
      .map(v => `- ${v.name} (ID: ${v.id}): ${v.gender}, ${v.type}. ${v.context}`)
      .join('\n');

    const prompt = VOICE_PHASE_PROMPT
      .replace('{{userName}}', userName)
      .replace('{{currentVoice}}', state.voiceName)
      .replace('{{currentVoiceGender}}', currentVoice?.gender || 'unknown')
      .replace('{{currentVoiceType}}', currentVoice?.type || 'unknown')
      .replace('{{voicesList}}', voicesList)
      .replace('{{conversationHistory}}', historyText)
      .replace('{{userInput}}', userInput);

    try {
      const result = await this.llm.invoke([new HumanMessage(prompt)]);
      const content = (result.content as string).trim();
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('⚠️ No JSON in voice phase response', { content });
        return { response: content };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      logger.info('🎤 Voice phase action', { action: parsed.action });

      switch (parsed.action) {
        case 'change_voice': {
          const newVoice = state.availableVoices.find(v => v.id === parsed.voiceId);
          if (newVoice) {
            logger.info('🎤 Changing voice', { from: state.voiceName, to: newVoice.name });
            return {
              response: parsed.response,
              agentCreation: {
                type: 'voice_selected',
                voiceId: newVoice.id,
                voiceName: newVoice.name,
              },
              newVoiceId: newVoice.id,
            };
          }
          return { response: parsed.response };
        }

        case 'confirm_voice':
          logger.info('✅ Voice confirmed, moving to personality phase');
          return {
            response: parsed.response,
            agentCreation: {
              type: 'personality_set', // This signals phase change
            },
          };

        case 'clarify':
        default:
          return { response: parsed.response };
      }
    } catch (error) {
      logger.error(error, { context: 'voice_phase' });
      return { response: `I didn't catch that. Do you like this voice, or would you prefer a different one?` };
    }
  }

  /**
   * Handle personality configuration phase
   * Voice is LOCKED at this point
   */
  private async handlePersonalityPhase(
    userInput: string,
    state: AgentCreationState,
    userName: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    response: string;
    agentCreation?: AgentCreationData;
  }> {
    const historyText = this.formatConversationHistory(conversationHistory);

    const prompt = PERSONALITY_PHASE_PROMPT
      .replace('{{userName}}', userName)
      .replace('{{currentVoice}}', state.voiceName)
      .replace('{{humor}}', state.humor.toString())
      .replace('{{formality}}', state.formality.toString())
      .replace('{{traits}}', state.traits.length > 0 ? state.traits.join(', ') : 'none set yet')
      .replace('{{conversationHistory}}', historyText)
      .replace('{{userInput}}', userInput);

    try {
      const result = await this.llm.invoke([new HumanMessage(prompt)]);
      const content = (result.content as string).trim();

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('⚠️ No JSON in personality phase response', { content });
        return { response: content };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      logger.info('✨ Personality phase action', { action: parsed.action });

      switch (parsed.action) {
        case 'update_personality': {
          const updates: AgentCreationData = { type: 'personality_set' };
          
          if (parsed.humor !== null && parsed.humor !== undefined) {
            updates.humor = parsed.humor;
          }
          if (parsed.formality !== null && parsed.formality !== undefined) {
            updates.formality = parsed.formality;
          }
          if (parsed.traits && Array.isArray(parsed.traits) && parsed.traits.length > 0) {
            updates.traits = parsed.traits;
          }

          logger.info('✨ Personality updated', { humor: updates.humor, formality: updates.formality, traits: updates.traits });
          
          return {
            response: parsed.response,
            agentCreation: updates,
          };
        }

        case 'complete':
          logger.info('🎉 Personality complete, generating system prompt');
          return this.handleFinalization(state, userName, parsed.response);

        case 'clarify':
        default:
          return { response: parsed.response };
      }
    } catch (error) {
      logger.error(error, { context: 'personality_phase' });
      return { response: `I didn't catch that. What personality traits would you like? Or say "that's all" if you're done.` };
    }
  }

  /**
   * Generate final system prompt and complete
   */
  private async handleFinalization(
    state: AgentCreationState,
    userName: string,
    responseText: string
  ): Promise<{
    response: string;
    agentCreation: AgentCreationData;
  }> {
    const prompt = GENERATE_SYSTEM_PROMPT
      .replace('{{userName}}', userName)
      .replace('{{voiceName}}', state.voiceName)
      .replace('{{humor}}', state.humor.toString())
      .replace('{{formality}}', state.formality.toString())
      .replace('{{traits}}', state.traits.length > 0 ? state.traits.join(', ') : 'friendly, helpful');

    let systemPrompt: string;

    try {
      const result = await this.llm.invoke([new HumanMessage(prompt)]);
      systemPrompt = (result.content as string).trim();
      logger.info('✨ System prompt generated', { length: systemPrompt.length });
    } catch (error) {
      logger.error(error, { context: 'system_prompt_generation' });
      // Fallback
      systemPrompt = `You are a helpful AI voice assistant speaking with ${userName}. 
Be ${state.humor > 5 ? 'witty and humorous' : 'straightforward'} and ${state.formality > 5 ? 'professional' : 'casual and friendly'}.
${state.traits.length > 0 ? `Key traits: ${state.traits.join(', ')}.` : ''}
Keep responses concise (2-3 sentences) and conversational. Address ${userName} by name occasionally.`;
    }

    return {
      response: responseText,
      agentCreation: {
        type: 'creation_complete',
        voiceId: state.voiceId,
        voiceName: state.voiceName,
        humor: state.humor,
        formality: state.formality,
        traits: state.traits,
        systemPrompt,
      },
    };
  }

  /**
   * Format conversation history for prompts
   */
  private formatConversationHistory(
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    if (history.length === 0) {
      return '(Conversation just started)';
    }
    
    // Include last 10 messages max to keep prompt size reasonable
    const recentHistory = history.slice(-10);
    return recentHistory
      .map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
      .join('\n');
  }
}
