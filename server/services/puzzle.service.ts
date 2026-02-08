import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Load puzzles from JSON file at module initialization
// Using process.cwd() since tsx runs from the project root
const puzzlesPath = resolve(process.cwd(), 'server/data/puzzles.json');
const puzzlesData = JSON.parse(readFileSync(puzzlesPath, 'utf-8'));

export interface Puzzle {
  id: number;
  title: string;
  question: string;
  answer: string;
  hints: string[];
}

export interface PuzzleState {
  phase: 'intro' | 'asking' | 'discussing' | 'revealed' | 'complete';
  currentPuzzleIndex: number;
  hintsGiven: number;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  puzzlesSolved: number[];
  puzzlesRevealed: number[];
}

const PUZZLE_DISCUSSION_PROMPT = `You are a friendly puzzle master having a conversation about a brain teaser. You're helping the user think through the puzzle without giving away the answer too easily.

CURRENT PUZZLE:
Title: {{puzzleTitle}}
Question: {{puzzleQuestion}}
Answer (DO NOT REVEAL unless user gives up): {{puzzleAnswer}}

HINTS AVAILABLE (give one at a time if user is stuck):
{{hints}}
Hints given so far: {{hintsGiven}}/{{totalHints}}

CONVERSATION SO FAR:
{{conversationHistory}}

USER JUST SAID: "{{userInput}}"

YOUR TASK:
- Engage in a brainstorming conversation about the puzzle
- If user's answer is CORRECT or very close, congratulate them enthusiastically
- If user is on the right track, encourage them
- If user is stuck, offer a hint (one at a time)
- If user explicitly gives up or asks for the answer, reveal it
- If user wants to move to the next puzzle, let them
- Keep responses SHORT (2-3 sentences max) since this is voice

RESPOND WITH ONLY ONE OF THESE JSON FORMATS:

If the user got it RIGHT:
{"action": "correct", "response": "Your congratulatory message"}

If discussing/hinting (user is working on it):
{"action": "discuss", "response": "Your encouraging response or hint", "giveHint": true/false}

If revealing the answer (user gave up):
{"action": "reveal", "response": "The answer is: [answer]. [brief explanation]. Want to try another puzzle?"}

If user wants next puzzle:
{"action": "next_puzzle", "response": "Great! Let's move on to the next one."}

If user wants to stop/finish:
{"action": "complete", "response": "Thanks for playing! You solved X puzzles. Hope you had fun!"}`;

export class PuzzleService {
  private llm: ChatAnthropic;
  private puzzles: Puzzle[];

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 1024,
      anthropicApiKey: config.anthropicApiKey,
    });

    // Load puzzles from JSON file
    this.puzzles = puzzlesData.puzzles as Puzzle[];
    logger.info('🧩 Loaded puzzles from puzzles.json', { count: this.puzzles.length });
  }

  /**
   * Get all puzzles
   */
  getPuzzles(): Puzzle[] {
    return this.puzzles;
  }

  /**
   * Get a specific puzzle by index
   */
  getPuzzle(index: number): Puzzle | undefined {
    return this.puzzles[index];
  }

  /**
   * Generate initial greeting for puzzle mode
   */
  async generateInitialGreeting(userName: string): Promise<string> {
    return `Hey ${userName}! Ready to challenge your brain? I've got ${this.puzzles.length} mind-bending puzzles for you. Let's start with the first one!`;
  }

  /**
   * Get the current puzzle question
   */
  getCurrentPuzzleIntro(state: PuzzleState): string {
    const puzzle = this.puzzles[state.currentPuzzleIndex];
    if (!puzzle) {
      return "Looks like we've gone through all the puzzles! Great job!";
    }
    return `Here's puzzle number ${puzzle.id}: ${puzzle.title}. ${puzzle.question}`;
  }

  /**
   * Process user input during puzzle mode
   */
  async processInput(
    userInput: string,
    state: PuzzleState,
    userName: string
  ): Promise<{
    response: string;
    action: 'correct' | 'discuss' | 'reveal' | 'next_puzzle' | 'complete';
    giveHint?: boolean;
  }> {
    const puzzle = this.puzzles[state.currentPuzzleIndex];
    
    if (!puzzle) {
      return {
        response: `Amazing work, ${userName}! You've completed all ${this.puzzles.length} puzzles. You solved ${state.puzzlesSolved.length} on your own. Thanks for playing!`,
        action: 'complete',
      };
    }

    const historyText = this.formatConversationHistory(state.chatHistory);
    const hintsText = puzzle.hints
      .map((hint, i) => `Hint ${i + 1}: ${hint}`)
      .join('\n');

    const prompt = PUZZLE_DISCUSSION_PROMPT
      .replace('{{puzzleTitle}}', puzzle.title)
      .replace('{{puzzleQuestion}}', puzzle.question)
      .replace('{{puzzleAnswer}}', puzzle.answer)
      .replace('{{hints}}', hintsText)
      .replace('{{hintsGiven}}', state.hintsGiven.toString())
      .replace('{{totalHints}}', puzzle.hints.length.toString())
      .replace('{{conversationHistory}}', historyText)
      .replace('{{userInput}}', userInput);

    try {
      const result = await this.llm.invoke([new HumanMessage(prompt)]);
      const content = (result.content as string).trim();

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('⚠️ No JSON in puzzle response', { content });
        return {
          response: "Hmm, interesting thought! Keep going, you're doing great.",
          action: 'discuss',
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      logger.info('🧩 Puzzle action', { action: parsed.action });

      return {
        response: parsed.response,
        action: parsed.action,
        giveHint: parsed.giveHint,
      };
    } catch (error) {
      logger.error(error, { context: 'puzzle_process_input' });
      return {
        response: "I didn't quite catch that. What do you think the answer might be?",
        action: 'discuss',
      };
    }
  }

  /**
   * Get the next puzzle intro or completion message
   */
  getNextPuzzleIntro(state: PuzzleState, userName: string): string {
    const nextIndex = state.currentPuzzleIndex + 1;
    
    if (nextIndex >= this.puzzles.length) {
      return `That was the last puzzle, ${userName}! You solved ${state.puzzlesSolved.length} out of ${this.puzzles.length} on your own. Fantastic brain workout!`;
    }

    const puzzle = this.puzzles[nextIndex];
    return `Alright, here's puzzle number ${puzzle.id}: ${puzzle.title}. ${puzzle.question}`;
  }

  /**
   * Get a hint for the current puzzle
   */
  getHint(state: PuzzleState): string | null {
    const puzzle = this.puzzles[state.currentPuzzleIndex];
    if (!puzzle || state.hintsGiven >= puzzle.hints.length) {
      return null;
    }
    return puzzle.hints[state.hintsGiven];
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

    // Include last 10 messages max
    const recentHistory = history.slice(-10);
    return recentHistory
      .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
      .join('\n');
  }
}
