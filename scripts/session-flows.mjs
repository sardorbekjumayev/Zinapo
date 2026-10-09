#!/usr/bin/env node
/**
 * M4 — Sessions & kid mode, driven end to end (task.md § 12 M4, § 8.3, § 11).
 *
 *   ./scripts/session-flows.sh
 *
 * Seasons and waves admin, starting a session (wave open, grade, consent,
 * educator link, snapshots), the offline bundle (no keys), the in-flight
 * answer sync (newest wins, idempotent), submit (one response per item, once),
 * and the job: auto-submit at the deadline, expire at wave close, `wave_open`.
 *
 * Needs `/api/dev/seed` and `/api/dev/seed-bank` (a frozen grade 4 form behind
 * an open wave 1). Fresh people and children each run, so it can repeat.
 */

import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ROOT = new URL('..', import.meta.url).pathname;

const results = [];
let section = '';
const check = (ok, name, detail = '') => results.push({ ok: !!ok, section, name, detail });
const group = (name) => (section = name);

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const v = pair.slice(eq + 1).trim();
      if (v === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(pair.slice(0, eq).trim());
      else this.cookies.set(pair.slice(0, eq).trim(), v);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function call(method, path, { jar, body } = {}) {
  const headers = { 'user-agent': 'zinapo-session-flows' };
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
    const keys = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*').split('\n').filter(Boolean);
    if (keys.length) docker('exec', '-T', 'redis', 'redis-cli', 'del', ...keys);
  } catch {}
}

async function signIn(phone) {
  flush();
  const jar = new Jar();
  const start = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  const sim = await call('POST', '/api/dev/telegram/simulate', {
    body: { link: start.body.deepLink, phone, firstName: 'Sess', lastName: 'Flow' },
  });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: start.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}: ${v.status}`);
  return jar;
}

const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const freshPhone = () => `+99890${rand(7)}`;
const pinflFor = (dob) => {
  const [y, m, d] = dob.split('-');
  return `6${d}${m}${y.slice(2)}${rand(7)}`;
};

/** A fresh owner with a fresh grade 4 child in Tashkent city. */
async function freshFamily() {
  const jar = await signIn(freshPhone());
  const dob = '2016-05-14';
  const r = await call('POST', '/api/family/children', {
    jar,
    body: {
      pinfl: pinflFor(dob), dob, familyName: 'SESSIYEVA', givenName: 'Zarina', grade: 4, schoolRegionId: 14,
      consents: [{ type: 'data_processing', given: true }],
    },
  });
  if (r.status !== 201) throw new Error(`create child: ${r.status} ${r.text}`);
  return { jar, childId: r.body.id };
}

const now = () => new Date().toISOString();

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  const seedBank = (await call('POST', '/api/dev/seed-bank')).body;
  const P = seeded.people;
  const madina = seeded.children.find((c) => c.grade === 4);
  const temur = seeded.children.find((c) => c.grade === 1);
  const owner = await signIn(P.owner.phone);
  const co = await signIn(P.coGuardian.phone);
  const educator = await signIn(P.educator.phone);
  const manager = await signIn(P.season_manager.phone);
  const editor = await signIn(P.bank_editor.phone);

  // The grade 4 wave open right now (its ordinal depends on how much history
  // the dev fixtures have added — M5 puts three closed waves before it).
  const wave1 = sql(`SELECT w.id FROM wave w JOIN season s ON s.id = w.season_id AND s.is_current
                      WHERE w.grade = 4 AND w.opens_at <= now() AND w.closes_at > now() AND w.closed_at IS NULL
                      ORDER BY w.ordinal LIMIT 1`);
  const form1 = sql(`SELECT form_id FROM wave WHERE id = '${wave1}'`);
  check(wave1 && form1, 'the seed has an open grade 4 wave behind a frozen form', seedBank?.waves);
  void seedBank;

  // ----------------------------------------------------------- admin
  group('Seasons and waves admin');
  const seasons = await call('GET', '/api/staff/seasons', { jar: manager });
  check(seasons.status === 200 && seasons.body.some((s) => s.isCurrent), 'the season manager lists seasons');
  check((await call('GET', '/api/staff/seasons', { jar: editor })).status === 403, 'a bank editor cannot');
  const code = `${2100 + Number(rand(3)) % 800}/${rand(2)}`;
  const test = await call('POST', '/api/staff/seasons', {
    jar: manager, body: { code, nameUz: 'Sinov', nameRu: 'Тест', startsOn: '2026-01-01', endsOn: '2026-12-31' },
  });
  check(test.status === 201, 'creates a (non-current) season', `${test.status} ${test.text.slice(0, 120)}`);
  const seasonId = test.body?.find((s) => s.code === code)?.id;
  check((await call('POST', '/api/staff/seasons', {
    jar: manager, body: { code, nameUz: 'x', nameRu: 'x', startsOn: '2026-01-01', endsOn: '2026-12-31' },
  })).status === 409, 'season codes are unique');

  const t0 = Date.now();
  const iso = (ms) => new Date(t0 + ms).toISOString();
  const H = 3_600_000;
  const w8 = await call('POST', '/api/staff/waves', {
    jar: manager, body: { seasonId, grade: 4, ordinal: 8, opensAt: iso(240 * H), closesAt: iso(250 * H) },
  });
  check(w8.status === 201 && w8.body?.state === 'upcoming', 'sets an upcoming wave', `${w8.status}`);
  const overlap = await call('POST', '/api/staff/waves', {
    jar: manager, body: { seasonId, grade: 4, ordinal: 7, opensAt: iso(245 * H), closesAt: iso(255 * H) },
  });
  check(overlap.status === 409 && overlap.body?.error === 'WAVE_OVERLAP', 'windows of one grade cannot overlap (INV-14)');
  const draftForm = (await call('POST', '/api/staff/forms', {
    jar: editor, body: { mode: 'monitoring', grade: 4, label: 'unfrozen' },
  })).body?.id;
  const unfrozen = await call('PATCH', `/api/staff/waves/${w8.body?.id}`, { jar: manager, body: { formId: draftForm } });
  check(unfrozen.status === 400 && unfrozen.body?.error === 'WAVE_FORM_INVALID', 'a wave only takes a frozen monitoring form (INV-14)');
  const moved = await call('POST', '/api/staff/waves', {
    jar: manager, body: { seasonId, grade: 4, ordinal: 8, opensAt: iso(260 * H), closesAt: iso(270 * H), formId: form1 },
  });
  check(moved.status === 201 && moved.body?.formId === form1, 'an upcoming wave can be moved and given its form');
  const shrink = await call('PATCH', `/api/staff/waves/${wave1}`, {
    jar: manager, body: { closesAt: iso(H) },
  });
  check(shrink.status === 409, 'an open wave cannot be shortened', `${shrink.status}`);
  const forms = await call('GET', '/api/staff/waves/forms/4', { jar: manager });
  check(forms.body?.some((f) => f.id === form1), 'frozen grade 4 forms are offered for waves');
  const sch = await call('POST', '/api/staff/schools', {
    jar: manager, body: { regionId: 12, kind: 'general', name: `Sinov maktabi ${rand(4)}` },
  });
  check(sch.status === 201 && sch.body?.length > 0, 'the season manager adds a school');

  // --------------------------------------------------------- start
  group('Start a session');
  const waves = await call('GET', `/api/family/children/${madina.id}/waves`, { jar: owner });
  const w1 = waves.body?.waves?.find((w) => w.id === wave1);
  check(w1 && ['open', 'in_progress', 'taken'].includes(w1.state), 'the parent sees wave 1', w1?.state);
  check((await call('GET', `/api/family/children/${temur.id}/waves`, { jar: owner })).body?.waves?.every((w) => w.grade === 1),
    'a grade 1 child sees only grade 1 waves');

  const fam = await freshFamily();
  const started = await call('POST', `/api/family/children/${fam.childId}/sessions`, { jar: fam.jar, body: { waveId: wave1 } });
  check(started.status === 201 && started.body?.sessionId && !started.body.resumed, 'the owner starts wave 1', `${started.status} ${started.text.slice(0, 160)}`);
  const sid = started.body.sessionId;
  const again = await call('POST', `/api/family/children/${fam.childId}/sessions`, { jar: fam.jar, body: { waveId: wave1 } });
  check(again.body?.sessionId === sid && again.body.resumed, 'starting again resumes the same session (one per wave)');
  const snap = sql(`SELECT grade_snapshot || '/' || region_snapshot || '/' || (deadline_at IS NULL) FROM session WHERE id = '${sid}'`);
  check(snap === '4/14/true', 'grade and school region are snapshotted; no clock yet (the child has not pressed Start)', snap);
  const begun = await call('POST', `/api/sessions/${sid}/begin`, { jar: fam.jar });
  const left = (Date.parse(begun.body?.deadlineAt) - Date.parse(begun.body?.serverTime)) / 60000;
  check(begun.status === 200 && left > 89 && left <= 90, 'Start begins the 90-minute clock (design/05)', `${left.toFixed(1)} min`);
  const begunAgain = await call('POST', `/api/sessions/${sid}/begin`, { jar: fam.jar });
  check(begunAgain.body?.deadlineAt === begun.body?.deadlineAt, 'pressing Start again cannot extend it');
  check((await call('POST', `/api/family/children/${temur.id}/sessions`, { jar: owner, body: { waveId: wave1 } })).body?.error === 'WRONG_GRADE',
    'a grade 1 child cannot take a grade 4 wave');
  const eduTemur = await call('POST', `/api/educator/children/${temur.id}/sessions`, { jar: educator, body: { waveId: wave1 } });
  check(eduTemur.status === 404, 'an educator whose link is only requested cannot launch (INV-15)', `${eduTemur.status}`);
  check((await call('POST', `/api/family/children/${madina.id}/sessions`, { jar: educator, body: { waveId: wave1 } })).status === 404,
    'an educator cannot use the family door');
  const eduMadina = await call('POST', `/api/educator/children/${madina.id}/sessions`, { jar: educator, body: { waveId: wave1 } });
  check([200, 201, 409].includes(eduMadina.status) && eduMadina.body?.error !== 'NOT_FOUND',
    'an educator with an ACTIVE link may launch in the office', `${eduMadina.status} ${eduMadina.body?.error ?? ''}`);
  const coStart = await call('POST', `/api/family/children/${madina.id}/sessions`, { jar: co, body: { waveId: wave1 } });
  check([200, 201, 409].includes(coStart.status), 'a co-guardian may launch too (§ 3)', `${coStart.status}`);

  // Consent (note M2-e): no live data processing consent, no measurement.
  const fam2 = await freshFamily();
  await call('PUT', `/api/family/children/${fam2.childId}/consents/data_processing`, { jar: fam2.jar, body: { given: false } });
  const noConsent = await call('POST', `/api/family/children/${fam2.childId}/sessions`, { jar: fam2.jar, body: { waveId: wave1 } });
  check(noConsent.status === 409 && noConsent.body?.error === 'CONSENT_REQUIRED', 'no data-processing consent, no session (M2-e)');
  // Withdrawn mid-test: no resume, no submit — nothing reaches the raw layer.
  await call('PUT', `/api/family/children/${fam2.childId}/consents/data_processing`, { jar: fam2.jar, body: { given: true } });
  const s2 = (await call('POST', `/api/family/children/${fam2.childId}/sessions`, { jar: fam2.jar, body: { waveId: wave1 } })).body?.sessionId;
  await call('PUT', `/api/family/children/${fam2.childId}/consents/data_processing`, { jar: fam2.jar, body: { given: false } });
  const noResume = await call('POST', `/api/family/children/${fam2.childId}/sessions`, { jar: fam2.jar, body: { waveId: wave1 } });
  const noSubmit = await call('POST', `/api/sessions/${s2}/submit`, { jar: fam2.jar, body: { answers: [] } });
  check(noResume.body?.error === 'CONSENT_REQUIRED' && noSubmit.body?.error === 'CONSENT_REQUIRED',
    'consent withdrawn mid-test: no resume and no submit');
  sql(`UPDATE session SET deadline_at = now() - interval '20 minutes' WHERE id = '${s2}'`);
  await call('POST', '/api/dev/tick');
  check(sql(`SELECT status || '/' || (SELECT count(*) FROM response WHERE session_id = '${s2}') FROM session WHERE id = '${s2}'`) === 'started/0',
    'and the deadline job does not auto-submit it either');

  // ---------------------------------------------------------- bundle
  group('Bundle');
  const bundle = await call('GET', `/api/sessions/${sid}/bundle`, { jar: fam.jar });
  check(bundle.status === 200 && bundle.body?.items?.length === 30, 'the whole form downloads at once', `${bundle.body?.items?.length}`);
  check(!/isKey|is_key|rationale|misconception|slotRole|slot_role|anchor|expected/i.test(bundle.text),
    'no key, no rationale, no slot role, nothing that marks an anchor');
  check(bundle.body?.items?.every((i) => i.options.length >= 3 && i.stemUz && i.stemRu), 'stems in both languages and every option');
  check(bundle.body?.deadlineAt && bundle.body?.serverTime, 'deadline and server time for the timer');
  check((await call('GET', `/api/sessions/${sid}/bundle`, { jar: manager })).status === 404, 'a stranger gets 404');

  // ---------------------------------------------------------- answers
  group('Answers in flight');
  const items = bundle.body.items;
  const keyOf = (ivid) => sql(`SELECT id FROM item_option WHERE item_version_id = '${ivid}' AND is_key`);
  const wrongOf = (ivid) => sql(`SELECT id FROM item_option WHERE item_version_id = '${ivid}' AND NOT is_key LIMIT 1`);
  const a0 = items[0].itemVersionId;
  const a1 = items[1].itemVersionId;
  const a2 = items[2].itemVersionId;
  const t1 = now();
  const first = await call('POST', `/api/sessions/${sid}/responses`, {
    jar: fam.jar,
    body: {
      answers: [
        { itemVersionId: a0, chosenOptionId: wrongOf(a0), clientRecordedAt: t1, responseMs: 9000 },
        { itemVersionId: a1, chosenOptionId: keyOf(a1), clientRecordedAt: t1, responseMs: 12000, flagged: true },
        { itemVersionId: a2, chosenOptionId: null, clientRecordedAt: t1 },
      ],
      device: 'Redmi 9A', os: 'Android 11', clientVersion: 'web-0.4',
    },
  });
  check(first.status === 200 && first.body?.saved === 3, 'a batch of answers is saved');
  check(sql(`SELECT count(*) FROM response WHERE session_id = '${sid}'`) === '0', 'nothing reaches `response` before submit (INV-07)');
  const t2 = new Date(Date.now() + 1000).toISOString();
  await call('POST', `/api/sessions/${sid}/responses`, {
    jar: fam.jar,
    body: { answers: [{ itemVersionId: a0, chosenOptionId: keyOf(a0), clientRecordedAt: t2, revisionCount: 1, responseMs: 15000 }] },
  });
  const stale = await call('POST', `/api/sessions/${sid}/responses`, {
    jar: fam.jar, body: { answers: [{ itemVersionId: a0, chosenOptionId: wrongOf(a0), clientRecordedAt: t1 }] },
  });
  check(stale.body?.saved === 0, 'an old batch replayed late never undoes a later change');
  check(sql(`SELECT chosen_option_id = '${keyOf(a0)}' AND revision_count = 1 FROM session_answer WHERE session_id = '${sid}' AND item_version_id = '${a0}'`) === 't',
    'the child changed their mind: the newest answer stands');
  const foreign = await call('POST', `/api/sessions/${sid}/responses`, {
    jar: fam.jar, body: { answers: [{ itemVersionId: a0, chosenOptionId: keyOf(a1), clientRecordedAt: t2 }] },
  });
  check(foreign.status === 400, 'an option from another item is refused');
  const resume = await call('GET', `/api/sessions/${sid}/bundle`, { jar: fam.jar });
  check(resume.body?.answers?.length === 3, 'a second device resumes with the saved answers');
  check(sql(`SELECT device || '|' || os FROM session WHERE id = '${sid}'`) === 'Redmi 9A|Android 11', 'device and OS are recorded (§ 8.3)');

  // ----------------------------------------------------------- submit
  group('Submit');
  const t3 = new Date(Date.now() + 2000).toISOString();
  const submitted = await call('POST', `/api/sessions/${sid}/submit`, {
    jar: fam.jar, body: { answers: [{ itemVersionId: items[3].itemVersionId, chosenOptionId: keyOf(items[3].itemVersionId), clientRecordedAt: t3 }] },
  });
  check(submitted.status === 200 && submitted.body?.status === 'submitted', 'submit');
  check(!('solved' in (submitted.body ?? {})) && !/score|correct/i.test(submitted.text), 'monitoring answers "submitted" — no score (§ 8.3)');
  const counts = sql(`SELECT count(*) || '/' || count(*) FILTER (WHERE chosen_option_id IS NULL) || '/' ||
                             count(*) FILTER (WHERE is_correct) FROM response WHERE session_id = '${sid}'`);
  check(counts === '30/27/3', 'one response per item: 3 answered (all right), 27 skipped or unopened as NULL', counts);
  check(sql(`SELECT flagged FROM response WHERE session_id = '${sid}' AND item_version_id = '${a1}'`) === 't', 'the flag travels with the answer');
  const twice = await call('POST', `/api/sessions/${sid}/submit`, { jar: fam.jar, body: { answers: [] } });
  check(twice.status === 200 && sql(`SELECT count(*) FROM response WHERE session_id = '${sid}'`) === '30', 'a repeated submit changes nothing (idempotent)');
  const late = await call('POST', `/api/sessions/${sid}/responses`, {
    jar: fam.jar, body: { answers: [{ itemVersionId: a2, chosenOptionId: keyOf(a2), clientRecordedAt: now() }] },
  });
  check(late.body?.saved === 0 && late.body?.status === 'submitted', 'answers after submit are ignored, without an error for a retrying device');
  let appendOnly = false;
  try {
    sql(`UPDATE response SET chosen_option_id = NULL WHERE session_id = '${sid}'`);
  } catch (e) {
    appendOnly = /INV-07/.test(String(e.stderr ?? e.message));
  }
  check(appendOnly, 'and the raw layer stays append-only (INV-07)');
  check((await call('POST', `/api/family/children/${fam.childId}/sessions`, { jar: fam.jar, body: { waveId: wave1 } })).body?.error === 'WAVE_TAKEN',
    'a taken wave cannot be started again');
  await call('POST', `/api/family/children/${fam.childId}/enrolments`, { jar: fam.jar, body: { schoolYear: 2026, grade: 3, schoolRegionId: 12 } });
  check(sql(`SELECT grade_snapshot || '/' || region_snapshot FROM session WHERE id = '${sid}'`) === '4/14', 'changing school afterwards does not move the snapshot');

  // -------------------------------------------------------------- job
  group('The wave job');
  const fam3 = await freshFamily();
  const s3 = (await call('POST', `/api/family/children/${fam3.childId}/sessions`, { jar: fam3.jar, body: { waveId: wave1 } })).body.sessionId;
  const iv = items[5].itemVersionId;
  await call('POST', `/api/sessions/${s3}/responses`, {
    jar: fam3.jar, body: { answers: [{ itemVersionId: iv, chosenOptionId: keyOf(iv), clientRecordedAt: now() }] },
  });
  sql(`UPDATE session SET deadline_at = now() - interval '20 minutes' WHERE id = '${s3}'`);
  const tick1 = await call('POST', '/api/dev/tick');
  check(tick1.body?.autoSubmitted >= 1, 'time up: the job submits the saved answers', JSON.stringify(tick1.body));
  check(sql(`SELECT status || '/' || (SELECT count(*) FROM response WHERE session_id = '${s3}') FROM session WHERE id = '${s3}'`) === 'submitted/30',
    'with one response per item');

  // A wave of a test season that closes with a session still open → expired.
  const fam4 = await freshFamily();
  const testWave = (await call('POST', '/api/staff/waves', {
    jar: manager, body: { seasonId, grade: 4, ordinal: 1, opensAt: iso(-H), closesAt: iso(H), formId: form1 },
  })).body;
  check(testWave?.state === 'open', 'an open test wave', JSON.stringify(testWave).slice(0, 120));
  const s4 = (await call('POST', `/api/family/children/${fam4.childId}/sessions`, { jar: fam4.jar, body: { waveId: testWave.id } })).body?.sessionId;
  sql(`UPDATE session SET deadline_at = now() + interval '1 hour' WHERE id = '${s4}'`);
  sql(`UPDATE wave SET closes_at = now() - interval '1 second' WHERE id = '${testWave.id}'`);
  const tick2 = await call('POST', '/api/dev/tick');
  check(tick2.body?.closed >= 1 && tick2.body?.expired >= 1, 'the wave closes and its open session expires', JSON.stringify(tick2.body));
  check(sql(`SELECT status || '/' || (SELECT closed_at IS NOT NULL FROM wave WHERE id = '${testWave.id}') FROM session WHERE id = '${s4}'`) === 'expired/true',
    'expired, and the wave is marked closed for M5');
  check((await call('POST', `/api/sessions/${s4}/submit`, { jar: fam4.jar, body: { answers: [] } })).body?.error === 'SESSION_EXPIRED',
    'an expired session cannot be submitted');
  check(sql(`SELECT count(*) FROM notification WHERE throttle_key = 'wave_open:${wave1}:${madina.id}'`) === '1',
    'parents were told once that wave 1 opened (§ 10)');

  // -------------------------------------------------------- reminders
  group('Reminders');
  const r1 = await call('POST', `/api/staff/waves/${wave1}/reminders`, { jar: manager });
  check(r1.status === 200 && r1.body?.eligible >= 1, 'bulk reminders go to the owners of children who have not taken it', JSON.stringify(r1.body));
  const r2 = await call('POST', `/api/staff/waves/${wave1}/reminders`, { jar: manager });
  check(r2.body?.queued === 0 && r2.body?.throttled === r2.body?.eligible, 'at most one reminder per wave per child per day (§ 10)');
  check((await call('POST', `/api/staff/waves/${wave1}/reminders`, { jar: editor })).status === 403, 'only the season manager sends them');

  // Leave no test season behind: it would clutter the season manager's list.
  // Only ever touches the season this run created, and only rows without
  // responses (the raw layer is never deleted — there are none here).
  if (seasonId) {
    sql(`DELETE FROM session_answer WHERE session_id IN (SELECT s.id FROM session s JOIN wave w ON w.id = s.wave_id
           WHERE w.season_id = '${seasonId}')`);
    sql(`DELETE FROM session WHERE wave_id IN (SELECT id FROM wave WHERE season_id = '${seasonId}')
           AND NOT EXISTS (SELECT 1 FROM response r WHERE r.session_id = session.id)`);
    sql(`DELETE FROM wave WHERE season_id = '${seasonId}'`);
    sql(`DELETE FROM season WHERE id = '${seasonId}' AND NOT is_current`);
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

main().catch((err) => {
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.section}] ${r.name}  ${r.ok ? '' : r.detail}`);
  console.error(err);
  process.exit(1);
});
