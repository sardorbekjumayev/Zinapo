#!/usr/bin/env node
/**
 * Checks the dashboard router and the workspace shells end to end
 * (task.md § 2.2 and § 7) against the running stack.
 *
 *   ./scripts/routing.sh
 *
 * Signs in as each seeded persona and asserts where /dashboard sends them,
 * that each workspace renders for the people who hold it, and that it bounces
 * the people who do not.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const results = [];
function record(ok, name, detail) {
  results.push({ ok, name, detail });
}

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function call(method, path, { jar, body, follow = false } = {}) {
  const headers = { 'user-agent': 'zinapo-routing' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: follow ? 'follow' : 'manual',
  });
  if (jar) jar.absorb(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, location: res.headers.get('location'), body: json, text };
}

async function flushRateLimits() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const compose = ['compose', '--project-directory', new URL('..', import.meta.url).pathname];
  try {
    const { stdout } = await run('docker', [
      ...compose, 'exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*',
    ]);
    const keys = stdout.split('\n').filter(Boolean);
    if (keys.length) await run('docker', [...compose, 'exec', '-T', 'redis', 'redis-cli', 'del', ...keys]);
  } catch {
    /* without docker access this still works until a limit trips */
  }
}

async function signIn(phone) {
  await flushRateLimits();
  const jar = new Jar();
  const start = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  if (start.status !== 200) throw new Error(`start ${phone}: ${start.status} ${start.text}`);
  const sim = await call('POST', '/api/dev/telegram/simulate', {
    body: { link: start.body.deepLink, phone, firstName: 'Route', lastName: 'Check' },
  });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  if (!code) throw new Error(`no code for ${phone}: ${sim.text}`);
  const verify = await call('POST', '/api/auth/telegram/verify', {
    jar,
    body: { requestId: start.body.requestId, code },
  });
  if (verify.status !== 200) throw new Error(`verify ${phone}: ${verify.status} ${verify.text}`);
  return jar;
}

/** Follows 3xx hops by hand so each step is visible when something is wrong. */
async function trail(path, jar, max = 5) {
  const hops = [path];
  let current = path;
  for (let i = 0; i < max; i += 1) {
    const res = await call('GET', current, { jar });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, BASE).pathname + (new URL(res.location, BASE).search || '');
      hops.push(current);
      continue;
    }
    return { hops, status: res.status, text: res.text };
  }
  return { hops, status: 0, text: 'too many redirects' };
}

/**
 * `want` is compared on the PATH only. A redirect to sign-in legitimately
 * carries `?next=`, and asserting on the query would be asserting on something
 * the test does not care about.
 */
async function expectLandsOn(name, jar, from, want) {
  const t = await trail(from, jar);
  const last = t.hops[t.hops.length - 1];
  const ok = last.split('?')[0] === want && t.status === 200;
  record(ok, name, ok ? t.hops.join(' → ') : `${t.hops.join(' → ')} [${t.status}], wanted ${want}`);
}

async function expectRenders(name, jar, path, mustContain) {
  const t = await trail(path, jar);
  const last = t.hops[t.hops.length - 1];
  if (last.split('?')[0] !== path || t.status !== 200) {
    record(false, name, `${t.hops.join(' → ')} [${t.status}]`);
    return;
  }
  const missing = mustContain.filter((s) => !t.text.includes(s));
  record(missing.length === 0, name, missing.length ? `missing: ${missing.join(', ')}` : '200');
}

async function main() {
  if ((await call('GET', '/api/health')).status !== 200) {
    console.error(`the stack is not answering on ${BASE}`);
    process.exit(1);
  }
  const seeded = await call('POST', '/api/dev/seed');
  const people = seeded.body?.people;
  if (!people) {
    console.error(`seed failed: ${seeded.status} ${seeded.text}`);
    process.exit(1);
  }

  console.log('signing in…');
  const jars = {};
  for (const key of ['owner', 'coGuardian', 'educator', 'educatorParent', 'bank_editor', 'item_author']) {
    jars[key] = await signIn(people[key].phone);
  }
  const guest = new Jar();

  console.log('checking routes…\n');

  // ---- § 2.2, the dashboard router -------------------------------------
  await expectLandsOn('guest on /dashboard → sign-in', guest, '/uz/dashboard', '/uz/sign-in');
  await expectLandsOn('owner → family', jars.owner, '/uz/dashboard', '/uz/family');
  await expectLandsOn('co-guardian → family', jars.coGuardian, '/uz/dashboard', '/uz/family');
  await expectLandsOn('educator → educator', jars.educator, '/uz/dashboard', '/uz/educator');
  await expectLandsOn('bank_editor → staff', jars.bank_editor, '/uz/dashboard', '/uz/staff');
  await expectLandsOn('item_author → staff', jars.item_author, '/uz/dashboard', '/uz/staff');

  // Two workspaces: lastWorkspace decides, and PUT /me/workspace sets it.
  await call('PUT', '/api/me/workspace', { jar: jars.educatorParent, body: { workspace: 'educator' } });
  await expectLandsOn(
    'two workspaces → lastWorkspace (educator)',
    jars.educatorParent,
    '/uz/dashboard',
    '/uz/educator',
  );
  await call('PUT', '/api/me/workspace', { jar: jars.educatorParent, body: { workspace: 'family' } });
  await expectLandsOn(
    'two workspaces → lastWorkspace (family)',
    jars.educatorParent,
    '/uz/dashboard',
    '/uz/family',
  );

  // ---- § 7, the workspace gate ----------------------------------------
  await expectLandsOn('owner on /staff → bounced', jars.owner, '/uz/staff', '/uz/family');
  await expectLandsOn('owner on /educator → bounced', jars.owner, '/uz/educator', '/uz/family');
  await expectLandsOn('educator on /family → bounced', jars.educator, '/uz/family', '/uz/educator');
  await expectLandsOn('bank_editor on /family → bounced', jars.bank_editor, '/uz/family', '/uz/staff');
  await expectLandsOn('guest on /staff → sign-in', guest, '/uz/staff', '/uz/sign-in');

  // ---- the shells render, in the right language ------------------------
  await expectRenders('family shell renders', jars.owner, '/uz/family', [
    'Zinapo',
    'FARZANDLAR',        // nav group, uz
    'Dilnoza Karimova',  // the crumb
  ]);
  await expectRenders('educator shell renders', jars.educator, '/uz/educator', [
    'GURUHLAR',
    'Aziza Rakhimovna',
  ]);
  await expectRenders('staff shell renders, role-aware', jars.bank_editor, '/uz/staff', [
    'NAVBATLAR',
    'Bank muharriri',    // the role name in the crumb
    'Kalibrlash',        // bank_editor unlocks calibration
  ]);

  // An item author must NOT see the bank editor's queues in the rail.
  const author = await trail('/uz/staff', jars.item_author);
  record(
    !author.text.includes('Kalibrlash') && author.text.includes('Savollar banki'),
    'staff rail hides queues the role does not hold',
    author.text.includes('Kalibrlash') ? 'item_author was shown Kalibrlash' : 'ok',
  );

  // The switcher appears only with more than one workspace.
  const single = await trail('/uz/family', jars.owner);
  const dual = await trail('/uz/family', jars.educatorParent);
  record(
    !single.text.includes('Ish maydoni') && dual.text.includes('Ish maydoni'),
    'workspace switcher shows only when there are two',
    `owner=${single.text.includes('Ish maydoni')} educatorParent=${dual.text.includes('Ish maydoni')}`,
  );

  // ---- locales and the always-reachable pages --------------------------
  await expectRenders('ru renders', jars.owner, '/ru/family', ['ДЕТИ', 'Родитель']);
  await expectRenders('en renders', jars.owner, '/en/family', ['CHILDREN', 'Parent']);
  await expectRenders('profile reachable from any workspace', jars.bank_editor, '/uz/profile', [
    'Telegram',
    '+99890',             // the masked phone
  ]);
  await expectRenders('kid mode has no nav rail', jars.owner, '/uz/play/demo-session', ['Zinapo']);
  const kid = await trail('/uz/play/demo-session', jars.owner);
  record(!kid.text.includes('ws__nav'), 'kid mode really has no rail', kid.text.includes('ws__nav') ? 'rail present' : 'ok');

  // INV-06, again: no PINFL in any rendered page.
  const pinflLeak = [single.text, dual.text, author.text, kid.text].some((t) => /pinfl/i.test(t));
  record(!pinflLeak, 'no PINFL in any rendered page', pinflLeak ? 'found one' : 'ok');

  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  — ${r.detail}`}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed · ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
