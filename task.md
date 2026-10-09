# Zinapo — roles, permissions and full build plan

> **For the coding agent (Claude).** This is the master task file for building Zinapo end to end.
> Read it fully before writing code. Work milestone by milestone (section 12), in order.
> After each task, tick its checkbox in this file and note anything you changed in the spec.
> If something here conflicts with `schema.sql` or the strategy doc, **stop and ask**. Don't guess.

---

## 0. Context

**Zinapo** is a measurement and preparation platform for families in Uzbekistan. It follows a child from **grade 0 to grade 4** and tells the parent, honestly, where the child stands among children preparing for **grade-5 entry** to Presidential Schools and other specialized schools.

- **The product is the measurement, not the tests.** Tests are free everywhere. What nobody else has is the **cohort**: "your child is in the top 11–19% of the Tashkent region and moving up".
- **The asset is item-level history.** For each child we store which item, which answer, which date, which wave. We never store a score as the source of truth.

### Stack

| Layer | Tech |
|---|---|
| Frontend | **Next.js** (App Router, TypeScript), `next-intl` (uz-Latn, ru; `kaa` reserved), light/dark themes with the Lumen design tokens |
| Backend | **NestJS** (TypeScript), REST under `/api`, proxied by Next.js rewrites (same origin) |
| DB | **PostgreSQL 15+**. The schema is in `docs/schema.sql` |
| Cache / ephemeral | **Redis** (login requests, rate limits, queues) |
| Jobs | BullMQ on Redis (notifications, sync ingest, fraud rules, measurement runs) |
| Bot | Telegram bot inside NestJS (`nestjs-telegraf`, webhook mode) |
| Files | S3-compatible object storage **hosted in Uzbekistan** (item images, audio) |

### Reference files (read these first)

- `docs/strategy.md`: the product strategy (why every rule below exists).
- `docs/schema.sql`: the core data model and its invariants (INV-01 … INV-16).
- `docs/sign-in-spec.md`: the Telegram sign-in flow, **already implemented**.
- `design/*.html`: exported desktop designs for every screen (Lumen design system, uz/ru/en, light/dark, all states). Treat them as the visual source of truth.

### What exists today

- [x] Sign-in: phone → Telegram deep link → bot asks for the contact → 5-digit code (2 min) → session cookies → `/dashboard`.
- [x] One generic dashboard. **Roles are not implemented.** Everything below is to build.

---

## 1. Non-negotiable rules (apply to every task)

These come from the strategy and the schema. A PR that breaks one of them is wrong even if the feature works.

1. **Roles are relationships, not person types.** There is one `person` table. Never add `person.type` or `person.role`. A tutor who is also a parent is **one** person with two relationships (INV-01).
2. **A child is not a user.** Children never authenticate and own nothing. Parents and educators act on a child.
3. **Exactly one owner per child** (`guardianship.role = 'owner'`, enforced by a partial unique index). The owner alone gives consent and grants educator access.
4. **Educator access always expires** (`educator_link.valid_until NOT NULL`). Every read of a child's data by an educator is authorised through `v_educator_visible_child`. Group membership grants **nothing** (INV-15).
5. **PINFL never leaves the service layer.** It is never returned by any API, not partially and not even to the owner. Store a salted hash plus an app-level encrypted value with a separate key. Services exchange `child.id`.
6. **Responses are append-only** (no UPDATE or DELETE on `response`). Derived values (theta, percentile bands, skill states) are stored **per `calibration_run_id`** and never overwritten.
7. **Frozen item versions are immutable.** An edit means a new `item_version`. Every distractor has a `misconception_code` and a `rationale`.
8. **Anchor items never appear in practice forms.** Enforce this in the **query** that selects candidate items, not in the UI (INV-08).
9. **Percentiles are ranges, never points**, and only for grades 3–4. Grades 0–2 get criterion-referenced skill states only (`not_yet / emerging / secure`), with no ranking and no forecast.
10. **Never show:** absolute scores to parents, other children's names to parents, admission probability as a %, an exam countdown, or item-by-item review of monitoring forms (anchors would leak).
11. **Practice never shows percentiles.** It shows only "how many solved". Practice data never feeds the scale.
12. **Teacher metrics are gain, not level.** A child who missed a wave is shown as "not taken yet", never as zero. Reminders go to **parents**, never to children.
13. **Deletion = anonymisation.** Strip identifiers and keep responses.
14. **Data localisation.** Personal data (Postgres, Redis, object storage, logs) lives on servers inside Uzbekistan.
15. **Everything that changes access, consent, ownership, items or flags writes to `audit_log`.**

---

## 2. Roles

Roles are **derived at request time** from relationships. A person can hold several at once. The UI shows a **workspace switcher** whenever a person has more than one workspace.

| # | Role | Who | Derived from | Workspace |
|---|---|---|---|---|
| R0 | **Guest** | Anyone not signed in | No session | public pages |
| R1 | **Person (signed in, no role yet)** | A verified phone with nothing attached | Session, no other relationship | onboarding |
| R2 | **Parent — owner** | The legal holder of a child profile | `guardianship.role='owner' AND revoked_at IS NULL` | **Family** |
| R3 | **Parent — co-guardian** | Second parent or relative, view only | `guardianship.role='co_guardian' AND revoked_at IS NULL` | **Family** |
| R4 | **Child** (subject, not an account) | Grade 0–4 pupil | `child` row | **Kid mode**, launched from a parent's or educator's session |
| R5 | **Educator** | Tutor or school teacher | `educator_profile.status='approved'` | **Educator** |
| R6 | **Staff** (one or more staff roles below) | Zinapo team | `staff_role_assignment` (active) | **Staff console** |
| R7 | *(future)* **Partner organiser** | External olympiad organiser | `partner_member` | out of scope v1 |

### 2.1 Staff roles (RBAC inside the staff console)

A staff person can hold several staff roles. Permissions are the union.

| Staff role | Code | Main jobs |
|---|---|---|
| Item author | `item_author` | Writes items to the template; sees only their own items and statistics; paid per **accepted** item |
| Item reviewer | `item_reviewer` | Two-hand review: solves blind, then critiques; cannot review own items |
| Bank editor (psychometrics) | `bank_editor` | Approves or retires items, designates anchors, builds and freezes forms, triggers calibration runs, reads item statistics |
| Season manager | `season_manager` | Seasons, waves (windows per grade), regions and schools, monitoring calendar |
| Olympiad operator | `olympiad_operator` | Olympiad events, stages, venues, registrations, finals, results, certificates, awards |
| Proctor | `proctor` | Runs an in-person final: check-in, verifies the accompanying adult, runs the offline runner, uploads the sync. **Cannot proctor a final where their own child competes.** |
| Trust & safety | `trust_safety` | Fraud flags, ownership disputes, manual review (5th child, educator applications), suspends educator links |
| Support | `support` | Looks up a person by phone and sees relationships and statuses (never PINFL, never answers); can resend invites and reset a stuck login |
| Outcomes operator | `outcomes_operator` | Imports official admission lists (July), runs PINFL matching **inside the service**, reviews unmatched rows |
| Super admin | `super_admin` | Manages staff role assignments, system settings, reads the audit log; everything else needs the specific role too |

### 2.2 Role resolution and the dashboard router

`GET /api/me` returns:

```json
{
  "person": { "id": "…", "fullName": "Dilnoza Karimova", "phone": "+99890•••4567", "locale": "uz-Latn" },
  "workspaces": ["family", "educator", "staff"],
  "family": { "ownerOf": 2, "coGuardianOf": 0 },
  "educator": { "status": "approved", "activeChildren": 18 },
  "staff": { "roles": ["item_reviewer", "bank_editor"] },
  "lastWorkspace": "family"
}
```

`/dashboard` (Next.js server component) redirects as follows:

- 0 workspaces → `/onboarding` (choose "I'm a parent: add my child" or "I'm a tutor/teacher: apply").
- 1 workspace → its home (`/family`, `/educator`, `/staff`).
- More than 1 → `lastWorkspace`'s home, with the switcher in the header.

Pending states:

- An educator with `status='applied'` sees `/educator/pending`.
- A parent whose 5th child is in manual review still has their family workspace.

---

## 3. Permission matrix

Legend: ✅ allowed · 👁 read only · ❌ never · 🔸 only own / only if linked · — not applicable

| Action | Guest | Owner | Co-guardian | Educator | Staff (role) |
|---|---|---|---|---|---|
| Sign in / sign up via Telegram | ✅ | — | — | — | — |
| Create a child profile (PINFL) | ❌ | ✅ (max 4, then manual review) | ❌ | ❌ **never** | ❌ |
| Edit child name / enrolment (grade, school, region) | ❌ | ✅ | ❌ | ❌ | `support` 👁 |
| See PINFL | ❌ | ❌ | ❌ | ❌ | ❌ (nobody, ever) |
| Invite / remove co-guardian | ❌ | ✅ | ❌ | ❌ | — |
| Transfer ownership | ❌ | ✅ (to a co-guardian, who must accept) | accept only | ❌ | `trust_safety` via dispute |
| Grant / revoke educator access | ❌ | ✅ | ❌ | ❌ | `trust_safety` can suspend |
| Give / revoke consents | ❌ | ✅ | ❌ | ❌ | ❌ |
| Request anonymisation | ❌ | ✅ | ❌ | ❌ | `super_admin` executes |
| Launch a **monitoring** session (kid mode) | ❌ | ✅ (inside the wave window) | ✅ | 🔸 linked child, in office | `proctor` at finals |
| Launch a **practice** session | ❌ | ✅ (assigned or self-serve) | ✅ | 🔸 linked child | — |
| Parent report, grades 3–4 (percentile band) | ❌ | ✅ | 👁 | 🔸 **own child only** (`is_own_child`) | ❌ |
| Parent report, grades 0–2 (skills) | ❌ | ✅ | 👁 | 🔸 own child only | ❌ |
| Educator view of a pupil (gain, clusters, misconceptions, no percentile) | ❌ | — | — | 🔸 active link | ❌ |
| Practice results (how many solved) | ❌ | count only | count only | 🔸 linked | — |
| Invite parents (bulk phone) | ❌ | — | — | ✅ (approved) | `support` resend |
| PINFL + surname match-check | ❌ | — | — | ✅ (25/day, cooldown) | ❌ |
| Request access to a registered child | ❌ | — | — | ✅ (one live request per pair) | — |
| Create groups / add linked children | ❌ | — | — | ✅ (organisation only) | — |
| Send wave reminders | ❌ | — | — | ✅ (to parents) | `season_manager` (bulk) |
| Create / edit draft items | ❌ | — | — | — | `item_author` (own), `bank_editor` |
| Review items | ❌ | — | — | — | `item_reviewer` (not own) |
| Approve / retire item, set anchor | ❌ | — | — | — | `bank_editor` |
| Build / freeze forms | ❌ | — | — | — | `bank_editor` |
| Run calibration | ❌ | — | — | — | `bank_editor` |
| Configure seasons / waves | ❌ | — | — | — | `season_manager` |
| Register a child for an olympiad | ❌ | ✅ | ❌ | ❌ | `olympiad_operator` |
| Manage olympiads, venues, awards | ❌ | — | — | — | `olympiad_operator` |
| Run final check-in / offline runner | ❌ | — | — | — | `proctor` (not own child) |
| Resolve fraud flags, disputes, manual review | ❌ | — | — | — | `trust_safety` |
| Import admission outcomes | ❌ | — | — | — | `outcomes_operator` |
| Manage staff roles, read audit log | ❌ | — | — | — | `super_admin` |

---

## 4. Authorization design (backend)

Implement **one policy layer** and use it everywhere. Don't scatter role checks in controllers.

```
src/authz/
  authz.module.ts
  actor.ts                # Actor = { personId, staffRoles[], educatorStatus } loaded once per request (cache 60 s in Redis)
  policies/
    child.policy.ts       # canReadChild(actor, childId, scope: 'parent_report'|'educator_view'|'manage')
    item.policy.ts
    form.policy.ts
    olympiad.policy.ts
    staff.policy.ts
  decorators/
    require-staff-role.decorator.ts   # @RequireStaffRole('bank_editor')
    child-access.decorator.ts         # @ChildAccess('educator_view')  → resolves :childId param
  guards/
    session.guard.ts      # existing (zn_at cookie)
    staff-role.guard.ts
    child-access.guard.ts
```

Rules:

- **Child access** is checked by SQL, not by loading arrays into memory:
  - **Owner / co-guardian:** `EXISTS (SELECT 1 FROM guardianship WHERE child_id=$1 AND person_id=$2 AND revoked_at IS NULL [AND role='owner'])`
  - **Educator:** `EXISTS (SELECT 1 FROM v_educator_visible_child WHERE child_id=$1 AND educator_person_id=$2)`
  - **Educator reading a percentile:** only if that row has `is_own_child = true`.
- The educator API **never queries `child` directly**. It only goes through `v_educator_visible_child` (a lint rule or code review checklist item).
- **Staff permissions** are a constant map in code (`STAFF_PERMISSIONS: Record<StaffRole, Permission[]>`). The DB stores only assignments.
- Every denied access returns `404` for child resources (don't reveal existence) and `403` for staff actions.
- **Tests:** one e2e test per row of the permission matrix (section 3). This is the definition of done for milestone M1.

---

## 5. Data model additions (on top of `docs/schema.sql`)

Write these as migrations. Keep the naming rules of `schema.sql` (singular tables, `_id`, `timestamptz`).

```sql
-- From sign-in (may already exist)
ALTER TABLE person ADD COLUMN IF NOT EXISTS telegram_user_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS person_telegram_unique ON person (telegram_user_id) WHERE telegram_user_id IS NOT NULL;
-- auth_session: see sign-in spec

-- Staff RBAC
CREATE TYPE staff_role AS ENUM ('item_author','item_reviewer','bank_editor','season_manager','olympiad_operator',
                                'proctor','trust_safety','support','outcomes_operator','super_admin');
CREATE TABLE staff_role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  role staff_role NOT NULL,
  granted_by uuid REFERENCES person(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX staff_role_live ON staff_role_assignment (person_id, role) WHERE revoked_at IS NULL;

-- Educator profile (approval gate; the first ~100 educators are hand-picked)
CREATE TYPE educator_status AS ENUM ('applied','approved','rejected','suspended');
CREATE TYPE educator_kind AS ENUM ('tutor','school_teacher','learning_centre');
CREATE TABLE educator_profile (
  person_id uuid PRIMARY KEY REFERENCES person(id),
  kind educator_kind NOT NULL,
  status educator_status NOT NULL DEFAULT 'applied',
  public_code text UNIQUE NOT NULL,            -- e.g. 'AR4821', printed on invites, used for bonus attribution
  region_id smallint REFERENCES region(id),
  school_id uuid REFERENCES school(id),
  subjects text[],
  applied_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES person(id),
  decided_at timestamptz,
  note text
);

-- Co-guardian invitations and ownership transfer
CREATE TABLE guardian_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES child(id),
  invited_by uuid NOT NULL REFERENCES person(id),
  phone_e164 text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('co_guardian','ownership_transfer')),
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES person(id),
  accepted_at timestamptz,
  cancelled_at timestamptz
);

-- Disputes and manual review cases (one queue for trust & safety)
CREATE TYPE case_kind AS ENUM ('ownership_dispute','fifth_child','educator_application','fraud_flag');
CREATE TYPE case_status AS ENUM ('open','waiting_owner','resolved','dismissed');
CREATE TABLE review_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind case_kind NOT NULL,
  status case_status NOT NULL DEFAULT 'open',
  subject_person_id uuid REFERENCES person(id),
  subject_child_id uuid REFERENCES child(id),
  registration_flag_id bigint REFERENCES registration_flag(id),
  payload jsonb NOT NULL DEFAULT '{}',
  assigned_to uuid REFERENCES person(id),
  resolution text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Practice assignments (practice sessions reuse session/response with mode='practice')
CREATE TABLE practice_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES form(id),          -- mode = 'practice', never contains anchors
  educator_person_id uuid NOT NULL REFERENCES person(id),
  group_id uuid REFERENCES teaching_group(id),
  source_misconception_code text REFERENCES misconception(code),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_assignment_child (
  assignment_id uuid NOT NULL REFERENCES practice_assignment(id),
  child_id uuid NOT NULL REFERENCES child(id),
  PRIMARY KEY (assignment_id, child_id)
);

-- Olympiad operations
CREATE TABLE olympiad_venue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olympiad_id uuid NOT NULL REFERENCES olympiad(id),
  name text NOT NULL, address text NOT NULL, capacity int NOT NULL,
  starts_at timestamptz NOT NULL
);
ALTER TABLE olympiad_entry ADD COLUMN venue_id uuid REFERENCES olympiad_venue(id);
ALTER TABLE olympiad_entry ADD COLUMN checked_in_at timestamptz;
ALTER TABLE olympiad_entry ADD COLUMN accompanying_adult_matches_owner boolean;
CREATE TABLE proctor_assignment (
  venue_id uuid NOT NULL REFERENCES olympiad_venue(id),
  person_id uuid NOT NULL REFERENCES person(id),
  PRIMARY KEY (venue_id, person_id)
);

-- Notifications (Telegram first, SMS fallback)
CREATE TYPE notify_channel AS ENUM ('telegram','sms');
CREATE TABLE notification (
  id bigserial PRIMARY KEY,
  person_id uuid REFERENCES person(id),
  phone_e164 text,                        -- for people not registered yet (invites)
  channel notify_channel NOT NULL,
  template text NOT NULL,                 -- 'educator_invite', 'wave_reminder', 'access_changed', ...
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Workspace preference
ALTER TABLE person ADD COLUMN IF NOT EXISTS last_workspace text CHECK (last_workspace IN ('family','educator','staff'));
```

---

## 6. Backend modules (NestJS)

| Module | Owns | Must never |
|---|---|---|
| `auth` *(done)* | Telegram sign-in, sessions | – |
| `authz` | Actor loading, policies, guards | – |
| `identity` | person, child (PINFL hash/encrypt, DOB check), guardianship, co-guardian invites, ownership transfer, consent, enrolment | return PINFL; let an educator create a child |
| `access` | educator_profile, educator_invite (bulk), PINFL match-check + log, educator_link requests/approve/decline/expire | let group membership authorise anything |
| `bank` | topic, skill, misconception, item, item_version, item_option, item_review, item_statistic (read) | update a frozen version |
| `forms` | form, form_item assembly, rule checks, freeze | put anchors into a practice form |
| `seasons` | season, wave, region, school | – |
| `sessions` | session start (snapshots), offline bundle, response ingest (idempotent), submit | compute or store a score |
| `measurement` | calibration_run, scale_score, percentile_band, skill_state, inflation_adjustment (writes via job only) | write to the raw layer |
| `reporting` | read models: parent report 3–4, parent report 0–2, educator group view, practice results | show what section 1 forbids |
| `groups` | teaching_group, group_member | grant access |
| `practice` | practice forms from misconception/topic, assignments, repeat | return percentiles |
| `olympiad` | olympiad, venues, entries, tickets (≥3 waves), ranking within region, certificates (top 15%), awards, season cup | rank grades 0–2; compute teacher bonus from online stages |
| `trust` | fraud rules (job), registration_flag, review_case (disputes, 5th child, educator applications), suspensions | block silently |
| `notify` | Telegram + SMS sending, templates uz/ru, rate limits | message a child; message a parent on an expired link |
| `outcomes` | admission_outcome import + matching | expose PINFL in matching results |
| `audit` | audit_log writes + staff viewer | – |
| `privacy` | anonymisation_request execution | physically delete responses |

### 6.1 API surface (summary)

All routes are under `/api`. Use cursor pagination for lists. Errors look like `{ error: 'CODE', message, details? }`.

**Me & workspaces**
- `GET /me`
- `PUT /me` (name, locale)
- `PUT /me/workspace`

**Family**
- Children:
  - `GET /family/children`
  - `POST /family/children` (PINFL, names, DOB, grade, school_region, school)
  - `GET /family/children/:id`
  - `PATCH /family/children/:id`
  - `POST /family/children/:id/enrolments`
- Guardians:
  - `GET /family/children/:id/guardians`
  - `POST /family/children/:id/co-guardian-invites`
  - `POST /family/guardian-invites/:code/accept`
  - `POST /family/children/:id/ownership-transfer`
  - `DELETE /family/children/:id/guardians/:personId`
- Educator access:
  - `GET /family/children/:id/educators`
  - `POST /family/educator-requests/:linkId/approve {validUntil}`
  - `POST /family/educator-requests/:linkId/decline` (blocks for the season)
  - `POST /family/children/:id/educators/:linkId/revoke`
- Consents and privacy:
  - `GET /family/consents`
  - `PUT /family/children/:id/consents/:type`
  - `POST /family/children/:id/anonymisation-request`
- Reports and sessions:
  - `GET /family/children/:id/report` (returns `template: 'grade_3_4' | 'grade_0_2'`)
  - `GET /family/children/:id/waves` (open / upcoming / taken)
  - `POST /family/children/:id/sessions {waveId|assignmentId}`
- Olympiad:
  - `GET /family/children/:id/olympiad`
  - `POST /family/children/:id/olympiad/:olympiadId/register {venueId}`

**Kid mode / sessions** (shared by family, educator and proctor)
- `GET /sessions/:id/bundle` (the whole form, media URLs, no keys for monitoring)
- `POST /sessions/:id/responses` (batch, idempotent on `(session_id,item_version_id)`)
- `POST /sessions/:id/submit`
- `GET /sessions/:id/result`
  - practice: solved count, plus review **only** if the form has no anchors
  - monitoring: just "submitted"

**Educator**
- Application:
  - `POST /educator/apply`
  - `GET /educator/profile`
- Invites and access requests:
  - `POST /educator/invites {phones[]}` (bulk)
  - `GET /educator/invites`
  - `POST /educator/invites/remind`
  - `POST /educator/match-check {pinfl, familyName}` → `{match: true, maskedName}` | `{match:false}`
  - `POST /educator/access-requests {matchToken}`
- Groups and pupils:
  - `GET /educator/groups`
  - `POST /educator/groups`
  - `POST /educator/groups/:id/members`
  - `GET /educator/groups/:id/overview?waveId=` (gain-sorted list, common misconceptions, not-taken)
  - `GET /educator/children/:id` (educator view; percentile only if own child)
  - `POST /educator/groups/:id/reminders`
- Practice:
  - `POST /educator/practice/forms {source: misconception|topic, code, size}`
  - `POST /educator/practice/assignments`
  - `GET /educator/practice/assignments/:id/results`
  - `POST /educator/practice/assignments/:id/repeat {childIds}`

**Staff**
- Item bank:
  - `/staff/items` CRUD (versions, options)
  - `/staff/items/:id/versions/:v/freeze`
  - `/staff/review-queue`
  - `/staff/reviews`
- Forms, seasons and calibration:
  - `/staff/forms` (+ `/rules`, `/freeze`)
  - `/staff/seasons`, `/staff/waves`
  - `/staff/calibration-runs`
- Olympiads:
  - `/staff/olympiads` (+ venues, entries, results, certificates, awards)
  - `/staff/finals/:venueId/check-in`
  - `/staff/finals/:venueId/offline-package`
  - `/staff/finals/:venueId/sync`
- Trust, outcomes and admin:
  - `/staff/cases` (flags, disputes, 5th child, educator applications)
  - `/staff/outcomes/import`
  - `/staff/people?phone=` (support lookup)
  - `/staff/roles`
  - `/staff/audit`

---

## 7. Frontend routes (Next.js App Router)

All routes are prefixed with `/[locale]` (`uz` default, `ru`). One root layout loads the theme (light/dark), `next-intl` and the session.

```
(public)
  /sign-in                         DONE
  /invite/[code]                   educator invite landing → sign-in → add child with access toggle pre-filled
  /o/[slug]                        olympiad landing (deep-link source attribution: ?src=)
(app)
  /dashboard                       role router (section 2.2)
  /onboarding                      "I'm a parent" / "I'm a tutor or teacher"
  /profile                         name, language, theme, Telegram link status, sign out
(family)                           layout: parent sidebar
  /family                          → first child's report
  /family/children/new             3-step wizard (details → access & consents → done)
  /family/children/[id]            report: template by grade (3–4 percentile band | 0–2 skills)
  /family/children/[id]/olympiad
  /family/access                   requests, who can see, co-guardians, ownership transfer, change log
  /family/consents                 per child, per type, document version
  /family/privacy                  anonymisation request
(kid)                              full-screen, no sidebar, large touch targets, works offline
  /play/[sessionId]                ready → test → review → done (monitoring); practice shows solved count
(educator)                         layout: teacher sidebar
  /educator                        → first group
  /educator/pending                application under review
  /educator/groups/[id]            gain list · common mistakes · not taken yet · pupil detail panel
  /educator/children/[id]          pupil view (or full parent report if own child)
  /educator/practice               sets + results
  /educator/practice/new           from a mistake / by topic → assign
  /educator/invites                bulk phone invite + PINFL match-check + status
  /educator/my-children            "My children" (own kids, full report)
(staff)                            layout: staff sidebar, items depend on staff roles
  /staff                           role-aware home (queues with counts)
  /staff/items                     bank list + filters + season targets
  /staff/items/new  /staff/items/[id]   item card editor, versions, statistics
  /staff/review                    blind solve → reveal → verdict
  /staff/forms  /staff/forms/[id]  form builder, rule checks, freeze
  /staff/seasons                   seasons & waves calendar
  /staff/calibration               runs, current run, compare runs
  /staff/olympiads  /staff/olympiads/[id]  stages, venues, entries, results, certificates
  /staff/finals/[venueId]          proctor check-in + offline runner control
  /staff/cases                     flags · disputes · 5th child · educator applications
  /staff/outcomes                  admission list import + matching review
  /staff/people                    support lookup
  /staff/roles  /staff/audit       super admin
```

Next.js `middleware.ts` handles these checks:

- **No session:** redirect to `/sign-in?next=`.
- **Workspace segments:** check that the workspace is in `me.workspaces`, using a cached claim in the access JWT: `ws: ['family','educator','staff']`, `sr: [staff roles]`.
- **Data access** is always enforced again by the API. Never trust the client.

### 7.1 UI requirements for every screen

- **Languages:** uz-Latn and ru for all copy. Keep the `kaa` locale wired but empty.
- **Themes:** light and dark with the Lumen tokens. One accent colour, `brand-400`, for the primary action, with dark text on it. No white text on `brand-400`.
- **Every data screen has four states:** loading (skeleton shaped like the content), empty (why it's empty plus the next action), error (what failed plus retry), and default. Flow screens also have validation and success states.
- **Practice vs monitoring look different:** teal for practice, violet for monitoring. The difference must be in layout and wording too, not just a caption.
- **Accessibility:** real buttons, links and labels; focus rings; 44 px touch targets; text contrast ≥ 4.5:1.
- **Performance:** must work on low-end Android over mobile data. Kid mode loads the whole form before starting and works offline.

---

## 8. Core flows per role

### 8.1 Parent (owner)

1. **Sign-in (done)** → `/dashboard` → no role yet → `/onboarding` → "Add my child".
2. **Add a child:**
   - Enter PINFL, family/given/patronymic names, DOB, grade, **school region** (the school's region, not home), and the school.
   - Backend: validate the PINFL format, check that the **DOB matches the PINFL** (a mismatch is a hard stop), hash and look up the PINFL.
     - **Already registered:** open an `ownership_dispute` case and notify the current owner. Don't create a duplicate.
     - **5th child for this owner:** open a `fifth_child` case (manual review) instead of failing.
   - Consents: `data_processing` (required), `third_party_transfer` (optional, separate), `marketing` (optional).
   - If the user arrived from an educator invite, show the access toggle **ON** ("Share reports with Aziza Rakhimovna until 31 May"), visible and switchable.
3. **Reports:**
   - **Grades 3–4:** blocks in this order: *where are we → where heading → what's wrong → what to do*. Then Plan B, who can see, practice count.
   - **Grades 0–2:** "11 of 18 skills secure", new since last month, skill list with 3 states, one play-based action, and the explicit refusal to forecast.
4. **Take a wave:** a wave window is open for the child's grade → "Start" → kid mode `/play/[sessionId]` → submitted → the report updates after the wave closes and measurement runs.
5. **Access management:**
   - Approve or decline educator requests (a decline blocks that educator for the season).
   - Switch access off or restore it.
   - Invite a co-guardian, transfer ownership.
   - Every change is notified via Telegram.
6. **Olympiad:** view stages, the ticket (≥ 3 monitoring waves = direct entry to the spring final), register at a venue, see results (certificate only if top 15%, otherwise a diagnostic report). Grades 0–2: a diagnostic marathon with no places.
7. **Privacy:** revoke consents; request anonymisation.

### 8.2 Co-guardian

Gets an invite by phone → signs in → accepts → sees the reports read-only. Can launch sessions in kid mode. Cannot change consents or access. Can accept an ownership transfer.

### 8.3 Child (kid mode)

- Launched from a parent's account (home), an educator's account (office, active link only) or a proctor's device (final).
- Full-screen, minimal chrome, large options.
- Grades 0–1 get **visual items with read-aloud audio** (`audio_ref` required).
- Monitoring:
  - no correct answers, no score at the end
  - just "Well done, your answers are saved"
  - the timer is shown, but there is **no exam countdown** anywhere else
- Practice: shows how many were solved; the review is allowed because practice forms contain no anchors.
- The child **never** sees a percentile or rank.
- Responses are buffered locally and synced with retries. Record `response_ms`, `revision_count`, `client_recorded_at`, device, OS and client version.

### 8.4 Educator

1. **Apply:** `/onboarding` → "I'm a tutor/teacher" → kind, region, school, subjects → `educator_profile.status='applied'` → a `trust_safety` case → approved. The first ~100 educators are invited by staff and pre-approved.
2. **Invite parents:**
   - **Primary path:** paste phone numbers (bulk), and the SMS carries the educator's `public_code`. The parent registers, and the access toggle is pre-filled.
   - **Child already registered:** a PINFL + family-name **match-check**, which returns only match/no-match with a masked name (`KARIMOVA M***A`).
     - Limits: 25 checks/day, 3 misses → 1 h cooldown. Every check goes to `pinfl_check_log`.
     - On a match, send an access request (lives 14 days, one live request per pair).
   - **There is no "add pupil" button.** Educators can't create children.
3. **Groups:** organise linked children by group (organisation only).
4. **Group overview** for a selected wave:
   - Children **sorted by gain** (no level sort).
   - **Common misconceptions** (from distractor codes), each with a button to build practice from it.
   - **Not taken yet**, with a reminder to parents.
5. **Pupil view:** band per wave, gain, dominant misconception, access expiry. **No percentile** unless it's the educator's own child.
6. **Practice:**
   - Build a set from a misconception or a topic. Candidate items exclude anchors **in the SQL**. Practice can contain pretest items with `is_scored=false`, and the source is tagged.
   - Assign it to the whole group or to the children who made that mistake.
   - Results show "how many solved" only.
   - "Repeat for those who struggled" sits on the result card.
7. **My children:** the educator's own kids, with the full parent report. Excluded from group statistics and the bonus. The educator can't proctor their own child's final.

### 8.5 Staff

**Item author**
- Fills in the item card template: grade, topic, cluster, construct, stem format, expected p, the stem in uz and ru, options, the key, and **a misconception code + rationale for every distractor**.
- Grades 0–1 need visual + audio.
- Saves a draft, then submits for review.

**Item reviewer**
- Gets the stem without the key and solves it **blind**.
- Then the key and rationales are revealed:
  - If the answers disagree, the item is **auto-rejected**.
  - Otherwise the reviewer gives a verdict (accept / revise / reject, with a required note for revise and reject).
- Reviewers never review their own items.

**Bank editor**
- Approves items and designates anchors (horizontal, or vertical with a link grade). Retires items.
- Builds wave forms:
  - Anchors in the **middle positions**, spanning the full difficulty range.
  - 4–5 unscored pretest items.
  - 6–8 items per cluster.
  - uz and ru versions both present.
- Runs rule checks and then **freezes** the form (irreversible).
- Triggers calibration runs.
- Reviews item statistics: p outside 0.20–0.85, point-biserial < 0.20, a dead distractor, DIF uz vs ru.

**Season manager**
- Creates the season, waves per grade with windows (8 per season), regions and schools.
- Sends bulk wave reminders to parents.

**Olympiad operator**
- Sets up stages: autumn online, mini-finals, spring online, spring final.
- Manages venues and capacity, entries, and tickets from monitoring waves.
- After the in-person final:
  - regional ranking for grades ≥ 3 only
  - certificates for the top 15%, a diagnostic report for everyone else
  - awards; the teacher bonus counts **only proctored stages**
  - the season cup, which rewards gain

**Proctor**
- Gets a venue roster and checks children in.
- Records whether the accompanying adult matches the owner.
- Runs the **offline runner** (local sessions with no internet) and uploads the sync package afterwards.

**Trust & safety**
- Works one queue holding:
  - fraud flags from rules — for example many owners from one device in 2 h, children with different surnames all in one group, an owner who never opens reports but completes waves, PINFL check bursts
  - ownership disputes
  - 5th-child cases
  - educator applications
- Actions on a fraud flag:
  - **Suspend the educator's links and ask the owners to confirm.** Never block silently.
  - Dismiss as a false positive, with a note.
  - Confirm and escalate.

**Outcomes operator**
- Imports the official admission lists (July). Matching is by PINFL **inside the service**, so the UI never shows PINFLs.
- Reviews unmatched rows, which writes `admission_outcome`.

**Support**
- Looks people up by phone: sees their relationships, statuses, invites and login state.
- Can resend an invite or cancel a stuck login request.
- Never sees PINFL or answers.

**Super admin**
- Manages staff role assignments, settings and the audit log viewer.

---

## 9. Measurement (keep it versioned and simple first)

- **Measurement runs only as background jobs** that write to the derived tables with a `calibration_run_id`. Never compute it inline in a request.
- **v0 (Release 1, method `raw_band_v0`):** within one wave form per grade:
  - score = the number of correct **scored** items
  - percentile band within the cohort `region × grade × season` = the percentile of score ± SEM, stored as `pct_low/pct_high`
  - if `cohort_n < 30`, don't show a band; show "not enough children in this cohort yet"
  - skill states for grades 0–2: ≥ 2 correct items on a skill in a wave → candidate; confirmed in a later wave → `secure`; partial → `emerging`
- **v1 (Release 2, method `rasch_anchor_equating_v1`):**
  - a Rasch calibration with horizontal and vertical anchor equating; theta + SE go in `scale_score`
  - bands are derived from theta ± 1.0 SE
  - `inflation_adjustment` comes from the in-person final anchors, applied one way only: the final corrects monitoring, never the reverse
  - a Python worker (e.g. `girth` or R `mirt`) is acceptable if it reads the raw tables and writes the derived tables only
- **Recalibration** creates a new run; switching `is_current` atomically changes what the reports read.
- **Online olympiad stage data never enters the scale.**

---

## 10. Notifications

- **Channels:** Telegram first (every signed-in person has linked Telegram through sign-in). SMS for invites to numbers that aren't registered yet and as a fallback.
- **Templates (uz/ru):**
  - `educator_invite`
  - `access_requested`, `access_granted`, `access_revoked`, `access_expiring` (14 days before)
  - `co_guardian_invite`, `ownership_transfer`
  - `wave_open`, `wave_reminder`, `report_ready`
  - `olympiad_registered`, `final_venue_details`
  - `case_needs_owner_confirmation`
- **Rules:**
  - never message a child
  - never message a parent about an educator whose link expired
  - throttle to max 1 reminder per wave per child per day

---

## 11. Non-functional requirements

- **Load:** the online olympiad stage means tens of thousands at once.
  - Stagger starts by region and grade.
  - Bundle the whole form to the client before the start.
  - Buffer answers locally and sync through a retrying queue.
  - Make ingest idempotent.
  - **Load-test at 3× the expected peak before the announcement.**
- **Offline final:** the runner works with zero connectivity and syncs later. `sync_source='offline_sync'` with `client_recorded_at`.
- **Security:**
  - PINFL encryption key in a KMS or env, separate from the DB.
  - Rate limits on match-check, invites and sign-in.
  - All cookies httpOnly and Secure.
  - CSRF protection on mutating routes (SameSite=Lax + an origin check).
- **Observability:** structured logs **without** PINFL, codes or tokens; request IDs; a job dashboard.
- **Testing:**
  - unit tests for policies and measurement
  - e2e for every permission-matrix row
  - Playwright for the main flows per role
  - a DB test for each invariant in `schema.sql`

---

## 12. Milestones and tasks

> Each task: implement → tests → update this checklist. Don't start the next milestone with red tests.

### M0 — Done
- [x] Telegram sign-in, sessions, `/dashboard` placeholder.

### M1 — Roles foundation — Done
- [x] **Core data model** (`db/init/003_core_schema.sql`, = `docs/schema.sql`). Was missing from the repo; see note M1-a.
- [x] Migrations: `staff_role_assignment`, `educator_profile`, `guardian_invite`, `review_case`, `practice_assignment`, olympiad ops, `notification`, `person.last_workspace` (`db/init/004_roles_and_ops.sql`); regions + starter taxonomy (`005_reference_data.sql`); `scripts/migrate.sh` for an existing volume.
- [x] `authz` module: Actor loader (60 s Redis cache), SQL-based child policy, staff permission map, `SessionGuard` / `StaffRoleGuard` / `ChildAccessGuard`, `@Guarded` / `@RequireStaffRole` / `@RequirePermission` / `@ChildAccess` / `@CurrentActor` / `@ResolvedChild`.
- [x] `GET /me` with workspaces; `PUT /me`; `PUT /me/workspace`. Access JWT carries `ws[]` and `sr[]`.
- [x] `/dashboard` router + `/onboarding` + the workspace switcher in the header.
- [x] Layout shells for family, educator, staff and kid; Lumen tokens from `design/*.html`; i18n uz/ru/en (+ `kaa` wired, see note M1-e); light/dark.
- [x] Seed (`scripts/seed.sh` → `POST /api/dev/seed`): owner with 2 children, co-guardian, 2 approved educators (one of them also a parent, for `is_own_child`), 2 groups, one person per staff role, one person with two staff roles.
- [x] **DoD:** `scripts/permission-matrix.sh` — 16 pass, 0 fail, 72 pending (the pending rows are the M2–M9 routes; the script prints the breakdown per milestone and a pending row is never counted as a pass).

Also delivered, because M1 could not be verified without them:
- [x] `design/` — the 15 boards unpacked from `Zinapo.html`, self-contained, with `design/index.html` as a contact sheet.
- [x] `scripts/db-test.sh` — one check per invariant (31 assertions, all passing). task.md § 11 asks for this; doing it now rather than at M9 is what caught notes M1-b and M1-c.
- [x] `scripts/routing.sh` — 24 checks over § 2.2 and § 7.

#### Notes on M1 — deviations and decisions

**M1-a. `docs/schema.sql` did not exist.** The repo only had the sign-in slice
(`person`, `audit_log`, `auth_session`). The core model was authored from the
references in task.md and confirmed with the product owner before any code was
written. `docs/schema.sql` is now a symlink to `db/init/003_core_schema.sql`, so
the specification and the migration are the same bytes and cannot drift. All 16
invariants are enforced in the database — by a constraint, a partial index or a
trigger — and each has a test in `db/test/invariants.sql`.

**M1-b. INV-04 had a hole.** "A child always has an owner" was enforced only by a
trigger on `guardianship`, so a `child` row inserted with no guardianship at all
was never checked. There is now a second deferred constraint trigger on `child`
itself (`child_owner_present_on_insert`), and `INV-04 orphan` in the test suite
covers it.

**M1-c. No PINFL check digit.** `PinflService.isWellFormed` validates 14 digits,
a century/sex digit in 1–6, and an embedded birth date that is a real calendar
date and matches the entered DOB. It deliberately does **not** test a checksum:
the official modulo is not published in a verifiable form, and a guessed one
would reject real families at the one screen they cannot work around. Duplicate
detection rests on `child.pinfl_hash UNIQUE` plus the ownership-dispute flow,
which is where task.md puts it anyway. Added as open question 7.

**M1-d. `super_admin` does not inherit.** Read literally from § 2.1
("everything else needs the specific role too"): the role grants
`role.manage`, `audit.read`, `settings.manage` and `anonymisation.execute` and
nothing else. A super admin cannot freeze a form or resolve a case without also
holding that role. The permission matrix asserts this.

**M1-e. `kaa` is routable, not empty.** § 7.1 asks for it "wired but empty". An
empty dictionary would render blank strings, so `kaa` is a real locale that
falls back to uz; it is excluded from the language switcher until there is copy.
Dropping in `messages/kaa.json` is then the only change needed.

**M1-f. Enum arrays needed an explicit cast.** `node-pg` has no parser for
`staff_role[]` and returns the literal string `'{bank_editor}'`. Both role
queries cast to `text[]` and filter through `isStaffRole`, so a role added to
the SQL enum but not to the TypeScript union is dropped rather than taking the
request down.

**M1-g. White text on `brand-400` is gone.** The first-slice stylesheet had
`.btn--primary` as a violet gradient with `#fff` text, which § 7.1 forbids. It
is now flat `--brand-400` with `--ink-on-primary`, matching every board.

**M1-h. Routes that later milestones own are placeholders, not 404s.** Every
route in § 7 exists and renders a screen naming the milestone it waits for. A
nav rail whose links 404 would not demonstrate the workspace routing that M1 is
supposed to deliver.

### M2 — Family & identity (Release 1) — Done
- [x] Add-child wizard: PINFL validation, DOB-vs-PINFL hard stop, hash + encrypt (separate key), duplicate → dispute case, 5th child → manual review case. (`/family/children/new`, `POST /family/children`; notes M2-c, M2-d.)
- [x] Enrolment history (school year, grade, school, **school region**). (`/family/children/[id]`; a change closes the current enrolment and opens a new one; a school outside the chosen region is refused.)
- [x] Consents (3 separate types, versioned documents, revocable). (Every grant is its own row; `data_processing` too can be withdrawn — note M2-e.)
- [x] Co-guardian invite and accept; ownership transfer (requires acceptance; always exactly one owner). (`/guardian-invite/[code]`, onboarding lists invites; note M2-f.)
- [x] Access page: requests, approve with expiry, decline (blocks for the season), revoke or restore, change log; Telegram notifications. (`/family/access`; notes M2-g, M2-h, M2-i.)
- [x] Anonymisation request (queued; executed by a job that strips identifiers and keeps responses). (`/family/privacy`, `zn_anonymise_child`; notes M2-a, M2-b.)
- [x] **DoD:** `scripts/permission-matrix.sh` — 41 pass, 0 fail, 0 pending for M2 (50 pending, all M3–M9); `scripts/family-flows.sh` — 75 checks over every M2 flow, all passing; `scripts/db-test.sh` — 36 assertions (5 new for M2); `scripts/routing.sh` and `scripts/acceptance.sh` still green.

#### Notes on M2 — deviations and decisions

**M2-a. INV-04 steps aside for an anonymised child** (decided with the product
owner). Rule 13 says deletion strips identifiers; a guardianship row ties a
named adult to the child's responses, so it is an identifier. Migration
`006_family_identity.sql` makes `child_owner_present()` return early for a child
whose `anonymised_at` is set, and `zn_anonymise_child()` revokes every
guardianship, educator link, group membership, live consent and open invite in
one transaction. Names become `—`, the PINFL hash is replaced by random bytes
(the UNIQUE index still holds and the row can never be matched again), the
sealed PINFL is emptied, the DOB is kept to the year (the cohort needs the age).
Sessions, responses and enrolments stay.

**M2-b. Who executes an anonymisation** (decided with the product owner). § 3
says "`super_admin` executes", § 12 says "executed by a job". Both: the owner's
request waits out a grace window (`ANONYMISATION_GRACE_DAYS`, default 7) during
which it can be cancelled (new column `anonymisation_request.cancelled_at`); the
privacy job (every 10 min) then runs it. A super admin can run one immediately
with `POST /staff/anonymisation-requests/:id/execute`; the staff screen is M9.

**M2-c. Who may create a child** (decided with the product owner). § 3 denies
co-guardians, educators and staff, while § 2.2 sends a person with no role to
onboarding, whose first door is "add my child". Rule: someone who already owns
a child, or someone with no workspace at all. This leaves a gap — a co-guardian,
an educator or a staff member who is also a parent cannot add their own child
— recorded as open question 8. The family layout and the middleware let a
person with no workspace onto `/family/children/new` and nowhere else.

**M2-d. A duplicate PINFL opens the case at once; the claimant's "Open a
dispute" confirms it.** § 8.1 says to open the `ownership_dispute` case and
notify the owner; design/02 shows the claimant pressing "Open an ownership
dispute" first. The case is opened (and the owner notified) when the duplicate
is detected, with `payload.claimantConfirmed = false`; the button records the
claimant's confirmation and returns the request number. Trust & safety (M8) can
tell a typo from a claim. The same owner re-submitting their own child is not a
duplicate: it returns 200 with the existing id, which is what makes a retry
after a dropped connection safe (design/02's error state).

**M2-e. `data_processing` can be withdrawn.** design/06 shows "Withdraw
anyway" with "Measurement will stop… Earlier results are kept"; the M1 service
refused it. Withdrawing it keeps the profile; **M4 must refuse to start a
session without a live `data_processing` consent.** Deleting the data is the
separate anonymisation request.

**M2-f. Invitations are bound to the invitee's verified phone.** A
co-guardian or ownership invite is addressed to a phone; only a person signed in
with that phone (sign-in verified it through Telegram) can see or accept it, so
a forwarded link is useless. Invites live 7 days, re-inviting the same number
re-sends the same invite, and an owner may send 20 a day (§ 11 rate limits).
Ownership goes only to a current co-guardian, by person id or phone; the old
owner becomes a co-guardian in the same transaction. A number not on Zinapo gets
an SMS row that stays queued until there is a provider (open question 2).

**M2-g. Decline blocks for the season by keeping the row.** A declined link
keeps `status = 'declined'` and its `season_id`. **M6's request endpoint must
refuse a new request for the same pair while that season is current.** The
educator is not messaged about a decline (design/06: they see only "not
accepted").

**M2-h. Access end dates.** The owner picks "end of the school year" (31 May
of the season's last year, or the season end if earlier) or "3 months", both
computed by the API and bounded by the season end (INV-05). The chosen day is
stored as its last second in Asia/Tashkent, so "until 31 May" really means the
whole of 31 May. A request lapses 14 days after it was made; that is computed
when read (no job yet) — M6 adds the expiry job and `access_expiring`.

**M2-i. The change log is the audit log.** `GET /family/children/:id/changelog`
reads `audit_log` filtered to the child and to the family-facing actions; names
are resolved from ids at read time, so the log never stores a name. Every
change is also announced by Telegram to the owner and every co-guardian
(`FamilyNotifier`), with eight new uz/ru templates in `notify/templates.ts`.

**M2-j. Two M1 bugs found and fixed.** `NotifyService.queue` used `ON CONFLICT
(throttle_key)` against a *partial* unique index, which Postgres rejects
(42P10) — no notification had ever been queued. `toE164` read a locally typed
"90 123 45 67" as `+90…` (Turkey) and rejected it; only numbers that already
carry a country code are parsed internationally now (sign-in is unaffected:
`acceptance.sh` 45/45).

**M2-k. The permission-matrix harness tells "not built" from "denied".** Both
are 404 by design (§ 4); the harness now looks at the body — Nest's
`Cannot GET …` means the route does not exist, our `{ error: 'NOT_FOUND' }`
means the policy refused. Before this, every M2 deny row would have stayed
PENDING forever. The owner rows act on real fixtures (Aziza's link is switched
off and restored) and clean up after themselves.

### M3 — Item bank & forms (Release 1) — Done
- [x] Taxonomy CRUD: topics (3 clusters), skills (grades 0–2), misconceptions. (`/staff/taxonomy`; note M3-d.)
- [x] Item editor: versions, options, distractor validation (code + rationale), audio for grades 0–1, uz/ru versions, media upload to in-country storage. (`/staff/items/new`, `/staff/items/[id]`; notes M3-b, M3-c, M3-e.)
- [x] Review queue: blind solve → reveal → verdict; auto-reject on disagreement; no self-review; `accepted_at` for author payment. (`/staff/review`.)
- [x] Freeze version (DB trigger already exists) + "create new version". (Submitting freezes; note M3-e.)
- [x] Form builder: slots by role, anchor placement rules, pretest unscored, cluster coverage, rule checks API, freeze. (`/staff/forms`, `/staff/forms/[id]`; note M3-f.)
- [x] **Anchor exclusion for practice in the candidate SQL**, plus a test that fails if an anchor can be selected. (`bank/candidates.repository.ts`; `scripts/bank-flows.sh` "INV-08" group and `db/test` "INV-08 candidates" — note M3-g.)
- [x] **DoD:** `scripts/bank-flows.sh` — 60 checks, all passing; permission matrix 50 pass, 0 fail, 0 pending for M3 (41 pending, all M4–M9); `scripts/db-test.sh` 39; M2 suites still green.

#### Notes on M3 — deviations and decisions

**M3-a. Clusters stay `numeracy / reasoning / language`** (decided with the
product owner). design/11–14 use "Number & computation / Problem solving /
Logic & space"; the schema, the topics and the misconceptions were confirmed in
M1, and "language" has no counterpart in the boards. Item codes are
`G{grade}-{NUM|REA|LAN}-{nnnn}`, assigned by a trigger on insert (new column
`item.code`, migration 007).

**M3-b. A reviewer's Accept is not the editor's approval** (decided with the
product owner). design/13 says Accept "goes to pretesting, the author is paid";
§ 2.1 says the bank editor "approves". New status `accepted` between
`in_review` and `approved`: Accept sets `accepted_at` (payment) and the item can
fill PRETEST slots only; the bank editor's Approve makes it eligible for scored
and anchor slots; anchors are designated only on approved items. Revise sends
the item back to `draft` for a new version; reject and auto-reject to
`rejected`.

**M3-c. Media on local disk, behind an interface** (decided with the product
owner). No in-country S3 provider is chosen, so `MediaStorage` has one driver,
`LocalDiskStorage` (`MEDIA_DIR`, a Docker volume kept in the production
overlay). Files are checked by their bytes (PNG/JPEG/SVG ≤ 2 MB, MP3 ≤ 3 MB),
registered in `media_object`, and read through short-lived HMAC-signed URLs
(`/api/media/...`) — the same mechanism kid mode will use in M4. SVGs are
served with a sandboxing CSP. An S3 driver is a new class, nothing else.

**M3-d. Taxonomy belongs to the bank editor.** The permission map gained
`taxonomy.manage` (bank_editor). Authors and reviewers read it. Codes never
change; nothing an item uses is deleted — a misconception is retired, which
hides it from new options but leaves frozen ones intact. A route
`/staff/taxonomy` was added to § 7's list.

**M3-e. Submitting freezes the version.** The reviewer must answer exactly
what was submitted, and design/12 says "even a fixed comma means a new
version". So `submit` validates completeness, writes the options and freezes
the version in one transaction; every later change is "Create a new version".
Because the schema refuses an unexplained distractor (INV-10) and a picture
format without its picture even in a draft, an unsubmitted version keeps its
editable content in `item_version.draft` (jsonb) until submit. Item-level
fields (grade, topic, skill, construct) lock once anything has been submitted.
A reviewer cannot read the key from the item card before solving blind
(`keysHidden`). The back-translation workflow on design/12 is not in the spec
and was not built.

**M3-f. Form rules, made concrete.** A form is a plan (role per position) plus
filled positions; design/14's template is 30 positions for monitoring (12
anchors in 10–21, 5 pretest, 13 core) and 18 for practice (13 core, 5 pretest).
Rules: every position filled; every item still valid for its slot; anchors
cover easy/medium/hard (calibrated b when there is one, otherwise the author's
expected p: ≥ 0.70 easy, < 0.40 hard); anchors only in the middle half of the
form (for 30 positions: 8–23); 4–5 unscored pretest items in monitoring; at
least 6 scored items per cluster that covers the grade; no anchor in practice;
both language versions present. Freezing requires every applicable rule.
Time limits, waves and seasons attach to forms in M4.

**M3-g. The INV-08 tests.** `bank-flows.sh` builds a practice form and asks
the candidate query for every position: it must offer items and never an
anchor; forcing an anchor in by id is refused by the API, and by the trigger
underneath. The old "INV-08 candidates" DB check was a tautology
(`NOT is_anchor AND is_anchor`); it now runs the practice predicate against an
approved, frozen anchor.

**M3-h. Development fixture.** `POST /api/dev/seed-bank` writes a grade 4 bank
(12 anchors, 26 core, 8 accepted, 3 in review, 2 drafts) and season targets, so
the bank, the review queue and the form builder have something to show.

### M4 — Sessions & kid mode (Release 1) — Done
- [x] Seasons and waves admin (season manager). (`/staff/seasons`: seasons, the 5 × 8 wave calendar, forms per wave, bulk reminders, schools.)
- [x] Start a session: checks (wave open, child grade, link if educator), **snapshots** of grade, region and school. (Plus a live data-processing consent — note M4-c.)
- [x] Bundle endpoint (no keys for monitoring), signed media URLs. (`GET /sessions/:id/bundle`; no slot roles either — note M4-d.)
- [x] Kid mode UI: ready → test (navigator, flag, skip) → review → done; offline buffer; retrying sync; idempotent ingest. (`/play/[sessionId]`; note M4-a.)
- [x] Submit; the session status machine; expire unsubmitted sessions when the wave closes. (Note M4-b.)
- [x] **DoD:** `scripts/session-flows.sh` — 58 checks, all passing; permission matrix 57 pass, 0 fail, 0 pending for M4 (34 pending, all M5–M9); earlier suites green.

#### Notes on M4 — deviations and decisions

**M4-a. Answers in flight are not responses** (decided with the product
owner). `response` is append-only (INV-07) and unique per item, yet design/05
lets a child change answers until they submit and promises "all answers sent"
while they work. So `POST /sessions/:id/responses` writes a mutable working
set, `session_answer` (migration 008): for each item the answer with the newest
`client_recorded_at` wins, so a late replay of an old batch never undoes a later
change, and replays are harmless. `submit` writes exactly one `response` per
form item — the final answer, or NULL for skipped and unopened items — in one
transaction with `ON CONFLICT DO NOTHING`; a repeated submit changes nothing.
The raw layer only ever receives final answers. § 6.1's description of
`/responses` ("idempotent on (session_id, item_version_id)") holds for the
working set.

**M4-b. The status machine.** A session gets a `deadline_at`: the form's time
limit from the start, or the wave's close, whichever is first. A device may
still deliver answers recorded before the deadline for 10 minutes after it.
The job (every minute): sessions past deadline + grace are SUBMITTED with what
was saved (the time is up, the answers count); when a wave closes, sessions
still open are EXPIRED (§ 12 M4) and the wave gets `closed_at` — M5's run
follows from there. The same job sends `wave_open` once per wave and child.
`POST /api/dev/tick` runs it on demand in development.

**M4-c. No consent, no session.** Note M2-e made data processing
withdrawable; starting or resuming a session now requires a live
`data_processing` consent (`CONSENT_REQUIRED`), and so does submitting: a
consent withdrawn mid-test means nothing reaches the raw layer — no submit, no
auto-submit at the deadline; the session expires with the wave unless consent
comes back. Reminders and `wave_open` skip children without it.

**M4-d. The bundle hides the roles, not only the keys.** Kid mode gets stems,
options and signed media URLs — no key, no rationale, no misconception, and no
slot role or anchor flag either: telling a device which items are anchors would
leak them as surely as the key (INV-08's reason). Media URLs live until the
session's deadline; the player downloads them before the start.

**M4-e. Who launches where.** Guardians (owner and co-guardian, § 3) start a
session at home through `POST /family/children/:id/sessions`; an educator uses
`POST /educator/children/:id/sessions`, which resolves only through an ACTIVE
link (INV-15) — the educator UI is M6. Starting twice resumes the same session
(one per child per wave). The proctor path is M7. Practice sessions start from
assignments in M6; the player and `/result` already handle practice (solved
count only).

**M4-f. Waves.** `POST /staff/waves` sets wave N of a grade: it creates the
wave or moves it while it is upcoming; once open, only its close may move, and
only later. Windows of one grade never overlap and a wave takes only a frozen
monitoring form of its grade (INV-14 — the schema's refusals become named
errors). Bulk reminders go to owners only, at most one per wave per child per
day (§ 10's throttle key).

**M4-h. The clock starts when the child presses Start** (design/05). The
parent's "Start wave" opens the session without a deadline; the child's Start
calls `POST /sessions/:id/begin`, which sets the deadline once (idempotent — a
retry cannot extend it). A session never begun is not auto-submitted; it
expires with the wave. Offline at Start, the device counts from its own Start,
never past the wave's close.

**M4-i. The middleware no longer gates workspaces on the token's `ws` claim.**
The claim is a snapshot up to 15 minutes old; when it disagreed with the live
relationships it looped forever — a parent whose token predated their first
child went /family → /dashboard → /family … (found while testing kid mode).
Every workspace layout already checks `/api/me` on each request, and the API
authorises every call, so the middleware only redirects signed-out people.

**M4-g. Matrix harness.** A cell may name business refusals that can only
happen after authorisation passed (`passedPolicy`): "the owner may launch" is
still proven when the answer is `WAVE_TAKEN` because the child already took it.

### M5 — Measurement v0 & parent reports (Release 1) — Done
- [x] Job: `raw_band_v0` calibration run per wave close → `percentile_band`, `skill_state`. (Plus `scale_score`, `item_statistic` and `child_wave_summary` — notes M5-a, M5-c, M5-d.)
- [x] Parent report 3–4 (band, trend with the next wave as an empty column, "the 5 in eMaktab" block, clusters, misconception pattern, one action, Plan B, who can see, practice count). (`GET /family/children/:id/report`, on `/family/children/[id]`.)
- [x] Parent report 0–2 (skills, new since, one action, refusal to forecast). (Note M5-b.)
- [x] Cohort minimum (n ≥ 30) handling; "report ready" notification.
- [x] **DoD:** `scripts/report-flows.sh` — 33–34 checks (one only on a fresh database); `scripts/measurement-unit.sh` — 8 unit tests of the arithmetic; permission matrix 65 pass, 0 fail, 0 pending for M5 (26 pending, all M6–M9); earlier suites green.

#### Notes on M5 — deviations and decisions

**M5-a. One run per season × grade, recomputing every closed wave.** A wave
close triggers a `raw_band_v0` run for its grade; the run measures ALL closed
waves of that grade this season and becomes current in the same transaction
(INV-13). One run therefore holds the whole trend a report draws, a re-run
never mixes rows from different runs, and switching `is_current` (the bank
editor can switch back) changes what every report reads at once. Derived rows
are only inserted (INV-12); old runs stay as they were.

**M5-b. The v0 arithmetic, made concrete.** Score = correct scored items
(pretest excluded); only submitted monitoring sessions (practice and olympiad
never enter the scale). SEM = SD·√(1 − KR-20) per wave form; when reliability
cannot be estimated, the binomial error √(k·p̄·(1 − p̄)) — wider, never falsely
precise — and never below one raw point. The band = mid-rank percentile of
score − SEM … score + SEM within region × grade × season (the session's
snapshotted region), clamped 1–100; below 30 children the row is written with
no band. Reports show it from the strong end, "top {100 − high}–{100 − low}%".
Skill states (grades 0–2): ≥ 2 correct on a skill in a wave makes a candidate,
which is EMERGING until a later wave confirms it with ≥ 2 again → SECURE;
some correct → emerging; none → not yet. A secure skill stays secure while the
child keeps answering it correctly. These rules live in
`measurement/measurement.math.ts` with unit tests.

**M5-c. Two derived facts the schema lacked** (migration 009). design/03's
"A strength / In line / Most points lost" and "She stops after the first
step" need a cluster standing and a misconception pattern per child and wave:
`child_wave_summary`, append-only, keyed by run. The standing compares a
cluster with the child's OWN overall result (±15 points), so it means the same
in a cohort of 12 or 1,200 and never exposes another child. The pattern is the
misconception picked most often (at least twice) on scored items; "across the
season" is the code seen in the most waves (≥ 2).

**M5-d. Item statistics come from the same run.** p, point-biserial against
the rest score, distractor share by option position (zeros included — that is
the "dead distractor" flag), a v0 logit difficulty, and DIF uz/ru when both
language groups have ≥ 20 answers. For DIF the session now records the
language the child answered in (`session.test_language`, set at Start).

**M5-e. The report reads, never measures.** `GET /family/children/:id/report`
reads the current run's derived rows and relationships only. `parent_report`
scope: guardians, and an educator for their own child only (§ 3). It carries
no score, no other child, no probability; grades 0–2 carry no band, no cohort
and an explicit `forecast: null`. The "ticket" line counts waves taken (≥ 3 for
the spring final — the olympiad itself is M7). Re-runs never re-announce:
`report_ready` goes once per wave, child and guardian.

**M5-f. Calibration staff API.** `POST /staff/calibration-runs` re-runs v0
(one grade, or every grade with a closed wave); `rasch_anchor_equating_v1`
answers `METHOD_NOT_AVAILABLE` until M9. `POST /staff/calibration-runs/:id/current`
switches the current run.

**M5-h. Item statistics read the current season's current run.** M3's
lookups took the newest `is_current` run of ANY season; with a second season's
run (a test season, or simply last season) newer than this season's, the item
bank and the form builder read the wrong statistics — the anchor-spread rule
then failed intermittently (found by the full suite in M5). The current season's
current run now always wins; older seasons are a fallback only.

**M5-g. Development fixture.** `POST /api/dev/seed-results` (also in
`seed.sh`) gives grade 4 three closed waves — Madina plus 40 synthetic
"Kohort" children answering from a simple ability model — and grade 1 a picture
+ audio form with Temur's three waves, then runs the real wave and measurement
jobs over them. `POST /api/dev/tick` now runs both jobs.

### M6 — Educator workspace (Release 2)
- [ ] Educator application + trust & safety approval; staff invite of pre-approved educators.
- [ ] Bulk phone invites (SMS with public code), invite landing `/invite/[code]`, status list, reminders.
- [ ] PINFL + surname match-check with limits and logging; access requests (14-day TTL, one live per pair).
- [ ] Groups; group overview (gain sort, common misconceptions, not taken + remind parents); pupil detail.
- [ ] Practice builder (from misconception / topic), assignments, results (solved count), repeat; the parent sees the practice **count only**.
- [ ] "My children" view; `is_own_child` auto-set; excluded from statistics and bonus.

### M7 — Olympiad (Release 2)
- [ ] Olympiad admin: stages, regions, grades (`is_ranked=false` for 0–2), venues, capacity.
- [ ] Parent registration; monitoring ticket (≥ 3 waves); deep-link source attribution (`/o/[slug]?src=`).
- [ ] Online stage (kid mode, data excluded from the scale); response-time cheating signal.
- [ ] Proctor console: roster, check-in, accompanying-adult check, offline runner package + sync upload.
- [ ] Results: regional ranking (grades ≥ 3), certificates (top 15%), diagnostic reports, awards, teacher bonus (proctored stages only), season cup (gain).

### M8 — Trust & safety (Release 2)
- [ ] Fraud rules job → `registration_flag` (the 4 rules in section 8.5) with evidence JSON.
- [ ] Cases queue UI: flags, disputes, 5th child, educator applications; assignment; resolutions.
- [ ] "Suspend links + ask owners to confirm" flow with notifications and owner responses.
- [ ] Ownership dispute procedure (both parties notified, evidence, keep or transfer owner).

### M9 — Measurement v1, outcomes, admin
- [ ] Rasch + anchor equating worker (`rasch_anchor_equating_v1`), item statistics (p, point-biserial, distractor share, DIF uz/ru), compare runs, switch current.
- [ ] Inflation adjustment from the in-person final.
- [ ] Admission outcomes import + matching (July 2027).
- [ ] Support lookup, staff roles management, audit viewer.

---

## 13. Do **not** build (season one)

Forum or chats, a public ratings feed, gamification badges, video lessons, a tutor marketplace, native mobile apps, a visual (WYSIWYG) item editor, partner organiser accounts, payments (unless explicitly requested).

## 14. Open questions (ask the product owner before implementing)

1. Payment and subscription model: which milestone, and what is paid?
2. SMS provider for invites (Eskiz / Playmobile?) and the fallback for parents without Telegram.
3. OneID / state family-composition integration: when?
4. Karakalpak (`kaa`) content: season two?
5. Should educators see a child's percentile with explicit parent opt-in, or never (the current rule is never, except their own child)?
6. Exact certificate threshold per olympiad (default top 15%) and the prize policy for minors (legal/tax).
7. **PINFL check digit** — is there an official, documented modulo we may rely on? Until there is, `PinflService` validates structure and the embedded date of birth only (note M1-c). A guessed checksum that rejects a real PINFL is far worse than accepting a malformed one, which the `pinfl_hash` unique index catches anyway.
8. **A parent who also co-guards, tutors or works at Zinapo** cannot add their own child today (note M2-c: only an owner or a person with no role may create one, read literally from § 3). Should "create a child" be open to every signed-in adult — they become that child's owner — with the matrix rows reworded to "not *as* a co-guardian / educator / staff member"?
8. **`docs/strategy.md`** is referenced by § 0 but absent from the repo. Nothing in M1 needed it; the parent-report copy in M5 will.