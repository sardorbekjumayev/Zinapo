#!/usr/bin/env node
/**
 * Development only: signs a phone in through the Telegram simulator and prints
 * the session cookies as JSON, ready for a browser context:
 *
 *   node scripts/dev-login.mjs +998901110001
 *   → [{"name":"zn_at","value":"…","domain":"localhost","path":"/"}, …]
 *
 * Seeded numbers: ./scripts/seed.sh prints them. Any other +99890xxxxxxx signs
 * in as a brand-new person with no role (onboarding).
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const phone = process.argv[2];
if (!phone) {
  console.error('usage: node scripts/dev-login.mjs +998901110001');
  process.exit(1);
}

try {
  const root = new URL('..', import.meta.url).pathname;
  const compose = ['compose', '--project-directory', root, 'exec', '-T', 'redis', 'redis-cli'];
  const keys = execFileSync('docker', [...compose, '--scan', '--pattern', 'rl:*'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  if (keys.length) execFileSync('docker', [...compose, 'del', ...keys]);
} catch {}

const jar = new Map();
async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    body: JSON.stringify(body),
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const start = await call('/api/auth/telegram/start', { phone, lang: 'uz' });
if (start.status !== 200) throw new Error(`start: ${start.status} ${JSON.stringify(start.body)}`);
const sim = await call('/api/dev/telegram/simulate', { link: start.body.deepLink, phone, firstName: 'Dev', lastName: 'User' });
const code = /\*(\d{5})\*/.exec((sim.body.replies ?? []).map((r) => r.text).join(' '))?.[1];
if (!code) throw new Error(`no code: ${JSON.stringify(sim.body)}`);
const verify = await call('/api/auth/telegram/verify', { requestId: start.body.requestId, code });
if (verify.status !== 200) throw new Error(`verify: ${verify.status}`);

console.log(JSON.stringify(
  [...jar].filter(([k, v]) => k.startsWith('zn_') && v).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })),
));
