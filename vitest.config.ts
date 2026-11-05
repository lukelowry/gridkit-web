import { defineConfig } from 'vitest/config';

// One `pnpm test` across the workspace; each project keeps its own configuration.
export default defineConfig({ test: { projects: ['packages/*', 'services/library'] } });
