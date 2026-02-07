/**
 * Conversation History Store
 * 
 * Manages per-session conversation history for LLM interactions.
 * Features:
 * - Rolling window with configurable max messages
 * - Token-aware truncation (approximate)
 * - Role-based message tracking (system, user, assistant)
 * - Summary generation for long conversations
 */

import { logger } from '../logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface ConversationConfig {
  /** Max messages to keep in history (default: 50) */
  maxMessages: number;
  /** Approximate max tokens for context window (default: 8000) */
  maxContextTokens: number;
  /** Whether to include timestamps in context (default: false) */
  includeTimestamps: boolean;
}

const DEFAULT_CONFIG: ConversationConfig = {
  maxMessages: 50,
  maxContextTokens: 8000,
  includeTimestamps: false,
};

// ─── Conversation History ─────────────────────────────────────────────────────

export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private config: ConversationConfig;
  private sessionId: string;

  constructor(sessionId: string, config?: Partial<ConversationConfig>) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a user message to the history
   */
  addUserMessage(content: string): void {
    this.addMessage('user', content);
  }

  /**
   * Add an assistant message to the history
   */
  addAssistantMessage(content: string): void {
    this.addMessage('assistant', content);
  }

  /**
   * Get the conversation messages formatted for LLM consumption.
   * Returns messages trimmed to fit within the token budget.
   */
  getMessagesForLLM(): Array<{ role: MessageRole; content: string }> {
    const trimmed = this.trimToTokenBudget();
    return trimmed.map(({ role, content }) => ({ role, content }));
  }

  /**
   * Get the full raw message history
   */
  getFullHistory(): ConversationMessage[] {
    return [...this.messages];
  }

  /**
   * Get message count
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Clear conversation history
   */
  clear(): void {
    this.messages = [];
    logger.debug(`🗑️ Conversation history cleared`, { sessionId: this.sessionId });
  }

  /**
   * Get a summary of the conversation for logging/debugging
   */
  getSummary(): { messageCount: number; estimatedTokens: number; oldestMessage?: number; newestMessage?: number } {
    return {
      messageCount: this.messages.length,
      estimatedTokens: this.estimateTokens(this.messages),
      oldestMessage: this.messages[0]?.timestamp,
      newestMessage: this.messages[this.messages.length - 1]?.timestamp,
    };
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  private addMessage(role: MessageRole, content: string): void {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const message: ConversationMessage = {
      role,
      content: trimmedContent,
      timestamp: Date.now(),
    };

    this.messages.push(message);

    // Enforce max messages limit
    if (this.messages.length > this.config.maxMessages) {
      const removed = this.messages.length - this.config.maxMessages;
      this.messages = this.messages.slice(removed);
      logger.debug(`📜 Trimmed ${removed} old messages from conversation`, { 
        sessionId: this.sessionId,
        remaining: this.messages.length,
      });
    }

    logger.debug(`💬 [${role}] added to history (${this.messages.length} total)`, {
      sessionId: this.sessionId,
      contentPreview: trimmedContent.substring(0, 60),
    });
  }

  /**
   * Trim messages to fit within the approximate token budget.
   * Keeps the most recent messages, dropping oldest first.
   */
  private trimToTokenBudget(): ConversationMessage[] {
    const budget = this.config.maxContextTokens;
    let totalTokens = 0;
    const result: ConversationMessage[] = [];

    // Walk backwards from most recent to preserve latest context
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const msgTokens = this.estimateMessageTokens(msg);

      if (totalTokens + msgTokens > budget) {
        break;
      }

      totalTokens += msgTokens;
      result.unshift(msg);
    }

    if (result.length < this.messages.length) {
      logger.debug(`📜 Token budget trim: ${this.messages.length} → ${result.length} messages (~${totalTokens} tokens)`, {
        sessionId: this.sessionId,
      });
    }

    return result;
  }

  /**
   * Rough token estimation (~4 chars per token for English text)
   */
  private estimateMessageTokens(message: ConversationMessage): number {
    // ~4 chars per token + overhead for role markers
    return Math.ceil(message.content.length / 4) + 4;
  }

  private estimateTokens(messages: ConversationMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
  }
}

// ─── Conversation Store (manages multiple sessions) ───────────────────────────

export class ConversationStore {
  private sessions: Map<string, ConversationHistory> = new Map();

  /**
   * Create or get a conversation history for a session
   */
  getOrCreate(sessionId: string, config?: Partial<ConversationConfig>): ConversationHistory {
    let history = this.sessions.get(sessionId);
    if (!history) {
      history = new ConversationHistory(sessionId, config);
      this.sessions.set(sessionId, history);
      logger.info(`📝 New conversation history created`, { sessionId });
    }
    return history;
  }

  /**
   * Get an existing conversation history
   */
  get(sessionId: string): ConversationHistory | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove a session's conversation history
   */
  remove(sessionId: string): void {
    const history = this.sessions.get(sessionId);
    if (history) {
      logger.info(`🗑️ Removing conversation history`, { 
        sessionId,
        summary: history.getSummary(),
      });
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get the number of active sessions
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}
