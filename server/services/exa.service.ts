import Exa from 'exa-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface SearchResult {
  title: string;
  url: string;
  text: string;
  publishedDate?: string;
}

export class ExaService {
  private exa: Exa;

  constructor() {
    this.exa = new Exa(config.exaApiKey);
  }

  /**
   * Search the web for relevant information
   */
  async search(query: string, numResults: number = 3): Promise<SearchResult[]> {
    try {
      logger.info('🔍 Searching web with Exa', { query: query.substring(0, 50) });

      const result = await this.exa.searchAndContents(query, {
        type: 'auto',
        numResults,
        text: {
          maxCharacters: 500,
        },
      });

      const searchResults: SearchResult[] = result.results.map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url,
        text: r.text || '',
        publishedDate: r.publishedDate,
      }));

      logger.info('✅ Exa search completed', { resultsCount: searchResults.length });
      return searchResults;
    } catch (error) {
      logger.error(error, { context: 'exa_search' });
      return [];
    }
  }

  /**
   * Format search results into a readable string for the LLM
   */
  formatResultsForLLM(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No search results found.';
    }

    return results
      .map((r, i) => {
        const date = r.publishedDate ? ` (${new Date(r.publishedDate).toLocaleDateString()})` : '';
        return `[${i + 1}] ${r.title}${date}\n${r.text}\nSource: ${r.url}`;
      })
      .join('\n\n');
  }
}
