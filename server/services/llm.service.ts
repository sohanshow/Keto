import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Your role is to:
- Listen actively and respond with clarity
- Provide helpful, accurate information
- Keep responses concise and conversational (2-3 sentences max)
- Be friendly and professional`;

export interface LLMStreamOptions {
  onSentence: (sentence: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  systemPrompt?: string;
}

export class LLMService {
  private llm: ChatAnthropic;

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 4096,
      anthropicApiKey: config.anthropicApiKey,
      streaming: true,
    });
  }

  /**
   * Stream LLM response by sentence
   * Buffers tokens until a sentence is complete, then calls onSentence callback
   */
  async streamResponse(transcript: string, options: LLMStreamOptions): Promise<void> {
    const { onSentence, onComplete, onError, systemPrompt } = options;
    let buffer = '';
    let fullText = '';

    try {
      const stream = await this.llm.stream([
        new SystemMessage(systemPrompt?.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT),
        new HumanMessage(transcript),
      ]);

      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          buffer += content;
          fullText += content;

          const sentences = this.splitIntoSentences(buffer);

          if (sentences.length > 1) {
            for (let i = 0; i < sentences.length - 1; i++) {
              const sentence = sentences[i].trim();
              if (sentence) {
                onSentence(sentence);
              }
            }
            buffer = sentences[sentences.length - 1] || '';
          }
        }
      }

      // Emit remaining text
      if (buffer.trim()) {
        onSentence(buffer.trim());
      }

      onComplete?.(fullText);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(err, { context: 'llm_stream' });
      onError?.(err);
      throw err;
    }
  }

  private splitIntoSentences(text: string): string[] {
    const sentenceRegex = /([.!?]+["')\]]?)\s+/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = text.substring(lastIndex, match.index + match[0].length).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      const remaining = text.substring(lastIndex).trim();
      if (remaining) {
        sentences.push(remaining);
      }
    }

    if (sentences.length === 0) {
      return [text];
    }

    return sentences;
  }
}
