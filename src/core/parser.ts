import { createRequire } from 'node:module';
import path from 'node:path';
import Parser from 'web-tree-sitter';
import type { ScannedFile } from './scanner.js';
import type { ImportInfo, ParsedFile, SymbolInfo, SymbolKind } from './types.js';

const require = createRequire(import.meta.url);

const LANGUAGE_TO_WASM: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
};

let initPromise: Promise<void> | null = null;
const loadedLanguages = new Map<string, Parser.Language | null>();

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  await initPromise;
}

async function getLanguage(lang: string): Promise<Parser.Language | null> {
  if (loadedLanguages.has(lang)) {
    return loadedLanguages.get(lang) ?? null;
  }
  const wasmFile = LANGUAGE_TO_WASM[lang];
  if (!wasmFile) {
    loadedLanguages.set(lang, null);
    return null;
  }

  try {
    await ensureInitialized();
    const wasmDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const wasmPath = path.join(wasmDir, 'out', wasmFile);
    const loaded = await Parser.Language.load(wasmPath);
    loadedLanguages.set(lang, loaded);
    return loaded;
  } catch {
    loadedLanguages.set(lang, null);
    return null;
  }
}

function countLoc(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function oneLineSignature(nodeText: string, maxLen = 110): string {
  const firstLine = (nodeText.split(/\r?\n/)[0] ?? '').trim();
  // Trim trailing opening brace if it's at the end of a signature
  const cleaned = firstLine.replace(/\s*\{\s*$/, '').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + '...';
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

type SyntaxNode = Parser.SyntaxNode;

function extractTsJs(root: SyntaxNode): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];

  for (const child of root.namedChildren) {
    if (child.type === 'import_statement') {
      const source = child.childForFieldName('source');
      if (source) {
        const spec = stripQuotes(source.text);
        imports.push({
          specifier: spec,
          isRelative: spec.startsWith('.'),
          line: child.startPosition.row + 1,
        });
      }
    } else if (child.type === 'export_statement') {
      const source = child.childForFieldName('source');
      if (source) {
        const spec = stripQuotes(source.text);
        imports.push({
          specifier: spec,
          isRelative: spec.startsWith('.'),
          line: child.startPosition.row + 1,
        });
      }
      const decl = child.childForFieldName('declaration');
      if (decl) {
        collectTsJsDecl(decl, true, symbols, exports);
      } else {
        for (const sub of child.namedChildren) {
          if (sub.type === 'export_clause') {
            for (const spec of sub.namedChildren) {
              const nameNode = spec.childForFieldName('name') ?? spec.namedChild(0);
              if (nameNode) exports.add(nameNode.text);
            }
          }
        }
      }
    } else {
      collectTsJsDecl(child, false, symbols, exports);
    }
  }

  // Also scan for CommonJS require('...') at top-level or anywhere
  walkTree(root, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn?.text === 'require' && args && args.namedChildCount > 0) {
        const firstArg = args.namedChild(0);
        if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
          const spec = stripQuotes(firstArg.text);
          if (!spec.includes('${')) {
            imports.push({
              specifier: spec,
              isRelative: spec.startsWith('.'),
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    }
  });

  return { imports, exports: Array.from(exports), symbols };
}

function collectTsJsDecl(
  node: SyntaxNode,
  exported: boolean,
  symbols: SymbolInfo[],
  exports: Set<string>,
): void {
  const kindMap: Record<string, SymbolKind> = {
    function_declaration: 'function',
    generator_function_declaration: 'function',
    class_declaration: 'class',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
  };

  const kind = kindMap[node.type];
  if (kind) {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text ?? 'default';
    if (exported) exports.add(name);
    symbols.push({
      name,
      kind,
      signature: oneLineSignature(node.text),
      line: node.startPosition.row + 1,
      exported,
    });
    return;
  }

  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (const declarator of node.namedChildren) {
      if (declarator.type === 'variable_declarator') {
        const nameNode = declarator.childForFieldName('name');
        const valueNode = declarator.childForFieldName('value');
        if (!nameNode) continue;
        const name = nameNode.text;
        const isFunc =
          valueNode?.type === 'arrow_function' ||
          valueNode?.type === 'function_expression' ||
          valueNode?.type === 'function';
        if (exported) exports.add(name);
        if (isFunc || exported) {
          symbols.push({
            name,
            kind: isFunc ? 'function' : 'constant',
            signature: oneLineSignature(node.text),
            line: node.startPosition.row + 1,
            exported,
          });
        }
      }
    }
  }
}

function extractPython(root: SyntaxNode): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];

  for (const child of root.namedChildren) {
    if (child.type === 'import_statement') {
      for (const nameNode of child.namedChildren) {
        if (nameNode.type === 'dotted_name') {
          imports.push({
            specifier: nameNode.text,
            isRelative: false,
            line: child.startPosition.row + 1,
          });
        } else if (nameNode.type === 'aliased_import') {
          const target = nameNode.childForFieldName('name');
          if (target) {
            imports.push({
              specifier: target.text,
              isRelative: false,
              line: child.startPosition.row + 1,
            });
          }
        }
      }
    } else if (child.type === 'import_from_statement') {
      const modNode = child.childForFieldName('module_name');
      if (modNode) {
        const spec = modNode.text;
        imports.push({
          specifier: spec,
          isRelative: spec.startsWith('.'),
          line: child.startPosition.row + 1,
        });
      }
    } else {
      const target =
        child.type === 'decorated_definition' ? child.childForFieldName('definition') : child;
      if (target && (target.type === 'function_definition' || target.type === 'class_definition')) {
        const nameNode = target.childForFieldName('name');
        const name = nameNode?.text ?? 'anonymous';
        const isExported = !name.startsWith('_');
        if (isExported) exports.add(name);
        symbols.push({
          name,
          kind: target.type === 'class_definition' ? 'class' : 'function',
          signature: oneLineSignature(target.text).replace(/:$/, ''),
          line: target.startPosition.row + 1,
          exported: isExported,
        });
      }
    }
  }

  return { imports, exports: Array.from(exports), symbols };
}

function extractGo(root: SyntaxNode): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];

  walkTree(root, (node) => {
    if (node.type === 'import_spec') {
      const pathNode = node.childForFieldName('path');
      if (pathNode) {
        const spec = stripQuotes(pathNode.text);
        imports.push({
          specifier: spec,
          isRelative: spec.startsWith('.'),
          line: node.startPosition.row + 1,
        });
      }
    }
  });

  for (const child of root.namedChildren) {
    if (child.type === 'function_declaration' || child.type === 'method_declaration') {
      const nameNode = child.childForFieldName('name');
      const name = nameNode?.text ?? 'func';
      const exported = /^[A-Z]/.test(name);
      if (exported) exports.add(name);
      symbols.push({
        name,
        kind: child.type === 'method_declaration' ? 'method' : 'function',
        signature: oneLineSignature(child.text),
        line: child.startPosition.row + 1,
        exported,
      });
    } else if (child.type === 'type_declaration') {
      for (const spec of child.namedChildren) {
        if (spec.type === 'type_spec') {
          const nameNode = spec.childForFieldName('name');
          const typeNode = spec.childForFieldName('type');
          const name = nameNode?.text ?? 'type';
          const exported = /^[A-Z]/.test(name);
          if (exported) exports.add(name);
          const kind: SymbolKind =
            typeNode?.type === 'struct_type'
              ? 'struct'
              : typeNode?.type === 'interface_type'
                ? 'interface'
                : 'type';
          symbols.push({
            name,
            kind,
            signature: oneLineSignature(spec.text),
            line: spec.startPosition.row + 1,
            exported,
          });
        }
      }
    }
  }

  return { imports, exports: Array.from(exports), symbols };
}

function extractRust(root: SyntaxNode): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];

  for (const child of root.namedChildren) {
    if (child.type === 'use_declaration') {
      const arg = child.childForFieldName('argument');
      if (arg) {
        const spec = arg.text.replace(/;$/, '').trim();
        imports.push({
          specifier: spec,
          isRelative:
            spec.startsWith('crate::') || spec.startsWith('super::') || spec.startsWith('self::'),
          line: child.startPosition.row + 1,
        });
      }
    } else if (child.type === 'mod_item' && !child.childForFieldName('body')) {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        imports.push({
          specifier: nameNode.text,
          isRelative: true,
          line: child.startPosition.row + 1,
        });
      }
    } else {
      const kindMap: Record<string, SymbolKind> = {
        function_item: 'function',
        struct_item: 'struct',
        enum_item: 'enum',
        trait_item: 'trait',
        type_item: 'type',
      };
      const kind = kindMap[child.type];
      if (kind) {
        const nameNode = child.childForFieldName('name');
        const name = nameNode?.text ?? 'item';
        const isPub = child.namedChildren.some((c) => c.type === 'visibility_modifier');
        if (isPub) exports.add(name);
        symbols.push({
          name,
          kind,
          signature: oneLineSignature(child.text),
          line: child.startPosition.row + 1,
          exported: isPub,
        });
      }
    }
  }

  return { imports, exports: Array.from(exports), symbols };
}

function extractJava(root: SyntaxNode): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];

  for (const child of root.namedChildren) {
    if (child.type === 'import_declaration') {
      const spec = child.text
        .replace(/^import\s+(?:static\s+)?/, '')
        .replace(/;\s*$/, '')
        .trim();
      imports.push({
        specifier: spec,
        isRelative: false,
        line: child.startPosition.row + 1,
      });
    } else if (
      child.type === 'class_declaration' ||
      child.type === 'interface_declaration' ||
      child.type === 'enum_declaration'
    ) {
      const nameNode = child.childForFieldName('name');
      const name = nameNode?.text ?? 'Class';
      const isPublic = child.text.trimStart().startsWith('public ');
      if (isPublic) exports.add(name);
      const kind: SymbolKind =
        child.type === 'interface_declaration'
          ? 'interface'
          : child.type === 'enum_declaration'
            ? 'enum'
            : 'class';
      symbols.push({
        name,
        kind,
        signature: oneLineSignature(child.text),
        line: child.startPosition.row + 1,
        exported: isPublic,
      });

      const body = child.childForFieldName('body');
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === 'method_declaration') {
            const mName = member.childForFieldName('name')?.text;
            if (mName) {
              symbols.push({
                name: `${name}.${mName}`,
                kind: 'method',
                signature: oneLineSignature(member.text),
                line: member.startPosition.row + 1,
                exported: member.text.trimStart().startsWith('public '),
              });
            }
          }
        }
      }
    }
  }

  return { imports, exports: Array.from(exports), symbols };
}

function walkTree(node: SyntaxNode, visitor: (n: SyntaxNode) => void): void {
  visitor(node);
  for (const child of node.namedChildren) {
    walkTree(child, visitor);
  }
}

function extractFallbackRegex(content: string): {
  imports: ImportInfo[];
  exports: string[];
  symbols: SymbolInfo[];
} {
  const imports: ImportInfo[] = [];
  const exports = new Set<string>();
  const symbols: SymbolInfo[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    // Generic import / include / require patterns
    const esmMatch = line.match(/^\s*(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/);
    if (esmMatch?.[1]) {
      imports.push({
        specifier: esmMatch[1],
        isRelative: esmMatch[1].startsWith('.'),
        line: lineNo,
      });
    }

    const cInclude = line.match(/^\s*#include\s+"([^"]+)"/);
    if (cInclude?.[1]) {
      imports.push({
        specifier: `./${cInclude[1]}`,
        isRelative: true,
        line: lineNo,
      });
    }

    const fnMatch = line.match(
      /^\s*(?:export\s+)?(?:async\s+)?(?:function|def|fn|func|class|struct|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    if (fnMatch?.[1]) {
      const name = fnMatch[1];
      const exported = /^\s*export\b/.test(line);
      if (exported) exports.add(name);
      symbols.push({
        name,
        kind: /\bclass\b/.test(line)
          ? 'class'
          : /\bstruct\b/.test(line)
            ? 'struct'
            : /\binterface\b/.test(line)
              ? 'interface'
              : 'function',
        signature: oneLineSignature(line),
        line: lineNo,
        exported,
      });
    }
  }

  return { imports, exports: Array.from(exports), symbols };
}

/**
 * Parse a single scanned file using web-tree-sitter (for TS/JS/Python/Go/Rust/Java)
 * or regex fallback for other languages.
 */
export async function parseFile(file: ScannedFile): Promise<ParsedFile> {
  const loc = countLoc(file.content);
  const lang = await getLanguage(file.language);

  let extracted: { imports: ImportInfo[]; exports: string[]; symbols: SymbolInfo[] };

  if (lang) {
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(file.content);
    const root = tree.rootNode;

    switch (file.language) {
      case 'typescript':
      case 'tsx':
      case 'javascript':
        extracted = extractTsJs(root);
        break;
      case 'python':
        extracted = extractPython(root);
        break;
      case 'go':
        extracted = extractGo(root);
        break;
      case 'rust':
        extracted = extractRust(root);
        break;
      case 'java':
        extracted = extractJava(root);
        break;
      default:
        extracted = extractFallbackRegex(file.content);
    }
    tree.delete();
    parser.delete();
  } else {
    extracted = extractFallbackRegex(file.content);
  }

  return {
    path: file.path,
    language: file.language,
    hash: file.hash,
    sizeBytes: file.sizeBytes,
    loc,
    imports: extracted.imports,
    exports: extracted.exports,
    symbols: extracted.symbols,
  };
}
