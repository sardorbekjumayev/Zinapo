# Zinapo

A measurement platform for families in Uzbekistan: it follows a child from
grade 0 to grade 4 and tells the parent, honestly, where that child stands among
the children preparing for grade-5 entry to Presidential and specialised schools.

Next.js (App Router) · NestJS · PostgreSQL · Redis · Telegram Bot API, all
isolated in Docker. The build plan is [`task.md`](./task.md); the data model and
its invariants are [`docs/schema.sql`](./docs/schema.sql); the visual source of
truth is [`design/`](./design/index.html).

**Where the build is.** M0 (Telegram sign-in) and M1 (the roles foundation) are
done — see `task.md` § 12 for what each milestone covers and the notes under M1
for the decisions taken along the way. M2–M9 are not built; every route they own
exists in the shell and renders a screen naming the milestone it waits for.

```
.
├── apps/
│   ├── api/          NestJS — auth, authz (policies + guards), /me, identity
│   └── web/          Next.js — sign-in, dashboard router, workspace shells
├── db/
│   ├── init/         schema + migrations, applied in order on first boot
│   └── test/         one assertion per invariant in docs/schema.sql
├── design/           the 15 design boards, unpacked from Zinapo.html
│                     → open design/index.html for the contact sheet
├── docs/
│   ├── schema.sql    the core data model (symlink to db/init/003_core_schema.sql)
│   └── sign-in-spec.md
├── scripts/
│   ├── migrate.sh            apply pending migrations to an existing volume
│   ├── seed.sh               load the development fixture, print the logins
│   ├── db-test.sh            the invariant suite
│   ├── acceptance.sh         the sign-in checklist (sign-in spec § 11)
│   ├── permission-matrix.sh  one check per cell of task.md § 3
│   ├── routing.sh            the dashboard router and workspace gate
│   ├── family-flows.sh       every M2 family & identity flow, end to end
│   ├── bank-flows.sh         every M3 item bank & form flow, incl. the INV-08 test
│   ├── session-flows.sh      every M4 session flow: start, bundle, sync, submit, the wave job
│   ├── dev-login.mjs         print session cookies for a phone (dev only)
│   └── dev-code.sh           prints the sign-in code when there is no bot token
├── task.md                   the master build plan, milestone by milestone
├── docker-compose.yml        development (hot reload)
└── docker-compose.prod.yml   production overlay
```

## Run it

```bash
cp .env.example .env     # then fill in the secrets — see "Environment" below
docker compose up --build
```

- Site — http://localhost:3000 (redirects to `/uz/sign-in`)
- API — http://localhost:4000/api/health
- Postgres — `localhost:15432`, Redis — `localhost:16379`

The non-standard host ports keep a locally installed Postgres/Redis working;
inside the compose network the services still use 5432 and 6379. Override with
`DB_HOST_PORT` / `REDIS_HOST_PORT`.

### Without a bot token

`TELEGRAM_BOT_TOKEN` may be left empty. The bot then stays off and the API
exposes a development-only stand-in that drives the *same* handlers the webhook
uses, so the whole flow works in the browser:

1. Open http://localhost:3000, type a number, press **Kodni yuborish**.
2. In a terminal, stand in for Telegram:

   ```bash
   ./scripts/dev-code.sh +998901234567
   #   bot: Zinapoʻga kirish uchun telefon raqamingizni yuboring.
   #   bot: Kirish kodi: *48603*. 2 daqiqa amal qiladi. …
   #
   #   KOD: 48603
   ```

3. Type that code on the site — it auto-submits and lands on `/dashboard`.

Driving it entirely from curl works too, when you have the deep link:

```bash
curl -H 'Content-Type: application/json' \
  -d '{"link":"<deepLink>","phone":"+998903124567"}' \
  http://localhost:3000/api/dev/telegram/simulate
```

`POST /api/dev/telegram/{simulate,share-contact,new-code,not-me}` return 404
when `NODE_ENV=production`, and the module is not even registered there.

### With a real bot

1. Create a bot with [@BotFather](https://t.me/BotFather), put the token in
   `TELEGRAM_BOT_TOKEN` and the handle in `TELEGRAM_BOT_USERNAME`.
2. Leave `TELEGRAM_WEBHOOK_URL` empty for local work — the bot falls back to
   long polling, no public HTTPS needed.
3. In production set `TELEGRAM_WEBHOOK_URL=https://<host>/api/telegram/webhook`
   and a 32+ character `TELEGRAM_WEBHOOK_SECRET`. The bot registers the webhook
   itself on boot and rejects any update whose
   `X-Telegram-Bot-Api-Secret-Token` header doesn't match.

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Builds the `prod` stage of each image (compiled output only, non-root user), drops
the bind mounts and the published database ports, and sets `COOKIE_SECURE=true`.
Terminate TLS in front of `web` — the session cookies are `Secure` there.

## Roles, and trying them out

Roles are **relationships, not person types** — there is one `person` table and
no `person.role` (INV-01). A tutor who is also a parent is one person holding two
relationships, and the header shows a workspace switcher. `GET /api/me` derives
the workspaces at request time; `/dashboard` reads it and redirects.

Load the development fixture and it prints a number per role:

```bash
./scripts/seed.sh
#   owner              +998901110001   owns Madina (grade 4) and Temur (grade 1)
#   coGuardian         +998901110002   co-guardian of both children, view only
#   educator           +998901110003   approved tutor, public code AZR-4821
#   educatorParent     +998901110004   approved tutor AND owner of her own child
#   bank_editor        +998901110013   staff role: bank_editor
#   …one person per staff role, plus one holding two
```

Sign in with any of them at http://localhost:3000. Without a bot token, get the
code with `./scripts/dev-code.sh +998901110001`.

The fixture goes through the real services, so seeded children carry real PINFL
hashes and every invariant applies to them. It is idempotent.

## Checking it works

```bash
./scripts/db-test.sh            # 39 checks — one per invariant in docs/schema.sql, plus M2's and M3's
./scripts/acceptance.sh         # 45 checks — the sign-in spec § 11
./scripts/routing.sh            # 24 checks — the dashboard router and workspace gate
./scripts/permission-matrix.sh  # one check per cell of task.md § 3
./scripts/family-flows.sh       # 75 checks — add child, invites, transfer, access, consents, deletion
./scripts/bank-flows.sh         # 60 checks — taxonomy, item card, blind review, media, forms, INV-08
./scripts/session-flows.sh      # 58 checks — waves admin, start, bundle, answers, submit, the wave job
(cd apps/api && npm run lint)   # tsc --noEmit
(cd apps/web && npm run lint)
```

`permission-matrix.sh` reports three outcomes, and the difference matters:
**PASS** the cell behaves as § 3 says · **FAIL** someone can do something they
must not, or cannot do something they must · **PENDING** the route belongs to a
milestone that is not built yet. A pending row is never counted as a pass, and
the run prints the breakdown per milestone — so the number shrinks as the
milestones land:

```
16 passed · 0 failed · 72 pending (route not built yet)
pending by milestone: M2=22 M3=9 M4=7 M5=8 M6=11 M7=5 M8=2 M9=8
```

All four suites talk to the running stack and clear rate-limit counters as they
go, so treat them as development tools rather than something to point at
production.

## Migrations

`db/init` is only read by Postgres on an **empty** data directory, so a database
created before a migration was written never sees it:

```bash
./scripts/migrate.sh --status   # list applied / pending
./scripts/migrate.sh            # apply what is missing
```

One transaction per file, tracked in `schema_migration`, with 001/002 baselined
for a volume the entrypoint already built.

## How the flow works

`docs/sign-in-spec.md` § 1 has the full sequence diagram. In short:

1. `POST /api/auth/telegram/start` creates a login request in Redis (TTL 10 min),
   returns a one-time deep link, and sets the `zn_login` cookie.
2. The user opens `t.me/<bot>?start=<token>`; the bot asks for their contact.
3. The bot checks the contact is the sender's own and the number matches, then
   issues a 5-digit code valid for 120 s.
4. The site polls `GET /api/auth/telegram/status`, shows the code boxes, and
   posts to `POST /api/auth/telegram/verify`, which sets `zn_at` / `zn_rt` and
   sends the user to `/dashboard`.

### Where things live

| Concern | File |
|---|---|
| Redis state machine, Lua scripts | `apps/api/src/auth/login-request.service.ts` |
| Code generation + HMAC compare | `apps/api/src/auth/otp.service.ts` |
| JWT, refresh rotation, person upsert | `apps/api/src/auth/session.service.ts` |
| Routes and error mapping | `apps/api/src/auth/auth.controller.ts` |
| Bot decisions (webhook *and* dev) | `apps/api/src/telegram/telegram-flow.service.ts` |
| Telegraf wiring, webhook auth | `apps/api/src/telegram/telegram.{service,controller}.ts` |
| Sign-in steps | `apps/web/components/auth/SignInCard.tsx` |
| Status polling (2 s → 5 s) | `apps/web/hooks/useLoginStatus.ts` |
| Locale prefixes, auth + workspace redirects | `apps/web/middleware.ts` |
| Lumen design tokens, light + dark | `apps/web/styles/globals.css` |
| Workspace shell (rail, header, switcher) | `apps/web/styles/shell.css`, `apps/web/components/shell/` |
| Actor, policies, guards | `apps/api/src/authz/` |
| Role → permission map | `apps/api/src/authz/staff-permissions.ts` |
| Child access, by SQL | `apps/api/src/authz/policies/child.policy.ts` |
| PINFL hashing and sealing (INV-06) | `apps/api/src/identity/pinfl.service.ts` |
| Workspaces and `/me` | `apps/api/src/me/me.service.ts` |
| The dashboard router | `apps/web/app/[locale]/(app)/dashboard/page.tsx` |
| Nav rail per workspace | `apps/web/components/shell/nav-items.ts` |
| Development fixture | `apps/api/src/dev/seed.service.ts` |

## Environment

See `.env.example`. The secrets that must be set for production:

| Variable | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from @BotFather; empty disables the bot |
| `TELEGRAM_BOT_USERNAME` | used to build the deep link |
| `TELEGRAM_WEBHOOK_URL` | empty → long polling |
| `TELEGRAM_WEBHOOK_SECRET` | 32+ random chars |
| `OTP_HMAC_SECRET` | 32+ random bytes; rotating it invalidates live codes |
| `JWT_ACCESS_SECRET` | 32+ random bytes |
| `PINFL_HASH_SALT` | 32+ random bytes; keys the PINFL lookup hash. Rotating it invalidates every stored `pinfl_hash` |
| `PINFL_ENC_KEY` | 32+ random bytes, **separate** from the salt and from the DB credentials; decrypts a PINFL for admission matching only |
| `DATABASE_URL`, `REDIS_URL` | keep both inside Uzbekistan (`docs/sign-in-spec.md` § 10) |
| `COOKIE_SECURE` | `true` in production |

## Notes on the implementation

A few places where this deviates from, or sharpens, the spec — all deliberate:

- **The mock says SMS, the spec says Telegram.** `sign_in.png` reads
  *"raqamingizga SMS orqali kod yuboramiz"*, but `docs/sign-in-spec.md` specifies the
  Telegram-contact flow. The spec wins; that one line of copy now says Telegram.
  Everything else follows the mock.
- **Telegraf directly, not `nestjs-telegraf`.** The spec suggests the Nest
  wrapper; using Telegraf directly avoids a peer-dependency pin against Nest 11
  and keeps the webhook secret check in our own controller. The handler
  structure (`@Start`, `on('contact')`, `new_code` / `not_me`) is unchanged.
- **Long polling restarts itself.** Telegraf retries network errors, 429 and 5xx
  inside its own loop, but a 409 (`terminated by other getUpdates request` — two
  instances, or a redeploy overlapping the old one) escapes `launch()`.
  Unhandled, that rejection takes the whole API process down with it;
  `telegram.service.ts` catches it and restarts polling with exponential backoff
  (1s → 60s). A 401 is treated as fatal for the bot only: the token is wrong, so
  it logs and stays off while the API keeps serving.
- **Bot logic is separated from Telegraf.** `telegram-flow.service.ts` holds
  every decision; `telegram.service.ts` only translates `ctx` into calls. That
  is what lets the dev simulator exercise the real code paths.
- **A small i18n layer instead of `next-intl`.** `lib/i18n.ts` plus
  `messages/{uz,ru,en}.json` covers what this page needs without a second
  middleware to compose with the auth redirects. Message keys match § 9.
- **Timing-safe compare, done atomically.** Redis has no HMAC, so `verifyBegin`
  counts the attempt in Lua and *then* returns the stored digest; Node does the
  `timingSafeEqual`. Aborting after the Lua call still burns the attempt.
- **Fonts.** The mock uses a rounded sans. The CSS asks for `Nunito` first and
  falls back to the system rounded stack, so no network fetch happens at build
  time. To match the mock exactly, add `next/font/google` for Nunito in
  `app/layout.tsx`.
- **The invite banner** from the mock renders when the user arrives with
  `?invite=<name>&code=<code>`. Invites themselves are not part of this slice.

## Still open

- **M2–M9** — see `task.md` § 12. The routes exist and say which milestone they
  wait for; `./scripts/permission-matrix.sh` prints how many cells each one owes.
- **The open questions in `task.md` § 14** need the product owner, in particular
  the PINFL check digit (question 7) and the missing `docs/strategy.md`
  (question 8).
- From `docs/sign-in-spec.md` § 12: SMS fallback for parents without Telegram,
  and the Telegram Login Widget for returning users.
