<!-- Keep PRs small and single-purpose. Branch naming: feat/<slug>, fix/<slug>, chore/<slug>. -->

## What & why

<!-- One or two lines: what this changes and the reason. Link issues: "Closes #123, closes #124" (repeat the keyword per issue). -->

## Changes

-

## Checklist

- [ ] Tests pass (`npm test -- --no-coverage`) and lint is clean (`npm run lint`)
- [ ] Types check (`npx tsc --noEmit`) for component/action changes
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Schema change? migration committed (`prisma migrate dev`) + client regenerated
- [ ] Role checks enforced at **both** page and action for any new mutation
- [ ] No secrets, member PII, or real credentials in the diff
- [ ] **Bugfix?** a failing-first regression test ships in this PR (guardrail ladder L3)
- [ ] **Class bitten twice?** promoted to a guardrail — `.semgrep/rules.yml` rule or CI gate (L4–5), not just a note

## Notes for reviewer

<!-- Anything to focus on, known gaps, or follow-ups filed as issues. -->
