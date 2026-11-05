import { defineConfig } from 'vitest/config';

// The case model, and each way to reach a library against stand-ins for what it reads: a service's answers, a folder's handles.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
