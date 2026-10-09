#!/usr/bin/env node
/**
 * M6 — the educator workspace, end to end (task.md § 8.4, § 12 M6).
 *
 *   ./scripts/educator-flows.sh
 *
 * Needs the dev fixtures (/api/dev/seed, seed-bank, seed-results,
 * seed-educator — `./scripts/seed.sh` runs them all). Covers the application
 * and its approval, pre-approval, bulk invites and the public landing, the
 * PINFL match-check with its limits and log, access requests (one live per
 * pair, decline blocks the season, 14-day expiry), groups (INV-15: a group is
 * not access), the overview (sorted by gain, no percentile), reminders,
 * the pupil view, the own-child exclusions, and practice (INV-08: no anchors,
 * "how many solved" only, never measured, the parent sees no count).
 *
 * Every run uses fresh phones and children, so it can run any number of times.
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
  const headers = { 'user-agent': 'zinapo-educator-flows' };
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
const redisDel = (pattern) => {
  try {
    const k = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', pattern).split('\n').filter(Boolean);
    if (k.length) docker('exec', '-T', 'redis', 'redis-cli', 'del', ...k);
  } catch {}
};
async function signIn(phone) {
  redisDel('rl:*');
  const jar = new Jar();
  const s = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  const sim = await call('POST', '/api/dev/telegram/simulate', { body: { link: s.body.deepLink, phone, firstName: 'Edu', lastName: 'Flow' } });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: s.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}: ${v.status}`);
  return jar;
}

const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;
function pinflFor(dob) {
  const [y, m, d] = dob.split('-');
  return `6${d}${m}${y.slice(2)}${rand(7)}`;
}
/** A response body must never carry a percentile, a score or a raw answer to an educator. */
const LEAK = /"(pct_?low|pct_?high|pctLow|pctHigh|percentile|rawScore|raw_score|theta|isCorrect|is_correct|correct_count|gain)"\s*:/i;

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  await call('POST', '/api/dev/seed-bank');
  await call('POST', '/api/dev/seed-results');
  await call('POST', '/api/dev/seed-educator');
  const P = seeded.people;
  const madina = seeded.children.find((c) => c.grade === 4);
  const temur = seeded.children.find((c) => c.grade === 1);
  const sevinch = seeded.children.find((c) => c.grade === 3);

  const aziza = await signIn(P.educator.phone);
  const nodira = await signIn(P.educatorParent.phone);
  const owner = await signIn(P.owner.phone);
  const ts = await signIn(P.trust_safety.phone);
  const editor = await signIn(P.bank_editor.phone);
  const azizaId = sql(`SELECT id FROM person WHERE phone = '${P.educator.phone}'`);
  redisDel(`zn:mc:*`);

  // ============================================================ application
  group('Application and approval (§ 8.4.1)');
  const applicantPhone = freshPhone();
  const applicant = await signIn(applicantPhone);
  const none = await call('GET', '/api/educator/profile', { jar: applicant });
  check(none.status === 200 && none.body?.status === null, 'someone who never applied has no profile', JSON.stringify(none.body));
  const blocked = await call('POST', '/api/educator/invites', { jar: applicant, body: { phones: [freshPhone()] } });
  check(blocked.status === 403, 'no educator profile → 403 on educator actions', `${blocked.status}`);
  const bad = await call('POST', '/api/educator/apply', { jar: applicant, body: { kind: 'wizard', regionId: 14, subjects: [] } });
  check(bad.status === 400, 'a malformed application is rejected (400)', `${bad.status}`);
  const applied = await call('POST', '/api/educator/apply', { jar: applicant, body: { kind: 'tutor', regionId: 14, subjects: ['numeracy', 'reasoning'] } });
  check(applied.status === 201 && applied.body?.status === 'applied' && applied.body?.publicCode === null,
    'apply → status applied, no public code yet', JSON.stringify(applied.body));
  const applicantId = sql(`SELECT id FROM person WHERE phone = '${applicantPhone}'`);
  check(sql(`SELECT count(*) FROM review_case WHERE kind = 'educator_application' AND subject_person_id = '${applicantId}' AND status = 'open'`) === '1',
    'a trust & safety case is opened');
  const twice = await call('POST', '/api/educator/apply', { jar: applicant, body: { kind: 'tutor', regionId: 14, subjects: ['numeracy'] } });
  check(twice.status === 409 && twice.body?.error === 'ALREADY_APPLIED', 'applying twice → 409', `${twice.status}`);
  const me = await call('GET', '/api/me', { jar: applicant });
  check((me.body?.workspaces ?? []).includes('educator'), 'the educator workspace opens at once (it shows /educator/pending)', JSON.stringify(me.body?.workspaces));
  const pendingInvite = await call('POST', '/api/educator/invites', { jar: applicant, body: { phones: [freshPhone()] } });
  check(pendingInvite.status === 403 && pendingInvite.body?.error === 'EDUCATOR_NOT_APPROVED', 'an applicant cannot invite yet (403)', `${pendingInvite.status}`);

  const queue = await call('GET', '/api/staff/educator-applications', { jar: ts });
  check(queue.status === 200 && queue.body.some((a) => a.personId === applicantId), 'trust & safety sees the application');
  const noPerm = await call('GET', '/api/staff/educator-applications', { jar: editor });
  check(noPerm.status === 403, 'bank_editor has no educator.decide → 403', `${noPerm.status}`);
  const approve = await call('POST', `/api/staff/educator-applications/${applicantId}/decision`, { jar: ts, body: { decision: 'approved' } });
  check(approve.status === 200 && approve.body?.status === 'approved', 'trust & safety approves', `${approve.status}`);
  const again = await call('POST', `/api/staff/educator-applications/${applicantId}/decision`, { jar: ts, body: { decision: 'rejected' } });
  check(again.status === 409 && again.body?.error === 'ALREADY_DECIDED', 'a decision is final (409)', `${again.status}`);
  check(sql(`SELECT status FROM review_case WHERE kind = 'educator_application' AND subject_person_id = '${applicantId}' ORDER BY opened_at DESC LIMIT 1`) === 'resolved',
    'the case is resolved');
  check(sql(`SELECT count(*) FROM notification WHERE person_id = '${applicantId}' AND template = 'educator_application_decided'`) === '1',
    'the applicant is told');
  const nowApproved = await call('GET', '/api/educator/profile', { jar: applicant });
  check(/^[A-Z]{2}\d{4}$/.test(nowApproved.body?.publicCode ?? ''), 'approved → a public code to print on invites', nowApproved.body?.publicCode);

  const prePhone = freshPhone();
  const pre = await call('POST', '/api/staff/educator-preapprovals', { jar: ts, body: { phone: prePhone, kind: 'school_teacher' } });
  check(pre.status === 201 && pre.body?.approvedNow === false, 'staff pre-approve a phone (§ 8.4.1 "the first ~100")', `${pre.status}`);
  const preTwice = await call('POST', '/api/staff/educator-preapprovals', { jar: ts, body: { phone: prePhone } });
  check(preTwice.status === 409, 'one live pre-approval per phone', `${preTwice.status}`);
  const preJar = await signIn(prePhone);
  const preApplied = await call('POST', '/api/educator/apply', { jar: preJar, body: { kind: 'school_teacher', regionId: 14, subjects: ['language'] } });
  check(preApplied.body?.status === 'approved', 'a pre-approved person is approved the moment they apply', preApplied.body?.status);
  check(sql(`SELECT (used_at IS NOT NULL)::text FROM educator_preapproval WHERE phone_e164 = '${prePhone}'`) === 'true', 'the pre-approval is used up');

  // ================================================================ invites
  group('Bulk invites and the landing (§ 8.4.2)');
  const p1 = freshPhone();
  const sent = await call('POST', '/api/educator/invites', {
    jar: aziza,
    body: { phones: [p1, p1.replace('+998', ''), 'not a phone', '', P.educator.phone] },
  });
  check(sent.status === 200 && sent.body?.sent === 1 && sent.body?.duplicates === 1 && sent.body?.invalid?.length === 1,
    'one sent, the duplicate merged, the bad line reported by number, own number skipped', JSON.stringify(sent.body));
  check(sent.body?.invalid?.[0]?.line === 3, 'invalid lines keep their line number', JSON.stringify(sent.body?.invalid));
  const sms = sql(`SELECT channel || '|' || (payload->'vars'->>'code') || '|' || (payload->'vars'->>'link' LIKE '%/invite/%') FROM notification
                    WHERE phone_e164 = '${p1}' AND template = 'educator_invite'`);
  check(sms === 'sms|AZR-4821|true', 'the SMS carries the public code and the /invite link', sms);
  const resent = await call('POST', '/api/educator/invites', { jar: aziza, body: { phones: [p1] } });
  check(resent.body?.alreadyInvited === 1 && resent.body?.sent === 0, 'a live invite is not sent twice', JSON.stringify(resent.body));
  const code = sql(`SELECT code FROM educator_invite WHERE phone_e164 = '${p1}'`);
  const landing = await call('GET', `/api/public/educator-invites/${code}`);
  check(landing.status === 200 && landing.body?.educatorName === 'Aziza Rakhimovna' && !('phone' in (landing.body ?? {})),
    'the public landing names the educator — nothing else, no session needed', JSON.stringify(landing.body));
  const dead = await call('GET', '/api/public/educator-invites/SEED005004');
  check(dead.status === 404, 'an expired invite is a 404 on the landing', `${dead.status}`);
  const list = await call('GET', '/api/educator/invites', { jar: aziza });
  const mine = list.body?.invites?.find((i) => i.phone === p1);
  check(mine?.state === 'waiting' && list.body.counts.sent >= 7, 'the status list shows it waiting', JSON.stringify(list.body?.counts));
  sql(`UPDATE educator_invite SET created_at = now() - interval '4 days' WHERE phone_e164 = '${p1}'`);
  const remind = await call('POST', '/api/educator/invites/remind', { jar: aziza });
  check(remind.status === 200 && remind.body?.reminded >= 1, 'remind those waiting (3 days on)', JSON.stringify(remind.body));
  const remind2 = await call('POST', '/api/educator/invites/remind', { jar: aziza });
  check(remind2.body?.reminded === 0, 'a second reminder the same day sends nothing', JSON.stringify(remind2.body));
  const expiredId = sql(`SELECT id FROM educator_invite WHERE educator_person_id = '${azizaId}' AND accepted_at IS NULL
                           AND cancelled_at IS NULL AND expires_at <= now() LIMIT 1`);
  if (expiredId) {
    const rs = await call('POST', `/api/educator/invites/${expiredId}/resend`, { jar: aziza });
    check(rs.status === 200, 'an expired invite can be resent (fresh code, fresh 14 days)', `${rs.status}`);
  }

  // ============================================================ match-check
  group('PINFL match-check (§ 8.4.2)');
  const notEdu = await call('POST', '/api/educator/match-check', { jar: owner, body: { pinfl: '60312160000011', familyName: 'KARIMOVA' } });
  check(notEdu.status === 403, 'a parent cannot match-check (403)', `${notEdu.status}`);
  const hit = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'karimova ' } });
  check(hit.body?.match === true && hit.body?.maskedName === 'KARIMOVA M***A' && hit.body?.existingLink === 'active',
    'match → only a masked name (case and spaces do not matter)', JSON.stringify(hit.body));
  check(!/60312160000011/.test(hit.text) && !/Madina/.test(hit.text), 'the reply never repeats the PINFL or the full name');
  const malformed = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '00000000000000', familyName: 'X' } });
  check(malformed.status === 400, 'a malformed PINFL is a 400 and is not counted', `${malformed.status}`);
  const logRow = sql(`SELECT octet_length(pinfl_hash) || '|' || family_name_probe || '|' || matched FROM pinfl_check_log
                       WHERE educator_person_id = '${azizaId}' ORDER BY id DESC LIMIT 1`);
  check(logRow === '32|KARIMOVA|true', 'every check is logged — the PINFL only as a 32-byte hash (INV-06)', logRow);
  check(sql(`SELECT count(*) FROM pinfl_check_log WHERE family_name_probe ~ '[0-9]{14}'`) === '0', 'no PINFL digits anywhere in the log');
  const miss = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'ALIYEVA' } });
  check(miss.body?.match === false && !('maskedName' in miss.body) && miss.body.limits.missesInRow === 1,
    'no match says nothing about which half was wrong', JSON.stringify(miss.body));
  await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'ALIYEVA' } });
  const third = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'ALIYEVA' } });
  check(third.body?.limits?.pausedUntil, '3 misses in a row → paused for an hour', JSON.stringify(third.body?.limits));
  const paused = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'KARIMOVA' } });
  check(paused.status === 429 && paused.body?.error === 'MATCH_CHECK_PAUSED', 'while paused, even a correct check is refused (429)', `${paused.status}`);
  redisDel(`zn:mc:pause:${azizaId}`);
  const dayKey = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', `zn:mc:day:${azizaId}:*`).trim();
  docker('exec', '-T', 'redis', 'redis-cli', 'set', dayKey || `zn:mc:day:${azizaId}:x`, '25');
  const capped = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl: '60312160000011', familyName: 'KARIMOVA' } });
  check(capped.status === 429 && capped.body?.error === 'MATCH_CHECK_LIMIT', '25 checks a day, then 429 until midnight', `${capped.status}`);
  redisDel(`zn:mc:*`);

  // ======================================================== access requests
  group('Access requests (one live per pair, 14 days)');
  // A fresh family: the owner registers a child Aziza has never seen.
  const famPhone = freshPhone();
  const fam = await signIn(famPhone);
  const dob = '2016-05-12';
  const pinfl = pinflFor(dob);
  const child = await call('POST', '/api/family/children', {
    jar: fam,
    body: {
      pinfl, familyName: 'SINOVOVA', givenName: 'Lola', patronymic: 'Testovna', dob, grade: 4, schoolRegionId: 14,
      consents: [{ type: 'data_processing', given: true }, { type: 'third_party_transfer', given: false }, { type: 'marketing', given: false }],
    },
  });
  const lola = child.body?.id;
  check(child.status === 201 && lola, 'a parent registers a child', `${child.status}`);
  const pre1 = await call('GET', `/api/educator/children/${lola}`, { jar: aziza });
  check(pre1.status === 404, 'no link → the pupil view is a 404', `${pre1.status}`);
  const m1 = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl, familyName: 'Sinovova' } });
  check(m1.body?.match && m1.body?.existingLink === null, 'match, no link yet', JSON.stringify(m1.body?.existingLink));
  const req = await call('POST', '/api/educator/access-requests', { jar: aziza, body: { matchToken: m1.body?.matchToken } });
  check(req.status === 201 && req.body?.status === 'requested', 'access requested', `${req.status}`);
  const reuse = await call('POST', '/api/educator/access-requests', { jar: aziza, body: { matchToken: m1.body?.matchToken } });
  check(reuse.status === 404, 'a match token is single-use', `${reuse.status}`);
  const stolen = await call('POST', '/api/educator/match-check', { jar: nodira, body: { pinfl, familyName: 'Sinovova' } });
  const notHers = await call('POST', '/api/educator/access-requests', { jar: aziza, body: { matchToken: stolen.body?.matchToken } });
  check(notHers.status === 404, "another educator's token does not work", `${notHers.status}`);
  const m2 = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl, familyName: 'Sinovova' } });
  const dupReq = await call('POST', '/api/educator/access-requests', { jar: aziza, body: { matchToken: m2.body?.matchToken } });
  check(dupReq.status === 409 && dupReq.body?.error === 'LINK_EXISTS', 'one live request per (educator, child)', `${dupReq.status}`);
  const famId = sql(`SELECT id FROM person WHERE phone = '${famPhone}'`);
  check(sql(`SELECT count(*) FROM notification WHERE person_id = '${famId}' AND template = 'access_requested'`) === '1', 'the owner is asked');
  const stillNo = await call('GET', `/api/educator/children/${lola}`, { jar: aziza });
  check(stillNo.status === 404, 'a REQUESTED link grants nothing', `${stillNo.status}`);
  // The owner declines → blocked for the season.
  const dec = await call('POST', `/api/family/educator-requests/${req.body?.linkId}/decline`, { jar: fam });
  check(dec.status === 204, 'the owner declines', `${dec.status}`);
  const m3 = await call('POST', '/api/educator/match-check', { jar: aziza, body: { pinfl, familyName: 'Sinovova' } });
  const blockedReq = await call('POST', '/api/educator/access-requests', { jar: aziza, body: { matchToken: m3.body?.matchToken } });
  check(blockedReq.status === 409 && blockedReq.body?.error === 'DECLINED_THIS_SEASON', 'a decline blocks the pair for the season', `${blockedReq.status}`);
  // Nodira asks too and nobody answers for 15 days → the job expires it.
  const m4 = await call('POST', '/api/educator/match-check', { jar: nodira, body: { pinfl, familyName: 'Sinovova' } });
  const nreq = await call('POST', '/api/educator/access-requests', { jar: nodira, body: { matchToken: m4.body?.matchToken } });
  sql(`UPDATE educator_link SET requested_at = now() - interval '15 days' WHERE id = '${nreq.body?.linkId}'`);
  const tick = await call('POST', '/api/dev/tick');
  check(tick.body?.expiredRequests >= 1 && sql(`SELECT status FROM educator_link WHERE id = '${nreq.body?.linkId}'`) === 'expired',
    'a request unanswered for 14 days expires', JSON.stringify(tick.body?.expiredRequests));
  redisDel(`zn:mc:*`);

  // ================================================================= groups
  group('Groups (INV-15: a group is not access)');
  const gName = `Sinov guruh ${rand(5)}`;
  const g = await call('POST', '/api/educator/groups', { jar: aziza, body: { name: gName, grade: 4 } });
  check(g.status === 201 && g.body?.created, 'create a group', `${g.status}`);
  const g2 = await call('POST', '/api/educator/groups', { jar: aziza, body: { name: gName.toUpperCase() } });
  check(g2.body?.id === g.body?.id && g2.body?.created === false, 'the same name is the same group (no double)', JSON.stringify(g2.body));
  const add = await call('POST', `/api/educator/groups/${g.body.id}/members`, { jar: aziza, body: { childIds: [madina.id, temur.id, lola] } });
  check(add.body?.added === 1 && add.body?.skipped === 2, 'only a linked child of the grade joins (Temur requested, Lola declined)', JSON.stringify(add.body));
  // Put Temur in by hand: a membership row without a link must still show nothing.
  sql(`INSERT INTO group_member (group_id, child_id) VALUES ('${g.body.id}', '${temur.id}') ON CONFLICT DO NOTHING`);
  const ov = await call('GET', `/api/educator/groups/${g.body.id}/overview`, { jar: aziza });
  check(ov.status === 200 && ov.body.children.length === 1 && ov.body.children[0].id === madina.id,
    'a member without an active link is invisible in the overview', JSON.stringify(ov.body?.children?.map((c) => c.name)));
  check(!ov.body.notTaken.some((c) => c.id === temur.id), '…and in "not taken"');
  const notMine = await call('GET', `/api/educator/groups/${g.body.id}/overview`, { jar: nodira });
  check(notMine.status === 404, "another educator's group is a 404", `${notMine.status}`);
  const rm = await call('DELETE', `/api/educator/groups/${g.body.id}/members/${madina.id}`, { jar: aziza });
  check(rm.status === 200, 'remove a member', `${rm.status}`);
  const arch = await call('PATCH', `/api/educator/groups/${g.body.id}`, { jar: aziza, body: { archived: true } });
  const after = await call('GET', '/api/educator/groups', { jar: aziza });
  check(arch.status === 200 && !after.body.groups.some((x) => x.id === g.body.id), 'archive a group', `${arch.status}`);

  // ================================================================ overview
  group('Group overview (§ 8.4.4)');
  const shanba = after.body.groups.find((x) => x.grade === 4 && x.name.includes('Shanba'));
  const o = await call('GET', `/api/educator/groups/${shanba.id}/overview`, { jar: aziza });
  check(o.status === 200 && o.body.wave?.state === 'open', 'defaults to the open wave', o.body?.wave?.state);
  check(!LEAK.test(o.text) && !/"top /.test(o.text), 'no percentile, score or gain number reaches the educator', (o.text.match(LEAK) ?? [''])[0]);
  check(o.body.progressWaves.to !== null && o.body.progressWaves.to < o.body.wave.ordinal,
    'progress compares the latest MEASURED waves (the open one is not measured yet)', JSON.stringify(o.body.progressWaves));
  const cats = new Set(o.body.children.map((c) => c.progress));
  check([...cats].every((c) => ['up', 'flat', 'look', 'first', 'not_taken'].includes(c)), 'progress is a category', [...cats].join(','));
  const order = { up: 0, flat: 1, look: 2, first: 3, not_taken: 4 };
  const ranks = o.body.children.map((c) => order[c.progress]);
  // The categories are disjoint gain ranges (up ≥ +3 > flat > −5 ≥ look; first and
  // not_taken sort last), so "sorted by gain" means the ranks never go down.
  check(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    'sorted by gain: moved up first, then no real change, worth a look, then no comparison', ranks.join(''));
  check(o.body.stats.took + o.body.notTaken.length === o.body.stats.total, 'took + not taken = the group', JSON.stringify(o.body.stats));
  check(o.body.misconceptions.length > 0 && o.body.misconceptions.every((m) => m.childCount <= o.body.stats.took && m.childIds.length === m.childCount),
    'common mistakes are counted per child, among those who took the wave', o.body.misconceptions.map((m) => `${m.code}:${m.childCount}`).join(' '));
  const remindAll = await call('POST', `/api/educator/groups/${shanba.id}/reminders`, { jar: aziza, body: {} });
  check(remindAll.status === 200 && remindAll.body.reminded + remindAll.body.alreadyToday === o.body.notTaken.length,
    'remind all: one per child who has not taken it', JSON.stringify(remindAll.body));
  const remindAgain = await call('POST', `/api/educator/groups/${shanba.id}/reminders`, { jar: aziza, body: {} });
  check(remindAgain.body?.reminded === 0, 'at most one reminder per child per day (§ 10)', JSON.stringify(remindAgain.body));
  const toKids = sql(`SELECT count(*) FROM notification n JOIN child c ON c.id = n.person_id`);
  check(toKids === '0', 'reminders go to parents, never to children');

  // ================================================================== pupil
  group('Pupil view (§ 8.4.5) and own child (§ 8.4.7)');
  const pupil = await call('GET', `/api/educator/children/${madina.id}`, { jar: aziza });
  check(pupil.status === 200 && pupil.body.waves.length >= 4 && pupil.body.isOwnChild === false && pupil.body.parentReportAvailable === false,
    'pupil view: waves with taken / progress, no parent report', `${pupil.status}`);
  check(!LEAK.test(pupil.text), 'no percentile in the pupil view', (pupil.text.match(LEAK) ?? [''])[0]);
  const temurView = await call('GET', `/api/educator/children/${temur.id}`, { jar: aziza });
  check(temurView.status === 404, 'link only requested → 404', `${temurView.status}`);
  const ownGroup = await call('POST', '/api/educator/groups', { jar: nodira, body: { name: `Uy ${rand(4)}`, grade: 3 } });
  await call('POST', `/api/educator/groups/${ownGroup.body.id}/members`, { jar: nodira, body: { childIds: [sevinch.id] } });
  const ownOv = await call('GET', `/api/educator/groups/${ownGroup.body.id}/overview`, { jar: nodira });
  check(ownOv.body?.children?.length === 0 && ownOv.body?.ownChildExcluded === true && ownOv.body?.stats?.total === 0,
    'the own child is left out of the group statistics', JSON.stringify(ownOv.body?.stats));
  const ownPupil = await call('GET', `/api/educator/children/${sevinch.id}`, { jar: nodira });
  check(ownPupil.body?.isOwnChild === true && ownPupil.body?.parentReportAvailable === true, 'own child: the parent report is theirs to open');
  await call('PATCH', `/api/educator/groups/${ownGroup.body.id}`, { jar: nodira, body: { archived: true } });
  const myKids = await call('GET', '/api/educator/my-children', { jar: nodira });
  check(myKids.body?.some((c) => c.id === sevinch.id), '"My children" lists the own child (by guardianship)');
  const azizaKids = await call('GET', '/api/educator/my-children', { jar: aziza });
  check(Array.isArray(azizaKids.body) && !azizaKids.body.some((c) => c.id === madina.id), "a pupil is never in 'My children'");

  // ================================================================ practice
  group('Practice (§ 8.4.6, INV-08)');
  const mistake = o.body.misconceptions[0];
  const built = await call('POST', '/api/educator/practice/forms', { jar: aziza, body: { source: 'misconception', code: mistake.code, grade: 4 } });
  check(built.status === 201 && built.body.items.length >= 3 && built.body.source?.code === mistake.code,
    'build a set from a common mistake', `${built.status} ${built.body?.items?.length}`);
  const anchors = sql(`SELECT count(*) FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id JOIN item i ON i.id = v.item_id
                        WHERE fi.form_id = '${built.body.id}' AND i.is_anchor`);
  check(anchors === '0', 'no anchor in the set (INV-08, by the candidate query)', anchors);
  check(sql(`SELECT count(*) FROM form f JOIN form_item fi ON fi.form_id = f.id JOIN item_version v ON v.id = fi.item_version_id
              JOIN item i ON i.id = v.item_id WHERE f.mode = 'practice' AND i.is_anchor`) === '0', 'no practice form anywhere holds an anchor');
  check(sql(`SELECT bool_and(source_code IS NOT NULL)::text FROM form_item WHERE form_id = '${built.body.id}'`) === 'true', 'every slot is tagged with its source');
  check(sql(`SELECT count(*) FROM form_item WHERE form_id = '${built.body.id}' AND is_scored = false AND slot_role <> 'pretest'`) === '0',
    'only a pretest slot is unscored');
  check(!LEAK.test(built.text), 'no answer keys or statistics in the preview', (built.text.match(LEAK) ?? [''])[0]);
  const byTopic = await call('POST', '/api/educator/practice/forms', { jar: aziza, body: { source: 'topic', code: 'rea.logic', grade: 4 } });
  check(byTopic.status === 201 && byTopic.body.items.length >= 3, 'build a set by topic', `${byTopic.status}`);
  const swapped = await call('POST', `/api/educator/practice/forms/${byTopic.body.id}/swap`, { jar: aziza, body: { position: 1 } });
  check(swapped.status === 200 && swapped.body.items[0].itemVersionId !== byTopic.body.items[0].itemVersionId, 'swap a question', `${swapped.status}`);
  const empty = await call('POST', '/api/educator/practice/forms', { jar: aziza, body: { source: 'topic', code: 'num.addsub', grade: 4 } });
  check(empty.status === 409 && empty.body?.error === 'NO_ITEMS', 'a topic with nothing to practise → 409 NO_ITEMS', `${empty.status}`);
  const foreign = await call('GET', `/api/educator/practice/forms/${built.body.id}`, { jar: nodira });
  check(foreign.status === 404, "another educator's set is a 404", `${foreign.status}`);

  const kids = mistake.childIds.slice(0, 3);
  const assigned = await call('POST', '/api/educator/practice/assignments', {
    jar: aziza,
    body: { formId: built.body.id, childIds: [...kids, temur.id], groupId: shanba.id },
  });
  check(assigned.status === 201 && assigned.body.assigned === kids.length && assigned.body.skipped === 1,
    'assign to those who made the mistake (an unlinked child is dropped)', JSON.stringify(assigned.body));
  check(sql(`SELECT (frozen_at IS NOT NULL)::text FROM form WHERE id = '${built.body.id}'`) === 'true', 'assigning freezes the set');
  const frozenSwap = await call('POST', `/api/educator/practice/forms/${built.body.id}/swap`, { jar: aziza, body: { position: 1 } });
  check(frozenSwap.status === 409 && frozenSwap.body?.error === 'FORM_FROZEN', 'an assigned set cannot change', `${frozenSwap.status}`);
  check(sql(`SELECT count(*) FROM notification WHERE template = 'practice_assigned' AND throttle_key LIKE 'practice_assigned:${assigned.body.id}:%'`) === String(kids.length),
    'each owner gets a short note');

  // The parent's side: a set and whether it is done — never how many solved.
  const kidId = kids[0];
  const kidOwnerPhone = sql(`SELECT p.phone FROM guardianship g JOIN person p ON p.id = g.person_id WHERE g.child_id = '${kidId}' AND g.role = 'owner'`);
  const parent = await signIn(kidOwnerPhone);
  const fList = await call('GET', `/api/family/children/${kidId}/practice`, { jar: parent });
  const row = fList.body?.find((r) => r.assignmentId === assigned.body.id);
  check(row?.status === 'not_started' && !/solved/i.test(fList.text), 'the parent sees the set, no solved count', JSON.stringify(row));
  const otherKid = await call('POST', `/api/family/children/${madina.id}/practice/${assigned.body.id}/sessions`, { jar: owner });
  check(otherKid.status === 404, 'a child not in the assignment cannot start it', `${otherKid.status}`);
  const start = await call('POST', `/api/family/children/${kidId}/practice/${assigned.body.id}/sessions`, { jar: parent });
  check(start.status === 201 && start.body?.sessionId, 'the parent starts it in kid mode', `${start.status}`);
  const sid = start.body.sessionId;
  const bundle = await call('GET', `/api/sessions/${sid}/bundle`, { jar: parent });
  check(bundle.body?.mode === 'practice' && bundle.body.items.length === built.body.items.length, 'the kid gets the whole set', bundle.body?.mode);
  const begin = await call('POST', `/api/sessions/${sid}/begin`, { jar: parent, body: { language: 'uz' } });
  check(begin.status === 200 && begin.body?.deadlineAt === null, 'practice has no clock', JSON.stringify(begin.body));
  const keys = sql(`SELECT string_agg(o.id::text, ',' ORDER BY fi.position) FROM form_item fi JOIN item_option o
                     ON o.item_version_id = fi.item_version_id AND o.is_key WHERE fi.form_id = '${built.body.id}'`).split(',');
  const answers = bundle.body.items.map((it, i) => ({
    itemVersionId: it.itemVersionId,
    chosenOptionId: i < 2 ? keys[i] : it.options.find((op) => !keys.includes(op.id))?.id ?? null,
    clientRecordedAt: new Date().toISOString(),
  }));
  const submit = await call('POST', `/api/sessions/${sid}/submit`, { jar: parent, body: { answers } });
  const scoredCount = built.body.size;
  check(submit.status === 200 && submit.body?.total === scoredCount && typeof submit.body?.solved === 'number',
    'the child sees "solved X of N" — scored items only', JSON.stringify(submit.body));
  const twiceStart = await call('POST', `/api/family/children/${kidId}/practice/${assigned.body.id}/sessions`, { jar: parent });
  check(twiceStart.status === 409 && twiceStart.body?.error === 'PRACTICE_DONE', 'one attempt per assignment', `${twiceStart.status}`);
  const res = await call('GET', `/api/educator/practice/assignments/${assigned.body.id}/results`, { jar: aziza });
  const me1 = res.body?.children?.find((c) => c.id === kidId);
  check(res.status === 200 && me1?.status === 'done' && me1.solved === submit.body.solved && res.body.summary.completed === 1,
    'the educator sees how many solved', JSON.stringify(res.body?.summary));
  check(!LEAK.test(res.text) && !/percent|top /i.test(res.text), 'results carry no percentile or position', (res.text.match(LEAK) ?? [''])[0]);
  const fList2 = await call('GET', `/api/family/children/${kidId}/practice`, { jar: parent });
  check(fList2.body?.find((r) => r.assignmentId === assigned.body.id)?.status === 'done' && !/solved/i.test(fList2.text),
    'the parent sees it done — still no count');
  await call('POST', '/api/dev/tick');
  check(sql(`SELECT count(*) FROM scale_score x JOIN session s ON s.id = x.session_id WHERE s.mode = 'practice'`) === '0',
    'practice never feeds the scale (§ 1.11)');

  const rep = await call('POST', `/api/educator/practice/assignments/${assigned.body.id}/repeat`, { jar: aziza, body: { childIds: [kidId] } });
  check(rep.status === 201 && sql(`SELECT repeat_of FROM practice_assignment WHERE id = '${rep.body?.id}'`) === assigned.body.id,
    '"repeat for those who struggled" makes a linked assignment', `${rep.status}`);
  const undo = await call('DELETE', `/api/educator/practice/assignments/${rep.body.id}`, { jar: aziza });
  check(undo.status === 200, 'undo while nobody started', `${undo.status}`);
  const undoStarted = await call('DELETE', `/api/educator/practice/assignments/${assigned.body.id}`, { jar: aziza });
  check(undoStarted.status === 409 && undoStarted.body?.error === 'ALREADY_STARTED', 'no undo once a child started', `${undoStarted.status}`);
  const listed = await call('GET', '/api/educator/practice/assignments', { jar: aziza });
  check(listed.body?.[0]?.id === assigned.body.id && !('children' in listed.body[0]), 'the list is newest first, summaries only');

  // ----------------------------------------------------------------- report
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
