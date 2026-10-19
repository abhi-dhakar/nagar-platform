export type SearchOptions = {
  query: string;
  isCaseSensitive: boolean;
  isRegex: boolean;
  isWholeWord: boolean;
  includePattern?: string;
  excludePattern?: string;
};

export type SearchResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchLength: number;
};

export type SearchResultGroup = {
  path: string;
  results: SearchResult[];
};

export interface SearchService {
  search(opts: SearchOptions): Promise<SearchResultGroup[]>;
  replace?(opts: SearchOptions & { replaceText: string }): Promise<number>;
}

export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
