# HireGnome ATS — Security Test Plan

**Environment:** https://careers.darumatic.com  
**Last updated:** 2026-06-24  
**Scope:** Web application security — authentication, authorisation, input handling, transport, bot protection, and API surface. Does not cover infrastructure-level hardening (firewall, OS patching, SSH keys).

> **Prerequisite:** All tests should be performed against a staging/test instance unless explicitly noted as safe for production. Tests marked ⚠️ **Destructive / Rate-consuming** must not be run against production without throttle overrides in `.env`.

---

## Table of Contents

1. [Transport & TLS](#1-transport--tls)
2. [HTTP Security Headers](#2-http-security-headers)
3. [Authentication — Login](#3-authentication--login)
4. [Authentication — Session Management](#4-authentication--session-management)
5. [Authentication — Password Reset](#5-authentication--password-reset)
6. [Authorisation & Access Control](#6-authorisation--access-control)
7. [Input Validation & Injection](#7-input-validation--injection)
8. [Cross-Site Scripting (XSS)](#8-cross-site-scripting-xss)
9. [CSRF Resistance](#9-csrf-resistance)
10. [File Upload Security](#10-file-upload-security)
11. [Career Site Bot & Spam Protection](#11-career-site-bot--spam-protection)
12. [Rate Limiting — All Endpoints](#12-rate-limiting--all-endpoints)
13. [Sensitive Data Exposure](#13-sensitive-data-exposure)
14. [API Surface — Unauthenticated Endpoints](#14-api-surface--unauthenticated-endpoints)
15. [Webhook Endpoint Security](#15-webhook-endpoint-security)
16. [Client Review Portal Isolation](#16-client-review-portal-isolation)
17. [Denial-of-Service Resistance](#17-denial-of-service-resistance)
18. [Security Regression Checks](#18-security-regression-checks)

---

## 1. Transport & TLS

### SEC-TLS-01 — HTTP redirects to HTTPS
```bash
curl -sI http://careers.darumatic.com/ | grep -i "location\|http_code"
```
**Expected:** `301` or `302` redirect to `https://careers.darumatic.com/`.

---

### SEC-TLS-02 — HTTPS certificate valid and trusted
```bash
curl -sv https://careers.darumatic.com/api/health 2>&1 | grep -E "SSL|certificate|expire|issuer"
```
**Expected:** Certificate issued by Let's Encrypt / Cloudflare. No SSL errors.

---

### SEC-TLS-03 — TLS version — no TLS 1.0 or 1.1
```bash
# Requires openssl or nmap ssl-enum-ciphers
openssl s_client -connect careers.darumatic.com:443 -tls1 2>&1 | grep -E "alert|handshake"
openssl s_client -connect careers.darumatic.com:443 -tls1_1 2>&1 | grep -E "alert|handshake"
```
**Expected:** Both connections fail with "handshake failure" or "unsupported protocol". TLS 1.2+ only.

---

### SEC-TLS-04 — HSTS header present
```bash
curl -sI https://careers.darumatic.com/ | grep -i "strict-transport"
```
**Expected:** `Strict-Transport-Security: max-age=…` present (may be set by Cloudflare).  
**If missing:** Add via Cloudflare HSTS settings or Next.js custom headers in `next.config.mjs`.

---

## 2. HTTP Security Headers

### SEC-HDR-01 — X-Frame-Options or CSP frame-ancestors
```bash
curl -sI https://careers.darumatic.com/careers | grep -iE "x-frame|content-security"
```
**Expected:** Either `X-Frame-Options: DENY` (or `SAMEORIGIN`) or a `Content-Security-Policy` header with `frame-ancestors 'none'` or `frame-ancestors 'self'`.  
**Risk if missing:** Clickjacking attacks against authenticated ATS pages.

---

### SEC-HDR-02 — X-Content-Type-Options
```bash
curl -sI https://careers.darumatic.com/ | grep -i "x-content-type"
```
**Expected:** `X-Content-Type-Options: nosniff`.  
**Risk if missing:** Browser MIME-type sniffing on uploaded files.

---

### SEC-HDR-03 — Referrer-Policy
```bash
curl -sI https://careers.darumatic.com/ | grep -i "referrer-policy"
```
**Expected:** `Referrer-Policy: strict-origin-when-cross-origin` or stricter.

---

### SEC-HDR-04 — X-Powered-By suppressed or acceptable
```bash
curl -sI https://careers.darumatic.com/ | grep -i "x-powered-by"
```
**Current state:** Returns `x-powered-by: Next.js`.  
**Recommendation:** Suppress with `poweredByHeader: false` in `next.config.mjs` to avoid disclosing framework version to scanners.

---

### SEC-HDR-05 — Server header minimised
```bash
curl -sI https://careers.darumatic.com/ | grep -i "^server"
```
**Current state:** Returns `server: cloudflare` (Cloudflare strips the origin server header). Acceptable.

---

## 3. Authentication — Login

### SEC-AUTH-01 — Credentials sent over HTTPS only
**Steps:**
1. Attempt to log in via the HTTP URL
2. Confirm the request is redirected to HTTPS before credentials are submitted

**Expected:** Browser follows the 301 redirect. No credentials ever sent in plaintext.

---

### SEC-AUTH-02 — Incorrect password returns generic error
**Steps:**
1. POST to `/api/session/login` with a valid email and wrong password
2. Observe the response body

**Expected:** Generic message such as "Invalid email or password." No indication of whether the email exists.

---

### SEC-AUTH-03 — Non-existent email returns same generic error (user enumeration prevention)
**Steps:**
1. POST to `/api/session/login` with `totally-fake@example.com` and any password

**Expected:** Identical HTTP status (401) and identical response body to an existing-email / wrong-password attempt.  
**Timing:** Response time should not significantly differ (constant-time comparison is implemented via `crypto.timingSafeEqual`).

---

### SEC-AUTH-04 — Account lockout after N failed attempts
**Default:** 5 attempts, 15-minute lockout (`AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOGIN_LOCKOUT_MINUTES`).

```bash
for i in $(seq 1 6); do
  curl -s -X POST https://careers.darumatic.com/api/session/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"wrongpassword'$i'"}' | jq -r '.error'
done
```
**Expected:** Attempt 6 returns "Account is locked." or equivalent, even if correct password supplied.

---

### SEC-AUTH-05 — Rate limit on login endpoint ⚠️
**Default:** 20 requests per 15-minute window per IP.

```bash
for i in $(seq 1 25); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://careers.darumatic.com/api/session/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"x"}')
  echo "Request $i: $STATUS"
done
```
**Expected:** Requests 21+ return HTTP `429`.

---

### SEC-AUTH-06 — Password minimum length enforced
**Steps:**
1. Attempt to set a 7-character password (via password reset or user creation)

**Expected:** Server returns validation error "Password must be at least 8 characters." (`isAcceptablePassword` checks length ≥ 8).

---

### SEC-AUTH-07 — Password hashed with scrypt (not plaintext / MD5 / SHA1)
**Steps (DB inspection):**
```bash
ssh root@139.180.182.102 'mysql hiregnome -e "SELECT LEFT(passwordHash, 10) FROM User LIMIT 1;"'
```
**Expected:** Value starts with `s1$` (the `PASSWORD_HASH_VERSION` prefix indicating scrypt with random salt).

---

## 4. Authentication — Session Management

### SEC-SESS-01 — Session cookie flags
**Steps:**
1. Log in via browser
2. In DevTools → Application → Cookies, inspect `ats-session`

**Expected:**
- `HttpOnly` ✓ (not accessible via JS)
- `Secure` ✓ (HTTPS only — set because `AUTH_COOKIE_SECURE=true` in production `.env`)
- `SameSite: Lax` ✓ (blocks cross-origin POST)
- `Path: /`

---

### SEC-SESS-02 — Session invalidated on logout
**Steps:**
1. Log in, copy the `ats-session` cookie value
2. Log out
3. Replay the old cookie in a request to `/api/candidates`

**Expected:** HTTP `401`. The old token is rejected.  
**Note:** The app uses HMAC-signed tokens with expiry; logout clears the client-side cookie. If server-side session revocation is not implemented, old tokens remain technically valid until they expire — document this as a known limitation and ensure `AUTH_SESSION_MAX_AGE_SECONDS` is short enough (default 12h is acceptable).

---

### SEC-SESS-03 — Session expiry enforced
**Steps:**
1. Note `exp` field in the decoded token (base64url-decode the first `.`-separated segment of `ats-session`)
2. Use the token after the expiry timestamp

**Expected:** HTTP `401`.

---

### SEC-SESS-04 — Session token tampering rejected
**Steps:**
1. Copy the `ats-session` cookie
2. Modify a single character in the base64 payload segment
3. Send the request to any authenticated API endpoint

**Expected:** HTTP `401`. The HMAC signature check (`crypto.timingSafeEqual`) rejects the tampered token.

---

### SEC-SESS-05 — Acting-user cookie cannot escalate privileges
**Steps:**
1. Log in as a **Recruiter**
2. Manually set the `ats-acting-user-id` cookie to the ID of an **Administrator** user
3. Attempt to call `GET /api/admin/system-settings`

**Expected:** The acting-user cookie is supplementary to the session; the authorisation check reads the user's role from the DB, not the cookie. Access still denied.

---

## 5. Authentication — Password Reset

### SEC-PWD-01 — Reset token is cryptographically random
**Implementation:** `crypto.randomBytes(32).toString('base64url')` = 256-bit entropy.  
**Verification:** Inspect generated token in reset email — should be 43+ random base64url characters with no predictable pattern.

---

### SEC-PWD-02 — Reset token stored as SHA-256 hash, not plaintext
```bash
ssh root@139.180.182.102 'mysql hiregnome -e "SELECT LEFT(tokenHash, 10) FROM PasswordResetToken ORDER BY id DESC LIMIT 1;"'
```
**Expected:** SHA-256 base64url hash — not the raw token value.

---

### SEC-PWD-03 — Reset token expires (default 60 minutes)
**Steps:**
1. Request a password reset
2. Wait for the token TTL to pass (or manually set `expiresAt` in the past in DB)
3. Use the expired link

**Expected:** "This password reset link has expired or is invalid."

---

### SEC-PWD-04 — Reset token single-use
**Steps:**
1. Request reset, use the link to change password
2. Use the same link again

**Expected:** Second attempt fails. Token deleted from `PasswordResetToken` table after first use.

---

### SEC-PWD-05 — Forgot-password endpoint does not confirm email existence
```bash
curl -s -X POST https://careers.darumatic.com/api/session/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"totallyfake@notareal.domain"}'
```
**Expected:** Same success-style response as for a real email (e.g., "If this email is registered, you will receive a reset link."). No error distinguishing real vs. fake.

---

### SEC-PWD-06 — Rate limit on forgot-password ⚠️
**Default:** 6 requests per 15-minute window.

```bash
for i in $(seq 1 8); do
  curl -s -X POST https://careers.darumatic.com/api/session/forgot-password \
    -H "Content-Type: application/json" -d '{"email":"x@x.com"}' | jq -r '.ok // .error'
done
```
**Expected:** Request 7+ returns HTTP `429`.

---

## 6. Authorisation & Access Control

### SEC-AUTHZ-01 — Unauthenticated access to protected API routes returns 401
```bash
for route in "/api/candidates" "/api/job-orders" "/api/submissions" "/api/clients" "/api/users"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://careers.darumatic.com$route)
  echo "$route → $STATUS"
done
```
**Expected:** All return `401`.

---

### SEC-AUTHZ-02 — Recruiter cannot access Administrator-only endpoints
**Steps:**
1. Log in as a Recruiter, capture `ats-session` cookie
2. Attempt:
   ```bash
   curl -s -H "Cookie: ats-session=<recruiter-token>" \
     https://careers.darumatic.com/api/admin/system-settings
   ```

**Expected:** HTTP `403` "Access denied."

---

### SEC-AUTHZ-03 — Recruiter cannot access data outside their division (Owner Only mode)
**Steps:**
1. Create Division A (Owner Only), assign User A
2. Create Division B (Owner Only), assign User B
3. User A creates a job order in Division A
4. Log in as User B, call `GET /api/job-orders`

**Expected:** User B does not see Division A job orders.

---

### SEC-AUTHZ-04 — IDOR: candidate ID enumeration
**Steps:**
1. Log in as a limited user (Recruiter with no division access to candidate 99)
2. `GET /api/candidates/99`

**Expected:** HTTP `404` or `403` — not the candidate's data.

---

### SEC-AUTHZ-05 — Public career API does not expose unpublished jobs
```bash
# Create a job order with publishToCareerSite = false
curl -s https://careers.darumatic.com/api/careers/jobs | jq '.jobs[].id'
```
**Expected:** The unpublished job's ID does not appear. Direct access via `/api/careers/jobs/{id}` returns `404`.

---

### SEC-AUTHZ-06 — Closed / on-hold jobs not accessible via public apply API
**Steps:**
1. Set a job order status to `closed`
2. POST to `/api/careers/jobs/{id}/apply` with valid form data

**Expected:** HTTP `404` "This job is no longer accepting applications."

---

### SEC-AUTHZ-07 — Admin cannot be demoted to non-admin by a non-admin
**Steps:**
1. Log in as a Director
2. Attempt `PATCH /api/users/{admin-id}` with `{"role":"RECRUITER"}`

**Expected:** HTTP `403`. Only administrators can change roles.

---

## 7. Input Validation & Injection

### SEC-INJ-01 — SQL injection via search (Prisma parameterised queries)
```bash
curl -s -H "Cookie: ats-session=<token>" \
  "https://careers.darumatic.com/api/candidates?q=%27%3B+DROP+TABLE+Candidate%3B--"
```
**Expected:** Normal search result (empty or partial match). No database error. Prisma's ORM never interpolates user input into raw SQL.

---

### SEC-INJ-02 — SQL injection via career site apply fields
```bash
echo '%PDF-1.4' > /tmp/t.pdf
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  -F "firstName=Robert'); DROP TABLE Submission;--" \
  -F "lastName=Tables" \
  -F "email=bobby.$(date +%s)@tables.com" \
  -F "mobile=0400000000" -F "zipCode=2000" \
  -F "startedAtMs=$(( ($(date +%s) - 300) * 1000 ))" \
  -F "resumeFile=@/tmp/t.pdf;type=application/pdf"
```
**Expected:** Application processed normally (or rejected by field validation). No DB error. Tables intact.

---

### SEC-INJ-03 — No raw SQL usage in codebase (static check)
```bash
grep -rn "\$queryRawUnsafe\|\$executeRawUnsafe" /Users/adrian/Projects/hire-gnome-ats/
```
**Expected:** No output. If any raw queries exist, they must use parameterised `$queryRaw` tagged template literals only.

---

### SEC-INJ-04 — Command injection not possible (no shell exec in app)
```bash
grep -rn "child_process\|exec(\|execSync\|spawn(" \
  /Users/adrian/Projects/hire-gnome-ats/app \
  /Users/adrian/Projects/hire-gnome-ats/lib 2>/dev/null | grep -v node_modules
```
**Expected:** No `child_process` usage in application code. Framework dependencies are out of scope.

---

### SEC-INJ-05 — Prototype pollution: JSON body size / depth limit
**Steps:**
1. POST a deeply nested JSON payload to any authenticated API endpoint
2. Also try `{"__proto__":{"admin":true}}`

**Expected:** Request rejected by body parser size limit or server-side validation. No property pollution observed.

---

### SEC-INJ-06 — Path traversal via file name
**Steps:**
1. Upload a resume with filename `../../etc/passwd.pdf`

**Expected:**
- Server sanitises or rejects the filename before constructing the storage key
- No path traversal to server filesystem; file stored at a normalised storage path

---

### SEC-INJ-07 — Integer overflow / type coercion on ID parameters
```bash
# Non-integer ID
curl -s -H "Cookie: ats-session=<token>" \
  "https://careers.darumatic.com/api/candidates/999999999999999999999"

# Negative ID
curl -s -H "Cookie: ats-session=<token>" \
  "https://careers.darumatic.com/api/candidates/-1"
```
**Expected:** Both return `400` "Invalid ID" or `404`. No unhandled exception.

---

## 8. Cross-Site Scripting (XSS)

### SEC-XSS-01 — Stored XSS via candidate note
**Steps:**
1. Create a candidate note with content `<img src=x onerror=alert(1)>`
2. View the Notes tab in the ATS

**Expected:** Content rendered as escaped text. No JavaScript execution. React escapes text-node content by default.

---

### SEC-XSS-02 — Stored XSS via job public description (rendered via dangerouslySetInnerHTML)
**Risk:** The career detail page renders `job.publicDescription` via `dangerouslySetInnerHTML`.

**Steps:**
1. As an authenticated ATS user, set `publicDescription` to `<script>alert('xss')</script>Test`
2. View the public career detail page

**Expected:** Script tag rendered as literal text or stripped.  
**Current status:** `publicDescription` is entered via a rich-text editor in the ATS by authenticated staff only. The attack surface is limited to malicious administrators. However, if the field is ever editable by external parties, a server-side HTML sanitiser (e.g., `DOMPurify` on the server, or `sanitize-html`) must be added.  
**Recommendation:** Add server-side HTML sanitisation to `publicDescription` before storing in DB.

---

### SEC-XSS-03 — Reflected XSS via search/query parameters
**Steps:**
1. Navigate to `/careers?q="><script>alert(1)</script>`
2. View page source

**Expected:** The query string value is passed to React state and rendered as a string, not injected into raw HTML. No script execution.

---

### SEC-XSS-04 — JSON-LD structured data does not introduce XSS
**Steps:**
1. Set a job order title to `</script><script>alert(1)</script>`
2. View the public career detail page source

**Expected:** The JSON-LD block uses `JSON.stringify()` which escapes the string. No executable script injection.

---

### SEC-XSS-05 — Custom question labels rendered safely
**Steps:**
1. Create a custom question with label `<b>Salary</b><script>x()</script>`
2. View the career apply form

**Expected:** Label rendered as literal text. React escapes text content.

---

## 9. CSRF Resistance

### SEC-CSRF-01 — Authenticated state-changing requests require session cookie
**Note:** The app uses `SameSite: Lax` cookies. `Lax` prevents cross-site POST requests from carrying cookies, which is sufficient CSRF protection for forms using `application/json` or `multipart/form-data` POST requests.

**Steps:**
1. From a different origin, attempt a cross-origin `POST /api/candidates` with a forged session cookie

**Expected:** The browser does not send `SameSite: Lax` cookies on cross-site POST. The request is unauthenticated → `401`.

---

### SEC-CSRF-02 — Career site apply endpoint accepts cross-origin POST intentionally
**Expectation:** `/api/careers/jobs/{id}/apply` is a public endpoint — no session cookie required. Cross-origin form posts are intentional and expected.  
**Verify:** The endpoint's bot protection (honeypot + timing) provides the appropriate layer of protection for this public surface.

---

### SEC-CSRF-03 — Verify no mutation endpoints accept GET
```bash
curl -s -H "Cookie: ats-session=<token>" \
  "https://careers.darumatic.com/api/candidates/1?_method=DELETE"
```
**Expected:** `405 Method Not Allowed`. Only `GET` is served at that path. No state changed.

---

## 10. File Upload Security

### SEC-FILE-01 — Extension allowlist enforced (resume)
**Allowed:** `.pdf`, `.doc`, `.docx`

```bash
echo 'malicious content' > /tmp/evil.sh
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  -F "firstName=Test" -F "lastName=Test" \
  -F "email=file.sec.$(date +%s)@example.com" \
  -F "mobile=0400000000" -F "zipCode=2000" \
  -F "startedAtMs=$(( ($(date +%s) - 300) * 1000 ))" \
  -F "resumeFile=@/tmp/evil.sh;type=text/plain"
```
**Expected:** HTTP `400` "Unsupported resume file type."

---

### SEC-FILE-02 — Double extension rejected
```bash
cp /tmp/evil.sh /tmp/evil.pdf.exe
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  ... -F "resumeFile=@/tmp/evil.pdf.exe;type=application/pdf"
```
**Expected:** Rejected. `extractExtension()` takes the last `.` suffix — `.exe` is not in the allowlist.

---

### SEC-FILE-03 — Oversized file rejected
```bash
# Create 9 MB file (over 8 MB RESUME_UPLOAD_MAX_BYTES limit)
dd if=/dev/urandom of=/tmp/big.pdf bs=1024 count=9216
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  ... -F "resumeFile=@/tmp/big.pdf;type=application/pdf"
```
**Expected:** HTTP `400` "Resume exceeds 8 MB limit."

---

### SEC-FILE-04 — Empty file rejected
```bash
touch /tmp/empty.pdf
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  ... -F "resumeFile=@/tmp/empty.pdf;type=application/pdf"
```
**Expected:** HTTP `400` "Resume file is empty."

---

### SEC-FILE-05 — File content not executed by server
**Verify:** The uploaded file is stored as a binary blob in object storage (S3 or local filesystem). The server never executes, parses for macros, or includes the file as a script.  
**Steps:** Inspect storage path for an uploaded file — it should be a static key under a candidate-scoped prefix, not a web-accessible route.

---

### SEC-FILE-06 — Candidate attachment allowlist (broader set)
**Allowed:** `.pdf`, `.doc`, `.docx`, `.txt`, `.rtf`, `.odt`, `.png`, `.jpg`, `.jpeg`

**Steps:**
1. As authenticated user, attempt to attach a `.php` or `.html` file to a candidate
2. Attempt to attach a `.js` file

**Expected:** Both rejected with an "unsupported file type" error.

---

## 11. Career Site Bot & Spam Protection

### SEC-BOT-01 — Honeypot field silently rejects bots
**Steps:**
1. POST to apply endpoint with `faxNumber=bot@example.com` (populated honeypot)
2. Verify no DB row created

```bash
MAX=$(ssh root@139.180.182.102 'mysql hiregnome -N -e "SELECT MAX(id) FROM Submission;"')
curl -s -X POST https://careers.darumatic.com/api/careers/jobs/1/apply \
  -F "firstName=Bot" -F "lastName=Test" -F "email=bot.$(date +%s)@spam.com" \
  -F "mobile=0400000000" -F "zipCode=2000" \
  -F "startedAtMs=$(( ($(date +%s) - 300) * 1000 ))" \
  -F "faxNumber=1234" \
  -F "resumeFile=@/tmp/t.pdf;type=application/pdf"
NEW=$(ssh root@139.180.182.102 'mysql hiregnome -N -e "SELECT MAX(id) FROM Submission;"')
[ "$MAX" = "$NEW" ] && echo "PASS: honeypot blocked" || echo "FAIL: submission created"
```
**Expected:** Response `{"ok":true,"message":"Application submitted successfully."}` but no new Submission row.

---

### SEC-BOT-02 — Missing timing field silently rejects
**Steps:**
1. POST without `startedAtMs` field

**Expected:** Silent pass (same as honeypot). No DB row.

---

### SEC-BOT-03 — Too-fast submission silently rejects
**Steps:**
1. POST with `startedAtMs` set to `Date.now()` (zero elapsed time)

**Expected:** Silent pass if `CAREERS_APPLY_MIN_FORM_FILL_SECONDS > 0` (default 2).

---

### SEC-BOT-04 — Future timestamp silently rejects
**Steps:**
1. POST with `startedAtMs` 1 hour in the future

**Expected:** Rejected as `future_started_at` → silent pass.

---

### SEC-BOT-05 — Career site apply rate limit ⚠️
**Default:** 6 requests per 15 minutes per IP.

```bash
for i in $(seq 1 8); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://careers.darumatic.com/api/careers/jobs/1/apply \
    -F "firstName=RL" -F "lastName=Test" \
    -F "email=rl$i.$(date +%s)@example.com" \
    -F "mobile=0400000000" -F "zipCode=2000" \
    -F "startedAtMs=$(( ($(date +%s) - 300) * 1000 ))" \
    -F "resumeFile=@/tmp/t.pdf;type=application/pdf")
  echo "Request $i: $STATUS"
done
```
**Expected:** Requests 7+ return `429`.

---

### SEC-BOT-06 — Duplicate email per job order prevented at DB level
**Steps:**
1. Submit two applications for the same job with `dup@example.com`

**Expected:** Second submission returns HTTP `409` "You already applied to this role with this email address." (Prisma unique constraint on `(candidateId, jobOrderId)`.)

---

## 12. Rate Limiting — All Endpoints

| Endpoint | Default Limit | Window |
|----------|--------------|--------|
| `POST /api/session/login` | 20 req | 15 min |
| `POST /api/session/forgot-password` | 6 req | 15 min |
| `POST /api/session/reset-password` | 10 req | 15 min |
| `POST /api/careers/jobs/*/apply` | 6 req | 15 min |
| `GET /api/lookups/*` | 80 req | 60 sec |
| `GET /api/search` | 30 req | 60 sec |
| Mutation endpoints (general) | 120 req | 60 sec |
| Candidate / Job Order match | 20 req | 60 sec |
| Resume parse | 30 req | 10 min |

### SEC-RL-01 — Each limit is enforced independently
**Steps:** For each endpoint in the table above, exceed its limit and confirm `429` is returned with the appropriate error message.

---

### SEC-RL-02 — Rate limit counters are per IP
**Steps:**
1. Hit the login limit from IP-A (blocked)
2. Use a different source IP

**Expected:** IP-B has a fresh counter. (This tests that limits are IP-scoped, not global.)

---

### SEC-RL-03 — Rate limit state stored in memory, survives process restart
**Note:** The current implementation uses `RequestThrottleEvent` persisted in MySQL, not in-memory. This means limits survive PM2 restarts and do not reset if the Node process crashes.  
**Verify:** Reach the login limit → restart PM2 → confirm still rate-limited.

---

## 13. Sensitive Data Exposure

### SEC-DATA-01 — Password hashes never returned in API responses
```bash
curl -s -H "Cookie: ats-session=<admin-token>" \
  https://careers.darumatic.com/api/users/1 | jq 'keys'
```
**Expected:** Response keys do not include `passwordHash`.

---

### SEC-DATA-02 — Session secret not exposed
```bash
curl -s https://careers.darumatic.com/api/health | jq .
```
**Expected:** No environment variables or secrets in the health response. Only `{"ok":true}`.

---

### SEC-DATA-03 — `.env` file not publicly accessible
```bash
curl -s -o /dev/null -w "%{http_code}" https://careers.darumatic.com/.env
curl -s -o /dev/null -w "%{http_code}" https://careers.darumatic.com/.env.local
```
**Expected:** Both return `404` (Next.js does not serve `.env` files as static assets).

---

### SEC-DATA-04 — Source maps not exposed in production
```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://careers.darumatic.com/_next/static/chunks/main.js.map
```
**Expected:** `404`. Source maps should not be deployed to production (set `productionBrowserSourceMaps: false` in `next.config.mjs` if not already).

---

### SEC-DATA-05 — Candidate PII not returned to public APIs
```bash
# Public jobs API should not return candidate data
curl -s https://careers.darumatic.com/api/careers/jobs | jq '.jobs[0] | keys'
```
**Expected:** Keys limited to public job fields: `id`, `title`, `location`, `employmentType`, `teaser`, `publishedAt`, `client.name`. No candidate PII.

---

### SEC-DATA-06 — Error messages do not leak stack traces in production
```bash
curl -s https://careers.darumatic.com/api/candidates/999999
```
**Expected:** `{"error":"Not found."}` or similar. No stack trace, file paths, or DB error details in the response body.

---

## 14. API Surface — Unauthenticated Endpoints

The following endpoints are intentionally public. Verify each is correctly scoped.

| Endpoint | Intended access | Verify |
|----------|----------------|--------|
| `GET /api/health` | Public | Returns `{"ok":true}` only |
| `GET /api/careers/jobs` | Public | Only open + published jobs; no internal fields |
| `GET /api/careers/jobs/{id}` | Public | No salary, no application count, no recruiter info |
| `POST /api/careers/jobs/{id}/apply` | Public | Bot protection + rate limit active |
| `GET /api/session/login` | Public | Returns form page (N/A for API) |
| `POST /api/session/login` | Public | Rate limited |
| `POST /api/session/forgot-password` | Public | Rate limited, no email enumeration |
| `POST /api/session/reset-password` | Public | Rate limited, token required |
| `GET /api/client-review/{token}/*` | Token-scoped | Token required; isolated to one job's submissions |

### SEC-PUB-01 — No internal fields in public job detail API
```bash
curl -s https://careers.darumatic.com/api/careers/jobs/1 | jq 'keys'
```
**Expected:** No fields such as `ownerId`, `divisionId`, `customFields`, `internalNotes`, `salaryMin`, `salaryMax`, `recruiterId`.

---

### SEC-PUB-02 — Public sitemap does not leak internal routes
```bash
curl -s https://careers.darumatic.com/sitemap.xml | grep -v "careers"
```
**Expected:** Sitemap contains only public-facing career URLs. No `/admin`, `/job-orders`, `/candidates` paths.

---

## 15. Webhook Endpoint Security

### SEC-WH-01 — Postmark inbound webhook requires secret token (if configured)
```bash
# Without secret
curl -s -X POST https://careers.darumatic.com/api/inbound/postmark \
  -H "Content-Type: application/json" -d '{"From":"test@example.com"}'
```
**Expected:**
- If `POSTMARK_INBOUND_WEBHOOK_SECRET` is set: HTTP `401` "Unauthorized."
- If not set: Endpoint accepts the request (open by default — configure secret in production).

**Recommendation:** Always configure `POSTMARK_INBOUND_WEBHOOK_SECRET` in production.

---

### SEC-WH-02 — Inbound webhook with valid secret is processed
```bash
curl -s -X POST https://careers.darumatic.com/api/inbound/postmark \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <configured-secret>" \
  -d '{"From":"candidate@example.com","FromFull":{"Email":"candidate@example.com","Name":"Test"},"Subject":"Re: Interview","TextBody":"Confirmed."}'
```
**Expected:** HTTP `200`. Email event stored or processed.

---

## 16. Client Review Portal Isolation

### SEC-CP-01 — Token grants access only to its associated job order
**Steps:**
1. Generate a client review token for Job Order A
2. Use the token to access Job Order B's submissions:
   ```bash
   curl -s "https://careers.darumatic.com/api/client-review/<token-a>/submissions?jobOrderId=<job-b-id>"
   ```

**Expected:** HTTP `404` or empty result. Token is scoped to a single job order.

---

### SEC-CP-02 — Expired or invalid token returns 404
**Steps:**
1. Use a made-up or deleted token:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     "https://careers.darumatic.com/client-review/fakeinvalidtoken123"
   ```

**Expected:** HTTP `404`.

---

### SEC-CP-03 — Client portal cannot modify ATS data
**Steps:**
1. Using a valid client token, attempt to:
   - `PATCH /api/job-orders/{id}` with a status change
   - `DELETE /api/submissions/{id}`

**Expected:** Both return `401` or `403`. Client portal tokens are read-only with feedback submission only.

---

## 17. Denial-of-Service Resistance

### SEC-DOS-01 — Large JSON body rejected
```bash
python3 -c "import json; print(json.dumps({'data': 'A' * 10_000_000}))" > /tmp/big.json
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://careers.darumatic.com/api/session/login \
  -H "Content-Type: application/json" --data-binary @/tmp/big.json
```
**Expected:** `413 Payload Too Large` or `400`. The body parser rejects oversized payloads before they reach application code.

---

### SEC-DOS-02 — Resume upload limit enforced before buffering
**Verify** (code review): The `resumeFile.size > RESUME_UPLOAD_MAX_BYTES` check is performed before `resumeFile.arrayBuffer()` is called, preventing a slow-write attack from buffering a 1 GB file.

---

### SEC-DOS-03 — Slow-loris resistance
**Note:** This is primarily mitigated at the Apache/Cloudflare layer, not the application layer.  
**Verify:** Apache `mod_reqtimeout` is configured on the VPS (or Cloudflare DDoS protection is active).

---

## 18. Security Regression Checks

These are tests for specific bugs that were found and fixed. Run after every deployment.

### SEC-REG-01 — Application answers not stripped by Zod (fixed in commit 0391c8e)
**Steps:**
1. Submit application with answers for custom questions
2. Query DB: `SELECT customFields FROM Submission ORDER BY id DESC LIMIT 1;`

**Expected:** `customFields.applicationAnswers` is populated. This was previously NULL because `careerApplicationSchema` stripped `applicationAnswers` from `parsed.data` before the DB write. Now uses `payload.applicationAnswers` directly.

---

### SEC-REG-02 — Hiring manager lookup scoped to client (not global contact list)
**Steps:**
1. Create a job order for Client A
2. In the Hiring Manager lookup, search for a contact belonging to Client B

**Expected:** Contact from Client B does not appear. Lookup is filtered by `clientId`.

---

### SEC-REG-03 — Session cookie insecure flag is not set over HTTP in production
**Steps:**
1. Confirm `AUTH_COOKIE_SECURE=true` in `/opt/hiregnome/.env`
2. Log in and inspect the session cookie

**Expected:** `Secure` flag set. Cookie is never transmitted over plaintext HTTP.

---

### SEC-REG-04 — Career site correctly disabled when toggle is off
**Steps:**
1. Disable career site in Admin Settings
2. Call `POST /api/careers/jobs/1/apply`

**Expected:** HTTP `404` "Career site is not enabled." No data written to DB.

---

## Appendix — curl Commands Reference

### Authenticate and capture session cookie
```bash
SESSION=$(curl -si -X POST https://careers.darumatic.com/api/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}' \
  | grep -i "set-cookie" | grep "ats-session" | sed 's/.*ats-session=\([^;]*\).*/\1/')
echo "Session: $SESSION"
```

### Authenticated API call
```bash
curl -s -H "Cookie: ats-session=$SESSION" \
  https://careers.darumatic.com/api/candidates | jq '.total'
```

### Check all security-relevant response headers at once
```bash
curl -sI https://careers.darumatic.com/ | grep -iE \
  "strict-transport|x-frame|x-content-type|content-security|referrer|permissions|x-powered"
```

### Inspect session token claims (without verifying signature)
```bash
TOKEN="<paste ats-session cookie value>"
PAYLOAD=$(echo "$TOKEN" | cut -d. -f1)
echo "$PAYLOAD" | base64 -d 2>/dev/null | python3 -m json.tool
```

---

*Re-run SEC-REG-* and SEC-BOT-* groups after every deployment. Run the full plan after major feature additions or dependency upgrades.*
