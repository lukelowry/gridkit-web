import { defineConfig } from 'vitest/config';

// The Worker against a stand-in bucket; Cloudflare's runtime never runs under test.
export default defineConfig({ test: { include: ['*.test.ts'], environment: 'node' } });
