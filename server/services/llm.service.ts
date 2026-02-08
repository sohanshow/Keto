import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ConversationHistory } from '../stores/conversation.store.js';
import { ExaService } from './exa.service.js';

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Your role is to:
- Listen actively and respond with clarity
- Provide helpful, accurate information
- Keep responses concise and conversational (2-3 sentences max)
- Be friendly and professional`;

const TOOL_DETECTION_SUFFIX = `

You have access to a web search tool. When the user asks about:
- Current events, news, or recent happenings
- Live scores, stock prices, or real-time data
- Information that requires up-to-date knowledge (after your training cutoff)
- Specific facts you're unsure about

You MUST respond with ONLY this JSON format (nothing else):
{"tool": "web_search", "query": "your search query here", "filler": "brief message like 'Let me look that up for you'"}

For all other questions, respond normally without JSON.`;

export interface LLMStreamOptions {
  onSentence: (sentence: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onToolCall?: (tool: string, query: string, filler: string) => void;
  systemPrompt?: string;
  conversationHistory?: ConversationHistory;
  searchContext?: string; // Search results to include in context
}

export class LLMService {
  private llm: ChatAnthropic;
  private exaService: ExaService;

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 4096,
      anthropicApiKey: config.anthropicApiKey,
      streaming: true,
    });
    this.exaService = new ExaService();
  }

  /**
   * Perform web search using Exa
   */
  async performWebSearch(query: string): Promise<string> {
    const results = await this.exaService.search(query, 3);
    return this.exaService.formatResultsForLLM(results);
  }

  /**
   * Stream LLM response by sentence.
   * Detects tool calls and handles them appropriately.
   */
  async streamResponse(transcript: string, options: LLMStreamOptions): Promise<void> {
    const { onSentence, onComplete, onError, onToolCall, systemPrompt, conversationHistory, searchContext } = options;
    let buffer = '';
    let fullText = '';

    try {
      // Build the messages array
      const messages = this.buildMessages(transcript, systemPrompt, conversationHistory, searchContext);

      logger.debug('🤖 Sending to LLM', {
        messageCount: messages.length,
        historyMessages: conversationHistory?.length || 0,
        hasSystemPrompt: !!systemPrompt,
        hasSearchContext: !!searchContext,
      });

      const stream = await this.llm.stream(messages);

      for await (const chunk of stream) {
        const content = chunk.content as string;
        if (content) {
          buffer += content;
          fullText += content;

          // Check if this looks like a tool call JSON (only check when we have enough content)
          if (fullText.length > 10 && fullText.trim().startsWith('{')) {
            // Keep accumulating until we have complete JSON
            continue;
          }

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

      // Check if the full response is a tool call
      const trimmedFull = fullText.trim();
      if (trimmedFull.startsWith('{') && trimmedFull.endsWith('}')) {
        try {
          const toolCall = JSON.parse(trimmedFull);
          if (toolCall.tool === 'web_search' && toolCall.query && onToolCall) {
            logger.info('🔧 Tool call detected', { tool: toolCall.tool, query: toolCall.query });
            onToolCall(toolCall.tool, toolCall.query, toolCall.filler || "Let me search for that...");
            return; // Don't emit as regular response
          }
        } catch {
          // Not valid JSON, treat as normal response
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
    conversationHistory?: ConversationHistory,
    searchContext?: string
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];

    // 1. System prompt with tool detection instructions
    const basePrompt = systemPrompt?.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
    const fullSystemPrompt = searchContext 
      ? basePrompt // Don't add tool suffix when we already have search results
      : basePrompt + TOOL_DETECTION_SUFFIX;
    
    messages.push(new SystemMessage(fullSystemPrompt));

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

    // 3. Current user transcript (with search context if available)
    if (searchContext) {
      const contextualTranscript = `${currentTranscript}\n\n[Web Search Results]\n${searchContext}\n\nBased on these search results, please provide a helpful response. Keep it concise (2-3 sentences).`;
      messages.push(new HumanMessage(contextualTranscript));
    } else {
      messages.push(new HumanMessage(currentTranscript));
    }

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
