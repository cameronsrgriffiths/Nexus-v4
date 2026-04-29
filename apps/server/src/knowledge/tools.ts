// search_knowledge and write_knowledge — the two tools the headless agent
// calls. These wrap the service with the tool-call ergonomics the PRD
// requires:
//   - write_knowledge defaults to mode='append'
//   - write_knowledge applies the 5x OCC retry policy
//   - search_knowledge defaults topN

import { writeKnowledgeWithRetry, type RetryResult } from './retry.ts';
import type {
  KnowledgeScope,
  KnowledgeService,
  SearchResult,
} from './service.ts';

const DEFAULT_TOP_N = 5;

export type SearchKnowledgeArgs = {
  scope: KnowledgeScope;
  scopeId: string;
  query: string;
  topN?: number;
};

export type WriteKnowledgeArgs = {
  scope: KnowledgeScope;
  scopeId: string;
  title: string;
  content: string;
  // Defaults to 'append' per PRD.
  mode?: 'append' | 'overwrite' | 'create';
};

export function createKnowledgeTools(service: KnowledgeService) {
  return {
    search_knowledge: (orgId: string, args: SearchKnowledgeArgs): Promise<SearchResult> =>
      service.search(orgId, {
        scope: args.scope,
        scopeId: args.scopeId,
        query: args.query,
        topN: args.topN ?? DEFAULT_TOP_N,
      }),

    write_knowledge: (orgId: string, args: WriteKnowledgeArgs): Promise<RetryResult> => {
      const mode = args.mode ?? 'append';
      return writeKnowledgeWithRetry({
        service,
        orgId,
        scope: args.scope,
        scopeId: args.scopeId,
        title: args.title,
        mode,
        contentToWrite: () => args.content,
      });
    },
  };
}
