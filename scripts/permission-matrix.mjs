#!/usr/bin/env node
/**
 * One check per cell of the permission matrix in task.md § 3 — the definition
 * of done for M1.
 *
 * It drives the real stack through the Next.js rewrite, exactly like a browser:
 * signs in as each seeded persona over the dev Telegram simulator, then calls
 * the endpoint each matrix row describes.
 *
 *   ./scripts/permission-matrix.sh
 *
 * Three outcomes, and the difference matters:
 *
 *   PASS     the cell behaves as § 3 says
 *   FAIL     the cell is wrong — someone can do something they must not, or
 *            cannot do something they must
 *   PENDING  the route does not exist yet. task.md § 12 M1: "Most return
 *            404/403 until their features exist; then they assert the real
 *            behaviour." A PENDING row is a milestone that has not landed; it
 *            is NOT a pass, and the run prints how many are left.
 *
 * A denied child resource and a missing route are both 404 by design (§ 4), so
 * PENDING is decided by an explicit `since` marker on the row, never guessed
 * from the status code.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------- plumbing

const results = [];
let currentGroup = '';

function record(outcome, row, detail) {
  results.push({ outcome, group: currentGroup, row, detail });
}

function group(name) {
  currentGroup = name;
}

/** A cookie jar that is just "the Cookie header we send next time". */
class Jar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
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

/** Every response the harness sees, for the INV-06 sweep at the end. */
const seenBodies = [];

async function call(method, path, { jar, body } = {}) {
  const headers = { 'user-agent': 'zinapo-permission-matrix' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar.header();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (jar) jar.absorb(res);

  const text = await res.text();
  seenBodies.push({ path: `${method} ${path}`, text });

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, text };
}

/**
 * Sign-in rate limits are per phone and per IP (signin.md § 3), and this script
 * logs in ~16 times from one address. Clearing the counters is the same thing
 * scripts/acceptance.sh does — it is a development harness, not a probe to
 * point at production.
 */
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
    if (keys.length) {
      await run('docker', [...compose, 'exec', '-T', 'redis', 'redis-cli', 'del', ...keys]);
    }
  } catch {
    // Without docker access the run still works until a limit trips, and the
    // failure will be an obvious 429 rather than a mystery.
  }
}

/** The full sign-in flow, headless: start → bot shares contact → verify. */
async function signIn(phone) {
  await flushRateLimits();
  const jar = new Jar();

  const start = await call('POST', '/api/auth/telegram/start', {
    jar,
    body: { phone, lang: 'uz' },
  });
  if (start.status !== 200) throw new Error(`start ${phone}: ${start.status} ${start.text}`);

  const sim = await call('POST', '/api/dev/telegram/simulate', {
    body: { link: start.body.deepLink, phone, firstName: 'Matrix', lastName: 'Runner' },
  });
  const spoken = (sim.body?.replies ?? []).map((r) => r.text).join(' ');
  const code = /\*(\d{5})\*/.exec(spoken)?.[1];
  if (!code) throw new Error(`no code for ${phone}: ${sim.text}`);

  const verify = await call('POST', '/api/auth/telegram/verify', {
    jar,
    body: { requestId: start.body.requestId, code },
  });
  if (verify.status !== 200) throw new Error(`verify ${phone}: ${verify.status} ${verify.text}`);

  return jar;
}

// ------------------------------------------------------------ assertions

const DENIED = [401, 403, 404];

/**
 * `expect` is 'allow' or 'deny'. `since` names the milestone that implements
 * the route; when the route is still missing the row is PENDING rather than a
 * free pass.
 */
async function cell({ name, actor, jar, method, path, body, expect, since }) {
  let res;
  try {
    res = await call(method, path, { jar, body });
  } catch (err) {
    record('FAIL', `${name} · ${actor}`, `request failed: ${err.message}`);
    return;
  }

  const label = `${name} · ${actor}`;
  const got = `${method} ${path} → ${res.status}`;

  // An unimplemented route 404s for everyone, including people who will be
  // allowed once it exists. Only an `allow` cell can tell us that.
  if (since && expect === 'allow' && res.status === 404) {
    record('PENDING', label, `${since} not implemented yet (${got})`);
    return;
  }

  if (expect === 'allow') {
    if (res.status >= 200 && res.status < 300) record('PASS', label, got);
    else record('FAIL', label, `expected 2xx, ${got}`);
    return;
  }

  if (DENIED.includes(res.status)) {
    // A deny cell on a route that does not exist is honest but weak: it proves
    // nothing about the policy. Mark it so the count is not flattering.
    if (since && res.status === 404) record('PENDING', label, `${since} not implemented yet (${got})`);
    else record('PASS', label, got);
  } else {
    record('FAIL', label, `expected 401/403/404, ${got}`);
  }
}

/**
 * INV-06, matrix row "See PINFL — ❌ (nobody, ever)".
 *
 * Rather than trust one endpoint, this sweeps EVERY response the harness
 * received — as every persona, including the owner and the super admin — and
 * fails if a PINFL, or the word, ever appears. The fixture numbers are known,
 * so the check is exact rather than a 14-digit heuristic that would trip over
 * timestamps.
 */
const FIXTURE_PINFLS = ['60312160000011', '52108200000022', '60509170000033'];

function assertNoPinflAnywhere() {
  const offenders = seenBodies.filter(
    ({ text }) => /pinfl/i.test(text) || FIXTURE_PINFLS.some((p) => text.includes(p)),
  );
  if (offenders.length === 0) {
    record(
      'PASS',
      'See PINFL · nobody, ever',
      `${seenBodies.length} responses swept, none mention a PINFL`,
    );
    return;
  }
  for (const o of offenders) {
    record('FAIL', 'See PINFL · nobody, ever', `${o.path} leaked a PINFL-shaped value`);
  }
}

// ------------------------------------------------------------------- main

async function main() {
  const health = await call('GET', '/api/health');
  if (health.status !== 200) {
    console.error(`the stack is not answering on ${BASE} — 'docker compose up -d'`);
    process.exit(1);
  }

  // The seed is idempotent and returns the ids the matrix needs.
  const seeded = await call('POST', '/api/dev/seed');
  if (seeded.status !== 200 && seeded.status !== 201) {
    console.error(`seed failed: ${seeded.status} ${seeded.text}`);
    process.exit(1);
  }
  const { people, children } = seeded.body;
  const madina = children.find((c) => c.grade === 4); // owner's child, grade 3–4
  const temur = children.find((c) => c.grade === 1);  // owner's child, grade 0–2
  const sevinch = children.find((c) => c.grade === 3); // the educator's OWN child

  console.log('signing in as each persona…');
  const jars = {};
  for (const [key, person] of Object.entries(people)) {
    jars[key] = await signIn(person.phone);
  }
  const guest = new Jar();

  // ------------------------------------------------------- sign-in & /me
  group('Sign in and role resolution');

  await cell({
    name: 'Sign in / sign up via Telegram', actor: 'guest', jar: guest,
    method: 'POST', path: '/api/auth/telegram/start', body: { phone: '+998900000777', lang: 'uz' },
    expect: 'allow',
  });
  await cell({
    name: 'GET /me', actor: 'guest', jar: guest, method: 'GET', path: '/api/me', expect: 'deny',
  });

  // § 2.2: workspaces are derived, and the seed makes each case real.
  const expectWorkspaces = {
    owner: ['family'],
    coGuardian: ['family'],
    educator: ['educator'],
    educatorParent: ['family', 'educator'],
    bank_editor: ['staff'],
    multiRoleStaff: ['staff'],
  };
  for (const [key, want] of Object.entries(expectWorkspaces)) {
    const me = await call('GET', '/api/me', { jar: jars[key] });
    const got = me.body?.workspaces ?? [];
    const same = want.length === got.length && want.every((w) => got.includes(w));
    record(
      same ? 'PASS' : 'FAIL',
      `workspaces · ${key}`,
      same ? got.join(', ') || '(none)' : `expected [${want}], got [${got}]`,
    );
  }

  // The educator who is also a parent is ONE person with two relationships.
  const nodira = await call('GET', '/api/me', { jar: jars.educatorParent });
  record(
    nodira.body?.family?.ownerOf === 1 && nodira.body?.educator?.status === 'approved'
      ? 'PASS'
      : 'FAIL',
    'INV-01 · one person, two relationships',
    JSON.stringify({ family: nodira.body?.family, educator: nodira.body?.educator }),
  );

  // multiRoleStaff holds item_reviewer AND bank_editor: permissions are the union.
  const multi = await call('GET', '/api/me', { jar: jars.multiRoleStaff });
  const perms = multi.body?.staff?.permissions ?? [];
  record(
    perms.includes('item.review') && perms.includes('form.freeze') ? 'PASS' : 'FAIL',
    'staff permissions are the union of roles',
    perms.join(', '),
  );

  // super_admin does NOT inherit the other roles (task.md § 2.1).
  const su = await call('GET', '/api/me', { jar: jars.super_admin });
  const suPerms = su.body?.staff?.permissions ?? [];
  record(
    suPerms.includes('role.manage') && !suPerms.includes('form.freeze') ? 'PASS' : 'FAIL',
    'super_admin does not inherit other staff roles',
    suPerms.join(', '),
  );

  group('Workspace switching');
  await cell({
    name: 'switch to a workspace you hold', actor: 'owner → family', jar: jars.owner,
    method: 'PUT', path: '/api/me/workspace', body: { workspace: 'family' }, expect: 'allow',
  });
  await cell({
    name: 'switch to a workspace you do not hold', actor: 'owner → staff', jar: jars.owner,
    method: 'PUT', path: '/api/me/workspace', body: { workspace: 'staff' }, expect: 'deny',
  });
  await cell({
    name: 'switch to a workspace you do not hold', actor: 'educator → family', jar: jars.educator,
    method: 'PUT', path: '/api/me/workspace', body: { workspace: 'family' }, expect: 'deny',
  });

  // ------------------------------------------------------------- § 3 rows
  group('Family — children and enrolment');
  const newChild = {
    pinfl: '60312160000099', dob: '2016-12-03', familyName: 'TEST', givenName: 'Child',
    grade: 3, schoolRegionId: 14,
  };
  await cell({ name: 'Create a child profile', actor: 'owner', jar: jars.owner,
    method: 'POST', path: '/api/family/children', body: newChild, expect: 'allow', since: 'M2' });
  await cell({ name: 'Create a child profile', actor: 'co-guardian', jar: jars.coGuardian,
    method: 'POST', path: '/api/family/children', body: newChild, expect: 'deny', since: 'M2' });
  await cell({ name: 'Create a child profile', actor: 'educator (never)', jar: jars.educator,
    method: 'POST', path: '/api/family/children', body: newChild, expect: 'deny', since: 'M2' });
  await cell({ name: 'Create a child profile', actor: 'support staff', jar: jars.support,
    method: 'POST', path: '/api/family/children', body: newChild, expect: 'deny', since: 'M2' });

  await cell({ name: 'Edit child name / enrolment', actor: 'owner', jar: jars.owner,
    method: 'PATCH', path: `/api/family/children/${madina.id}`, body: { givenName: 'Madina' },
    expect: 'allow', since: 'M2' });
  await cell({ name: 'Edit child name / enrolment', actor: 'co-guardian', jar: jars.coGuardian,
    method: 'PATCH', path: `/api/family/children/${madina.id}`, body: { givenName: 'X' },
    expect: 'deny', since: 'M2' });
  await cell({ name: 'Edit child name / enrolment', actor: 'educator', jar: jars.educator,
    method: 'PATCH', path: `/api/family/children/${madina.id}`, body: { givenName: 'X' },
    expect: 'deny', since: 'M2' });

  group('Family — guardians, consents, privacy');
  for (const [actor, jar, expect] of [
    ['owner', jars.owner, 'allow'],
    ['co-guardian', jars.coGuardian, 'deny'],
    ['educator', jars.educator, 'deny'],
  ]) {
    await cell({ name: 'Invite a co-guardian', actor, jar, method: 'POST',
      path: `/api/family/children/${madina.id}/co-guardian-invites`,
      body: { phone: '+998900000888' }, expect, since: 'M2' });
    await cell({ name: 'Transfer ownership', actor, jar, method: 'POST',
      path: `/api/family/children/${madina.id}/ownership-transfer`,
      body: { phone: '+998901110002' }, expect, since: 'M2' });
    await cell({ name: 'Give / revoke consents', actor, jar, method: 'PUT',
      path: `/api/family/children/${madina.id}/consents/marketing`,
      body: { given: true }, expect, since: 'M2' });
    await cell({ name: 'Request anonymisation', actor, jar, method: 'POST',
      path: `/api/family/children/${madina.id}/anonymisation-request`,
      body: {}, expect, since: 'M2' });
    await cell({ name: 'Grant / revoke educator access', actor, jar, method: 'POST',
      path: `/api/family/children/${madina.id}/educators/00000000-0000-0000-0000-000000000000/revoke`,
      body: {}, expect, since: 'M2' });
  }

  group('Reports');
  await cell({ name: 'Parent report, grade 3–4', actor: 'owner', jar: jars.owner,
    method: 'GET', path: `/api/family/children/${madina.id}/report`, expect: 'allow', since: 'M5' });
  await cell({ name: 'Parent report, grade 3–4', actor: 'co-guardian (read only)', jar: jars.coGuardian,
    method: 'GET', path: `/api/family/children/${madina.id}/report`, expect: 'allow', since: 'M5' });
  await cell({ name: 'Parent report, grade 3–4', actor: 'educator, NOT own child', jar: jars.educator,
    method: 'GET', path: `/api/family/children/${madina.id}/report`, expect: 'deny', since: 'M5' });
  await cell({ name: 'Parent report, grade 3–4', actor: 'educator, OWN child', jar: jars.educatorParent,
    method: 'GET', path: `/api/family/children/${sevinch.id}/report`, expect: 'allow', since: 'M5' });
  await cell({ name: 'Parent report, grade 0–2', actor: 'owner', jar: jars.owner,
    method: 'GET', path: `/api/family/children/${temur.id}/report`, expect: 'allow', since: 'M5' });
  await cell({ name: 'Parent report', actor: 'unrelated staff', jar: jars.super_admin,
    method: 'GET', path: `/api/family/children/${madina.id}/report`, expect: 'deny', since: 'M5' });
  await cell({ name: 'Parent report', actor: 'guest', jar: guest,
    method: 'GET', path: `/api/family/children/${madina.id}/report`, expect: 'deny' });

  await cell({ name: 'Educator view of a pupil', actor: 'educator with active link', jar: jars.educator,
    method: 'GET', path: `/api/educator/children/${madina.id}`, expect: 'allow', since: 'M6' });
  await cell({ name: 'Educator view of a pupil', actor: 'educator, link only REQUESTED', jar: jars.educator,
    method: 'GET', path: `/api/educator/children/${temur.id}`, expect: 'deny', since: 'M6' });
  await cell({ name: 'Educator view of a pupil (INV-15: group is not access)',
    actor: 'educator, child in group but no link', jar: jars.educator,
    method: 'GET', path: `/api/educator/children/${temur.id}`, expect: 'deny', since: 'M6' });
  await cell({ name: 'Educator view of a pupil', actor: 'owner', jar: jars.owner,
    method: 'GET', path: `/api/educator/children/${madina.id}`, expect: 'deny', since: 'M6' });

  group('Sessions — kid mode');
  for (const [actor, jar, expect] of [
    ['owner', jars.owner, 'allow'],
    ['co-guardian', jars.coGuardian, 'allow'],
    ['unrelated staff', jars.super_admin, 'deny'],
    ['guest', guest, 'deny'],
  ]) {
    await cell({ name: 'Launch a monitoring session', actor, jar, method: 'POST',
      path: `/api/family/children/${madina.id}/sessions`, body: { waveId: null },
      expect, since: 'M4' });
  }
  await cell({ name: 'Launch a session', actor: 'educator, linked child', jar: jars.educator,
    method: 'POST', path: `/api/family/children/${madina.id}/sessions`, body: {},
    expect: 'deny', since: 'M4' });

  group('Educator workspace');
  await cell({ name: 'Invite parents (bulk phone)', actor: 'approved educator', jar: jars.educator,
    method: 'POST', path: '/api/educator/invites', body: { phones: ['+998900000999'] },
    expect: 'allow', since: 'M6' });
  await cell({ name: 'Invite parents (bulk phone)', actor: 'owner (not an educator)', jar: jars.owner,
    method: 'POST', path: '/api/educator/invites', body: { phones: ['+998900000999'] },
    expect: 'deny', since: 'M6' });
  await cell({ name: 'PINFL + surname match-check', actor: 'approved educator', jar: jars.educator,
    method: 'POST', path: '/api/educator/match-check',
    body: { pinfl: '60312160000011', familyName: 'KARIMOVA' }, expect: 'allow', since: 'M6' });
  await cell({ name: 'PINFL + surname match-check', actor: 'owner', jar: jars.owner,
    method: 'POST', path: '/api/educator/match-check',
    body: { pinfl: '60312160000011', familyName: 'KARIMOVA' }, expect: 'deny', since: 'M6' });
  await cell({ name: 'PINFL + surname match-check', actor: 'trust_safety staff', jar: jars.trust_safety,
    method: 'POST', path: '/api/educator/match-check',
    body: { pinfl: '60312160000011', familyName: 'KARIMOVA' }, expect: 'deny', since: 'M6' });
  await cell({ name: 'Create groups', actor: 'approved educator', jar: jars.educator,
    method: 'POST', path: '/api/educator/groups', body: { name: 'New group', grade: 4 },
    expect: 'allow', since: 'M6' });
  await cell({ name: 'Create groups', actor: 'owner', jar: jars.owner,
    method: 'POST', path: '/api/educator/groups', body: { name: 'New group' },
    expect: 'deny', since: 'M6' });

  group('Staff — item bank');
  await cell({ name: 'Create / edit draft items', actor: 'item_author', jar: jars.item_author,
    method: 'POST', path: '/api/staff/items', body: { topicCode: 'num.addsub', grade: 3, construct: 'x' },
    expect: 'allow', since: 'M3' });
  await cell({ name: 'Create / edit draft items', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'POST', path: '/api/staff/items', body: { topicCode: 'num.addsub', grade: 3, construct: 'x' },
    expect: 'allow', since: 'M3' });
  await cell({ name: 'Create / edit draft items', actor: 'season_manager', jar: jars.season_manager,
    method: 'POST', path: '/api/staff/items', body: {}, expect: 'deny', since: 'M3' });
  await cell({ name: 'Create / edit draft items', actor: 'owner', jar: jars.owner,
    method: 'POST', path: '/api/staff/items', body: {}, expect: 'deny', since: 'M3' });
  await cell({ name: 'Review items', actor: 'item_reviewer', jar: jars.item_reviewer,
    method: 'GET', path: '/api/staff/review-queue', expect: 'allow', since: 'M3' });
  await cell({ name: 'Review items', actor: 'item_author', jar: jars.item_author,
    method: 'GET', path: '/api/staff/review-queue', expect: 'deny', since: 'M3' });
  await cell({ name: 'Approve / retire item, set anchor', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'GET', path: '/api/staff/items', expect: 'allow', since: 'M3' });
  await cell({ name: 'Build / freeze forms', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'POST', path: '/api/staff/forms', body: { mode: 'monitoring', grade: 3, label: 'x' },
    expect: 'allow', since: 'M3' });
  await cell({ name: 'Build / freeze forms', actor: 'item_author', jar: jars.item_author,
    method: 'POST', path: '/api/staff/forms', body: {}, expect: 'deny', since: 'M3' });
  await cell({ name: 'Run calibration', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'POST', path: '/api/staff/calibration-runs', body: { method: 'raw_band_v0' },
    expect: 'allow', since: 'M5' });
  await cell({ name: 'Run calibration', actor: 'season_manager', jar: jars.season_manager,
    method: 'POST', path: '/api/staff/calibration-runs', body: {}, expect: 'deny', since: 'M5' });

  group('Staff — seasons, olympiads, trust, admin');
  await cell({ name: 'Configure seasons / waves', actor: 'season_manager', jar: jars.season_manager,
    method: 'POST', path: '/api/staff/waves', body: { grade: 3, ordinal: 1 },
    expect: 'allow', since: 'M4' });
  await cell({ name: 'Configure seasons / waves', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'POST', path: '/api/staff/waves', body: {}, expect: 'deny', since: 'M4' });
  await cell({ name: 'Register a child for an olympiad', actor: 'owner', jar: jars.owner,
    method: 'POST', path: `/api/family/children/${madina.id}/olympiad/x/register`, body: {},
    expect: 'allow', since: 'M7' });
  await cell({ name: 'Register a child for an olympiad', actor: 'co-guardian', jar: jars.coGuardian,
    method: 'POST', path: `/api/family/children/${madina.id}/olympiad/x/register`, body: {},
    expect: 'deny', since: 'M7' });
  await cell({ name: 'Manage olympiads, venues, awards', actor: 'olympiad_operator',
    jar: jars.olympiad_operator, method: 'GET', path: '/api/staff/olympiads',
    expect: 'allow', since: 'M7' });
  await cell({ name: 'Manage olympiads, venues, awards', actor: 'proctor', jar: jars.proctor,
    method: 'POST', path: '/api/staff/olympiads', body: {}, expect: 'deny', since: 'M7' });
  await cell({ name: 'Run final check-in', actor: 'proctor', jar: jars.proctor,
    method: 'POST', path: '/api/staff/finals/00000000-0000-0000-0000-000000000000/check-in',
    body: {}, expect: 'deny', since: 'M7' });
  await cell({ name: 'Resolve fraud flags, disputes', actor: 'trust_safety', jar: jars.trust_safety,
    method: 'GET', path: '/api/staff/cases', expect: 'allow', since: 'M8' });
  await cell({ name: 'Resolve fraud flags, disputes', actor: 'support', jar: jars.support,
    method: 'GET', path: '/api/staff/cases', expect: 'deny', since: 'M8' });
  await cell({ name: 'Import admission outcomes', actor: 'outcomes_operator',
    jar: jars.outcomes_operator, method: 'POST', path: '/api/staff/outcomes/import', body: {},
    expect: 'allow', since: 'M9' });
  await cell({ name: 'Import admission outcomes', actor: 'super_admin', jar: jars.super_admin,
    method: 'POST', path: '/api/staff/outcomes/import', body: {}, expect: 'deny', since: 'M9' });
  await cell({ name: 'Support lookup by phone', actor: 'support', jar: jars.support,
    method: 'GET', path: '/api/staff/people?phone=%2B998901110001', expect: 'allow', since: 'M9' });
  await cell({ name: 'Support lookup by phone', actor: 'item_author', jar: jars.item_author,
    method: 'GET', path: '/api/staff/people?phone=%2B998901110001', expect: 'deny', since: 'M9' });
  await cell({ name: 'Manage staff roles', actor: 'super_admin', jar: jars.super_admin,
    method: 'GET', path: '/api/staff/roles', expect: 'allow', since: 'M9' });
  await cell({ name: 'Manage staff roles', actor: 'trust_safety', jar: jars.trust_safety,
    method: 'GET', path: '/api/staff/roles', expect: 'deny', since: 'M9' });
  await cell({ name: 'Read the audit log', actor: 'super_admin', jar: jars.super_admin,
    method: 'GET', path: '/api/staff/audit', expect: 'allow', since: 'M9' });
  await cell({ name: 'Read the audit log', actor: 'bank_editor', jar: jars.bank_editor,
    method: 'GET', path: '/api/staff/audit', expect: 'deny', since: 'M9' });

  group('INV-06 — PINFL never leaves the service layer');
  assertNoPinflAnywhere();

  // ------------------------------------------------------------- report
  let last = '';
  for (const r of results) {
    if (r.group !== last) {
      console.log(`\n=== ${r.group} ===`);
      last = r.group;
    }
    const tag = r.outcome.padEnd(7);
    console.log(`  ${tag} ${r.row}${r.outcome === 'PASS' ? '' : `  — ${r.detail}`}`);
  }

  const n = (o) => results.filter((r) => r.outcome === o).length;
  console.log(
    `\n${n('PASS')} passed · ${n('FAIL')} failed · ${n('PENDING')} pending (route not built yet)`,
  );
  if (n('PENDING')) {
    const byMilestone = {};
    for (const r of results.filter((x) => x.outcome === 'PENDING')) {
      const m = /^(M\d)/.exec(r.detail)?.[1] ?? '??';
      byMilestone[m] = (byMilestone[m] ?? 0) + 1;
    }
    console.log(
      `pending by milestone: ${Object.entries(byMilestone)
        .sort()
        .map(([m, c]) => `${m}=${c}`)
        .join(' ')}`,
    );
  }
  process.exit(n('FAIL') ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
