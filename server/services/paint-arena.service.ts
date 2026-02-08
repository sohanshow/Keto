import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { GeminiImageService } from './gemini-image.service.js';
import { PaintArenaState } from '../types.js';

interface PaintArenaResponse {
  response: string;
  shouldGenerateImage: boolean;
  imagePrompt?: string;
  isEditRequest?: boolean;
}

const PAINT_ARENA_SYSTEM_PROMPT = `You are a friendly and creative AI art assistant in a paint arena. Your role is to help users create and refine images.

IMPORTANT RULES:
1. When the user describes what they want to draw, extract a clear, detailed image generation prompt.
2. If the user wants to modify an existing image, understand their edit request and create an appropriate modification prompt.
3. Keep your responses SHORT and conversational (1-2 sentences max).
4. Be encouraging and excited about their creative ideas!

RESPONSE FORMAT:
You must respond with a JSON object in this exact format:
{
  "response": "Your friendly message to the user",
  "shouldGenerateImage": true/false,
  "imagePrompt": "Detailed prompt for image generation (only if shouldGenerateImage is true)",
  "isEditRequest": true/false (true if modifying existing image)
}

EXAMPLES:

User: "I want to draw a sunset over mountains"
{
  "response": "Ooh, a mountain sunset! Let me create that for you! 🎨",
  "shouldGenerateImage": true,
  "imagePrompt": "A breathtaking sunset over majestic mountain peaks, warm orange and pink sky, golden hour lighting, dramatic clouds, photorealistic landscape photography style",
  "isEditRequest": false
}

User: "Make it more purple"
{
  "response": "Adding some purple vibes! ✨",
  "shouldGenerateImage": true,
  "imagePrompt": "Modify the image to have more purple tones in the sky, deep violet and magenta sunset colors while keeping the mountain silhouette",
  "isEditRequest": true
}

User: "Do you like it?"
{
  "response": "I think it turned out beautifully! The colors really pop. Would you like to change anything?",
  "shouldGenerateImage": false
}

User: "What can you draw?"
{
  "response": "I can create anything you imagine! Landscapes, portraits, abstract art, fantasy scenes... What sounds fun to you?",
  "shouldGenerateImage": false
}

Always respond with valid JSON only, no additional text.`;

export class PaintArenaService {
  private llm: ChatAnthropic;
  private geminiService: GeminiImageService;

  constructor() {
    this.llm = new ChatAnthropic({
      anthropicApiKey: config.anthropicApiKey,
      modelName: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 500,
    });
    this.geminiService = new GeminiImageService();
  }

  /**
   * Generate the initial greeting for the paint arena
   */
  async generateInitialGreeting(userName: string): Promise<string> {
    const greetings = [
      `Hey ${userName}! Welcome to the Paint Arena! 🎨 What would you like to create today?`,
      `Hi ${userName}! I'm excited to help you create some art! What do you want to draw?`,
      `Welcome to the canvas, ${userName}! Tell me what you'd like to paint and I'll bring it to life!`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  /**
   * Process user input and determine if we should generate an image
   */
  async processInput(
    userInput: string,
    state: PaintArenaState,
    userName: string
  ): Promise<PaintArenaResponse> {
    logger.info('🎨 Processing paint arena input', { 
      userInput: userInput.substring(0, 50),
      phase: state.phase,
      hasExistingImage: !!state.currentImageBase64,
    });

    try {
      // Build system prompt with context about existing image
      let systemPrompt = PAINT_ARENA_SYSTEM_PROMPT;
      if (state.currentImageBase64) {
        systemPrompt += '\n\nCONTEXT: The user has already generated an image. If they want changes, set isEditRequest to true.';
      }

      // Build conversation history for context - system message MUST be first
      const messages = [
        new SystemMessage(systemPrompt),
        ...state.chatHistory.map((msg) =>
          msg.role === 'user'
            ? new HumanMessage(msg.content)
            : new AIMessage(msg.content)
        ),
        new HumanMessage(userInput),
      ];

      const response = await this.llm.invoke(messages);
      const content = response.content as string;

      // Parse JSON response
      try {
        // Extract JSON from response (in case there's extra text)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }

        const parsed = JSON.parse(jsonMatch[0]) as PaintArenaResponse;
        logger.info('🎨 Parsed paint arena response', {
          shouldGenerate: parsed.shouldGenerateImage,
          isEdit: parsed.isEditRequest,
        });

        return parsed;
      } catch (parseError) {
        logger.warn('⚠️ Failed to parse paint arena response as JSON, using fallback');
        return {
          response: content,
          shouldGenerateImage: false,
        };
      }
    } catch (error) {
      logger.error(error, { context: 'paint_arena_process_input' });
      return {
        response: "Oops, I had a little hiccup! Could you tell me again what you'd like to create?",
        shouldGenerateImage: false,
      };
    }
  }

  /**
   * Generate an image using Gemini
   */
  async generateImage(prompt: string): Promise<{ imageBase64: string; text?: string }> {
    logger.info('🖼️ Generating image', { promptLength: prompt.length });
    return this.geminiService.generateImage({ prompt });
  }

  /**
   * Edit an existing image using Gemini
   */
  async editImage(prompt: string, existingImageBase64: string): Promise<{ imageBase64: string; text?: string }> {
    logger.info('✏️ Editing image', { promptLength: prompt.length });
    return this.geminiService.editImage(prompt, existingImageBase64);
  }

  /**
   * Generate the "do you like it" response after image generation
   */
  getPostGenerationResponse(): string {
    const responses = [
      "There you go! Do you like it, or would you like to change something?",
      "Ta-da! ✨ What do you think? Want me to adjust anything?",
      "Here's your creation! Love it or want some tweaks?",
      "Done! How does it look? I can make changes if you'd like!",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}
