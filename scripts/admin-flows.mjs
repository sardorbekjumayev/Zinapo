#!/usr/bin/env node
/**
 * M9 — measurement v1, outcomes, admin (task.md § 8.5, § 9, § 12 M9).
 *
 *   ./scripts/admin-flows.sh
 *
 * Needs the dev fixtures (`./scripts/seed.sh`). Covers the Rasch v1 run
 * (anchors fixed — equating, θ ± SE bands, not current until switched,
 * comparing runs), the inflation adjustment from a proctored final (≥ 30
 * pairs, applied one way), the admission outcomes import (matching by PINFL
 * hash inside the service, never echoing a PINFL; the review queue; a later
 * registration matching by itself), support lookup with resend and a cancelled
 * login, staff roles (the last super admin stays) and the audit viewer.
 * Leaves the parent reports on the run they were on.
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
  const headers = { 'user-agent': 'zinapo-admin-flows' };
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
  const sim = await call('POST', '/api/dev/telegram/simulate', { body: { link: s.body.deepLink, phone, firstName: 'Ad', lastName: 'Flow' } });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: s.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}: ${v.status}`);
  return jar;
}
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;
const pinflFor = (dob, tail = rand(7)) => {
  const [y, m, d] = dob.split('-');
  return `6${d}${m}${y.slice(2)}${tail}`;
};
const PINFL = /\b[1-6]\d{13}\b/;

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  for (const step of ['seed-bank', 'seed-results', 'seed-educator', 'seed-olympiad', 'seed-trust']) await call('POST', `/api/dev/${step}`);
  const P = seeded.people;
  const madina = seeded.children.find((c) => c.grade === 4);
  const editor = await signIn(P.bank_editor.phone);
  const seasonMgr = await signIn(P.season_manager.phone);
  const outOp = await signIn(P.outcomes_operator.phone);
  const support = await signIn(P.support.phone);
  const admin = await signIn(P.super_admin.phone);
  const ts = await signIn(P.trust_safety.phone);
  const author = await signIn(P.item_author.phone);
  const owner = await signIn(P.owner.phone);
  const season = sql(`SELECT id FROM season WHERE is_current`);
  const v0Current = sql(`SELECT id FROM calibration_run WHERE season_id = '${season}' AND grade = 4 AND is_current`);

  // ================================================================ v1
  group('Rasch v1 with anchor equating (M9-a, M9-d)');
  check((await call('POST', '/api/staff/calibration-runs', { jar: seasonMgr, body: { method: 'rasch_anchor_equating_v1', grade: 4 } })).status === 403,
    'only the bank editor runs calibration (403)');
  const t1 = await call('POST', '/api/staff/calibration-runs', { jar: editor, body: { method: 'rasch_anchor_equating_v1', grade: 4 } });
  const r1 = t1.body?.runs?.[0];
  check(t1.status === 202 && r1, 'run v1 for grade 4', `${t1.status}`);
  const p1 = JSON.parse(sql(`SELECT json_build_object('current', is_current, 'method', method, 'p', params) FROM calibration_run WHERE id = '${r1}'`));
  check(p1.method === 'rasch_anchor_equating_v1' && p1.current === false, 'a v1 run is NOT current until staff switch (M9-d)');
  check(p1.p.converged === true && p1.p.persons > 30, 'the calibration converged', JSON.stringify({ c: p1.p.converged, n: p1.p.persons, it: p1.p.iterations }));
  check(sql(`SELECT count(*) FROM scale_score WHERE calibration_run_id = '${r1}' AND (theta IS NULL OR se IS NULL OR se <= 0)`) === '0',
    'every session has theta and SE');
  check(sql(`SELECT count(*) FROM percentile_band WHERE calibration_run_id = '${r1}' AND pct_low IS NOT NULL AND pct_low <= pct_high`) !== '0',
    'bands are ranges from theta ± 1.0 SE');
  const t2 = await call('POST', '/api/staff/calibration-runs', { jar: editor, body: { method: 'rasch_anchor_equating_v1', grade: 4 } });
  const r2 = t2.body?.runs?.[0];
  const p2 = JSON.parse(sql(`SELECT params FROM calibration_run WHERE id = '${r2}'`));
  check(p2.fixedAnchors > 0, 'the next run fixes the anchors at the earlier v1 values (equating)', `${p2.fixedAnchors}`);
  const anchorsDiffer = sql(`SELECT count(*) FROM item_statistic a JOIN item_statistic b ON b.item_version_id = a.item_version_id AND b.calibration_run_id = '${r2}'
                              JOIN item_version v ON v.id = a.item_version_id JOIN item i ON i.id = v.item_id AND i.is_anchor
                             WHERE a.calibration_run_id = '${r1}' AND a.difficulty_b <> b.difficulty_b`);
  check(anchorsDiffer === '0', "anchors don't move between equated runs");
  const cmp = await call('GET', `/api/staff/calibration-runs/compare?a=${v0Current}&b=${r2}`, { jar: editor });
  check(cmp.status === 200 && cmp.body.waves.length >= 1 && Array.isArray(cmp.body.items), 'compare v0 with v1: band shifts per wave, item changes', `${cmp.status}`);
  check(!/Madina|KARIMOVA|child_id/.test(cmp.text), 'the comparison names no child');
  const g1 = sql(`SELECT id FROM calibration_run WHERE season_id = '${season}' AND grade = 1 AND is_current`);
  const notCmp = await call('GET', `/api/staff/calibration-runs/compare?a=${g1}&b=${r2}`, { jar: editor });
  check(notCmp.status === 409 && notCmp.body?.error === 'NOT_COMPARABLE', 'only runs of the same season and grade compare', `${notCmp.status}`);
  const sw = await call('POST', `/api/staff/calibration-runs/${r2}/current`, { jar: editor });
  check(sw.status === 200 && sql(`SELECT is_current FROM calibration_run WHERE id = '${r2}'`) === 't', 'staff make v1 current');
  const rep = await call('GET', `/api/family/children/${madina.id}/report`, { jar: owner });
  check(rep.status === 200 && rep.body?.latest, 'the parent report reads the v1 run', `${rep.status}`);
  check(!/theta|"se"|rawScore/.test(rep.text), 'the report still shows no theta, SE or score');

  // ======================================================= inflation
  group('Inflation adjustment from the proctored final (M9-c)');
  // Fixture: a final in the current season that 35 synthetic children sat on
  // the monitoring scale's items, scoring LOWER than at home.
  const form4 = sql(`SELECT form_id FROM wave WHERE season_id = '${season}' AND grade = 4 AND closed_at IS NOT NULL ORDER BY ordinal LIMIT 1`);
  const slug = `inf-${rand(6)}`;
  const ol = sql(`INSERT INTO olympiad (season_id, slug, title_uz, title_ru, grade_min, grade_max, is_ranked)
                  VALUES ('${season}', '${slug}', 'Sinov inflyatsiya', 'Тест инфляции', 4, 4, true) RETURNING id`);
  const stg = sql(`INSERT INTO olympiad_stage (olympiad_id, kind, opens_at, closes_at) VALUES ('${ol}', 'spring_final', now() - interval '2 days', now() - interval '1 day') RETURNING id`);
  sql(`WITH kids AS (
         SELECT c.id AS child_id, g.person_id AS owner FROM child c
           JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
           JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL AND e.grade = 4 AND e.school_region_id = 14
          WHERE c.family_name = 'KOHORT' ORDER BY c.given_name LIMIT 35),
       en AS (INSERT INTO olympiad_entry (olympiad_id, stage_id, child_id, registered_by, region_id, grade, entry_via)
              SELECT '${ol}', '${stg}', child_id, owner, 14, 4, 'ticket' FROM kids RETURNING id, child_id, registered_by),
       se AS (INSERT INTO session (child_id, mode, form_id, olympiad_entry_id, launched_by, launch_context, grade_snapshot, region_snapshot,
                                   status, started_at, submitted_at, sync_source)
              SELECT child_id, 'olympiad', '${form4}', id, registered_by, 'proctored_final', 4, 14, 'submitted', now() - interval '1 day',
                     now() - interval '1 day' + interval '30 minutes', 'offline_sync' FROM en RETURNING id, child_id)
       INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, client_recorded_at)
       SELECT se.id, fi.item_version_id, NULL, (abs(hashtext(se.child_id::text || fi.position)) % 100) < 25, now() - interval '1 day'
         FROM se JOIN form_item fi ON fi.form_id = '${form4}'`);
  const t3 = await call('POST', '/api/staff/calibration-runs', { jar: editor, body: { method: 'rasch_anchor_equating_v1', grade: 4 } });
  const r3 = t3.body?.runs?.[0];
  const inf = sql(`SELECT delta_theta || '/' || n_final FROM inflation_adjustment WHERE calibration_run_id = '${r3}' AND region_id = 14`);
  const [delta, nFinal] = inf.split('/').map(Number);
  check(inf && nFinal >= 30 && delta > 0, 'with ≥ 30 pairs the delta is stored (monitoring above the final → positive)', inf);
  const shift = Number(sql(`SELECT avg(b.theta - a.theta) FROM scale_score a JOIN scale_score b ON b.session_id = a.session_id AND b.calibration_run_id = '${r3}'
                             JOIN session s ON s.id = a.session_id AND s.region_snapshot = 14 AND s.mode = 'monitoring'
                            WHERE a.calibration_run_id = '${r2}'`));
  check(Math.abs(shift + delta) < 0.05, "the region's monitoring thetas move down by the delta (the final corrects monitoring)", `shift ${shift.toFixed(3)} vs −${delta}`);
  check(sql(`SELECT count(*) FROM scale_score x JOIN session s ON s.id = x.session_id WHERE x.calibration_run_id = '${r3}' AND s.mode = 'olympiad'`) === '0',
    'final sessions are never written to the scale themselves');
  // Archive the fixture so later runs don't see it; reports go back to the run they were on.
  sql(`INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on) VALUES ('m7-sinov', 'Sinov M7 (arxiv)', 'Тест M7 (архив)', '2019-09-01', '2020-06-30') ON CONFLICT (code) DO NOTHING`);
  sql(`UPDATE olympiad SET season_id = (SELECT id FROM season WHERE code = 'm7-sinov') WHERE id = '${ol}'`);
  const back = await call('POST', `/api/staff/calibration-runs/${v0Current}/current`, { jar: editor });
  check(back.status === 200 && sql(`SELECT is_current FROM calibration_run WHERE id = '${v0Current}'`) === 't', 'switching back is one click (and the v0 job resumes)');

  // ========================================================= outcomes
  group('Admission outcomes (M9-b) — matched by PINFL inside the service');
  check((await call('POST', '/api/staff/outcomes/import', { jar: admin, body: { fileName: 'x.csv', csv: 'a' } })).status === 403,
    'super_admin cannot import (403) — outcomes_operator only');
  // A family whose child's PINFL in the list has a typo (same date of birth) → manual review.
  const famPhone = freshPhone();
  const fam = await signIn(famPhone);
  const dob = '2016-07-19';
  const realPinfl = pinflFor(dob);
  const kid = await call('POST', '/api/family/children', {
    jar: fam,
    body: { pinfl: realPinfl, familyName: 'NATIJAYEVA', givenName: 'Sabina', patronymic: 'T', dob, grade: 4, schoolRegionId: 14,
            consents: [{ type: 'data_processing', given: true }, { type: 'third_party_transfer', given: false }, { type: 'marketing', given: false }] },
  });
  const typo = pinflFor(dob, rand(7));
  const later = pinflFor('2016-08-21');
  const csv = [
    'pinfl;family_name;given_name;school;admitted;year',
    `${realPinfl};NATIJAYEVA;Sabina;Prezident maktabi;ha;2027`,
    `${typo};NATIJAYEVA;Sabina;Prezident maktabi;yes;2026`,
    `${later};KECHROQOVA;Dilya;Prezident maktabi;no;2027`,
    `00000000000000;XATO;Qator;—;yes;2027`,
  ].join('\n');
  const imp = await call('POST', '/api/staff/outcomes/import', { jar: outOp, body: { fileName: 'qabul-2027.csv', csv } });
  check(imp.status === 200 && imp.body.matched === 1 && imp.body.unmatched === 2 && imp.body.invalid.length === 1, 'import: one matched by hash, two to review, one invalid line', JSON.stringify(imp.body));
  check(!PINFL.test(imp.text) && !imp.text.includes(realPinfl), 'the reply never repeats a PINFL');
  check(sql(`SELECT count(*) FROM admission_outcome WHERE source_row::text ~ '[0-9]{14}'`) === '0', 'no PINFL is stored — only its hash and the date of birth (INV-06)');
  check(sql(`SELECT octet_length(pinfl_hash) FROM admission_outcome WHERE child_id = '${kid.body.id}'`) === '32', 'the match is kept by hash');
  const again = await call('POST', '/api/staff/outcomes/import', { jar: outOp, body: { fileName: 'qabul-2027.csv', csv } });
  check(again.body?.matched === 1 && sql(`SELECT count(*) FROM admission_outcome WHERE child_id = '${kid.body.id}'`) === '1', 'importing the same list again duplicates nothing');
  const pend = await call('GET', '/api/staff/outcomes/pending', { jar: outOp });
  const typoRow = pend.body.find((r) => r.familyName === 'NATIJAYEVA' && r.admitYear === 2026);
  check(typoRow && typoRow.dob === dob && !PINFL.test(pend.text), 'the review list shows names and the date of birth — never the PINFL');
  const cand = await call('GET', `/api/staff/outcomes/${typoRow.id}/candidates`, { jar: outOp });
  check(cand.body?.some((c) => c.childId === kid.body.id && c.name === 'NATIJAYEVA S***A'), 'candidates: same date of birth, similar name, masked', JSON.stringify(cand.body).slice(0, 120));
  const wrongDob = sql(`SELECT id FROM child WHERE dob <> '${dob}' AND anonymised_at IS NULL LIMIT 1`);
  const bad = await call('POST', `/api/staff/outcomes/${typoRow.id}/match`, { jar: outOp, body: { childId: wrongDob } });
  check(bad.status === 409 && bad.body?.error === 'DOB_MISMATCH', 'a manual match must share the date of birth', `${bad.status}`);
  const ok = await call('POST', `/api/staff/outcomes/${typoRow.id}/match`, { jar: outOp, body: { childId: kid.body.id } });
  check(ok.status === 200 && sql(`SELECT review FROM admission_outcome WHERE id = '${typoRow.id}'`) === 'matched_manual', 'match by hand');
  const twice = await call('POST', `/api/staff/outcomes/${typoRow.id}/not-zinapo`, { jar: outOp });
  check(twice.status === 409, 'a reviewed row stays reviewed', `${twice.status}`);
  // The other unmatched child registers later → the next import matches it by itself.
  const fam2 = await signIn(freshPhone());
  const k2 = await call('POST', '/api/family/children', {
    jar: fam2,
    body: { pinfl: later, familyName: 'KECHROQOVA', givenName: 'Dilya', patronymic: 'T', dob: '2016-08-21', grade: 4, schoolRegionId: 14,
            consents: [{ type: 'data_processing', given: true }, { type: 'third_party_transfer', given: false }, { type: 'marketing', given: false }] },
  });
  await call('POST', '/api/staff/outcomes/import', { jar: outOp, body: { fileName: 'bosh.csv', csv: 'pinfl,family_name,given_name,admitted,year' } });
  check(sql(`SELECT review FROM admission_outcome WHERE child_id = '${k2.body.id}'`) === 'matched_auto', 'a child registered after the import is matched later, by hash');
  const sum = await call('GET', '/api/staff/outcomes?year=2027', { jar: outOp });
  check(sum.status === 200 && sum.body.byBand.length === 5 && sum.body.totals.matched >= 2, 'the summary: counts and admission rate by last band', JSON.stringify(sum.body?.totals));
  check(!/NATIJAYEVA|KECHROQOVA/.test(sum.text), 'the summary lists no child');

  // ============================================================ support
  group('Support lookup (never a PINFL or an answer)');
  check((await call('GET', `/api/staff/people?phone=${encodeURIComponent(P.owner.phone)}`, { jar: author })).status === 403, 'an item author cannot look people up (403)');
  const look = await call('GET', `/api/staff/people?phone=${encodeURIComponent(P.owner.phone)}`, { jar: support });
  check(look.status === 200 && look.body.found && look.body.guardianships.some((g) => g.child === 'KARIMOVA M***A'), 'relationships with masked children');
  check(!PINFL.test(look.text) && !/pinfl/i.test(look.text) && !/is_correct|isCorrect|chosen/i.test(look.text), 'no PINFL, no answers');
  const target = freshPhone();
  const azizaJar = await signIn(P.educator.phone);
  await call('POST', '/api/educator/invites', { jar: azizaJar, body: { phones: [target] } });
  flush();
  await call('POST', '/api/auth/telegram/start', { body: { phone: target, lang: 'uz' } });
  const nobody = await call('GET', `/api/staff/people?phone=${encodeURIComponent(target)}`, { jar: support });
  check(nobody.body?.found === false && nobody.body.invitesForThisPhone.educator.length === 1 && nobody.body.login.requests.length === 1,
    'an unregistered number: its waiting invite and its login in progress', JSON.stringify(nobody.body).slice(0, 160));
  const inv = nobody.body.invitesForThisPhone.educator[0].id;
  const rs1 = await call('POST', `/api/staff/people/invites/${inv}/resend`, { jar: support, body: { kind: 'educator' } });
  const rs2 = await call('POST', `/api/staff/people/invites/${inv}/resend`, { jar: support, body: { kind: 'educator' } });
  check(rs1.body?.resent === true && rs2.body?.resent === false, 'resend an invite — once a day', `${JSON.stringify(rs1.body)} ${JSON.stringify(rs2.body)}`);
  const lr = nobody.body.login.requests[0].id;
  const wrongPhone = await call('POST', `/api/staff/people/login-requests/${lr}/cancel`, { jar: support, body: { phone: P.owner.phone } });
  check(wrongPhone.status === 404, "a login request is cancelled only for its own number", `${wrongPhone.status}`);
  const cl = await call('POST', `/api/staff/people/login-requests/${lr}/cancel`, { jar: support, body: { phone: target } });
  const afterCancel = await call('GET', `/api/staff/people?phone=${encodeURIComponent(target)}`, { jar: support });
  check(cl.status === 200 && afterCancel.body.login.requests.length === 0, 'cancel a stuck login request', `${cl.status}`);
  check((await call('POST', `/api/staff/people/login-requests/${lr}/cancel`, { jar: ts, body: { phone: target } })).status === 403,
    'trust & safety can look up but not reset logins (403)');

  // ============================================================== roles
  group('Staff roles and the audit log (super admin)');
  check((await call('GET', '/api/staff/roles', { jar: ts })).status === 403, 'trust & safety cannot manage roles (403)');
  const newbie = freshPhone();
  await signIn(newbie);
  const grant = await call('POST', '/api/staff/roles', { jar: admin, body: { phone: newbie, role: 'support' } });
  const person = grant.body?.people?.find((x) => x.roles.some((r) => r.role === 'support' && x.phone?.endsWith(newbie.slice(-2))));
  check(grant.status === 201 && person, 'grant a role to a registered person', `${grant.status}`);
  const dup = await call('POST', '/api/staff/roles', { jar: admin, body: { phone: newbie, role: 'support' } });
  check(dup.status === 409 && dup.body?.error === 'ALREADY_HAS_ROLE', 'no double grant', `${dup.status}`);
  const unknown = await call('POST', '/api/staff/roles', { jar: admin, body: { phone: freshPhone(), role: 'support' } });
  check(unknown.status === 404 && unknown.body?.error === 'PERSON_NOT_FOUND', 'only someone who has signed in can get a role', `${unknown.status}`);
  const newbieJar = await signIn(newbie);
  check((await call('GET', `/api/staff/people?phone=${encodeURIComponent(P.owner.phone)}`, { jar: newbieJar })).status === 200, 'the new role works at once');
  const aid = person.roles.find((r) => r.role === 'support').assignmentId;
  const rev = await call('DELETE', `/api/staff/roles/${aid}`, { jar: admin });
  check(rev.status === 200, 'revoke it', `${rev.status}`);
  check((await call('GET', `/api/staff/people?phone=${encodeURIComponent(P.owner.phone)}`, { jar: newbieJar })).status === 403, '…and it is gone at once');
  const supers = sql(`SELECT count(*) FROM staff_role_assignment WHERE role = 'super_admin' AND revoked_at IS NULL`);
  if (supers === '1') {
    const last = sql(`SELECT id FROM staff_role_assignment WHERE role = 'super_admin' AND revoked_at IS NULL`);
    const lastRev = await call('DELETE', `/api/staff/roles/${last}`, { jar: admin });
    check(lastRev.status === 409 && lastRev.body?.error === 'LAST_SUPER_ADMIN', 'the last super admin cannot be revoked', `${lastRev.status}`);
  }
  const log = await call('GET', '/api/staff/audit?action=staff_role&limit=5', { jar: admin });
  check(log.status === 200 && log.body.entries.some((e) => e.action === 'staff_role.granted') && log.body.entries.every((e) => e.action.startsWith('staff_role.')),
    'the audit log filters by action group', `${log.status}`);
  const page1 = await call('GET', '/api/staff/audit?limit=3', { jar: admin });
  const page2 = await call('GET', `/api/staff/audit?limit=3&before=${page1.body.nextBefore}`, { jar: admin });
  check(page2.body.entries.every((e) => e.id < page1.body.nextBefore + 1) && page2.body.entries[0]?.id < page1.body.entries[0].id, 'paged newest first');
  check(!PINFL.test(JSON.stringify(page1.body)) && /\+99890•/.test(page1.text), 'people with masked phones, no PINFL');
  check((await call('GET', '/api/staff/audit', { jar: editor })).status === 403, 'bank_editor cannot read the audit log (403)');

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
