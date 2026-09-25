# Security Policy

ParishCRM stores personal and financial data for church members. We take security
seriously and appreciate responsible disclosure.

## Supported Versions

ParishCRM is single-tenant and self-hosted; each church runs its own deployment. Only the
latest released version and the current `main` branch receive security fixes. Operators are
expected to keep their deployment reasonably up to date.

| Version | Supported |
|---------|-----------|
| Latest release / `main` | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately using **GitHub's private vulnerability reporting** — the
[**Security → Report a vulnerability**](https://github.com/ginutgeorge-Aus/parishcrm/security/advisories/new) tab on this repository.

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

## Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgement | 3 business days |
| Initial assessment | 7 business days |
| Fix or mitigation | 30 days (critical: 7 days) |

We will coordinate a disclosure timeline with you and credit reporters who wish to be named.

## Scope

In scope:
- Authentication and authorisation bypasses (role/permission escalation, IDOR)
- Data exposure (member PII, financial records, encrypted-field leakage)
- SQL/command injection or server-side code execution
- CSRF, XSS affecting authenticated sessions
- Weaknesses in field encryption, session handling, or secret management

Out of scope:
- Theoretical vulnerabilities with no practical exploit path
- Issues requiring physical access to the server
- Social engineering attacks
- Misconfiguration of a specific self-hosted deployment (e.g. weak operator-chosen secrets)

## For Operators

Each deployment is responsible for its own secrets and infrastructure. At minimum:
- Generate strong, unique `AUTH_SECRET` and `ENCRYPTION_KEY` values; never reuse the examples.
- Keep `DATABASE_URL` and mail credentials out of source control.
- Serve over HTTPS and keep the container image and dependencies current.
