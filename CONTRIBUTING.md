# Contributing to repomap

Thank you for your interest in contributing to **repomap**!

## Development Setup

```bash
git clone https://github.com/rohanpandityy35-bit/repomap.git
cd repomap
npm install
npm run build
npm test
```

## Scripts

- `npm run build` — Compile TypeScript to `dist/`
- `npm test` — Run the Vitest unit & integration test suite
- `npm run lint` — Run ESLint across `src/` and `tests/`
- `npm run format:check` — Verify Prettier formatting

## Pull Request Guidelines

1. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
2. Add or update tests in `tests/` for any new parser, graph resolver, CLI command, or MCP tool behavior.
3. Ensure `npm run lint`, `npm run format:check`, `npm run build`, and `npm test` all pass before opening a PR.
4. Keep runtime behavior 100% local with zero network calls.
