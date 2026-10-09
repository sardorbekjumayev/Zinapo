#!/usr/bin/env node
/**
 * M3 — Item bank & forms, driven end to end (task.md § 12 M3, § 8.5).
 *
 *   ./scripts/bank-flows.sh
 *
 * Taxonomy permissions, the item card from draft to approval through blind
 * two-hand review, media uploads and signed links, a monitoring form built
 * from the template and frozen, and — the test task.md asks for by name — a
 * practice form that can never be offered or given an anchor (INV-08).
 *
 * Every run writes fresh items with unique constructs, so it can run any
 * number of times; it needs `/api/dev/seed` and `/api/dev/seed-bank`.
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

async function call(method, path, { jar, body, raw } = {}) {
  const headers = { 'user-agent': 'zinapo-bank-flows' };
  if (body !== undefined && !raw) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar.header();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: 'manual',
  });
  if (jar) jar.absorb(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, text, buf, headers: res.headers };
}

const docker = (...args) =>
  execFileSync('docker', ['compose', '--project-directory', ROOT, ...args], { encoding: 'utf8' });
const sql = (q) => docker('exec', '-T', 'db', 'psql', '-U', 'zinapo', '-d', 'zinapo', '-Atq', '-c', q).trim();

function flushRateLimits() {
  try {
    const keys = docker('exec', '-T', 'redis', 'redis-cli', '--scan', '--pattern', 'rl:*').split('\n').filter(Boolean);
    if (keys.length) docker('exec', '-T', 'redis', 'redis-cli', 'del', ...keys);
  } catch {}
}

async function signIn(phone) {
  flushRateLimits();
  const jar = new Jar();
  const start = await call('POST', '/api/auth/telegram/start', { jar, body: { phone, lang: 'uz' } });
  if (start.status !== 200) throw new Error(`start ${phone}: ${start.status} ${start.text}`);
  const sim = await call('POST', '/api/dev/telegram/simulate', {
    body: { link: start.body.deepLink, phone, firstName: 'Bank', lastName: 'Flow' },
  });
  const code = /\*(\d{5})\*/.exec((sim.body?.replies ?? []).map((r) => r.text).join(' '))?.[1];
  const verify = await call('POST', '/api/auth/telegram/verify', { jar, body: { requestId: start.body.requestId, code } });
  if (verify.status !== 200) throw new Error(`verify ${phone}: ${verify.status}`);
  return jar;
}

const tag = Date.now().toString(36);

/** A complete grade 3 draft (text stem, 4 options, explained distractors). */
function fullDraft(key = 0) {
  return {
    stemFormat: 'text',
    stemUz: `${tag}: 48 : 6 = ?`,
    stemRu: `${tag}: 48 : 6 = ?`,
    expectedP: 0.55,
    options: ['8', '6', '42', '54'].map((label, i) => ({
      labelUz: label,
      labelRu: label,
      isKey: i === key,
      misconceptionCode: i === key ? null : 'm.muldiv.add',
      rationale: i === key ? null : 'Adds or subtracts instead of dividing.',
    })),
  };
}

/** A real 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(fields, file) {
  const boundary = `----zinapo${tag}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function upload(jar, kind, file) {
  const mp = multipart({ kind }, file);
  const res = await fetch(`${BASE}/api/staff/media`, {
    method: 'POST',
    headers: { cookie: jar.header(), 'content-type': mp.type },
    body: mp.body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

async function main() {
  if ((await call('GET', '/api/health')).status !== 200) {
    console.error(`the stack is not answering on ${BASE}`);
    process.exit(1);
  }
  const seeded = (await call('POST', '/api/dev/seed')).body;
  await call('POST', '/api/dev/seed-bank');
  const P = seeded.people;
  const author = await signIn(P.item_author.phone);
  const reviewer = await signIn(P.item_reviewer.phone);
  const editor = await signIn(P.bank_editor.phone);
  const season = await signIn(P.season_manager.phone);
  const multi = await signIn(P.multiRoleStaff.phone);
  const owner = await signIn(P.owner.phone);

  // ------------------------------------------------------------ taxonomy
  group('Taxonomy');
  const tax = await call('GET', '/api/staff/taxonomy', { jar: author });
  check(tax.status === 200 && tax.body?.topics?.length >= 10, 'authors read the taxonomy');
  check(
    (await call('GET', '/api/staff/taxonomy', { jar: owner })).status === 403,
    'a parent cannot',
  );
  const mcode = `m.flow.${tag}`;
  const byAuthor = await call('POST', '/api/staff/taxonomy/misconceptions', {
    jar: author,
    body: { code: mcode, topicCode: 'num.word', nameUz: 'x', nameRu: 'x', explainUz: 'x', explainRu: 'x' },
  });
  check(byAuthor.status === 403, 'an author cannot change the taxonomy', `${byAuthor.status}`);
  const created = await call('POST', '/api/staff/taxonomy/misconceptions', {
    jar: editor,
    body: { code: mcode, topicCode: 'num.word', nameUz: 'Sinov', nameRu: 'Тест', explainUz: 'Izoh', explainRu: 'Пояснение' },
  });
  check(created.status === 201, 'the bank editor adds a misconception', `${created.status}`);
  const dup = await call('POST', '/api/staff/taxonomy/misconceptions', {
    jar: editor,
    body: { code: mcode, topicCode: 'num.word', nameUz: 'x', nameRu: 'x', explainUz: 'x', explainRu: 'x' },
  });
  check(dup.status === 409, 'codes are unique', `${dup.status}`);
  const retired = await call('POST', `/api/staff/taxonomy/misconceptions/${mcode}/retire`, { jar: editor });
  check(
    retired.body?.misconceptions?.find((m) => m.code === mcode)?.retiredAt,
    'a misconception is retired, not deleted',
  );
  const badTopic = await call('POST', '/api/staff/taxonomy/topics', {
    jar: editor,
    body: { code: `num.x${tag}`, cluster: 'reasoning', gradeMin: 1, gradeMax: 3, nameUz: 'x', nameRu: 'x' },
  });
  check(badTopic.status === 409, 'a topic code must match its cluster', `${badTopic.status}`);

  // -------------------------------------------------------------- media
  group('Media');
  const png = await upload(author, 'image', { name: 'a.png', type: 'image/png', body: PNG });
  check(png.status === 201 && /^image\/.+\.png$/.test(png.body?.ref ?? ''), 'an author uploads a PNG', `${png.status} ${png.text}`);
  const fetched = await call('GET', png.body?.url ?? '/api/media/x');
  check(fetched.status === 200 && fetched.buf.equals(PNG), 'the signed link serves the exact bytes');
  check(fetched.headers.get('x-content-type-options') === 'nosniff', 'served with nosniff');
  const forged = await call('GET', (png.body?.url ?? '').replace(/sig=[0-9a-f]/, 'sig=0'));
  check(forged.status === 404, 'a tampered signature is a 404', `${forged.status}`);
  const fake = await upload(author, 'image', { name: 'x.png', type: 'image/png', body: Buffer.from('not an image') });
  check(fake.status === 400 && fake.body?.details?.reason === 'type', 'a file is judged by its bytes, not its name', `${fake.status}`);
  const svg = await upload(author, 'image', {
    name: 'a.svg',
    type: 'image/svg+xml',
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'),
  });
  const svgGet = await call('GET', svg.body?.url ?? '/api/media/x');
  check(
    svg.status === 201 && /sandbox/.test(svgGet.headers.get('content-security-policy') ?? ''),
    'an SVG is served sandboxed, so a script inside cannot run',
  );
  check((await upload(owner, 'image', { name: 'a.png', type: 'image/png', body: PNG })).status === 403, 'a parent cannot upload');

  // --------------------------------------------------------- item card
  group('Item card — draft and submit');
  const lowNoSkill = await call('POST', '/api/staff/items', {
    jar: author, body: { grade: 1, topicCode: 'num.addsub', construct: 'x' },
  });
  check(lowNoSkill.status === 400 && lowNoSkill.body?.details?.reason === 'skill_required', 'grades 0–2 need a skill (INV-11)');
  const made = await call('POST', '/api/staff/items', {
    jar: author, body: { grade: 3, topicCode: 'num.muldiv', construct: `divides within 100 (${tag})` },
  });
  check(made.status === 201 && /^G3-NUM-\d{4}$/.test(made.body?.code ?? ''), 'an item gets a code on create', made.body?.code);
  const itemId = made.body?.id;

  const partial = await call('PUT', `/api/staff/items/${itemId}/draft`, {
    jar: author, body: { stemUz: `${tag}: yarim`, options: fullDraft().options.map((o) => ({ ...o, rationale: null })) },
  });
  check(partial.status === 200, 'an incomplete draft can be saved', `${partial.status} ${partial.text.slice(0, 200)}`);
  const early = await call('POST', `/api/staff/items/${itemId}/submit`, { jar: author });
  const fields = early.body?.details?.fields ?? [];
  check(
    early.status === 400 && fields.includes('stemRu') && fields.includes('expectedP') && fields.includes('options.2.rationale'),
    'submit lists exactly what is missing',
    JSON.stringify(fields),
  );
  const stranger = await call('PUT', `/api/staff/items/${itemId}/draft`, { jar: reviewer, body: { stemUz: 'x' } });
  check(stranger.status === 403 || stranger.status === 404, 'nobody else edits an author’s draft', `${stranger.status}`);

  await call('PUT', `/api/staff/items/${itemId}/draft`, { jar: author, body: { ...fullDraft(), imageRef: png.body?.ref } });
  const submitted = await call('POST', `/api/staff/items/${itemId}/submit`, { jar: author });
  const v1 = submitted.body?.versions?.[0];
  check(submitted.status === 200 && submitted.body?.status === 'in_review' && v1?.frozenAt, 'submit freezes v1 and sends it to review');
  const afterFreeze = await call('PUT', `/api/staff/items/${itemId}/draft`, { jar: author, body: { stemUz: 'x' } });
  check(afterFreeze.status === 409, 'a frozen version cannot be edited (INV-09)', `${afterFreeze.status}`);
  check(
    sql(`SELECT count(*) FROM item_option WHERE item_version_id = '${v1?.id}'`) === '4',
    'the options became real rows on submit',
  );

  // ------------------------------------------------------------ review
  group('Two-hand review');
  const queue = await call('GET', '/api/staff/review-queue', { jar: reviewer });
  check(queue.status === 200 && queue.body?.items?.some((i) => i.itemId === itemId), 'the item is in the reviewer’s queue');
  check((await call('GET', '/api/staff/review-queue', { jar: author })).status === 403, 'an author has no review queue');
  const peek = await call('GET', `/api/staff/items/${itemId}`, { jar: reviewer });
  check(peek.body?.versions?.[0]?.keysHidden === true && !/"isKey"/.test(peek.text), 'the item card hides the key from a reviewer before the solve');
  const blind = await call('GET', `/api/staff/reviews/${v1.id}`, { jar: reviewer });
  check(blind.body?.step === 'solve' && !/"isKey"|rationale|misconception/i.test(blind.text), 'the blind view has no key, codes or rationales');
  const tooEarly = await call('POST', `/api/staff/reviews/${v1.id}/verdict`, { jar: reviewer, body: { verdict: 'accept' } });
  check(tooEarly.status === 409, 'no verdict before the blind solve', `${tooEarly.status}`);
  const wrong = blind.body.options.find((o) => o.position === 2);
  const solved = await call('POST', `/api/staff/reviews/${v1.id}/solve`, { jar: reviewer, body: { optionId: wrong.id } });
  check(
    solved.body?.agreed === false && solved.body?.verdict === 'auto_reject' && solved.body?.options?.some((o) => o.isKey),
    'a disagreeing answer rejects the item automatically and reveals the key',
  );
  const rejected = await call('GET', `/api/staff/items/${itemId}`, { jar: author });
  check(rejected.body?.status === 'rejected' && rejected.body?.versions?.[0]?.reviews?.[0]?.verdict === 'auto_reject', 'the author sees why');

  const v2res = await call('POST', `/api/staff/items/${itemId}/versions`, { jar: author });
  check(v2res.status === 201 && v2res.body?.versions?.[0]?.version === 2 && v2res.body?.status === 'draft', 'a fix is a new version');
  check(v2res.body?.versions?.[0]?.stemUz === fullDraft().stemUz, 'v2 starts as a copy of v1');
  await call('POST', `/api/staff/items/${itemId}/submit`, { jar: author });
  const v2 = (await call('GET', `/api/staff/items/${itemId}`, { jar: author })).body.versions[0];
  const blind2 = await call('GET', `/api/staff/reviews/${v2.id}`, { jar: reviewer });
  const right = blind2.body.options.find((o) => o.position === 1);
  await call('POST', `/api/staff/reviews/${v2.id}/solve`, { jar: reviewer, body: { optionId: right.id } });
  const noNote = await call('POST', `/api/staff/reviews/${v2.id}/verdict`, { jar: reviewer, body: { verdict: 'revise' } });
  check(noNote.status === 409 && noNote.body?.details?.reason === 'note_required', 'revise needs a note');
  const revise = await call('POST', `/api/staff/reviews/${v2.id}/verdict`, {
    jar: reviewer, body: { verdict: 'revise', note: 'Option D is too weak.' },
  });
  check(revise.status === 200 && revise.body?.step === 'done', 'the reviewer returns it for revision');

  await call('POST', `/api/staff/items/${itemId}/versions`, { jar: author });
  await call('POST', `/api/staff/items/${itemId}/submit`, { jar: author });
  const v3 = (await call('GET', `/api/staff/items/${itemId}`, { jar: author })).body.versions[0];
  const blind3 = await call('GET', `/api/staff/reviews/${v3.id}`, { jar: reviewer });
  await call('POST', `/api/staff/reviews/${v3.id}/solve`, {
    jar: reviewer, body: { optionId: blind3.body.options.find((o) => o.position === 1).id },
  });
  await call('POST', `/api/staff/reviews/${v3.id}/verdict`, { jar: reviewer, body: { verdict: 'accept' } });
  const accepted = await call('GET', `/api/staff/items/${itemId}`, { jar: author });
  check(accepted.body?.status === 'accepted' && accepted.body?.acceptedAt, 'accept: the item is accepted and the author paid');
  const again = await call('POST', `/api/staff/reviews/${v3.id}/solve`, {
    jar: multi, body: { optionId: blind3.body.options[0].id },
  });
  check(again.status === 409, 'the first verdict settles a version', `${again.status}`);
  check(
    sql(`SELECT count(*) FROM notification n JOIN item i ON true WHERE i.id = '${itemId}'
          AND n.template = 'item_reviewed' AND n.person_id = i.author_person_id
          AND n.payload->'vars'->>'item' = i.code`) === '3',
    'the author was told after each of the three reviews',
  );

  group('Approval and anchors');
  const notEditor = await call('POST', `/api/staff/items/${itemId}/approve`, { jar: author });
  check(notEditor.status === 403, 'only the bank editor approves', `${notEditor.status}`);
  const approved = await call('POST', `/api/staff/items/${itemId}/approve`, { jar: editor });
  check(approved.body?.status === 'approved', 'the bank editor approves an accepted item');
  const vertical = await call('PUT', `/api/staff/items/${itemId}/anchor`, {
    jar: editor, body: { isAnchor: true, kind: 'vertical' },
  });
  check(vertical.body?.isAnchor && vertical.body?.anchorLinkGrade === 4, 'a grade 3 vertical anchor links to grade 4');
  const g4 = sql(`SELECT id FROM item WHERE grade = 4 AND is_anchor LIMIT 1`);
  const top = await call('PUT', `/api/staff/items/${g4}/anchor`, { jar: editor, body: { isAnchor: true, kind: 'vertical' } });
  check(top.status === 400, 'grade 4 has no vertical anchors', `${top.status}`);
  await call('PUT', `/api/staff/items/${itemId}/anchor`, { jar: editor, body: { isAnchor: false } });

  group('Bank list');
  const list = await call('GET', '/api/staff/items?grade=4&perPage=100', { jar: editor });
  check(list.body?.total >= 51 && list.body?.overview?.tiles?.length === 5, 'the editor sees the whole bank and the grade tiles');
  const anchorsH = await call('GET', '/api/staff/items?grade=4&role=anchor_h', { jar: editor });
  check(anchorsH.body?.items?.every((i) => i.isAnchor), 'the role filter finds anchors');
  const authorList = await call('GET', '/api/staff/items?perPage=100', { jar: author });
  check(authorList.body?.items?.every((i) => i.isMine) && authorList.body?.overview === null, 'an author sees only their own items');

  // ------------------------------------------------------------- forms
  group('Monitoring form');
  check(
    (await call('POST', '/api/staff/forms', { jar: author, body: { mode: 'monitoring', grade: 4, label: 'x' } })).status === 403,
    'only the bank editor builds forms',
  );
  const form = await call('POST', '/api/staff/forms', {
    jar: editor, body: { mode: 'monitoring', grade: 4, label: `Wave test ${tag}`, template: true },
  });
  check(form.status === 201 && form.body?.plan?.length === 30, 'the template plans 30 positions', `${form.status}`);
  const formId = form.body.id;
  check(!form.body.canFreeze, 'an empty form cannot be frozen');

  // Fill: anchors in order of difficulty, core round-robin across clusters.
  const byCluster = { numeracy: [], reasoning: [], language: [] };
  const firstCore = form.body.plan.find((p) => p.role === 'scored').position;
  const coreCands = await call('GET', `/api/staff/forms/${formId}/positions/${firstCore}/candidates`, { jar: editor });
  for (const c of coreCands.body ?? []) byCluster[c.cluster]?.push(c);
  const order = ['language', 'reasoning', 'numeracy'];
  let turn = 0;
  for (const slot of form.body.plan) {
    let pick;
    if (slot.role === 'scored') {
      for (let k = 0; k < 3 && !pick; k++) pick = byCluster[order[turn++ % 3]].shift();
    } else {
      const c = await call('GET', `/api/staff/forms/${formId}/positions/${slot.position}/candidates`, { jar: editor });
      pick = c.body?.[0];
      if (slot.role === 'anchor' && !c.body?.every((x) => x.isAnchor)) check(false, 'anchor slots are offered only anchors');
      if (slot.role === 'pretest' && !c.body?.every((x) => x.status === 'accepted')) check(false, 'pretest slots are offered only accepted items');
    }
    if (!pick) continue;
    const r = await call('PUT', `/api/staff/forms/${formId}/positions/${slot.position}`, {
      jar: editor, body: { itemVersionId: pick.itemVersionId },
    });
    if (r.status !== 200) check(false, `fill position ${slot.position}`, `${r.status} ${r.text.slice(0, 160)}`);
  }
  const full = await call('GET', `/api/staff/forms/${formId}`, { jar: editor });
  const failing = (full.body?.rules ?? []).filter((r) => r.applicable && !r.ok).map((r) => r.id);
  check(full.body?.slots?.length === 30, 'all 30 positions filled', `${full.body?.slots?.length}`);
  check(failing.length === 0 && full.body?.canFreeze, 'every rule passes', failing.join(', '));

  // Move an anchor to the end: the middle-positions rule must catch it.
  const lastScored = full.body.slots.find((s) => s.position === 30);
  const plan = full.body.plan.map((p) =>
    p.position === 21 ? { ...p, role: 'scored' } : p.position === 30 ? { ...p, role: 'anchor' } : p,
  );
  const moved = await call('PUT', `/api/staff/forms/${formId}/plan`, { jar: editor, body: { plan } });
  const anchorAt21 = full.body.slots.find((s) => s.position === 21);
  await call('PUT', `/api/staff/forms/${formId}/positions/30`, { jar: editor, body: { itemVersionId: anchorAt21.itemVersionId } });
  await call('PUT', `/api/staff/forms/${formId}/positions/21`, { jar: editor, body: { itemVersionId: lastScored.itemVersionId } });
  const endRules = (await call('GET', `/api/staff/forms/${formId}/rules`, { jar: editor })).body;
  const middle = endRules?.rules?.find((r) => r.id === 'anchors_middle');
  check(moved.status === 200 && middle && !middle.ok && middle.details.outside[0]?.position === 30, 'an anchor at position 30 fails "anchors in the middle"');
  const blocked = await call('POST', `/api/staff/forms/${formId}/freeze`, { jar: editor });
  check(blocked.status === 409 && blocked.body?.details?.failing?.includes('anchors_middle'), 'and freezing is refused', `${blocked.status}`);
  // Put it back.
  await call('PUT', `/api/staff/forms/${formId}/plan`, { jar: editor, body: { plan: full.body.plan } });
  await call('PUT', `/api/staff/forms/${formId}/positions/21`, { jar: editor, body: { itemVersionId: anchorAt21.itemVersionId } });
  await call('PUT', `/api/staff/forms/${formId}/positions/30`, { jar: editor, body: { itemVersionId: lastScored.itemVersionId } });

  const frozen = await call('POST', `/api/staff/forms/${formId}/freeze`, { jar: editor });
  check(frozen.status === 200 && frozen.body?.frozenAt, 'the form freezes', `${frozen.status} ${frozen.text.slice(0, 200)}`);
  const late = await call('PUT', `/api/staff/forms/${formId}/positions/1`, { jar: editor, body: { itemVersionId: null } });
  check(late.status === 409, 'a frozen form cannot change', `${late.status}`);
  check(
    /frozen/.test(
      (() => {
        try {
          return sql(`DELETE FROM form_item WHERE form_id = '${formId}' AND position = 1`);
        } catch (e) {
          return String(e.stderr ?? e.message);
        }
      })(),
    ),
    'and the database refuses it too',
  );
  const copy = await call('POST', `/api/staff/forms/${formId}/copy`, { jar: editor });
  check(copy.status === 201 && copy.body?.slots?.length === 30 && !copy.body?.frozenAt, '"new form from this one" is an editable copy');

  // ------------------------------------------------------------ INV-08
  group('INV-08 — anchors never reach practice');
  const anchorVersions = new Set(
    sql(`SELECT v.id FROM item_version v JOIN item i ON i.id = v.item_id WHERE i.is_anchor`).split('\n').filter(Boolean),
  );
  check(anchorVersions.size >= 12, `${anchorVersions.size} anchor versions exist to tempt the query`);
  const practice = await call('POST', '/api/staff/forms', {
    jar: editor, body: { mode: 'practice', grade: 4, label: `Practice ${tag}`, template: true },
  });
  check(practice.body?.plan?.every((p) => p.role !== 'anchor'), 'the practice template has no anchor slots');
  let offered = 0;
  let leaked = 0;
  for (const slot of practice.body.plan) {
    const c = await call('GET', `/api/staff/forms/${practice.body.id}/positions/${slot.position}/candidates`, { jar: editor });
    for (const x of c.body ?? []) {
      offered += 1;
      if (x.isAnchor || anchorVersions.has(x.itemVersionId)) leaked += 1;
    }
  }
  check(offered > 0 && leaked === 0, `the candidate query offered ${offered} versions for practice, 0 anchors`, `${leaked} anchors leaked`);
  const anyAnchor = [...anchorVersions][0];
  const forced = await call('PUT', `/api/staff/forms/${practice.body.id}/positions/1`, {
    jar: editor, body: { itemVersionId: anyAnchor },
  });
  check(forced.status === 400 && forced.body?.error === 'SLOT_INVALID', 'putting an anchor into practice by id is refused', `${forced.status}`);
  const planAnchor = await call('PUT', `/api/staff/forms/${practice.body.id}/plan`, {
    jar: editor, body: { plan: [{ position: 1, role: 'anchor' }] },
  });
  check(planAnchor.status === 400, 'a practice plan cannot even have an anchor slot', `${planAnchor.status}`);
  let dbRefused = false;
  try {
    sql(`INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored)
         VALUES ('${practice.body.id}', 40, '${anyAnchor}', 'scored', true)`);
  } catch (e) {
    dbRefused = /INV-08/.test(String(e.stderr ?? e.message));
  }
  check(dbRefused, 'and the database trigger refuses it as the second line of defence');

  // ------------------------------------------------------------- report
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
