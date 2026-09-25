#!/usr/bin/env bash
#
# Post-deploy login canary. Drives the real NextAuth credentials path
# against prod as far as the OTP step — WITHOUT ever completing a login — to
# prove the auth route + DB + bcrypt + AUTH_SECRET/hashOtp + OTP-send path all
# execute. A plain /api/health ping and the UptimeRobot root/health monitors
# can't catch this: the 2026-06-06 AUTH_SECRET incident broke every
# login while both root and /api/health stayed green (login page renders, DB
# ping passes; only POST credentials failed).
#
# Flow: GET /api/auth/csrf -> POST /api/auth/callback/credentials (password
# mode). A valid email+password stops in authorizeCredentials() at
# `throw new OtpSent()` (src/auth.ts) BEFORE any session cookie is issued, so
# the canary can never actually authenticate.
#
# Env:
#   BASE_URL         prod origin, e.g. https://crm.example.org
#   CANARY_EMAIL     dedicated low-priv (VIEWER) canary user
#   CANARY_PASSWORD  its password
#
# Exit 0 iff the auth path returns code=OtpSent or code=OtpCooldown (both prove
# the path ran; cooldown means an OTP was already issued < 30s ago). Any other
# code, HTTP error, or missing token -> non-zero.
set -euo pipefail

: "${BASE_URL:?BASE_URL not set}"
: "${CANARY_EMAIL:?CANARY_EMAIL not set}"
: "${CANARY_PASSWORD:?CANARY_PASSWORD not set}"

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

# 1. CSRF token (+ __Host-authjs.csrf-token cookie into the jar).
csrf_json="$(curl -fsS --max-time 20 -c "$JAR" "$BASE_URL/api/auth/csrf")"
csrf="$(printf '%s' "$csrf_json" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"
if [ -z "$csrf" ]; then
  echo "CANARY FAIL: no csrfToken from $BASE_URL/api/auth/csrf" >&2
  exit 1
fi

# 2. POST credentials. X-Auth-Return-Redirect makes Auth.js reply with a JSON
#    {url} carrying ?code=... instead of a 302 (same as next-auth/react signIn
#    with redirect:false). Password is passed via --data-urlencode from an env
#    var, so it never appears in argv / process list.
resp="$(curl -fsS --max-time 20 -b "$JAR" -c "$JAR" \
  -H "X-Auth-Return-Redirect: 1" \
  --data-urlencode "csrfToken=$csrf" \
  --data-urlencode "email=$CANARY_EMAIL" \
  --data-urlencode "password=$CANARY_PASSWORD" \
  --data-urlencode "mode=password" \
  --data-urlencode "callbackUrl=$BASE_URL" \
  "$BASE_URL/api/auth/callback/credentials")"

code="$(printf '%s' "$resp" | sed -n 's/.*[?&]code=\([A-Za-z]*\).*/\1/p')"

case "$code" in
  OtpSent|OtpCooldown)
    echo "CANARY OK: auth path reached OTP step (code=$code)"
    exit 0
    ;;
  *)
    # Never echo $resp raw — it may contain the callbackUrl but not secrets;
    # still, keep output to the parsed code only.
    echo "CANARY FAIL: expected code=OtpSent, got code='${code:-<none>}'" >&2
    exit 1
    ;;
esac
