# Changelog

All notable changes to ParishCRM are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are `vX.Y.Z` git tags. Versioning is [SemVer](https://semver.org/):
MINOR for new features, PATCH for fixes/security.

## How to update

When merging a PR, add a bullet under `[Unreleased]` in the right group
(Added / Changed / Fixed / Security). On release, rename `[Unreleased]`
to the new version + date and start a fresh empty `[Unreleased]`.

Config/tooling-only PRs with no user-facing or runtime effect (linter/CI
config, editor settings, `.gitignore`) may skip the changelog.

On release, also add a top (newest-first) entry to `WHATS_NEW` in
`src/lib/whatsNew.ts` with 1–4 short, plain-English, user-facing highlights.

## [Unreleased]
