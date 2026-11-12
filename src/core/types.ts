export type SymbolKind =
  'function' | 'class' | 'interface' | 'type' | 'struct' | 'enum' | 'trait' | 'method' | 'constant';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  signature: string;
  line: number;
  exported: boolean;
}

export interface ImportInfo {
  specifier: string;
  resolvedPath?: string;
  isRelative: boolean;
  line: number;
}

export interface ParsedFile {
  path: string; // POSIX relative path from repo root
  language: string;
  hash: string; // SHA-256 hex
  sizeBytes: number;
  loc: number;
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
}

export interface FileGraphMetrics {
  fanIn: number;
  fanOut: number;
  importedBy: string[];
  imports: string[];
}

export interface EntryPoint {
  path: string;
  reason: string;
  command?: string;
}

export interface ModuleSummary {
  name: string;
  path: string;
  fileCount: number;
  totalLoc: number;
  purpose: string;
  dependencies: string[];
  topFiles: Array<{ path: string; fanIn: number; loc: number }>;
  keyExports: string[];
}

export interface HotFile {
  path: string;
  score: number;
  fanIn: number;
  fanOut: number;
  churn: number;
  loc: number;
  language: string;
}

export interface RepoMap {
  version: string;
  repoName: string;
  rootPath: string;
  generatedAt: string;
  gitHead?: string;
  stats: {
    totalFiles: number;
    totalLoc: number;
    totalBytes: number;
    languages: Record<string, number>;
    cycleCount: number;
  };
  entryPoints: EntryPoint[];
  modules: ModuleSummary[];
  hotFiles: HotFile[];
  cycles: string[][];
  files: Record<string, ParsedFile>;
  graph: Record<string, FileGraphMetrics>;
}

export type OutputFormat = 'markdown' | 'json' | 'mermaid';

export interface GenerateOptions {
  budget?: number;
  format?: OutputFormat;
  force?: boolean;
  noCache?: boolean;
}

export interface GenerateResult {
  map: RepoMap;
  output: string;
  estimatedTokens: number;
  cachedFiles: number;
  reparsedFiles: number;
  gitignoreSuggested: boolean;
}

export interface CacheData {
  version: string;
  generatedAt: string;
  gitHead?: string;
  files: Record<string, ParsedFile>;
}
