#!/usr/bin/env node
/**
 * M2 — Family & identity, driven end to end (task.md § 12 M2, § 8.1, § 8.2).
 *
 *   ./scripts/family-flows.sh
 *
 * The permission matrix proves WHO may call each route; this proves the routes
 * DO the right thing: the PINFL checks, the duplicate dispute, the fifth-child
 * review, co-guardian invites, ownership transfer, educator access decisions,
 * consents and anonymisation.
 *
 * Every run signs in fresh people with random numbers and creates fresh
 * children, so it never disturbs the seed and can run any number of times.
 * Educator access REQUESTS are M6, so the script inserts one directly in the
 * database, the same way scripts/acceptance.sh reaches into Redis.
 */

import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROOT = new URL('..', import.meta.url).pathname;

const results = [];
let section = '';
const check = (ok, name, detail = '') => results.push({ ok: !!ok, section, name, detail });
const group = (name) => (section = name);

// ---------------------------------------------------------------- plumbing

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

const bodies = [];

async function call(method, path, { jar, body } = {}) {
  const headers = { 'user-agent': 'zinapo-family-flows' };
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
  bodies.push({ path: `${method} ${path}`, text });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, text };
}

function docker(...args) {
  return execFileSync('docker', ['compose', '--project-directory', ROOT, ...args], {
    encoding: 'utf8',
  });
}

function sql(query) {
  return docker('exec', '-T', 'db', 'psql', '-U', 'zinapo', '-d', 'zinapo', '-Atq', '-c', query).trim();
}

function flushRateLimits() {
  try {
    const keys = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*')
      .split('\n')
      .filter(Boolean);
    if (keys.length) docker('exec', '-T', 'redis', 'redis-cli', 'del', ...keys);
  } catch {
    // Without docker the run still works until a limit trips.
  }
}

async function signIn(phone, firstName = 'Flow') {
  flushRateLimits();
  const jar = new Jar();
  const start = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  if (start.status !== 200) throw new Error(`start ${phone}: ${start.status} ${start.text}`);
  const sim = await call('POST', '/api/dev/telegram/simulate', {
    body: { link: start.body.deepLink, phone, firstName, lastName: 'Tester' },
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

const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;

/** A well-formed PINFL for a DOB: century/sex digit, DDMMYY, a random tail. */
function pinflFor(dob, sex = 'f') {
  const [y, m, d] = dob.split('-');
  const century = Number(y) >= 2000 ? (sex === 'm' ? 5 : 6) : sex === 'm' ? 3 : 4;
  return `${century}${d}${m}${y.slice(2)}${rand(7)}`;
}

function childBody(overrides = {}) {
  const dob = overrides.dob ?? '2017-04-09';
  return {
    pinfl: pinflFor(dob),
    familyName: 'SINOVOVA',
    givenName: 'Malika',
    patronymic: 'Testovna',
    dob,
    grade: 3,
    schoolRegionId: 11,
    consents: [
      { type: 'data_processing', given: true },
      { type: 'third_party_transfer', given: false },
      { type: 'marketing', given: true },
    ],
    ...overrides,
  };
}

// --------------------------------------------------------------------- main

async function main() {
  if ((await call('GET', '/api/health')).status !== 200) {
    console.error(`the stack is not answering on ${BASE}`);
    process.exit(1);
  }
  const seeded = (await call('POST', '/api/dev/seed')).body;
  const azizaId = seeded.people.educator.personId;

  const ownerPhone = freshPhone();
  const partnerPhone = freshPhone();
  const strangerPhone = freshPhone();
  const owner = await signIn(ownerPhone, 'Ona');
  const partner = await signIn(partnerPhone, 'Ota');
  const stranger = await signIn(strangerPhone, 'Begona');

  // ------------------------------------------------------- the wizard
  group('Add a child — validation');

  const can = await call('GET', '/api/family/children/can-create', { jar: owner });
  check(can.body?.canCreate === true, 'a person with no role yet may add a child (onboarding)');

  const malformed = await call('POST', '/api/family/children', {
    jar: owner, body: childBody({ pinfl: '7123' }),
  });
  check(malformed.status === 400, 'malformed PINFL → 400', `${malformed.status}`);

  const base = childBody();
  const mismatch = await call('POST', '/api/family/children', {
    jar: owner, body: { ...base, dob: '2017-04-10' },
  });
  check(
    mismatch.status === 400 && mismatch.body?.error === 'PINFL_DOB_MISMATCH',
    'DOB that disagrees with the PINFL is a hard stop',
    `${mismatch.status} ${mismatch.body?.error}`,
  );

  const noConsent = await call('POST', '/api/family/children', {
    jar: owner,
    body: { ...base, consents: [{ type: 'data_processing', given: false }] },
  });
  check(
    noConsent.status === 400 && noConsent.body?.error === 'CONSENT_REQUIRED',
    'data_processing consent is required',
    `${noConsent.status} ${noConsent.body?.error}`,
  );

  group('Add a child — create');
  const created = await call('POST', '/api/family/children', { jar: owner, body: base });
  check(created.status === 201 && created.body?.id, 'owner creates the child → 201', `${created.status}`);
  const childId = created.body?.id;

  const again = await call('POST', '/api/family/children', { jar: owner, body: base });
  check(
    again.status === 200 && again.body?.alreadyYours && again.body?.id === childId,
    're-submitting your own child is idempotent (no duplicate, no dispute)',
    `${again.status} ${JSON.stringify(again.body)}`,
  );

  const list = await call('GET', '/api/family/children', { jar: owner });
  const mine = (list.body ?? []).find((c) => c.id === childId);
  check(
    mine?.via === 'owner' && mine?.grade === 3 && mine?.schoolRegionId === 11,
    'the child is listed with role, grade and school region',
    JSON.stringify(mine),
  );

  const me = await call('GET', '/api/me', { jar: owner });
  check(me.body?.workspaces?.includes('family'), 'the creator now has the family workspace');

  const consents = await call('GET', `/api/family/children/${childId}/consents`, { jar: owner });
  const byType = Object.fromEntries((consents.body ?? []).map((c) => [c.type, c]));
  check(
    byType.data_processing?.given && !byType.third_party_transfer?.given && byType.marketing?.given,
    'the three consents are stored separately, as given in the wizard',
    JSON.stringify(consents.body?.map((c) => [c.type, c.given])),
  );

  group('Add a child — duplicate and fifth child');
  const dup = await call('POST', '/api/family/children', { jar: stranger, body: base });
  check(
    dup.status === 409 && dup.body?.error === 'CHILD_ALREADY_REGISTERED' && dup.body?.details?.caseId,
    'someone else with the same PINFL → 409 with a dispute case, no duplicate',
    `${dup.status} ${dup.body?.error}`,
  );
  check(
    !/Ona|Tester|\+998/.test(dup.text.replace(/"message":"[^"]*"/, '')),
    'the claimant learns nothing about the owner',
  );
  const caseId = dup.body?.details?.caseId;
  const confirm = await call('POST', `/api/family/ownership-disputes/${caseId}/confirm`, {
    jar: stranger,
  });
  check(
    confirm.status === 200 && /^D-[0-9A-F]{8}$/.test(confirm.body?.reference ?? ''),
    'the claimant confirms the dispute and gets a request number',
    `${confirm.status} ${confirm.body?.reference}`,
  );
  const hijack = await call('POST', `/api/family/ownership-disputes/${caseId}/confirm`, {
    jar: partner,
  });
  check(hijack.status === 404, 'nobody else can confirm someone’s dispute', `${hijack.status}`);
  check(
    sql(`SELECT count(*) FROM review_case WHERE id = '${caseId}' AND kind = 'ownership_dispute'`) === '1',
    'the ownership_dispute case is in the trust & safety queue',
  );

  for (const [i, dob] of ['2018-01-15', '2019-02-16', '2020-03-17'].entries()) {
    const r = await call('POST', '/api/family/children', {
      jar: owner,
      body: childBody({ dob, givenName: `Bola${i}`, grade: 1 }),
    });
    if (r.status !== 201) check(false, `filling up to four children (#${i + 2})`, `${r.status} ${r.text}`);
  }
  const fifth = await call('POST', '/api/family/children', {
    jar: owner, body: childBody({ dob: '2021-05-18', givenName: 'Beshinchi', grade: 0 }),
  });
  check(
    fifth.status === 202 && fifth.body?.error === 'FIFTH_CHILD_REVIEW' && fifth.body?.details?.caseId,
    'the fifth child opens a manual review instead of failing',
    `${fifth.status} ${fifth.body?.error}`,
  );
  const owned = (await call('GET', '/api/family/children', { jar: owner })).body ?? [];
  check(owned.length === 4, 'and no fifth profile was created', `${owned.length} children`);

  // ----------------------------------------------------- enrolment history
  group('Enrolment history');
  const sch = await call('GET', '/api/reference/schools?regionId=14', { jar: owner });
  const school = (sch.body ?? [])[0];
  const enrol = await call('POST', `/api/family/children/${childId}/enrolments`, {
    jar: owner,
    body: { schoolYear: 2026, grade: 4, schoolRegionId: 14, schoolId: school?.id },
  });
  check(enrol.status === 201 && enrol.body?.length === 2, 'a school change adds an enrolment', `${enrol.status}`);
  const live = (enrol.body ?? []).filter((e) => !e.endedAt);
  check(
    live.length === 1 && live[0].grade === 4 && live[0].schoolRegionId === 14,
    'the previous enrolment is closed, not edited (history kept)',
  );
  const wrongRegion = await call('POST', `/api/family/children/${childId}/enrolments`, {
    jar: owner,
    body: { schoolYear: 2026, grade: 4, schoolRegionId: 8, schoolId: school?.id },
  });
  check(wrongRegion.status === 404, 'a school outside the chosen region is refused', `${wrongRegion.status}`);
  const regions = await call('GET', '/api/reference/regions', { jar: owner });
  check(regions.body?.length === 14, '14 regions for the wizard');

  // --------------------------------------------------------- co-guardian
  group('Co-guardian invite');
  const inv = await call('POST', `/api/family/children/${childId}/co-guardian-invites`, {
    jar: owner, body: { phone: partnerPhone.replace('+998', '') },
  });
  check(inv.status === 201 && inv.body?.phone?.includes('•••'), 'owner invites by phone (masked back)', `${inv.status}`);

  const incoming = await call('GET', '/api/family/guardian-invites', { jar: partner });
  const code = incoming.body?.[0]?.code;
  check(
    incoming.body?.length === 1 && incoming.body[0].kind === 'co_guardian',
    'the invitee sees it after signing in with that phone',
  );
  const notMine = await call('GET', `/api/family/guardian-invites/${code}`, { jar: stranger });
  check(notMine.status === 400 || notMine.status === 404, 'a forwarded link is useless to anyone else', `${notMine.status}`);
  const strangerAccept = await call('POST', `/api/family/guardian-invites/${code}/accept`, { jar: stranger });
  check(strangerAccept.status >= 400, 'and cannot be accepted by them', `${strangerAccept.status}`);

  const accepted = await call('POST', `/api/family/guardian-invites/${code}/accept`, { jar: partner });
  check(accepted.status === 200 && accepted.body?.role === 'co_guardian', 'the invitee accepts', `${accepted.status}`);
  const reuse = await call('POST', `/api/family/guardian-invites/${code}/accept`, { jar: partner });
  check(reuse.status === 400, 'an invite works once', `${reuse.status}`);

  const partnerView = await call('GET', `/api/family/children/${childId}`, { jar: partner });
  check(partnerView.status === 200 && partnerView.body?.via === 'co_guardian', 'the co-guardian sees the child, read-only');
  const partnerEdit = await call('PATCH', `/api/family/children/${childId}`, {
    jar: partner, body: { givenName: 'X' },
  });
  check(partnerEdit.status === 404, 'and cannot edit it', `${partnerEdit.status}`);
  const partnerConsent = await call('PUT', `/api/family/children/${childId}/consents/marketing`, {
    jar: partner, body: { given: false },
  });
  check(partnerConsent.status === 404, 'nor change consents', `${partnerConsent.status}`);
  const partnerCreate = await call('GET', '/api/family/children/can-create', { jar: partner });
  check(partnerCreate.body?.canCreate === false, 'a co-guardian is not offered "add a child" (note M2-c)');

  // ------------------------------------------------------ ownership transfer
  group('Ownership transfer');
  const strangerTransfer = await call('POST', `/api/family/children/${childId}/ownership-transfer`, {
    jar: owner, body: { phone: strangerPhone },
  });
  check(
    strangerTransfer.status === 400 && strangerTransfer.body?.error === 'NOT_A_CO_GUARDIAN',
    'ownership can only go to a current co-guardian',
    `${strangerTransfer.status}`,
  );
  const offer = await call('POST', `/api/family/children/${childId}/ownership-transfer`, {
    jar: owner, body: { phone: partnerPhone },
  });
  check(offer.status === 201 && offer.body?.kind === 'ownership_transfer', 'owner offers ownership', `${offer.status}`);
  const stillOwner = await call('GET', `/api/family/children/${childId}`, { jar: owner });
  check(stillOwner.body?.via === 'owner', 'the owner stays the owner until it is accepted');

  const tcode = (await call('GET', '/api/family/guardian-invites', { jar: partner })).body?.find(
    (i) => i.kind === 'ownership_transfer',
  )?.code;
  const take = await call('POST', `/api/family/guardian-invites/${tcode}/accept`, { jar: partner });
  check(take.status === 200 && take.body?.role === 'owner', 'the co-guardian accepts', `${take.status}`);

  const roles = await call('GET', `/api/family/children/${childId}/guardians`, { jar: partner });
  const byName = Object.fromEntries((roles.body?.guardians ?? []).map((g) => [g.fullName.split(' ')[0], g.role]));
  check(
    byName.Ota === 'owner' && byName.Ona === 'co_guardian',
    'roles swapped: exactly one owner, the old owner is now a co-guardian (INV-03/04)',
    JSON.stringify(byName),
  );
  check(
    sql(`SELECT count(*) FROM guardianship WHERE child_id='${childId}' AND role='owner' AND revoked_at IS NULL`) === '1',
    'the database agrees: one live owner',
  );
  const oldOwnerEdit = await call('PATCH', `/api/family/children/${childId}`, {
    jar: owner, body: { givenName: 'Y' },
  });
  check(oldOwnerEdit.status === 404, 'the old owner can no longer manage', `${oldOwnerEdit.status}`);

  // Hand it back so the rest of the script runs as the original owner.
  const ownerPersonPhone = ownerPhone;
  await call('POST', `/api/family/children/${childId}/ownership-transfer`, {
    jar: partner, body: { phone: ownerPersonPhone },
  });
  const back = (await call('GET', '/api/family/guardian-invites', { jar: owner })).body?.find(
    (i) => i.kind === 'ownership_transfer',
  )?.code;
  const backAccept = await call('POST', `/api/family/guardian-invites/${back}/accept`, { jar: owner });
  check(backAccept.status === 200, 'and back again', `${backAccept.status}`);

  // ------------------------------------------------------ educator access
  group('Educator access');
  const seasonId = sql(`SELECT id FROM season WHERE is_current`);
  const linkId = sql(
    `INSERT INTO educator_link (educator_person_id, child_id, status, valid_until, season_id)
     VALUES ('${azizaId}', '${childId}', 'requested', now() + interval '30 days', '${seasonId}')
     RETURNING id`,
  );
  const educators = await call('GET', `/api/family/children/${childId}/educators`, { jar: owner });
  const req = (educators.body?.links ?? []).find((l) => l.linkId === linkId);
  check(
    req?.status === 'requested' && req?.requestExpiresAt && !/\+998/.test(educators.text),
    'a pending request is listed with its expiry, without the educator’s phone',
  );
  const until = educators.body?.until;
  check(until?.schoolYearEnd && until?.threeMonths, 'the two end-date options come from the server');

  const tooLate = await call('POST', `/api/family/educator-requests/${linkId}/approve`, {
    jar: owner, body: { validUntil: '2031-01-01' },
  });
  check(tooLate.status === 400, 'access cannot outlive the season (INV-05)', `${tooLate.status}`);
  const coApprove = await call('POST', `/api/family/educator-requests/${linkId}/approve`, {
    jar: partner, body: { validUntil: until.threeMonths },
  });
  check(coApprove.status === 404, 'a co-guardian cannot approve', `${coApprove.status}`);

  const approve = await call('POST', `/api/family/educator-requests/${linkId}/approve`, {
    jar: owner, body: { validUntil: until.threeMonths },
  });
  check(approve.status === 200 && approve.body?.status === 'active', 'owner approves until a chosen date', `${approve.status}`);
  check(
    sql(`SELECT count(*) FROM v_educator_visible_child WHERE child_id='${childId}'`) === '1',
    'the educator can now see the child through v_educator_visible_child',
  );

  const off = await call('POST', `/api/family/children/${childId}/educators/${linkId}/revoke`, { jar: owner });
  check(off.status === 200 && off.body?.status === 'revoked' && off.body?.canRestore, 'switch off', `${off.status}`);
  check(
    sql(`SELECT count(*) FROM v_educator_visible_child WHERE child_id='${childId}'`) === '0',
    'and the educator immediately loses sight of the child',
  );
  const on = await call('POST', `/api/family/children/${childId}/educators/${linkId}/restore`, { jar: owner });
  check(on.status === 200 && on.body?.status === 'active', 'restore', `${on.status}`);

  const link2 = sql(
    `INSERT INTO educator_link (educator_person_id, child_id, status, valid_until, season_id)
     SELECT person_id, '${childId}', 'requested', now() + interval '30 days', '${seasonId}'
       FROM educator_profile WHERE public_code = 'NYU-1907' RETURNING id`,
  );
  const decline = await call('POST', `/api/family/educator-requests/${link2}/decline`, { jar: owner });
  check(decline.status === 204, 'decline', `${decline.status}`);
  check(
    sql(`SELECT status || '/' || (season_id IS NOT NULL) FROM educator_link WHERE id='${link2}'`) === 'declined/true',
    'a decline is kept for the season (the block M6 enforces)',
  );

  // --------------------------------------------------------------- consents
  group('Consents');
  const proc = await call('PUT', `/api/family/children/${childId}/consents/data_processing`, {
    jar: owner, body: { given: false },
  });
  const procState = (proc.body ?? []).find((c) => c.type === 'data_processing');
  check(proc.status === 200 && procState?.given === false && procState?.revokedAt, 'data processing can be withdrawn');
  const others = (proc.body ?? []).filter((c) => c.type !== 'data_processing');
  check(others.find((c) => c.type === 'marketing')?.given === true, 'withdrawing one touches no other consent');
  const reGive = await call('PUT', `/api/family/children/${childId}/consents/data_processing`, {
    jar: owner, body: { given: true },
  });
  check(
    (reGive.body ?? []).find((c) => c.type === 'data_processing')?.documentVersion,
    'and given again, against the current document version',
  );
  const history = sql(`SELECT count(*) FROM consent WHERE child_id='${childId}' AND type='data_processing'`);
  check(history === '2', 'every grant is its own row — the history is kept', `${history} rows`);

  // ------------------------------------------------------------ change log
  group('Change log and notifications');
  const log = await call('GET', `/api/family/children/${childId}/changelog?limit=50`, { jar: partner });
  const actions = new Set((log.body?.entries ?? []).map((e) => e.action));
  for (const a of ['child.created', 'guardian.invite_accepted', 'ownership.transferred', 'access.granted', 'access.revoked', 'access.restored', 'access.declined', 'consent.revoked']) {
    check(actions.has(a), `change log has ${a}`);
  }
  check(log.body?.entries?.some((e) => e.subject === 'Aziza Rakhimovna'), 'entries name the educator involved');
  const notified = sql(
    `SELECT count(DISTINCT person_id) FROM notification n JOIN person p ON p.id = n.person_id
      WHERE p.phone IN ('${ownerPhone}', '${partnerPhone}') AND n.template = 'consent_changed'`,
  );
  check(notified === '2', 'a change is announced to the owner AND the co-guardian', `${notified} people`);

  // ------------------------------------------------------- anonymisation
  group('Anonymisation');
  const partnerId = (roles.body?.guardians ?? []).find((g) => g.fullName.startsWith('Ota'))?.personId;
  const remove = await call('DELETE', `/api/family/children/${childId}/guardians/${partnerId}`, {
    jar: owner,
  });
  check(remove.status === 204, 'owner removes the co-guardian', `${remove.status}`);
  const gone = await call('GET', `/api/family/children/${childId}`, { jar: partner });
  check(gone.status === 404, 'who then loses access', `${gone.status}`);

  const delReq = await call('POST', `/api/family/children/${childId}/anonymisation-request`, {
    jar: owner, body: { reason: 'flow test' },
  });
  check(
    delReq.status === 202 && /^DEL-/.test(delReq.body?.reference ?? '') && delReq.body?.executeAfter,
    'owner requests deletion; it waits out a grace window',
    `${delReq.status}`,
  );
  const blocked = await call('POST', `/api/family/children/${childId}/co-guardian-invites`, {
    jar: owner, body: { phone: strangerPhone },
  });
  check(blocked.status === 409, 'no new invitations while deletion is pending', `${blocked.status}`);

  const sessionCount = sql(`SELECT count(*) FROM session WHERE child_id='${childId}'`);
  const reqId = delReq.body?.id;
  const notAdmin = await call('POST', `/api/staff/anonymisation-requests/${reqId}/execute`, { jar: owner });
  check(notAdmin.status === 403, 'only a super_admin can run it early', `${notAdmin.status}`);
  const admin = await signIn(seeded.people.super_admin.phone);
  const exec = await call('POST', `/api/staff/anonymisation-requests/${reqId}/execute`, { jar: admin });
  check(exec.status === 200, 'super_admin executes it', `${exec.status} ${exec.text}`);

  const after = sql(
    `SELECT family_name || '|' || given_name || '|' || octet_length(pinfl_enc) || '|' || (anonymised_at IS NOT NULL)
       FROM child WHERE id='${childId}'`,
  );
  check(after === '—|—|0|true', 'names and PINFL are stripped (INV-16)', after);
  check(
    sql(`SELECT count(*) FROM guardianship WHERE child_id='${childId}' AND revoked_at IS NULL`) === '0' &&
      sql(`SELECT count(*) FROM v_educator_visible_child WHERE child_id='${childId}'`) === '0',
    'every guardianship and educator link is gone',
  );
  check(
    sql(`SELECT count(*) FROM session WHERE child_id='${childId}'`) === sessionCount,
    'sessions and responses are kept',
  );
  const ownerList = (await call('GET', '/api/family/children', { jar: owner })).body ?? [];
  check(!ownerList.some((c) => c.id === childId), 'the child disappears from the family');
  const ownerGet = await call('GET', `/api/family/children/${childId}`, { jar: owner });
  check(ownerGet.status === 404, 'and its page is gone', `${ownerGet.status}`);

  // ------------------------------------------------------------ INV-06
  group('INV-06');
  const leaked = bodies.filter(({ text }) => /pinfl_(hash|enc)|"pinfl"/i.test(text) || /\b[1-6]\d{13}\b/.test(text));
  check(leaked.length === 0, `no response carried a PINFL (${bodies.length} swept)`, leaked.map((l) => l.path).join(', '));

  // ------------------------------------------------------------ report
  let last = '';
  for (const r of results) {
    if (r.section !== last) {
      console.log(`\n=== ${r.section} ===`);
      last = r.section;
    }
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  — ${r.detail}`}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed · ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.section}] ${r.name}  ${r.ok ? '' : r.detail}`);
  console.error(err);
  process.exit(1);
});
