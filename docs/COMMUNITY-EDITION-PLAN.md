# Community Edition Plan

## Purpose and Non-goals

This is the durable planning record for a future, standalone, open-source,
organization-neutral attendance product. It is a future product effort only.

It must not change, share, migrate, or otherwise affect the current production
installation, database, repository, Cloudflare resources, Raspberry Pi kiosks,
or project materials. Work on the current system remains independent.

**Non-goals for this plan:** creating a branch, worktree, or linked fork;
deploying a public edition; changing current application code; or committing to
a migration of the current production installation.

## Confirmed Decisions

The following are confirmed planning decisions unless a later dated decision log
entry explicitly replaces one.

- Start later from a **standalone sanitized snapshot** with a fresh Git history.
  Do not use a branch, worktree, or linked fork of this repository.
- Make the future edition open source. Apache-2.0 is the recommended license,
  pending a dependency and license audit.
- Serve organizations beyond FRC, including bands, drama groups, clubs,
  classrooms, and other teams.
- Support self-hosting on each organization's own Cloudflare account with
  Raspberry Pi kiosks as the first installation path.
- First release supports **single-kiosk deployments only**. Advanced
  multi-kiosk operation and any biometric/template synchronization are deferred.
- Fingerprints are the primary first-release sign-in method. Non-biometric
  sign-in methods are deferred.
- Use organization-neutral product terms: **organization**, **member**,
  **administrator**, **kiosk**, and **attendance event**.
- Keep email, Discord, Google OAuth, and captive-portal authentication optional.
- First-release theming is limited to customized headers plus primary and
  secondary colors for themed mode, and global light/dark modes. Broad
  terminology overrides and expansive theming are deferred.
- Publish documentation in distinct operations and technical tracks.

## Product Principles

- Offline-first attendance: a kiosk can capture and safely queue attendance
  without a working network connection.
- Organization ownership: each organization controls its own Cloudflare account,
  data, deployment configuration, and kiosk hardware.
- Safe defaults: no bundled credentials, production identifiers, personal data,
  or live service configuration.
- Progressive capability: a small, working attendance installation comes first;
  integrations and specialized hardware are opt-in additions.
- Accessible identity and branding: use neutral language and allow an
  organization to make the product recognizably its own without breaking
  readability or contrast.

## Architecture and Configuration Direction

### Confirmed direction

The future edition will retain an independently deployable API/dashboard/kiosk
shape suitable for an organization's own Cloudflare account and Raspberry Pi
kiosks. Configuration must be explicit, documented, and safe when omitted.

Organization branding will support:

- organization name and short name;
- customized headers;
- primary and secondary colors for themed mode, with contrast protection; and
- global light and dark modes.

The kiosk will cache applicable branding for offline use.

First release supports one kiosk per deployment. It will not implement
multi-kiosk coordination, fingerprint/template export or synchronization, or
cloud persistence of biometric templates. Sensor templates and their slot
mappings remain local to that kiosk.

### Suggestions to validate later

- Keep core organization settings in a small, versioned configuration model,
  with kiosk-safe cached values separated from administrator-only settings.
- Provide configuration validation during setup, including color contrast checks
  for configured themed colors.
- Treat terminology overrides and additional brand/layout customization as later
  capabilities so the first public release can keep support and documentation
  comprehensible.

## Setup Experience

### Confirmed setup flow

The initial guided setup should cover:

1. Deploying required resources to the organization's Cloudflare account.
2. Creating a bootstrap administrator.
3. Configuring organization branding.
4. Pairing each kiosk through a short-lived pairing code or QR code.
5. Installing kiosk software on a Raspberry Pi.
6. Confirming health and a test attendance flow.

External integrations are optional setup steps, not prerequisites for basic
offline attendance. The first-release attendance flow is fingerprint sign-in on
the single paired kiosk.

### Suggestions to validate later

- Offer a command-line guided installer first, with a browser-based setup
  assistant only if it reduces rather than obscures Cloudflare account setup.
- Make setup resumable and clearly distinguish required steps from optional
  integrations and hardware features.

## Documentation Plan

Public documentation will have two tracks:

- **Operations:** choosing hardware, self-hosting, Cloudflare account setup,
  bootstrap administration, branding, kiosk pairing, Pi installation, offline
  operation, backups, upgrades, troubleshooting, and privacy/security basics.
- **Technical:** architecture, configuration reference, local development,
  database schema and migrations, API contracts, kiosk protocols, extension
  points, testing, release process, and contribution guidance.

Both tracks should make the optional nature of integrations clear, document the
single-kiosk fingerprint-first scope, and use organization-neutral terminology
from the outset.

### Confirmed documentation accessibility standard

The community release must be deployable by non-technical school or club staff.
At first use, operations documentation must define unfamiliar concepts in
concise plain language, including Cloudflare, Worker, D1 database, web
dashboard, kiosk, pairing, and secrets.

Operations instructions must be task-oriented and include prerequisites,
screenshots or visual cues where they materially help, an expected-success
check after each major step, and safe troubleshooting and recovery paths. An
easy glossary must be available for terms a new administrator may encounter.

Avoid unexplained acronyms, assumed command-line knowledge, verbose AI-style
exposition, and duplicating technical internals in the operations guide. Keep
deeper architecture and implementation reference material in the separate
technical track.

## Snapshot Release Checklist

Before creating the future standalone snapshot:

- [ ] Reach a stable, verified release checkpoint in the current repository.
- [ ] Create a new sanitized directory outside this repository and initialize a
  new Git repository with fresh history.
- [ ] Exclude all existing Git history, local data, environment files,
  credentials, deployed IDs/URLs, roster data, and fingerprint mappings.
- [ ] Replace environment-specific values with safe placeholders and document
  every required deployment configuration value.
- [ ] Provide an empty database bootstrap and an optional, clearly separated
  demo-data path.
- [ ] Audit source, scripts, documentation, examples, generated assets, and
  dependency manifests for organization-specific names, secrets, identifiers,
  and licensing concerns.
- [ ] Complete a dependency and license audit before confirming Apache-2.0.
- [ ] Test a fresh Cloudflare deployment and a fresh Raspberry Pi kiosk
  installation using only the sanitized snapshot and public instructions.
- [ ] Verify basic offline fingerprint attendance without email, Discord, Google
  OAuth, or captive-portal authentication.
- [ ] Confirm release documentation meets the accessibility standard: a
  non-technical school or club administrator can complete deployment with
  plain-language definitions at first use, task-oriented prerequisites and
  success checks, useful visual cues, safe recovery guidance, and a glossary;
  detailed technical internals remain in the technical documentation.
- [ ] Review the release candidate for privacy, security, accessibility, and
  contributor-readiness before publication.

## Open Questions

These are unresolved; they are not commitments.

- What is the product name?
- Does the dependency and license audit confirm Apache-2.0?
- What exact branding configuration model, storage location, validation, and
  cache-refresh behavior should be used?
- Where should public documentation be hosted, and which domain should it use?
- What should the Cloudflare bootstrap or one-click deployment experience be?
- Which fingerprint hardware, if any, will be officially supported?
- Which non-biometric sign-in method should be considered after the first
  release?
- What multi-kiosk deployment and template-sync model, if any, can meet the
  future product's privacy and security requirements?
- How should optional integrations be packaged, configured, and maintained?
- Is there a supported migration path from the current system, or only a
  documented clean-start path?
- What governance, maintainer, issue-triage, security-response, and support
  model will the project use?

## Recommended Next Steps

These are suggestions, not approved implementation work.

1. Establish and tag a stable current-system release checkpoint.
2. Run a scoped repository inventory for names, IDs, URLs, configuration,
   data-bearing files, and third-party licenses to define sanitization work.
3. Decide the product name and ownership/governance model before publishing
   public materials.
4. Design and test the empty-database bootstrap plus a clean Cloudflare/Pi
   installation path in an isolated future snapshot.
5. Perform the dependency/license audit, then make the final license decision.

## Decision Log

| Date | Status | Decision or note |
| --- | --- | --- |
| 2026-08-30 | Confirmed | Future community edition will start from a standalone sanitized snapshot with fresh Git history, never as a branch, worktree, or linked fork. |
| 2026-08-30 | Confirmed | The edition will be open source; Apache-2.0 is recommended pending a dependency/license audit. |
| 2026-08-30 | Confirmed | The first supported path is organization-owned Cloudflare self-hosting with a Raspberry Pi kiosk; integrations stay optional and fingerprint sign-in is the first-release default. |
| 2026-08-30 | Confirmed | The current production installation and its resources remain out of scope and unaffected. |
| 2026-08-30 | Suggested | Validate the detailed configuration, setup, packaging, governance, and migration choices listed above before implementation. |
| 2026-08-30 | Confirmed | First release is single-kiosk only. Advanced multi-kiosk operation and biometric/template synchronization are explicitly deferred. |
| 2026-08-30 | Confirmed | Fingerprints are the primary first-release sign-in method; non-biometric sign-in is explicitly deferred. |
| 2026-08-30 | Confirmed | First-release theming is customized headers, primary/secondary themed colors, and global light/dark modes only. Broad terminology overrides and expansive theming are explicitly deferred. |
| 2026-08-30 | Confirmed | Release operations documentation must enable non-technical school or club staff to deploy safely through plain language, task-oriented steps, success checks, recovery guidance, visual cues where useful, and a glossary; deeper technical reference stays separate. |
