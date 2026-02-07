/**
 * Prompt Store
 * 
 * Manages system prompts with template variable interpolation.
 * Supports named prompt templates and dynamic variable substitution.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  description?: string;
}

export interface PromptVariables {
  userName?: string;
  [key: string]: string | undefined;
}

// ─── Built-in Prompt Templates ────────────────────────────────────────────────

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'default',
    name: 'Default Assistant',
    template: `You are a helpful AI voice assistant{{#userName}} speaking with {{userName}}{{/userName}}. Your role is to:
- Listen actively and respond with clarity
- Provide helpful, accurate information
- Keep responses concise and conversational (2-3 sentences max)
- Be friendly, warm, and professional
- Remember context from the conversation
{{#userName}}- Address {{userName}} by name occasionally to keep the conversation personal{{/userName}}`,
    description: 'General-purpose voice assistant',
  },
  {
    id: 'agent-builder',
    name: 'Agent Builder Assistant',
    template: `You are Keto, an AI agent creation assistant{{#userName}} helping {{userName}}{{/userName}}. Your role is to:
- Guide the user through creating their custom AI voice agent
- Ask about the agent's personality, purpose, and behavior
- Suggest improvements and best practices for agent design
- Keep responses clear and actionable (2-3 sentences max)
- Be enthusiastic and encouraging about their agent creation
{{#userName}}- Address {{userName}} by name to keep it personal{{/userName}}`,
    description: 'Helps users create custom AI agents',
  },
];

// ─── Prompt Store Class ───────────────────────────────────────────────────────

export class PromptStore {
  private templates: Map<string, PromptTemplate>;
  private customTemplates: Map<string, PromptTemplate>;

  constructor() {
    this.templates = new Map();
    this.customTemplates = new Map();

    // Load built-in templates
    for (const template of PROMPT_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Get a prompt template by ID
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.customTemplates.get(id) || this.templates.get(id);
  }

  /**
   * List all available templates
   */
  listTemplates(): PromptTemplate[] {
    const all = new Map([...this.templates, ...this.customTemplates]);
    return Array.from(all.values());
  }

  /**
   * Register a custom prompt template
   */
  registerTemplate(template: PromptTemplate): void {
    this.customTemplates.set(template.id, template);
  }

  /**
   * Resolve a prompt template with variables.
   * Supports Mustache-like conditional blocks:
   *   {{#varName}}...content with {{varName}}...{{/varName}}
   * And simple variable interpolation:
   *   {{varName}}
   */
  resolvePrompt(templateId: string, variables: PromptVariables): string {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Prompt template "${templateId}" not found`);
    }

    return this.interpolate(template.template, variables);
  }

  /**
   * Resolve a raw prompt string (not from a template) with variables
   */
  resolveRawPrompt(rawTemplate: string, variables: PromptVariables): string {
    return this.interpolate(rawTemplate, variables);
  }

  /**
   * Interpolation engine:
   * 1. Process conditional blocks: {{#key}}...{{/key}} — included only if key is truthy
   * 2. Replace {{key}} with the variable value
   */
  private interpolate(template: string, variables: PromptVariables): string {
    let result = template;

    // Step 1: Conditional blocks {{#key}}...content...{{/key}}
    result = result.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, key: string, content: string) => {
        const value = variables[key];
        if (value) {
          // Replace variables inside the conditional block
          return content.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => variables[k] || '');
        }
        return '';
      }
    );

    // Step 2: Simple variable replacement {{key}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return variables[key] || '';
    });

    // Clean up any double blank lines from removed conditionals
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result;
  }
}
