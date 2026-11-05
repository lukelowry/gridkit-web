// The UI's browser policy as the image's Caddyfile imports it: `node headers.ts > headers.caddy`.
import headers from '../../packages/ui/headers.json' with { type: 'json' };

process.stdout.write(`header {\n${Object.entries(headers).map(([name, value]) => `\t${JSON.stringify(name)} ${JSON.stringify(value)}\n`).join('')}}\n`);
