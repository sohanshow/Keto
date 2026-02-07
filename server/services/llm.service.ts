import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ConversationHistory } from '../stores/conversation.store.js';

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
  conversationHistory?: ConversationHistory;
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
   * Stream LLM response by sentence.
   * Builds a full message array from conversation history + current transcript.
   * Buffers tokens until a sentence is complete, then calls onSentence callback.
   */
  async streamResponse(transcript: string, options: LLMStreamOptions): Promise<void> {
    const { onSentence, onComplete, onError, systemPrompt, conversationHistory } = options;
    let buffer = '';
    let fullText = '';

    try {
      // Build the messages array
      const messages = this.buildMessages(transcript, systemPrompt, conversationHistory);

      logger.debug('🤖 Sending to LLM', {
        messageCount: messages.length,
        historyMessages: conversationHistory?.length || 0,
        hasSystemPrompt: !!systemPrompt,
      });

      const stream = await this.llm.stream(messages);

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

      // Record the assistant's response in conversation history
      if (conversationHistory && fullText.trim()) {
        conversationHistory.addAssistantMessage(fullText.trim());
      }

      onComplete?.(fullText);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(err, { context: 'llm_stream' });
      onError?.(err);
      throw err;
    }
  }

  /**
   * Build the complete message array for the LLM:
   *   [SystemMessage, ...history, HumanMessage(current)]
   */
  private buildMessages(
    currentTranscript: string,
    systemPrompt?: string,
    conversationHistory?: ConversationHistory
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];

    // 1. System prompt
    messages.push(
      new SystemMessage(systemPrompt?.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT)
    );

    // 2. Conversation history (if available)
    if (conversationHistory) {
      const historyMessages = conversationHistory.getMessagesForLLM();
      for (const msg of historyMessages) {
        if (msg.role === 'user') {
          messages.push(new HumanMessage(msg.content));
        } else if (msg.role === 'assistant') {
          messages.push(new AIMessage(msg.content));
        }
      }
    }

    // 3. Current user transcript
    messages.push(new HumanMessage(currentTranscript));

    return messages;
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
