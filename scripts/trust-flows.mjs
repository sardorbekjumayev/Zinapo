#!/usr/bin/env node
/**
 * M8 — trust & safety, end to end (task.md § 8.5, § 12 M8).
 *
 *   ./scripts/trust-flows.sh
 *
 * Needs the dev fixtures (`./scripts/seed.sh`). Builds its own subjects each
 * run (fresh educators, families and devices), so it can run any number of
 * times. Covers the four fraud rules and their evidence, the 30-day quiet
 * period, the queue (permissions, assignment, notes), "suspend links and ask
 * the owners" with the owners' answers, confirm-and-escalate (the educator is
 * suspended), dismiss, the fifth-child review, and an ownership dispute —
 * statements, keep, and the clean handover.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROOT = new URL('..', import.meta.url).pathname;
const results = [];
let section = '';
const check = (ok, name, detail = '') => results.push({ ok: !!ok, section, name, detail });
const group = (n) => (section = n);

class Jar {
  constructor() {
    this.c = new Map();
  }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      const v = pair.slice(eq + 1).trim();
      if (v === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) this.c.delete(pair.slice(0, eq).trim());
      else this.c.set(pair.slice(0, eq).trim(), v);
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function call(method, path, { jar, body } = {}) {
  const headers = { 'user-agent': 'zinapo-trust-flows' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  if (jar) jar.absorb(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

const docker = (...a) => execFileSync('docker', ['compose', '--project-directory', ROOT, ...a], { encoding: 'utf8' });
const sql = (q) => docker('exec', '-T', 'db', 'psql', '-U', 'zinapo', '-d', 'zinapo', '-Atq', '-c', q).trim();
function flush() {
  try {
    const k = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*').split('\n').filter(Boolean);
    if (k.length) docker('exec', '-T', 'redis', 'redis-cli', 'del', ...k);
  } catch {}
}
async function signIn(phone) {
  flush();
  const jar = new Jar();
  const s = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  const sim = await call('POST', '/api/dev/telegram/simulate', { body: { link: s.body.deepLink, phone, firstName: 'Ts', lastName: 'Flow' } });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: s.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}: ${v.status}`);
  return jar;
}
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;
const pinflFor = (dob) => {
  const [y, m, d] = dob.split('-');
  return `6${d}${m}${y.slice(2)}${rand(7)}`;
};
const childBody = (o = {}) => {
  const dob = o.dob ?? '2016-04-09';
  return {
    pinfl: pinflFor(dob), familyName: 'SINOVOVA', givenName: 'Malika', patronymic: 'Testovna', dob, grade: 4, schoolRegionId: 14,
    consents: [{ type: 'data_processing', given: true }, { type: 'third_party_transfer', given: false }, { type: 'marketing', given: false }],
    ...o,
  };
};
const tick = () => call('POST', '/api/dev/tick');
const caseFor = (rule, personId) =>
  sql(`SELECT c.id FROM review_case c JOIN registration_flag f ON f.id = c.registration_flag_id
        WHERE f.rule_code = '${rule}' AND f.subject_person_id = '${personId}' ORDER BY c.opened_at DESC LIMIT 1`);

/** A fresh educator with a group of three children of ONE owner, three surnames, links active. */
function educatorFixture() {
  const eduPhone = freshPhone();
  const tag = rand(5);
  const edu = sql(`INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via) VALUES ('Sinov Ustoz ${tag}', '${eduPhone}', 'uz', now(), 'manual') RETURNING id`);
  sql(`INSERT INTO educator_profile (person_id, kind, status, public_code, region_id, subjects, decided_at)
       VALUES ('${edu}', 'tutor', 'approved', 'TS${tag}', 14, ARRAY['numeracy'], now())`);
  const ownerPhone = freshPhone();
  const owner = sql(`INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via) VALUES ('Sinov Ota-ona ${tag}', '${ownerPhone}', 'uz', now(), 'manual') RETURNING id`);
  const grp = sql(`INSERT INTO teaching_group (educator_person_id, name, grade) VALUES ('${edu}', 'Sinov ${tag}', 4) RETURNING id`);
  const kids = [];
  for (const [i, fam] of ['ALIYEVA', 'BOBOYEVA', 'VALIYEVA'].entries()) {
    // One statement: INV-04 (a child always has an owner) is checked at commit.
    const k = sql(`WITH c AS (INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, dob, created_by)
                              VALUES (gen_random_bytes(32), '\\x00', '${fam}', 'Sinov${i}', '2016-02-0${i + 1}', '${owner}') RETURNING id),
                        g AS (INSERT INTO guardianship (child_id, person_id, role, granted_by)
                              SELECT id, '${owner}', 'owner', '${owner}' FROM c)
                   SELECT id FROM c`);
    sql(`INSERT INTO enrolment (child_id, school_year, grade, school_region_id) VALUES ('${k}', 2026, 4, 14)`);
    sql(`INSERT INTO consent (child_id, person_id, type, document_version) VALUES ('${k}', '${owner}', 'data_processing', 'v1-2026-09')`);
    sql(`INSERT INTO educator_link (educator_person_id, child_id, status, valid_from, valid_until, decided_by, decided_at)
         VALUES ('${edu}', '${k}', 'active', now() - interval '5 days', now() + interval '200 days', '${owner}', now())`);
    sql(`INSERT INTO group_member (group_id, child_id) VALUES ('${grp}', '${k}')`);
    kids.push(k);
  }
  return { edu, eduPhone, owner, ownerPhone, kids };
}

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  for (const step of ['seed-bank', 'seed-results', 'seed-educator', 'seed-olympiad', 'seed-trust']) await call('POST', `/api/dev/${step}`);
  const P = seeded.people;
  const ts = await signIn(P.trust_safety.phone);
  const support = await signIn(P.support.phone);
  const editor = await signIn(P.bank_editor.phone);
  const tsId = sql(`SELECT id FROM person WHERE phone = '${P.trust_safety.phone}'`);

  // ================================================================ rules
  group('Fraud rules (§ 8.5, M8-a)');
  const A = educatorFixture();
  // Rule: ≥ 10 match-checks in an hour by A's educator.
  sql(`INSERT INTO pinfl_check_log (educator_person_id, pinfl_hash, family_name_probe, matched, created_at)
       SELECT '${A.edu}', gen_random_bytes(32), 'X', g % 3 = 0, now() - make_interval(mins => g) FROM generate_series(1, 12) g`);
  // Rule: three owners add a child from one device within 2 h.
  const ip = `10.${rand(2) % 250}.${rand(2) % 250}.${rand(2) % 250}`;
  const trio = [];
  for (let i = 0; i < 3; i++) {
    const p = sql(`INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via) VALUES ('Qurilma ${i}', '${freshPhone()}', 'uz', now(), 'manual') RETURNING id`);
    sql(`INSERT INTO audit_log (person_id, action, payload, ip, user_agent, created_at)
         VALUES ('${p}', 'child.created', '{"childId":"00000000-0000-0000-0000-00000000000${i}"}', '${ip}', 'TestUA/${ip}', now() - make_interval(mins => ${10 + i * 15}))`);
    trio.push(p);
  }
  const t1 = await tick();
  check(t1.body?.fraud?.flagged >= 3, 'the job raises new flags', JSON.stringify(t1.body?.fraud));
  const burst = caseFor('match_check_bursts', A.edu);
  const mismatch = caseFor('surname_mismatch_group', A.edu);
  const device = sql(`SELECT c.id FROM review_case c JOIN registration_flag f ON f.id = c.registration_flag_id
                       WHERE f.rule_code = 'many_owners_one_device' AND f.evidence->'device'->>'ip' = '${ip}' LIMIT 1`);
  check(burst && mismatch && device, 'each rule opened a fraud case', `${!!burst}/${!!mismatch}/${!!device}`);
  const ev = JSON.parse(sql(`SELECT f.evidence FROM registration_flag f JOIN review_case c ON c.registration_flag_id = f.id WHERE c.id = '${device}'`));
  check(ev.owners === 3 && ev.personIds.length === 3, 'evidence names the three owners and the device', JSON.stringify(ev).slice(0, 120));
  check(!/[0-9]{14}/.test(sql(`SELECT string_agg(evidence::text, ' ') FROM registration_flag`)), 'no PINFL in any evidence (INV-06)');
  const t2 = await tick();
  check(Number(sql(`SELECT count(*) FROM registration_flag WHERE rule_code = 'match_check_bursts' AND subject_person_id = '${A.edu}' AND resolved_at IS NULL`)) === 1,
    'running again raises nothing new for the same subject', JSON.stringify(t2.body?.fraud));
  const never = sql(`SELECT c.id FROM review_case c JOIN registration_flag f ON f.id = c.registration_flag_id
                      WHERE f.rule_code = 'owner_never_opens_reports' AND f.resolved_at IS NULL LIMIT 1`);
  check(!!never, '"never opens reports" is in the queue (seeded children)');

  // ================================================================ queue
  group('The queue — one place, trust_safety only');
  const list = await call('GET', '/api/staff/cases', { jar: ts });
  check(list.status === 200 && list.body.cases.some((c) => c.id === burst) && list.body.counts.fraud_flag?.open >= 3, 'trust & safety sees the queue with counts', `${list.status}`);
  check((await call('GET', '/api/staff/cases', { jar: support })).status === 403, 'support cannot read cases (403)');
  check((await call('GET', '/api/staff/cases', { jar: editor })).status === 403, 'bank_editor cannot read cases (403)');
  const fraudOnly = await call('GET', '/api/staff/cases?kind=fraud_flag', { jar: ts });
  check(fraudOnly.body.cases.every((c) => c.kind === 'fraud_flag'), 'filter by kind');
  const assign = await call('POST', `/api/staff/cases/${mismatch}/assign`, { jar: ts, body: { personId: tsId } });
  check(assign.status === 200 && assign.body.assignee?.me, 'assign to myself', `${assign.status}`);
  const badAssign = await call('POST', `/api/staff/cases/${mismatch}/assign`, { jar: ts, body: { personId: A.owner } });
  check(badAssign.status === 400 && badAssign.body?.error === 'NOT_TRUST_SAFETY', 'only trust & safety staff can be assigned', `${badAssign.status}`);
  const mine = await call('GET', '/api/staff/cases?mine=1', { jar: ts });
  check(mine.body.cases.some((c) => c.id === mismatch), '"assigned to me" lists it');
  const note = await call('POST', `/api/staff/cases/${mismatch}/notes`, { jar: ts, body: { body: 'Ota-onaga qo‘ng‘iroq qilindi.' } });
  check(note.status === 201 && note.body.notes.some((n) => n.authorRole === 'staff'), 'add a staff note', `${note.status}`);
  const det = await call('GET', `/api/staff/cases/${mismatch}`, { jar: ts });
  check(det.body?.fraud?.educator?.activeLinks === 3 && det.body.fraud.canSuspendLinks, 'the case shows the educator and their active links');
  check(!/pinfl|[0-9]{14}/i.test(det.text) && !/\+998[0-9]{9}/.test(det.text), 'no PINFL and only masked phones in a case');
  check(/"name":"[^"]+ [A-Z0-9]\*\*\*[A-Z0-9]"/.test(det.text) && !det.text.includes('Sinov Ota-ona'), 'people appear as masked names (design/15)');
  const devDet = await call('GET', `/api/staff/cases/${device}`, { jar: ts });
  check(/"device":"[0-9a-f]{4}·[0-9a-f]{4}"/.test(devDet.text) && !devDet.text.includes(ip), 'a device is a short hash, never the IP');

  // ===================================================== suspend & ask
  group('Suspend links and ask the owners (never block silently)');
  const eduJar = await signIn(A.eduPhone);
  check((await call('GET', `/api/educator/children/${A.kids[0]}`, { jar: eduJar })).status === 200, 'before: the educator sees the pupil');
  const sus = await call('POST', `/api/staff/cases/${mismatch}/suspend-links`, { jar: ts, body: { note: 'Bir ota-onada uch xil familiya.' } });
  check(sus.status === 200 && sus.body.status === 'waiting_owner' && sus.body.fraud.suspendedLinks.length === 3, 'links suspended, case waits for the owners', `${sus.status}`);
  check((await call('GET', `/api/educator/children/${A.kids[0]}`, { jar: eduJar })).status === 404, 'the educator loses sight at once');
  check(sql(`SELECT count(*) FROM notification WHERE person_id = '${A.owner}' AND template = 'case_needs_owner_confirmation'`) === '3',
    'the owner is asked — once per child');
  const ownerJar = await signIn(A.ownerPhone);
  const acc = await call('GET', `/api/family/children/${A.kids[0]}/educators`, { jar: ownerJar });
  const lnk = (acc.body?.links ?? acc.body ?? []).find?.((l) => l.awaitingOwnerAnswer);
  check(lnk, "the owner's access page shows the question", JSON.stringify(acc.body).slice(0, 160));
  const keep = await call('POST', `/api/family/children/${A.kids[0]}/educators/${lnk.linkId}/answer`, { jar: ownerJar, body: { keep: true } });
  check(keep.status === 200 && keep.body.status === 'active', 'the owner keeps one link', `${keep.status}`);
  check((await call('GET', `/api/educator/children/${A.kids[0]}`, { jar: eduJar })).status === 200, '…and the educator sees that child again');
  const acc2 = await call('GET', `/api/family/children/${A.kids[1]}/educators`, { jar: ownerJar });
  const lnk2 = (acc2.body?.links ?? []).find((l) => l.awaitingOwnerAnswer);
  const rev = await call('POST', `/api/family/children/${A.kids[1]}/educators/${lnk2.linkId}/answer`, { jar: ownerJar, body: { keep: false } });
  check(rev.status === 200 && rev.body.status === 'revoked', 'the owner ends another', `${rev.status}`);
  const again = await call('POST', `/api/family/children/${A.kids[1]}/educators/${lnk2.linkId}/answer`, { jar: ownerJar, body: { keep: true } });
  check(again.status === 404, 'an answer is final', `${again.status}`);
  const strangerAnswer = await call('POST', `/api/family/children/${A.kids[2]}/educators/${lnk2.linkId}/answer`, { jar: eduJar, body: { keep: true } });
  check(strangerAnswer.status === 404, 'only the owner answers', `${strangerAnswer.status}`);
  const closed = await call('POST', `/api/staff/cases/${mismatch}/close`, { jar: ts, body: {} });
  check(closed.status === 200 && closed.body.status === 'resolved', 'close the case after the owners answered', `${closed.status}`);
  const suspendNoEdu = await call('POST', `/api/staff/cases/${device}/suspend-links`, { jar: ts, body: {} });
  check(suspendNoEdu.status === 409 && suspendNoEdu.body?.error === 'NO_EDUCATOR', 'no educator behind a flag → nothing to suspend', `${suspendNoEdu.status}`);

  // ================================================== confirm / dismiss
  group('Confirm and escalate (M8-b) · dismiss');
  const B = educatorFixture();
  sql(`INSERT INTO pinfl_check_log (educator_person_id, pinfl_hash, family_name_probe, matched, created_at)
       SELECT '${B.edu}', gen_random_bytes(32), 'X', false, now() - make_interval(mins => g) FROM generate_series(1, 16) g`);
  await tick();
  const burstB = caseFor('match_check_bursts', B.edu);
  const noNote = await call('POST', `/api/staff/cases/${burstB}/confirm`, { jar: ts, body: {} });
  check(noNote.status === 400, 'confirming needs a reason', `${noNote.status}`);
  const conf = await call('POST', `/api/staff/cases/${burstB}/confirm`, { jar: ts, body: { note: 'Bir kunda 16 ta xato tekshiruv.' } });
  check(conf.status === 200 && conf.body.resolution === 'confirmed_educator_suspended', 'confirm → the educator is suspended', JSON.stringify(conf.body?.resolution));
  check(sql(`SELECT status FROM educator_profile WHERE person_id = '${B.edu}'`) === 'suspended', 'educator_profile.status = suspended');
  const bJar = await signIn(B.eduPhone);
  const blocked = await call('POST', '/api/educator/invites', { jar: bJar, body: { phones: [freshPhone()] } });
  check(blocked.status === 403, 'a suspended educator can no longer act', `${blocked.status}`);
  check(sql(`SELECT count(*) FROM educator_link WHERE educator_person_id = '${B.edu}' AND status = 'suspended' AND owner_response IS NULL`) === '3',
    'their links are suspended and the owners keep the choice');
  const dis = await call('POST', `/api/staff/cases/${device}/dismiss`, { jar: ts, body: { note: 'Maktab kompyuter sinfi — bitta qurilma.' } });
  check(dis.status === 200 && dis.body.status === 'dismissed', 'dismiss a false positive with a note', `${dis.status}`);
  await tick();
  check(sql(`SELECT count(*) FROM registration_flag WHERE rule_code = 'many_owners_one_device' AND evidence->'device'->>'ip' = '${ip}' AND resolved_at IS NULL`) === '0',
    'a dismissed pattern stays quiet (30 days)');
  const closedAgain = await call('POST', `/api/staff/cases/${device}/dismiss`, { jar: ts, body: { note: 'x x x' } });
  check(closedAgain.status === 409, 'a closed case stays closed', `${closedAgain.status}`);

  // =========================================================== 5th child
  group('Fifth child (§ 8.2)');
  const parentPhone = freshPhone();
  const parent = await signIn(parentPhone);
  for (let i = 0; i < 4; i++) await call('POST', '/api/family/children', { jar: parent, body: childBody({ givenName: `Bola${i}`, dob: `2016-0${i + 1}-1${i}` }) });
  const fifth = await call('POST', '/api/family/children', { jar: parent, body: childBody({ givenName: 'Beshinchi', dob: '2017-06-15' }) });
  check(fifth.status === 202 && fifth.body?.error === 'FIFTH_CHILD_REVIEW', 'the fifth child goes to review', `${fifth.status}`);
  const fifthCase = fifth.body?.details?.caseId ?? sql(`SELECT c.id FROM review_case c JOIN person p ON p.id = c.subject_person_id
                                                         WHERE c.kind = 'fifth_child' AND p.phone = '${parentPhone}' ORDER BY c.opened_at DESC LIMIT 1`);
  const fd = await call('GET', `/api/staff/cases/${fifthCase}`, { jar: ts });
  check(fd.body?.fifthChild?.children?.length === 4 && fd.body.fifthChild.requested.name === 'SINOVOVA B***I', 'the reviewer sees the family and the request');
  const ok5 = await call('POST', `/api/staff/cases/${fifthCase}/fifth-child`, { jar: ts, body: { decision: 'approved' } });
  check(ok5.status === 200 && ok5.body.resolution === 'approved', 'approve', `${ok5.status}`);
  const retry = await call('POST', '/api/family/children', { jar: parent, body: childBody({ givenName: 'Beshinchi', dob: '2017-06-15' }) });
  check(retry.status === 201, 'the parent adds the fifth child now', `${retry.status}`);
  const sixth = await call('POST', '/api/family/children', { jar: parent, body: childBody({ givenName: 'Oltinchi', dob: '2018-07-16' }) });
  check(sixth.status === 202, 'one approval admits one child — the sixth goes to review again', `${sixth.status}`);

  // ======================================================== disputes
  group('Ownership dispute (M8-c, M8-d)');
  async function dispute() {
    const ownerPhone = freshPhone();
    const claimPhone = freshPhone();
    const owner = await signIn(ownerPhone);
    const claim = await signIn(claimPhone);
    const body = childBody({ givenName: 'Talash', dob: '2016-09-21' });
    const made = await call('POST', '/api/family/children', { jar: owner, body });
    const childId = made.body?.id;
    await call('POST', `/api/family/children/${childId}/guardian-invites`, { jar: owner, body: { phone: freshPhone() } });
    const clash = await call('POST', '/api/family/children', { jar: claim, body: { ...body, familyName: 'DAVOGAR' } });
    const caseId = clash.body?.details?.caseId;
    await call('POST', `/api/family/ownership-disputes/${caseId}/confirm`, { jar: claim });
    return { owner, claim, ownerPhone, claimPhone, childId, caseId, clash };
  }
  const D = await dispute();
  check(D.clash.status === 409 && D.caseId, 'a second parent typing the same PINFL opens a dispute', `${D.clash.status}`);
  const cs = await call('POST', `/api/family/disputes/${D.caseId}/statements`, { jar: D.claim, body: { body: 'Men bolaning onasiman.' } });
  const os = await call('POST', `/api/family/disputes/${D.caseId}/statements`, { jar: D.owner, body: { body: 'Bola men bilan yashaydi.' } });
  check(cs.status === 201 && os.status === 201, 'both sides write a statement', `${cs.status}/${os.status}`);
  check(cs.body.role === 'claimant' && os.body.role === 'owner', 'each side is recognised');
  const claimView = await call('GET', `/api/family/disputes/${D.caseId}`, { jar: D.claim });
  check(claimView.body.statements.length === 1 && !/yashaydi/.test(claimView.text), "a party sees only their own words — never the other side's");
  const stranger = await call('GET', `/api/family/disputes/${D.caseId}`, { jar: parent });
  check(stranger.status === 404, 'a third person sees nothing', `${stranger.status}`);
  const staffView = await call('GET', `/api/staff/cases/${D.caseId}`, { jar: ts });
  check(staffView.body.notes.length === 2 && staffView.body.dispute.claimantConfirmed, 'trust & safety sees both statements');
  const noReason = await call('POST', `/api/staff/cases/${D.caseId}/dispute`, { jar: ts, body: { decision: 'transfer' } });
  check(noReason.status === 400, 'a decision needs a reason', `${noReason.status}`);
  const ownerId = sql(`SELECT id FROM person WHERE phone = '${D.ownerPhone}'`);
  // An educator link exists before the handover.
  sql(`INSERT INTO educator_link (educator_person_id, child_id, status, valid_until, decided_by, decided_at)
       SELECT person_id, '${D.childId}', 'active', now() + interval '100 days', '${ownerId}', now() FROM educator_profile
        WHERE public_code = 'AZR-4821'`);
  const transfer = await call('POST', `/api/staff/cases/${D.caseId}/dispute`, { jar: ts, body: { decision: 'transfer', note: 'Video qo‘ng‘iroqda guvohnoma ko‘rildi.' } });
  check(transfer.status === 200 && transfer.body.resolution === 'transferred', 'transfer to the claimant', `${transfer.status}`);
  const claimKids = await call('GET', '/api/family/children', { jar: D.claim });
  check(claimKids.body.some((c) => c.id === D.childId), 'the claimant now owns the child');
  check((await call('GET', `/api/family/children/${D.childId}`, { jar: D.owner })).status === 404, 'the old owner has no access any more');
  check(sql(`SELECT count(*) FROM guardianship WHERE child_id = '${D.childId}' AND revoked_at IS NULL`) === '1', 'nobody else holds the child (clean handover)');
  check(sql(`SELECT count(*) FROM consent WHERE child_id = '${D.childId}' AND revoked_at IS NULL`) === '0', 'consents must be given again by the new owner');
  check(sql(`SELECT count(*) FROM guardian_invite WHERE child_id = '${D.childId}' AND accepted_at IS NULL AND cancelled_at IS NULL`) === '0', 'open invites are cancelled');
  check(sql(`SELECT status || '/' || (owner_response IS NULL) FROM educator_link WHERE child_id = '${D.childId}'`) === 'suspended/true',
    'educator links wait for the new owner');
  const newAcc = await call('GET', `/api/family/children/${D.childId}/educators`, { jar: D.claim });
  check((newAcc.body?.links ?? []).some((l) => l.awaitingOwnerAnswer), "the new owner is asked about the educator's access");
  check(sql(`SELECT count(*) FROM notification n JOIN person p ON p.id = n.person_id
              WHERE n.template = 'case_decided' AND p.phone IN ('${D.ownerPhone}', '${D.claimPhone}')`) === '2', 'both parties are told');
  const E = await dispute();
  const kept = await call('POST', `/api/staff/cases/${E.caseId}/dispute`, { jar: ts, body: { decision: 'keep', note: 'Hujjatlar egasida.' } });
  check(kept.status === 200 && kept.body.resolution === 'kept', 'or keep the owner', `${kept.status}`);
  check((await call('GET', `/api/family/children/${E.childId}`, { jar: E.owner })).status === 200, 'the owner keeps everything');
  const late = await call('POST', `/api/family/disputes/${E.caseId}/statements`, { jar: E.claim, body: { body: 'Kech.' } });
  check(late.status === 409, 'no statements after the decision', `${late.status}`);

  // ============================================================ report views
  group('Report views feed the rule');
  const neverChild = sql(`SELECT f.subject_child_id FROM registration_flag f JOIN review_case c ON c.registration_flag_id = f.id WHERE c.id = '${never}'`);
  const neverOwner = sql(`SELECT p.phone FROM guardianship g JOIN person p ON p.id = g.person_id WHERE g.child_id = '${neverChild}' AND g.role = 'owner'`);
  const nj = await signIn(neverOwner);
  await call('GET', `/api/family/children/${neverChild}/report`, { jar: nj });
  check(sql(`SELECT count(*) FROM report_view WHERE child_id = '${neverChild}'`) !== '0', 'opening the report is recorded');

  // Clean up: this run's subjects leave no open case behind in the dev queue.
  for (const id of [A.edu, B.edu, ...trio]) {
    const open = sql(`SELECT string_agg(c.id::text, ',') FROM review_case c JOIN registration_flag f ON f.id = c.registration_flag_id
                       WHERE f.subject_person_id = '${id}' AND c.status IN ('open', 'waiting_owner')`);
    for (const cid of (open || '').split(',').filter(Boolean)) {
      await call('POST', `/api/staff/cases/${cid}/dismiss`, { jar: ts, body: { note: 'trust-flows test cleanup' } });
    }
  }

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

main().catch((e) => {
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.section}] ${r.name}  ${r.ok ? '' : r.detail}`);
  console.error(e);
  process.exit(1);
});
