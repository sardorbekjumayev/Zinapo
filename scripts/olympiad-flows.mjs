#!/usr/bin/env node
/**
 * M7 — the olympiad, end to end (task.md § 8.1.6, § 8.5, § 12 M7).
 *
 *   ./scripts/olympiad-flows.sh
 *
 * Needs the dev fixtures (`./scripts/seed.sh`, which ends with
 * /api/dev/seed-olympiad). Covers the operator's admin, the ticket and
 * registration rules, the online stages in kid mode (never on the scale),
 * the proctor's check-in, offline package and idempotent sync, results
 * (ranking only for grades ≥ 3, bands, certificates, qualification, places),
 * the response-time flag, the teacher bonus (proctored final only) and the
 * season cup, and that results reach only the family.
 *
 * Fresh children and phones each run; it can run any number of times.
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
  const headers = { 'user-agent': 'zinapo-olympiad-flows' };
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
  const sim = await call('POST', '/api/dev/telegram/simulate', { body: { link: s.body.deepLink, phone, firstName: 'Ol', lastName: 'Flow' } });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: s.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}: ${v.status}`);
  return jar;
}
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;
/** What a family must never receive about an olympiad: scores, ranks, other children. */
const FAMILY_LEAK = /"(result_?score|result_?rank|rank|score|percentile|rawScore|theta|isCorrect|is_correct|is_key|isKey)"\s*:/i;

/** Answer a session: `right` of the scored items correct (keys read from the DB, as a grader would). */
function answersFor(formId, bundleItems, right) {
  const keys = new Map(
    sql(`SELECT fi.item_version_id || ':' || o.id FROM form_item fi JOIN item_option o ON o.item_version_id = fi.item_version_id AND o.is_key
          WHERE fi.form_id = '${formId}'`).split('\n').filter(Boolean).map((l) => l.split(':')),
  );
  return bundleItems.map((it, i) => ({
    itemVersionId: it.itemVersionId,
    chosenOptionId: i < right ? keys.get(it.itemVersionId) : it.options.find((o) => o.id !== keys.get(it.itemVersionId))?.id ?? null,
    clientRecordedAt: new Date().toISOString(),
    responseMs: 20000,
  }));
}

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  for (const step of ['seed-bank', 'seed-results', 'seed-educator', 'seed-olympiad']) await call('POST', `/api/dev/${step}`);
  const P = seeded.people;
  const madina = seeded.children.find((c) => c.grade === 4);
  const temur = seeded.children.find((c) => c.grade === 1);
  const owner = await signIn(P.owner.phone);
  const co = await signIn(P.coGuardian.phone);
  const op = await signIn(P.olympiad_operator.phone);
  const proctor = await signIn(P.proctor.phone);
  const editor = await signIn(P.bank_editor.phone);
  const aziza = await signIn(P.educator.phone);

  // =================================================================== admin
  group('Operator admin (§ 8.5)');
  const list = await call('GET', '/api/staff/olympiads', { jar: op });
  check(list.status === 200 && list.body?.some((o) => o.slug === 'zinapo-2026'), 'the operator lists olympiads', `${list.status}`);
  const deny = await call('GET', '/api/staff/olympiads', { jar: proctor });
  check(deny.status === 403, 'a proctor cannot manage olympiads (403)', `${deny.status}`);
  const youngSlug = `sinov-yosh-${rand(6)}`;
  const young = await call('POST', '/api/staff/olympiads', { jar: op, body: { slug: youngSlug, titleUz: 'Sinov', titleRu: 'Тест', gradeMin: 0, gradeMax: 0 } });
  check(young.status === 201 && young.body?.isRanked === false, 'an olympiad reaching grades 0–2 is never ranked', JSON.stringify(young.body?.isRanked));
  const dupSlug = await call('POST', '/api/staff/olympiads', { jar: op, body: { slug: youngSlug, titleUz: 'Sinov', titleRu: 'Тест', gradeMin: 0, gradeMax: 0 } });
  check(dupSlug.status === 409 && dupSlug.body?.error === 'SLUG_TAKEN', 'slugs are unique', `${dupSlug.status}`);
  const yst = await call('PUT', `/api/staff/olympiads/${young.body.id}/stages/spring_online`, {
    jar: op, body: { opensAt: new Date(Date.now() + 86400e3).toISOString(), closesAt: new Date(Date.now() + 2 * 86400e3).toISOString() },
  });
  const onlineVenue = await call('POST', `/api/staff/olympiads/${young.body.id}/venues`, {
    jar: op, body: { stageId: yst.body.stages[0].id, name: 'Zal', address: 'Ko‘cha 1', capacity: 5, startsAt: new Date().toISOString() },
  });
  check(onlineVenue.status === 409 && onlineVenue.body?.error === 'STAGE_IS_ONLINE', 'an online stage has no venues', `${onlineVenue.status}`);

  // This run's own olympiad (grade 4), built through the API like an operator
  // would; it is moved to an archive season at the end so families never see it.
  const slug = `sinov-${rand(6)}`;
  const made = await call('POST', '/api/staff/olympiads', {
    jar: op, body: { slug, titleUz: `Sinov olimpiadasi ${slug}`, titleRu: 'Тестовая олимпиада', gradeMin: 4, gradeMax: 4, bonusRate: 50000 },
  });
  check(made.status === 201 && made.body?.isRanked === true, 'create a ranked olympiad for grade 4', `${made.status}`);
  const zin = { id: made.body.id };
  const day = 86400e3;
  const at = (d) => new Date(Date.now() + d * day).toISOString();
  await call('PUT', `/api/staff/olympiads/${zin.id}/stages/autumn_online`, { jar: op, body: { opensAt: at(-20), closesAt: at(-10) } });
  await call('PUT', `/api/staff/olympiads/${zin.id}/stages/spring_online`, { jar: op, body: { opensAt: at(-1), closesAt: at(10) } });
  const stagesSet = await call('PUT', `/api/staff/olympiads/${zin.id}/stages/spring_final`, { jar: op, body: { opensAt: at(20), closesAt: at(20.2), registrationClosesAt: at(15) } });
  check(stagesSet.body?.stages?.length === 3, 'set three stage windows', `${stagesSet.body?.stages?.length}`);
  const stage = (k) => stagesSet.body.stages.find((s) => s.kind === k);
  const forms = await call('GET', '/api/staff/olympiads/forms?grade=4', { jar: op });
  check(forms.body?.length >= 1, 'frozen olympiad forms to attach', `${forms.body?.length}`);
  const wrongGrade = await call('PUT', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_final').id}/forms/3`, { jar: op, body: { formId: forms.body[0].id } });
  check(wrongGrade.status === 400 || (wrongGrade.status === 409 && wrongGrade.body?.error === 'FORM_MISMATCH'), 'a stage form must be of the olympiad and that grade', `${wrongGrade.status}`);
  for (const k of ['autumn_online', 'spring_online', 'spring_final']) {
    await call('PUT', `/api/staff/olympiads/${zin.id}/stages/${stage(k).id}/forms/4`, { jar: op, body: { formId: forms.body[0].id } });
  }
  const venue = async (name, capacity) =>
    (await call('POST', `/api/staff/olympiads/${zin.id}/venues`, {
      jar: op, body: { stageId: stage('spring_final').id, regionId: 14, name, address: 'Yunusobod, 12-uy', capacity, startsAt: at(20) },
    })).body.find((v) => v.name === name);
  const v1 = await venue('Sinov zali 1', 40);
  const v2 = await venue('Sinov zali 2', 2);
  check(v1 && v2, 'two venues for the final');
  const notProctor = await call('POST', `/api/staff/olympiads/${zin.id}/venues/${v2.id}/proctors`, { jar: op, body: { phone: P.owner.phone } });
  check(notProctor.status === 404 && notProctor.body?.error === 'NOT_A_PROCTOR', 'only a person with the proctor role can be assigned', `${notProctor.status}`);
  const addP = await call('POST', `/api/staff/olympiads/${zin.id}/venues/${v1.id}/proctors`, { jar: op, body: { phone: P.proctor.phone } });
  check(addP.status === 201 && addP.body.find((v) => v.id === v1.id)?.proctors?.length === 1, 'assign the proctor to venue 1', `${addP.status}`);
  const pub = await call('GET', '/api/public/olympiads/zinapo-2026');
  check(pub.status === 200 && pub.body.stages.length === 4 && !/entries|child/i.test(pub.text), 'the public landing shows the stages, no entries', `${pub.status}`);
  check((await call('GET', '/api/public/olympiads/no-such-olympiad')).status === 404, 'an unknown slug is a 404');

  // Fixture cohorts (SQL, like the dev seed): the synthetic grade 4 children
  // took autumn (all 40 + Madina) and spring online (30), and six with a
  // ticket sit at venue 1 for the final.
  const cohort = (stageKind, limit, withMadina) => sql(`
    WITH kids AS (
      SELECT c.id AS child_id, g.person_id AS owner FROM child c
        JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL AND e.grade = 4
        JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
       WHERE c.family_name = 'KOHORT' ${withMadina ? `OR c.id = '${madina.id}'` : ''}
       ORDER BY c.id = '${madina.id}' DESC, c.given_name LIMIT ${limit}),
    en AS (
      INSERT INTO olympiad_entry (olympiad_id, stage_id, child_id, registered_by, region_id, grade, entry_via, ticket_from_waves)
      SELECT '${zin.id}', '${stage(stageKind).id}', child_id, owner, 14, 4, 'open', 3 FROM kids RETURNING id, child_id, registered_by),
    se AS (
      INSERT INTO session (child_id, mode, form_id, olympiad_entry_id, launched_by, launch_context, grade_snapshot, region_snapshot,
                           status, started_at, submitted_at, device)
      SELECT child_id, 'olympiad', '${forms.body[0].id}', id, registered_by, 'home', 4, 14, 'submitted', now() - interval '12 days',
             now() - interval '12 days' + interval '30 minutes', 'fixture' FROM en RETURNING id, child_id)
    INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, response_ms, client_recorded_at)
    SELECT se.id, fi.item_version_id, o.id, o.is_key, 25000, now() - interval '12 days'
      FROM se JOIN form_item fi ON fi.form_id = '${forms.body[0].id}'
      JOIN LATERAL (SELECT id, is_key FROM item_option WHERE item_version_id = fi.item_version_id
                     ORDER BY (is_key = (abs(hashtext(se.child_id::text || fi.position)) % 100 < 35 + abs(hashtext(se.child_id::text)) % 50)) DESC,
                              position LIMIT 1) o ON true`);
  cohort('autumn_online', 41, true);
  cohort('spring_online', 30, false);
  sql(`INSERT INTO olympiad_entry (olympiad_id, stage_id, child_id, registered_by, region_id, grade, entry_via, ticket_from_waves, venue_id)
       SELECT '${zin.id}', '${stage('spring_final').id}', c.id, g.person_id, 14, 4, 'ticket', 3, '${v1.id}'
         FROM child c JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL AND e.grade = 4
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.family_name = 'KOHORT' ORDER BY c.given_name LIMIT 6`);
  const shrink = await call('PATCH', `/api/staff/olympiads/${zin.id}/venues/${v1.id}`, { jar: op, body: { capacity: 1 } });
  check(shrink.status === 409 && shrink.body?.error === 'BELOW_SEATED', 'capacity cannot drop below the children seated', `${shrink.status}`);
  const aut = await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('autumn_online').id}/results`, { jar: op });
  check(aut.status === 200 && aut.body.taken === 41 && aut.body.certificates > 0, 'compute the autumn results', JSON.stringify(aut.body));
  await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('autumn_online').id}/publish`, { jar: op });
  const smallSeats = v2;

  // ============================================================ the family
  group('Ticket and registration (§ 8.1.6)');
  const ov = await call('GET', `/api/family/children/${madina.id}/olympiad`, { jar: owner });
  const zf = ov.body?.olympiads?.find((o) => o.id === zin.id);
  check(ov.status === 200 && ov.body.ticket.earned && ov.body.ticket.waves >= 3, 'Madina has a ticket (≥ 3 monitoring waves)', JSON.stringify(ov.body?.ticket?.waves));
  check(ov.body.owner?.name === 'Dilnoza Karimova', 'the accompanying adult is the owner (design/07)');
  const autumn = zf.stages.find((s) => s.kind === 'autumn_online');
  check(autumn.entry?.result?.band?.top && autumn.entry.result.diagnostic, 'the published autumn result: a band and a diagnostic', JSON.stringify(autumn.entry?.result?.band));
  check(!FAMILY_LEAK.test(ov.text), 'no score, rank or answer key reaches the family', (ov.text.match(FAMILY_LEAK) ?? [''])[0]);
  const coView = await call('GET', `/api/family/children/${madina.id}/olympiad`, { jar: co });
  check(coView.status === 200, 'the co-guardian can read it');
  const coReg = await call('POST', `/api/family/children/${madina.id}/olympiad/${zin.id}/register`, { jar: co, body: { stageId: stage('spring_final').id, venueId: v1.id } });
  check(coReg.status === 404, 'the co-guardian cannot register (§ 3)', `${coReg.status}`);
  const noVenue = await call('POST', `/api/family/children/${madina.id}/olympiad/${zin.id}/register`, { jar: owner, body: { stageId: stage('spring_final').id } });
  check(noVenue.status === 400 && noVenue.body?.error === 'VENUE_REQUIRED', 'an in-person stage needs a venue', `${noVenue.status}`);
  // Fill the 2-seat venue, then it is full.
  const reg = await call('POST', `/api/family/children/${madina.id}/olympiad/${zin.id}/register`, {
    jar: owner, body: { stageId: stage('spring_final').id, venueId: v1.id, source: 'telegram' },
  });
  check(reg.status === 201 && reg.body?.entryVia === 'ticket', 'with a ticket: straight into the spring final', JSON.stringify(reg.body));
  const again = await call('POST', `/api/family/children/${madina.id}/olympiad/${zin.id}/register`, { jar: owner, body: { stageId: stage('spring_final').id, venueId: v1.id } });
  check(again.status === 201 && again.body?.entryId === reg.body.entryId, 'registering again is the same entry');
  check(sql(`SELECT count(*) FROM notification n JOIN person p ON p.id = n.person_id WHERE p.phone = '${P.owner.phone}' AND n.template = 'olympiad_registered'
              AND n.throttle_key = 'olympiad_registered:${reg.body.entryId}'`) === '1', 'the owner is told once');
  const tooYoung = await call('POST', `/api/family/children/${temur.id}/olympiad/${zin.id}/register`, { jar: owner, body: { stageId: stage('spring_online').id } });
  check(tooYoung.status === 409 && tooYoung.body?.details?.reason === 'grade', 'a grade 1 child cannot enter the grades 3–4 olympiad', JSON.stringify(tooYoung.body));

  // A child with no monitoring waves: no ticket → must qualify via spring online.
  const famPhone = freshPhone();
  const fam = await signIn(famPhone);
  const dob = '2016-03-14';
  const kid = await call('POST', '/api/family/children', {
    jar: fam,
    body: {
      pinfl: `6140316${rand(7)}`, familyName: 'OLIMPOVA', givenName: 'Zuhra', patronymic: 'Testovna', dob, grade: 4, schoolRegionId: 14,
      consents: [{ type: 'data_processing', given: true }, { type: 'third_party_transfer', given: false }, { type: 'marketing', given: false }],
    },
  });
  const zuhra = kid.body?.id;
  check(kid.status === 201, 'a new family registers a grade 4 child', `${kid.status}`);
  const noTicket = await call('POST', `/api/family/children/${zuhra}/olympiad/${zin.id}/register`, { jar: fam, body: { stageId: stage('spring_final').id, venueId: v2.id } });
  check(noTicket.status === 409 && noTicket.body?.details?.reason === 'needs_ticket_or_qualification', 'no ticket, not qualified → no final yet', JSON.stringify(noTicket.body));
  const zReg = await call('POST', `/api/family/children/${zuhra}/olympiad/${zin.id}/register`, { jar: fam, body: { stageId: stage('spring_online').id, source: 'school-poster' } });
  check(zReg.status === 201 && zReg.body?.entryVia === 'open', 'anyone can enter the spring online stage', `${zReg.status}`);
  check(sql(`SELECT source FROM olympiad_entry WHERE id = '${zReg.body.entryId}'`) === 'school-poster', 'the deep-link source is kept (/o/[slug]?src=)');

  // ======================================================= online in kid mode
  group('Online stage in kid mode (never on the scale)');
  const zStart = await call('POST', `/api/family/children/${zuhra}/olympiad/entries/${zReg.body.entryId}/sessions`, { jar: fam });
  check(zStart.status === 201 && zStart.body?.sessionId, 'start the online stage', `${zStart.status}`);
  const zb = await call('GET', `/api/sessions/${zStart.body.sessionId}/bundle`, { jar: fam });
  check(zb.body?.mode === 'olympiad' && !/"isKey"|"is_key"/.test(zb.text), 'the bundle is an olympiad form, no keys', zb.body?.mode);
  const zBegin = await call('POST', `/api/sessions/${zStart.body.sessionId}/begin`, { jar: fam, body: { language: 'uz' } });
  check(zBegin.status === 200 && zBegin.body?.deadlineAt, 'the form time limit applies (no wave needed)', JSON.stringify(zBegin.body));
  const formSpring = sql(`SELECT form_id FROM session WHERE id = '${zStart.body.sessionId}'`);
  const zSubmit = await call('POST', `/api/sessions/${zStart.body.sessionId}/submit`, { jar: fam, body: { answers: answersFor(formSpring, zb.body.items, zb.body.items.length) } });
  check(zSubmit.status === 200 && zSubmit.body?.solved === undefined, 'submitted; the child sees no score for an olympiad', JSON.stringify(zSubmit.body));
  const twice = await call('POST', `/api/family/children/${zuhra}/olympiad/entries/${zReg.body.entryId}/sessions`, { jar: fam });
  check(twice.status === 409 && twice.body?.error === 'ENTRY_TAKEN', 'one attempt per entry', `${twice.status}`);
  const finalStart = await call('POST', `/api/family/children/${madina.id}/olympiad/entries/${reg.body.entryId}/sessions`, { jar: owner });
  check(finalStart.status === 409 && finalStart.body?.error === 'IN_PERSON_STAGE', 'an in-person final cannot be taken at home', `${finalStart.status}`);
  let waveRefused = false;
  try {
    sql(`UPDATE session SET wave_id = (SELECT id FROM wave LIMIT 1) WHERE id = '${zStart.body.sessionId}'`);
  } catch {
    waveRefused = true;
  }
  check(waveRefused, 'the DB refuses to attach an olympiad session to a monitoring wave (§ 9)');

  // The grades 0–2 marathon.
  const mar = ov.body.olympiads.length && (await call('GET', `/api/family/children/${temur.id}/olympiad`, { jar: owner }));
  const marafon = mar.body?.olympiads?.find((o) => o.slug === 'marafon-2027');
  check(marafon && marafon.isRanked === false, 'grades 0–2 see the marathon, unranked', JSON.stringify(marafon?.isRanked));
  const tReg = await call('POST', `/api/family/children/${temur.id}/olympiad/${marafon.id}/register`, { jar: owner, body: {} });
  check(tReg.status === 201, 'register for the marathon (the stage open for registration)', `${tReg.status}`);

  // ======================================================= spring online results
  group('Results and qualification (M7-d)');
  const sp = await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_online').id}/results`, { jar: op });
  check(sp.status === 200 && sp.body.taken >= 1, 'compute the spring online results', JSON.stringify(sp.body));
  const before = await call('GET', `/api/family/children/${zuhra}/olympiad`, { jar: fam });
  check(before.body.olympiads.find((o) => o.id === zin.id).stages.find((s) => s.kind === 'spring_online').entry.result === null,
    'nothing reaches the family before publication');
  const regEarly = await call('POST', `/api/family/children/${zuhra}/olympiad/${zin.id}/register`, { jar: fam, body: { stageId: stage('spring_final').id, venueId: v2.id } });
  check(regEarly.status === 409, 'qualification counts only once published', `${regEarly.status}`);
  const pubSp = await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_online').id}/publish`, { jar: op });
  check(pubSp.status === 200, 'publish', `${pubSp.status}`);
  const recompute = await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_online').id}/results`, { jar: op });
  check(recompute.status === 409 && recompute.body?.error === 'RESULTS_PUBLISHED', 'published results are fixed', `${recompute.status}`);
  check(sql(`SELECT qualified FROM olympiad_entry WHERE id = '${zReg.body.entryId}'`) === 't', 'all correct → in the top 30 % → qualified');
  const zFinal = await call('POST', `/api/family/children/${zuhra}/olympiad/${zin.id}/register`, { jar: fam, body: { stageId: stage('spring_final').id, venueId: smallSeats.id } });
  check(zFinal.status === 201 && zFinal.body?.entryVia === 'qualified', 'qualified → registers for the final', JSON.stringify(zFinal.body));

  // ================================================================ proctor
  group('Proctor console and the offline runner (M7-a)');
  const mine = await call('GET', '/api/staff/finals', { jar: proctor });
  check(mine.status === 200 && mine.body.some((v) => v.id === v1.id) && !mine.body.some((v) => v.id === v2.id), 'a proctor sees only their venues', `${mine.status}`);
  const otherVenue = await call('GET', `/api/staff/finals/${v2.id}`, { jar: proctor });
  check(otherVenue.status === 404, "another venue's roster is a 404", `${otherVenue.status}`);
  const notProctorRole = await call('GET', `/api/staff/finals/${v1.id}`, { jar: editor });
  check(notProctorRole.status === 403, 'no final.proctor permission → 403', `${notProctorRole.status}`);
  const roster = await call('GET', `/api/staff/finals/${v1.id}`, { jar: proctor });
  const rows = roster.body?.children ?? [];
  check(rows.length >= 7 && rows.some((r) => r.ownerName === 'Dilnoza Karimova'), 'the roster names the adult expected at the door', `${rows.length}`);
  check(!/pinfl|"phone"/i.test(roster.text), 'no PINFL or phone in the roster');
  const target = rows.filter((r) => !r.sessionStatus).slice(0, 3);
  for (const [i, r] of target.entries()) {
    await call('POST', `/api/staff/finals/${v1.id}/check-in`, { jar: proctor, body: { entryId: r.entryId, adultMatchesOwner: i !== 1 } });
  }
  check(sql(`SELECT count(*) FILTER (WHERE accompanying_adult_matches_owner = false) || '/' || count(*) FROM olympiad_entry
              WHERE id = ANY(ARRAY['${target.map((r) => r.entryId).join("','")}']::uuid[]) AND checked_in_at IS NOT NULL`) === '1/3',
    'check-in records whether the adult is the owner (a record, not a refusal)');
  const pkg = await call('GET', `/api/staff/finals/${v1.id}/package`, { jar: proctor });
  const pkgSessions = (pkg.body?.sessions ?? []).filter((s) => target.some((t) => t.entryId === s.entryId));
  check(pkg.status === 200 && pkgSessions.length === 3 && Object.keys(pkg.body.forms).length >= 1, 'the package: a session per checked-in child, each form once', `${pkg.status}`);
  check(!/"is_?key"|"isKey"|"key"\s*:/i.test(pkg.text), 'the package carries no answer keys');
  const pkg2 = await call('GET', `/api/staff/finals/${v1.id}/package`, { jar: proctor });
  check(pkg2.body.sessions.filter((s) => target.some((t) => t.entryId === s.entryId)).every((s) => pkgSessions.some((p) => p.sessionId === s.sessionId)),
    'downloading again returns the same sessions');
  check(sql(`SELECT count(*) FROM session WHERE id = ANY(ARRAY['${pkgSessions.map((s) => s.sessionId).join("','")}']::uuid[]) AND launch_context = 'proctored_final'`) === '3',
    'sessions are proctored_final');
  const form = pkg.body.forms[pkgSessions[0].formId];
  const upload = pkgSessions.map((s, i) => ({
    sessionId: s.sessionId,
    startedAt: new Date(Date.now() - 40 * 60e3).toISOString(),
    submittedAt: new Date(Date.now() - 5 * 60e3).toISOString(),
    device: 'zal-1-noutbuk',
    answers: answersFor(s.formId, form.items, form.items.length - i * 4),
  }));
  const bad = { ...upload[0], answers: [{ ...upload[0].answers[0], chosenOptionId: pkg.body.forms[pkgSessions[0].formId].items[1].options[0].id }] };
  const synced = await call('POST', `/api/staff/finals/${v1.id}/sync`, { jar: proctor, body: { sessions: [bad] } });
  check(synced.body?.rejected?.length === 1 && synced.body.synced === 0, 'an option from another item is rejected', JSON.stringify(synced.body));
  const sync1 = await call('POST', `/api/staff/finals/${v1.id}/sync`, { jar: proctor, body: { sessions: upload } });
  check(sync1.status === 200 && sync1.body?.synced === 3, 'the runner uploads its answers', JSON.stringify(sync1.body));
  const sync2 = await call('POST', `/api/staff/finals/${v1.id}/sync`, { jar: proctor, body: { sessions: upload } });
  check(sync2.body?.synced === 0 && sync2.body?.already === 3, 'uploading the same file twice changes nothing (idempotent)', JSON.stringify(sync2.body));
  check(sql(`SELECT count(*) FROM session WHERE id = ANY(ARRAY['${pkgSessions.map((s) => s.sessionId).join("','")}']::uuid[])
              AND sync_source = 'offline_sync' AND status = 'submitted'`) === '3', "submitted as sync_source = 'offline_sync'");
  const undoTaken = await call('DELETE', `/api/staff/finals/${v1.id}/check-in/${target[0].entryId}`, { jar: proctor });
  check(undoTaken.status === 409, 'check-in cannot be undone once the child sat the final', `${undoTaken.status}`);
  const seatedChild = sql(`SELECT child_id FROM olympiad_entry WHERE id = '${target[0].entryId}'`);
  const seatedOwner = await signIn(sql(`SELECT p.phone FROM guardianship g JOIN person p ON p.id = g.person_id
                                        WHERE g.child_id = '${seatedChild}' AND g.role = 'owner'`));
  const moveSeat = await call('POST', `/api/family/children/${seatedChild}/olympiad/${zin.id}/register`, {
    jar: seatedOwner, body: { stageId: stage('spring_final').id, venueId: v2.id },
  });
  check(moveSeat.status === 409 && moveSeat.body?.error === 'ALREADY_CHECKED_IN', 'a checked-in seat cannot be moved by re-registering', `${moveSeat.status}`);

  // ============================================================ final results
  group('Final: places, certificates, bonus, cup (M7-b, M7-c)');
  const fin = await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_final').id}/results`, { jar: op });
  check(fin.status === 200 && fin.body.taken >= 3, 'compute the final', JSON.stringify(fin.body));
  const awards = await call('GET', `/api/staff/olympiads/${zin.id}/awards`, { jar: op });
  const finalAwards = awards.body.filter((a) => a.stageKind === 'spring_final');
  check(finalAwards.some((a) => a.kind === 'place' && a.place === 1), 'places at the final', finalAwards.map((a) => a.kind).join(','));
  check(!awards.body.some((a) => a.kind === 'place' && a.stageKind !== 'spring_final'), 'no places for unsupervised stages');
  const certKids = sql(`SELECT count(*) FROM olympiad_entry e JOIN educator_link el ON el.child_id = e.child_id AND el.status = 'active'
                          AND NOT el.is_own_child JOIN person p ON p.id = el.educator_person_id AND p.phone = '${P.educator.phone}'
                        WHERE e.stage_id = '${stage('spring_final').id}' AND e.certificate_issued_at IS NOT NULL`);
  const bonus = finalAwards.find((a) => a.kind === 'teacher_bonus' && a.educatorName === 'Aziza Rakhimovna');
  check(certKids === '0' ? !bonus : bonus?.amount === 50000 * Number(certKids),
    'teacher bonus = certificates of linked pupils at the final × rate', `${certKids} → ${bonus?.amount}`);
  const autumnBonus = awards.body.some((a) => a.kind === 'teacher_bonus' && a.stageKind !== 'spring_final');
  check(!autumnBonus, 'no teacher bonus from an online stage (§ 8.5)');
  const cups = finalAwards.filter((a) => a.kind === 'season_cup');
  const both = Number(sql(`SELECT count(*) FROM olympiad_entry f JOIN olympiad_entry a ON a.child_id = f.child_id
                            JOIN olympiad_stage sa ON sa.id = a.stage_id AND sa.kind = 'autumn_online'
                           WHERE f.stage_id = '${stage('spring_final').id}' AND f.result_percentile IS NOT NULL AND a.result_percentile IS NOT NULL`));
  check(cups.length === Math.min(3, both), 'season cup: top 3 of those who took autumn and the final', `${cups.length} of ${both}`);
  const beforePub = await call('GET', `/api/family/children/${madina.id}/olympiad`, { jar: owner });
  check(beforePub.body.olympiads.find((o) => o.id === zin.id).awards.every((a) => a.stageId !== stage('spring_final').id),
    'final awards stay hidden until published');
  await call('POST', `/api/staff/olympiads/${zin.id}/stages/${stage('spring_final').id}/publish`, { jar: op });
  const ownerOf = (entryId) => sql(`SELECT p.phone FROM olympiad_entry e JOIN guardianship g ON g.child_id = e.child_id AND g.role = 'owner'
                                     JOIN person p ON p.id = g.person_id WHERE e.id = '${entryId}'`);
  const winnerParent = await signIn(ownerOf(target[0].entryId));
  const winnerChild = sql(`SELECT child_id FROM olympiad_entry WHERE id = '${target[0].entryId}'`);
  const wv = await call('GET', `/api/family/children/${winnerChild}/olympiad`, { jar: winnerParent });
  const wFinal = wv.body.olympiads.find((o) => o.id === zin.id).stages.find((s) => s.kind === 'spring_final');
  check(wFinal.entry?.result && !FAMILY_LEAK.test(wv.text), 'after publication the family sees its own result — no score or rank', (wv.text.match(FAMILY_LEAK) ?? [''])[0]);
  check(!/Bola 4-/.test(wv.text.replace(/"givenName":"Bola 4-\d+"/, '')), "no other child's name in a family's olympiad view");
  const azizaSees = await call('GET', `/api/family/children/${winnerChild}/olympiad`, { jar: aziza });
  check(azizaSees.status === 404, 'an educator does not read the family olympiad view', `${azizaSees.status}`);

  // =================================================================== flags
  group('Response-time signal (§ 12 M7)');
  check(Number(sql(`SELECT count(*) FROM registration_flag WHERE rule_code = 'olympiad_fast_answers'`)) >= 2,
    'too-fast, too-right online sessions are flagged for trust & safety');
  check(sql(`SELECT count(*) FROM olympiad_entry WHERE flagged_at IS NOT NULL AND result_score IS NULL`) === '0', 'a flag does not erase the result');
  await call('POST', '/api/dev/tick');
  check(sql(`SELECT count(*) FROM scale_score x JOIN session s ON s.id = x.session_id WHERE s.mode = 'olympiad'`) === '0',
    'olympiad sessions never reach the scale (§ 9)');

  // Clean up: this run's olympiads move to an archive season (never current),
  // so no family sees them. Their rows stay — results and awards are history.
  sql(`INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on)
       VALUES ('m7-sinov', 'Sinov M7 (arxiv)', 'Тест M7 (архив)', '2019-09-01', '2020-06-30') ON CONFLICT (code) DO NOTHING`);
  sql(`UPDATE olympiad SET season_id = (SELECT id FROM season WHERE code = 'm7-sinov') WHERE id IN ('${zin.id}', '${young.body.id}')`);
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
