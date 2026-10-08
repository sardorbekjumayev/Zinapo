#!/usr/bin/env bash
# Drives the acceptance checklist from signin.md § 11 through the Next.js
# rewrite, exactly like a browser would.
API=http://localhost:3000
PASS=0; FAIL=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC="docker compose --project-directory $ROOT -f $ROOT/docker-compose.yml"
# Fresh numbers each run, so re-runs don't collide with persisted person rows.
SUF=$(printf '%04d' $((RANDOM % 10000)))

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1  (got: $2)"; FAIL=$((FAIL+1)); }
check(){ [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2"; }

flush() { $DC exec -T redis redis-cli --scan --pattern 'rl:*' \
          | xargs -r $DC exec -T redis redis-cli del >/dev/null; }

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))"; }

start() { # $1 jar, $2 phone
  flush
  curl -s -c "$1" -b "$1" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$2\",\"lang\":\"uz\"}" $API/api/auth/telegram/start
}

sim() { # $1 link, $2 phone, [$3 contactUserId] [$4 tgUserId]
  curl -s -H 'Content-Type: application/json' \
    -d "{\"link\":\"$1\",\"phone\":\"$2\",\"contactUserId\":${3:-null},\"tgUserId\":${4:-null},\"firstName\":\"Aziza\",\"lastName\":\"Rahimova\"}" \
    $API/api/dev/telegram/simulate
}

code_from() { python3 -c 'import sys,json,re;t="".join(r["text"] for r in json.load(sys.stdin)["replies"]);m=re.search(r"\*(\d{5})\*",t);print(m.group(1) if m else "")'; }

verify_code() { # $1 jar, $2 rid, $3 code -> prints http status
  curl -s -b "$1" -c "$1" -o /tmp/vbody.json -w '%{http_code}' -H 'Content-Type: application/json' \
    -d "{\"requestId\":\"$2\",\"code\":\"$3\"}" $API/api/auth/telegram/verify
}

echo "=== A. server-side phone validation ==="
flush
HTTP=$(curl -s -o /tmp/b.json -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"phone":"+99812345","lang":"uz"}' $API/api/auth/telegram/start)
check "short number rejected 400" "$HTTP" "400"
check "  error=PHONE_INVALID" "$(jget error </tmp/b.json)" "PHONE_INVALID"

echo
echo "=== B. deep link is unique per request ==="
P=+99890${SUF}001
L1=$(start j1.txt $P | jget deepLink)
L2=$(start j1b.txt $P | jget deepLink)
[ "$L1" != "$L2" ] && ok "two starts -> two different tokens" || bad "token uniqueness" "same"

echo
echo "=== C. token bound to one Telegram account ==="
P=+99890${SUF}002
S=$(start j2.txt $P); L=$(echo "$S" | jget deepLink)
sim "$L" "$P" 11 11 >/dev/null
R=$(sim "$L" "$P" 22 22 | python3 -c 'import sys,json;print(json.load(sys.stdin)["replies"][0]["text"])')
[ "${R:0:17}" = "Bu havola boshqa " ] && ok "second Telegram account rejected" || bad "token re-use" "$R"

echo
echo "=== D. foreign / forwarded contact rejected ==="
P=+99890${SUF}003
S=$(start j3.txt $P); L=$(echo "$S" | jget deepLink)
R=$(sim "$L" "$P" 999 31 | python3 -c 'import sys,json;print(json.load(sys.stdin)["replies"][-1]["text"])')
[ "${R:0:8}" = "Iltimos," ] && ok "contact.user_id != from.id rejected" || bad "foreign contact" "$R"

echo
echo "=== E. phone mismatch, no code issued ==="
P=+99890${SUF}004
S=$(start j4.txt $P); RID=$(echo "$S" | jget requestId); L=$(echo "$S" | jget deepLink)
C=$(sim "$L" "+998905555555" 41 41 | code_from)
ST=$(curl -s -b j4.txt "$API/api/auth/telegram/status?requestId=$RID")
check "status = PHONE_MISMATCH" "$(echo "$ST" | jget status)" "PHONE_MISMATCH"
check "  terminal" "$(echo "$ST" | jget terminal)" "True"
[ -z "$C" ] && ok "  no code issued" || bad "code leaked on mismatch" "$C"

echo
echo "=== F. code is 5 digits, 120 s TTL ==="
P=+99890${SUF}005
S=$(start j5.txt $P); RID=$(echo "$S" | jget requestId); L=$(echo "$S" | jget deepLink)
C=$(sim "$L" "$P" 51 51 | code_from)
echo "$C" | grep -qE '^[0-9]{5}$' && ok "code is 5 digits" || bad "code format" "$C"
ST=$(curl -s -b j5.txt "$API/api/auth/telegram/status?requestId=$RID")
check "status = CODE_SENT" "$(echo "$ST" | jget status)" "CODE_SENT"
TTL=$(python3 -c "
import datetime,sys
exp=datetime.datetime.fromisoformat('$(echo "$ST" | jget codeExpiresAt)'.replace('Z','+00:00'))
now=datetime.datetime.now(datetime.timezone.utc)
print(round((exp-now).total_seconds()))")
[ "$TTL" -ge 115 ] && [ "$TTL" -le 120 ] && ok "codeExpiresAt ~120 s (${TTL}s)" || bad "code TTL" "${TTL}s"

echo
echo "=== G. verify without zn_login cookie ==="
HTTP=$(curl -s -o /tmp/b.json -w '%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"requestId\":\"$RID\",\"code\":\"$C\"}" $API/api/auth/telegram/verify)
check "no cookie -> 401" "$HTTP" "401"
check "  error=BROWSER_MISMATCH" "$(jget error </tmp/b.json)" "BROWSER_MISMATCH"

echo
echo "=== H. 5 wrong attempts -> LOCKED ==="
BAD=$([ "$C" = "00000" ] && echo 11111 || echo 00000)
for n in 4 3 2 1; do
  H=$(verify_code j5.txt "$RID" "$BAD")
  A=$(jget attemptsLeft </tmp/vbody.json)
  check "wrong attempt -> 400, attemptsLeft=$n" "$H/$A" "400/$n"
done
H=$(verify_code j5.txt "$RID" "$BAD")
check "5th wrong attempt -> 423" "$H" "423"
check "  error=LOCKED" "$(jget error </tmp/vbody.json)" "LOCKED"
H=$(verify_code j5.txt "$RID" "$C")
check "correct code after lock -> 423" "$H" "423"

echo
echo "=== I. max 3 codes per request + 30 s cooldown ==="
P=+99890${SUF}006
S=$(start j6.txt $P); L=$(echo "$S" | jget deepLink)
sim "$L" "$P" 61 61 >/dev/null
R=$(curl -s -H 'Content-Type: application/json' -d '{"tgUserId":61}' $API/api/dev/telegram/new-code \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["replies"][0]["text"])')
[ "${R:0:11}" = "Yangi kodni" ] && ok "30 s cooldown enforced: $R" || bad "cooldown" "$R"

echo
echo "=== J. start rate limit: 3 per phone / 10 min ==="
P=+99890${SUF}007
flush
for i in 1 2 3; do curl -s -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$P\",\"lang\":\"uz\"}" $API/api/auth/telegram/start; done
HTTP=$(curl -s -o /tmp/b.json -w '%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$P\",\"lang\":\"uz\"}" $API/api/auth/telegram/start)
check "4th start -> 429" "$HTTP" "429"
check "  error=RATE_LIMITED" "$(jget error </tmp/b.json)" "RATE_LIMITED"
R=$(jget retryAfter </tmp/b.json); [ -n "$R" ] && ok "  retryAfter=$R" || bad "retryAfter missing" ""

echo
echo "=== K. 'Bu men emasman' cancels the request ==="
P=+99890${SUF}008
S=$(start j8.txt $P); RID=$(echo "$S" | jget requestId); L=$(echo "$S" | jget deepLink)
sim "$L" "$P" 81 81 >/dev/null
curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"tgUserId":81}' $API/api/dev/telegram/not-me
ST=$(curl -s -b j8.txt "$API/api/auth/telegram/status?requestId=$RID")
check "status = CANCELLED" "$(echo "$ST" | jget status)" "CANCELLED"

echo
echo "=== L. happy path + session + refresh + logout ==="
P=+99890${SUF}009
S=$(start j9.txt $P); RID=$(echo "$S" | jget requestId); L=$(echo "$S" | jget deepLink)
C=$(sim "$L" "$P" 91 91 | code_from)
H=$(verify_code j9.txt "$RID" "$C")
check "verify -> 200" "$H" "200"
check "  next=/dashboard" "$(jget next </tmp/vbody.json)" "/dashboard"
check "  isNewUser=True" "$(jget isNewUser </tmp/vbody.json)" "True"
grep -q zn_at j9.txt && ok "  zn_at set" || bad "zn_at" "missing"
grep -q zn_rt j9.txt && ok "  zn_rt set" || bad "zn_rt" "missing"
grep -q "zn_login" j9.txt && bad "zn_login cleared" "still present" || ok "  zn_login cleared"
ME=$(curl -s -b j9.txt $API/api/auth/me | jget fullName)
check "/me returns Telegram name" "$ME" "Aziza Rahimova"
H=$(curl -s -o /dev/null -w '%{http_code}' -b j9.txt -c j9.txt -X POST $API/api/auth/refresh)
check "refresh -> 200" "$H" "200"
H=$(curl -s -o /dev/null -w '%{http_code}' -b j9.txt -c j9.txt -X POST $API/api/auth/refresh)
check "rotated refresh still works" "$H" "200"
curl -s -o /dev/null -b j9.txt -c j9out.txt -X POST $API/api/auth/logout
H=$(curl -s -o /dev/null -w '%{http_code}' -b j9out.txt $API/api/auth/me)
check "after logout /me -> 401" "$H" "401"

echo
echo "=== M. refresh-token rotation is single use ==="
P=+99890${SUF}010
S=$(start ja.txt $P); RID=$(echo "$S" | jget requestId); L=$(echo "$S" | jget deepLink)
C=$(sim "$L" "$P" 101 101 | code_from)
verify_code ja.txt "$RID" "$C" >/dev/null
OLD=$(grep zn_rt ja.txt | awk '{print $NF}')
curl -s -o /dev/null -b ja.txt -c ja.txt -X POST $API/api/auth/refresh
H=$(curl -s -o /dev/null -w '%{http_code}' -X POST --cookie "zn_rt=$OLD" $API/api/auth/refresh)
check "replaying the old refresh token -> 401" "$H" "401"

echo
echo "=== N. webhook rejects a bad secret token ==="
H=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -H 'X-Telegram-Bot-Api-Secret-Token: wrong' -d '{"update_id":1}' $API/api/telegram/webhook)
check "bad secret -> 401" "$H" "401"

echo
echo "=== O. audit trail ==="
ACTIONS=$($DC exec -T db psql -U zinapo -d zinapo -tAc \
  "SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_log")
echo "  actions written: $ACTIONS"
for a in auth.start auth.tg_linked auth.phone_mismatch auth.code_issued auth.verify_failed auth.locked auth.login; do
  echo "$ACTIONS" | grep -q "$a" && ok "  $a" || bad "  $a" "missing"
done
LEAK=$($DC exec -T db psql -U zinapo -d zinapo -tAc \
  "SELECT count(*) FROM audit_log WHERE payload::text ~ '\"code\"' OR payload::text ~ 'token\"[^H]'")
check "no codes/tokens in audit payloads" "$(echo $LEAK)" "0"

echo
echo "================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ]
