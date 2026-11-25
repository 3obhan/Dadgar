import { runCognitivePipeline, ThinkRequest, ThinkResult } from "./core/brainPipeline.js";
import { verifySymbolicFacts } from "./core/symbolicTruth.js";
import { MemoryKind, ProjectMemoryStore } from "./memory/memoryStore.js";
import { ProviderConfig, resolveConfiguredProviders } from "./providers/providerRouter.js";

export interface UniversalBrainOptions {
  memoryDir?: string;
  providers?: ProviderConfig;
}

export function createUniversalBrain(options: UniversalBrainOptions = {}) {
  const memoryStore = new ProjectMemoryStore(options.memoryDir);
  const providerCfg = options.providers || {};

  return {
    think(request: ThinkRequest): Promise<ThinkResult> {
      return runCognitivePipeline(request, memoryStore, providerCfg);
    },

    verifyFacts(primaryText: string, secondaryText?: string) {
      return verifySymbolicFacts(primaryText, secondaryText);
    },

    remember(input: {
      projectId: string;
      content: string;
      kind?: MemoryKind;
      tags?: string[];
      importance?: number;
    }) {
      return memoryStore.add(input);
    },

    recall(projectId: string, query: string, limit = 6) {
      return memoryStore.retrieveRelevant(projectId, query, limit);
    },

    listMemory(projectId: string) {
      return memoryStore.list(projectId);
    },

    clearMemory(projectId: string) {
      return memoryStore.clear(projectId);
    },

    status() {
      return {
        providers: resolveConfiguredProviders(providerCfg),
      };
    },
  };
}

export type UniversalBrain = ReturnType<typeof createUniversalBrain>;
export * from "./core/cognitiveModes.js";
export * from "./core/symbolicTruth.js";
export * from "./memory/memoryStore.js";
export * from "./providers/providerRouter.js";
export * from "./core/brainPipeline.js";
