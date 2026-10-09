#!/usr/bin/env node
/**
 * M5 — Measurement v0 & parent reports, end to end (task.md § 9, § 12 M5).
 *
 *   ./scripts/report-flows.sh
 *
 * Needs the dev fixtures: /api/dev/seed, /seed-bank, /seed-results (measured
 * grade 4 and grade 1 history). Checks the derived layer the job wrote, the
 * cohort minimum, append-only runs (INV-12), one current run (INV-13), re-runs,
 * and that the reports say only what § 1.10 allows.
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
  const headers = { 'user-agent': 'zinapo-report-flows' };
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
  const sim = await call('POST', '/api/dev/telegram/simulate', { body: { link: s.body.deepLink, phone, firstName: 'Rep', lastName: 'Flow' } });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const v = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: s.body.requestId, code } });
  if (v.status !== 200) throw new Error(`sign-in ${phone}`);
  return jar;
}

async function main() {
  const seeded = (await call('POST', '/api/dev/seed')).body;
  await call('POST', '/api/dev/seed-bank');
  await call('POST', '/api/dev/seed-results');
  const P = seeded.people;
  const madina = seeded.children.find((c) => c.grade === 4);
  const temur = seeded.children.find((c) => c.grade === 1);
  const sevinch = seeded.children.find((c) => c.grade === 3);
  const owner = await signIn(P.owner.phone);
  const co = await signIn(P.coGuardian.phone);
  const educator = await signIn(P.educator.phone);
  const nodira = await signIn(P.educatorParent.phone);
  const editor = await signIn(P.bank_editor.phone);

  // ------------------------------------------------------------ the job
  group('The measurement job');
  const cur4 = sql(`SELECT count(*) FROM calibration_run r JOIN season s ON s.id = r.season_id AND s.is_current
                     WHERE r.grade = 4 AND r.is_current`);
  check(cur4 === '1', 'exactly one current run per season and grade (INV-13)', cur4);
  const runId = sql(`SELECT r.id FROM calibration_run r JOIN season s ON s.id = r.season_id AND s.is_current
                      WHERE r.grade = 4 AND r.is_current`);
  const bands = sql(`SELECT count(*) FILTER (WHERE pct_low IS NOT NULL) || '/' || count(*) || '/' ||
                            bool_and(pct_low IS NULL OR pct_low <= pct_high) FROM percentile_band WHERE calibration_run_id = '${runId}'`);
  check(/^\d+\/\d+\/true$/.test(bands) && Number(bands.split('/')[0]) > 30, 'grade 4 gets bands, and every band is a range', bands);
  check(sql(`SELECT count(*) FROM skill_state WHERE calibration_run_id = '${runId}'`) === '0', 'grades 3–4 get no skill states');
  const run1 = sql(`SELECT r.id FROM calibration_run r JOIN season s ON s.id = r.season_id AND s.is_current WHERE r.grade = 1 AND r.is_current`);
  check(sql(`SELECT count(*) FROM percentile_band WHERE calibration_run_id = '${run1}'`) === '0', 'grades 0–2 never get a band (INV-11)');
  check(Number(sql(`SELECT count(*) FROM skill_state WHERE calibration_run_id = '${run1}'`)) > 0, 'grades 0–2 get skill states');
  check(
    sql(`SELECT count(*) FROM scale_score x JOIN session s ON s.id = x.session_id WHERE x.calibration_run_id = '${runId}' AND s.mode <> 'monitoring'`) === '0',
    'only monitoring sessions are measured (practice and olympiad never enter the scale)',
  );
  const stats = sql(`SELECT count(*) || '/' || count(*) FILTER (WHERE p IS NOT NULL AND point_biserial IS NOT NULL)
                       FROM item_statistic WHERE calibration_run_id = '${runId}'`);
  check(/^30\/\d+$/.test(stats), 'item statistics for every version on the form (p, point-biserial)', stats);
  let appendOnly = false;
  try {
    sql(`UPDATE percentile_band SET pct_low = 1 WHERE calibration_run_id = '${runId}'`);
  } catch (e) {
    appendOnly = /INV-12/.test(String(e.stderr ?? e.message));
  }
  check(appendOnly, 'derived rows are never overwritten (INV-12)');

  // Cohort minimum: a small closed wave in a test season → rows, but no band.
  // Created once and reused: its derived rows are append-only, so a test that
  // made a new one every run would pile them up forever.
  const form4 = sql(`SELECT w.form_id FROM wave w JOIN season s ON s.id = w.season_id AND s.is_current
                      WHERE w.grade = 4 AND w.form_id IS NOT NULL ORDER BY w.ordinal LIMIT 1`);
  let tSeason = sql(`SELECT id FROM season WHERE code = 'm5-small'`);
  if (!tSeason) {
    tSeason = sql(`INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on)
                    VALUES ('m5-small', 'Sinov M5 (kichik kohort)', 'Тест M5 (малая когорта)', '2020-01-01', '2020-12-31') RETURNING id`);
    const tWave = sql(`INSERT INTO wave (season_id, grade, ordinal, opens_at, closes_at, form_id)
                        VALUES ('${tSeason}', 4, 1, '2020-03-01', '2020-03-10', '${form4}') RETURNING id`);
    const small = sql(`SELECT string_agg(c.id::text, ',') FROM (SELECT c.id FROM child c JOIN enrolment e ON e.child_id = c.id
                         AND e.ended_at IS NULL AND e.grade = 4 WHERE c.family_name = 'KOHORT' LIMIT 5) c`).split(',');
    for (const c of small) {
      const sid = sql(`INSERT INTO session (child_id, mode, form_id, wave_id, launched_by, launch_context, grade_snapshot,
                         region_snapshot, status, started_at, submitted_at)
                       SELECT '${c}', 'monitoring', '${form4}', '${tWave}', g.person_id, 'home', 4, 14, 'submitted',
                              '2020-03-02', '2020-03-02' FROM guardianship g WHERE g.child_id = '${c}' AND g.role = 'owner' RETURNING id`);
      sql(`INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, client_recorded_at)
           SELECT '${sid}', fi.item_version_id, NULL, NULL, '2020-03-02' FROM form_item fi WHERE fi.form_id = '${form4}'`);
    }
    const tick = await call('POST', '/api/dev/tick');
    check(tick.body?.runs?.length >= 1, 'the job measures a newly closed wave by itself', JSON.stringify(tick.body));
  }
  const smallBands = sql(`SELECT count(*) || '/' || bool_and(pct_low IS NULL AND pct_high IS NULL) || '/' || max(cohort_n)
                            FROM percentile_band b JOIN calibration_run r ON r.id = b.calibration_run_id AND r.is_current
                           WHERE r.season_id = '${tSeason}'`);
  check(smallBands === '5/true/5', 'a cohort of 5 gets rows but no band (n < 30)', smallBands);

  // Re-run and switch back (§ 9: "switching is_current atomically").
  const before = (await call('GET', `/api/family/children/${madina.id}/report`, { jar: owner })).body;
  const rerun = await call('POST', '/api/staff/calibration-runs', { jar: editor, body: { method: 'raw_band_v0', grade: 4 } });
  check(rerun.status === 202 && rerun.body?.runs?.length === 1, 'the bank editor re-runs v0 for grade 4');
  check(
    sql(`SELECT is_current FROM calibration_run WHERE id = '${runId}'`) === 'f' &&
      sql(`SELECT count(*) FROM percentile_band WHERE calibration_run_id = '${runId}'`) === bands.split('/')[1],
    'the old run is no longer current, and its rows are untouched',
  );
  const back = await call('POST', `/api/staff/calibration-runs/${runId}/current`, { jar: editor });
  check(back.status === 200 && sql(`SELECT is_current FROM calibration_run WHERE id = '${runId}'`) === 't', 'and can be made current again');
  const after = (await call('GET', `/api/family/children/${madina.id}/report`, { jar: owner })).body;
  check(JSON.stringify(after.latest) === JSON.stringify(before.latest), 'the report reads whichever run is current');
  check((await call('POST', '/api/staff/calibration-runs', { jar: editor, body: { method: 'rasch_anchor_equating_v1' } })).status === 409,
    'v1 (Rasch) is not available yet — M9');

  // ---------------------------------------------------------- reports
  group('Parent report, grades 3–4');
  const r4 = await call('GET', `/api/family/children/${madina.id}/report`, { jar: owner });
  check(r4.status === 200 && r4.body?.template === 'grade_3_4' && r4.body?.latest?.top, 'the owner gets the band report');
  const t = r4.body?.latest?.top;
  check(t && t.from < t.to, 'the position is a range ("top X–Y%"), never a point', JSON.stringify(t));
  check(!/raw_score|rawScore|theta|"score"|correct_count|isCorrect|is_correct/i.test(r4.text), 'no score of any kind (§ 1.10)');
  check(!/KOHORT|Kohort|Bola 4-/.test(r4.text), 'no other child appears in the report (§ 1.10)');
  check(!/probab|chance|ehtimol/i.test(r4.text), 'no admission probability');
  check(r4.body?.trend?.some((w) => w.state === 'open' || w.state === 'upcoming'), 'the trend carries the next wave as an empty column');
  check(['in_line', 'strength', 'weaker'].includes(Object.values(r4.body?.clusters ?? {})[0]), 'clusters are words, not numbers');
  check(r4.body?.ticket?.needed === 3 && r4.body?.ticket?.taken >= 3, 'the spring-final ticket (≥ 3 waves)');
  check(r4.body?.access?.guardians?.length >= 1, '"who can see" is listed');
  const rCo = await call('GET', `/api/family/children/${madina.id}/report`, { jar: co });
  check(rCo.status === 200 && JSON.stringify(rCo.body?.latest) === JSON.stringify(r4.body?.latest), 'the co-guardian sees the same report');
  check((await call('GET', `/api/family/children/${madina.id}/report`, { jar: educator })).status === 404,
    'an educator does not see another family’s report — even with an active link');
  const own = await call('GET', `/api/family/children/${sevinch.id}/report`, { jar: nodira });
  check(own.status === 200 && own.body?.template === 'grade_3_4', 'an educator sees their OWN child’s report (§ 3)');

  group('Parent report, grades 0–2');
  const r1 = await call('GET', `/api/family/children/${temur.id}/report`, { jar: owner });
  check(r1.status === 200 && r1.body?.template === 'grade_0_2' && r1.body?.skillsTotal > 0, 'the skills report');
  check(!/"top"|percent|pct_|cohort/i.test(r1.text), 'no band, no rank, no cohort for grades 0–2 (INV-11)');
  check(r1.body?.forecast === null, 'and an explicit refusal to forecast');
  const states = new Set((r1.body?.skills ?? []).map((s) => s.state));
  check([...states].every((s) => [null, 'secure', 'emerging', 'not_yet'].includes(s)), 'three states (or not assessed yet)');
  const secure = (r1.body?.skills ?? []).filter((s) => s.state === 'secure');
  check(secure.every((s) => s.history.filter((h) => h.correct >= 2).length >= 2 || s.history.some((h) => h.state === 'secure')),
    'secure only after confirmation in a second wave (§ 9)');

  group('Notifications');
  const ready = sql(`SELECT count(*) FROM notification n JOIN person p ON p.id = n.person_id
                      WHERE p.phone = '${P.owner.phone}' AND n.template = 'report_ready'`);
  check(Number(ready) >= 2, '"report ready" reached the owner', ready);
  const dup = sql(`SELECT count(*) FROM (SELECT throttle_key FROM notification WHERE template = 'report_ready'
                     GROUP BY throttle_key HAVING count(*) > 1) d`);
  check(dup === '0', 'once per wave and child, however many times the job re-runs');


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
