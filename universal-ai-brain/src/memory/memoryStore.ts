import fs from "fs";
import path from "path";
import { normalizeBilingualText } from "../core/symbolicTruth.js";

export type MemoryKind = "fact" | "decision" | "rule" | "episode";

export interface MemoryEntry {
  id: string;
  projectId: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number; // 1..10
  createdAt: number;
}

const DEFAULT_MEMORY_DIR = path.resolve(
  process.env.BRAIN_MEMORY_DIR || path.join(process.cwd(), "data", "memory")
);

function sanitizeProjectId(projectId: string): string {
  return (projectId || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 64) || "default";
}

function tokenizeBilingual(text: string): string[] {
  const norm = normalizeBilingualText(text).toLowerCase();
  return norm
    .split(/[^a-z0-9\u0600-\u06FF]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export class ProjectMemoryStore {
  private readonly baseDir: string;
  private cache = new Map<string, MemoryEntry[]>();

  constructor(baseDir = DEFAULT_MEMORY_DIR) {
    this.baseDir = path.resolve(baseDir);
  }

  private getFilePath(projectId: string): string {
    return path.join(this.baseDir, `${sanitizeProjectId(projectId)}.json`);
  }

  private loadProject(projectId: string): MemoryEntry[] {
    const key = sanitizeProjectId(projectId);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const file = this.getFilePath(key);
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (Array.isArray(parsed)) {
          this.cache.set(key, parsed);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[BrainMemory] Failed reading ${file}:`, err);
    }
    const empty: MemoryEntry[] = [];
    this.cache.set(key, empty);
    return empty;
  }

  private saveProject(projectId: string, entries: MemoryEntry[]): void {
    const key = sanitizeProjectId(projectId);
    const trimmed = entries.slice(-500);
    this.cache.set(key, trimmed);
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      const file = this.getFilePath(key);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), "utf-8");
      fs.renameSync(tmp, file);
    } catch (err) {
      console.warn(`[BrainMemory] Failed saving ${key}:`, err);
    }
  }

  add(input: {
    projectId: string;
    content: string;
    kind?: MemoryKind;
    tags?: string[];
    importance?: number;
  }): MemoryEntry {
    const cleanContent = (input.content || "").trim();
    if (!cleanContent) {
      throw new Error("Memory content cannot be empty.");
    }
    const entries = [...this.loadProject(input.projectId)];
    const entry: MemoryEntry = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      projectId: sanitizeProjectId(input.projectId),
      kind: input.kind || "fact",
      content: cleanContent,
      tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      importance: Math.max(1, Math.min(10, Math.round(Number(input.importance) || 5))),
      createdAt: Date.now(),
    };
    entries.push(entry);
    this.saveProject(input.projectId, entries);
    return entry;
  }

  list(projectId: string): MemoryEntry[] {
    return [...this.loadProject(projectId)];
  }

  clear(projectId: string): void {
    this.saveProject(projectId, []);
  }

  /**
   * Bilingual BM25-inspired + importance + recency retrieval.
   * Always includes high-importance "rule" memories plus top-K query-relevant memories.
   */
  retrieveRelevant(projectId: string, query: string, limit = 6): MemoryEntry[] {
    const entries = this.loadProject(projectId);
    if (entries.length === 0) return [];

    const queryTokens = new Set(tokenizeBilingual(query));
    const totalDocs = entries.length;

    // Document frequency across project memories
    const df = new Map<string, number>();
    const docTokensList = entries.map((e) => {
      const toks = tokenizeBilingual(`${e.content} ${e.tags.join(" ")}`);
      const unique = new Set(toks);
      for (const t of unique) {
        df.set(t, (df.get(t) || 0) + 1);
      }
      return toks;
    });

    const now = Date.now();
    const scored = entries.map((entry, idx) => {
      const toks = docTokensList[idx];
      let lexicalScore = 0;
      if (queryTokens.size > 0 && toks.length > 0) {
        const tf = new Map<string, number>();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const qt of queryTokens) {
          const count = tf.get(qt) || 0;
          if (count > 0) {
            const idf = Math.log(1 + (totalDocs + 0.5) / ((df.get(qt) || 0) + 0.5));
            lexicalScore += idf * ((count * 2.2) / (count + 1.2));
          }
        }
      }

      const ageHours = Math.max(0, (now - entry.createdAt) / 3_600_000);
      const recencyBoost = 1 / (1 + ageHours / 168); // 1-week half-life
      const ruleBoost = entry.kind === "rule" ? 2.5 : 0;
      const importanceBoost = entry.importance * 0.25;

      return {
        entry,
        score: lexicalScore * 3 + ruleBoost + importanceBoost + recencyBoost,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entry);
  }
}
