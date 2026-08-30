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
- License direction is Apache-2.0, pending a dependency and license audit.
- The provisional product name is **LancerLogin**.
- The future standalone repository name is **LancerLogin**. The default public
  documentation target is `robolancers.github.io/LancerLogin/`.
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
- Bootstrap administration supports the organization's choice of Google OAuth,
  a local username/password administrator, or both.
- The first Cloudflare deployment path is a guided CLI flow; an optional
  one-click deployment path may follow later.
- First-release theming is limited to customized headers plus primary and
  secondary colors for themed mode, and global light/dark modes. Broad
  terminology overrides and expansive theming are deferred.
- Provide guided, persistent, resumable onboarding after first administrator
  login; its detailed wizard UX and data model are future design work.
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
2. Creating a bootstrap administrator with Google OAuth, local
   username/password credentials, or both.
3. Configuring organization branding.
4. Pairing each kiosk through a short-lived pairing code or QR code.
5. Installing kiosk software on a Raspberry Pi.
6. Confirming health and a test attendance flow.

External integrations are optional setup steps, not prerequisites for basic
offline attendance. The first-release attendance flow is fingerprint sign-in on
the single paired kiosk.

Local administrator credentials must use a modern salted password hash, never
plaintext. The operations guide must provide secure reset and recovery guidance.
Detailed session and authentication-security design is reserved for future
implementation work.

### Confirmed dashboard onboarding requirement

After first administrator login, the dashboard must guide setup with a durable
checklist. It must be resumable over minutes or multiple days/sessions, retain
progress across administrators, and guide a non-technical user from the public
operations guide through deployment to opening the dashboard.

The recommended core checklist is:

1. Set organization, header, and theme branding.
2. Add or import the initial members.
3. Prepare and pair one kiosk.
4. Enroll and test a fingerprint.
5. Create a test attendance event.
6. Verify a complete test attendance cycle.

Email, Discord, and captive-portal integrations must appear separately as
optional, safely skippable steps. Use verified or derived completion where
possible; otherwise persist an explicit administrator completion record with a
timestamp and audit metadata.

Until core onboarding is complete, show a concise resume-next-step surface. It
must not block normal dashboard navigation, require one sitting, or use a
one-time-modal pattern. After completion, do not repeatedly present onboarding;
instead keep a non-intrusive **Setup/Help** entry for reviewing it, success
checks, and recovery guidance.

### Confirmed integrations setup requirement

Optional integrations are exposed through an authenticated in-dashboard
**Integrations/Setup** area, never through AI or chat instructions. It must be
self-serve for non-technical administrators. The area covers Google OAuth,
local-administrator authentication configuration, an email provider, Discord,
and captive-portal authentication where supported.

For each integration, provide plain-language purpose and setup guidance,
annotated screenshots, and copyable non-secret values such as callback URLs.
Show configuration state, non-secret health/status, and the last successful
test or action. Provide safe test controls, credential rotation/removal, and a
clear optional or disabled state.

Secret values must never be displayed after they are saved. Detailed
implementation must use a secure installation-specific secret/configuration
design—for example, encrypted-at-rest integration values using a
deployment-provided key—rather than requiring the dashboard to hold broad
Cloudflare account API credentials. Concrete secret storage and recovery design
requires security review before implementation.

### Suggestions to validate later

- Deliver the first guided CLI deployment path with task-oriented, plain-language
  instructions that do not assume command-line knowledge; later evaluate an
  optional one-click deployment path.
- Make setup resumable and clearly distinguish required steps from optional
  integrations and hardware features.
- Design the detailed onboarding wizard interaction, completion data model,
  verification signals, and audit retention; this is future design work, not
  current implementation work.

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

### Privacy and support boundaries

Biometric consent, retention, deletion, and legal/privacy policy are the
deploying organization's responsibility. Documentation explains that
responsibility and points to the implementation's controls; it does not provide
organization-specific legal or policy determinations.

No support service-level agreement is promised. Users may contact RoboLancers,
and assistance may be available, but neither the documentation nor the release
promises response times or support coverage.

### Confirmed documentation accessibility standard

The community release must be deployable by non-technical school or club staff.
At first use, operations documentation must define unfamiliar concepts in
concise plain language, including Cloudflare, Worker, D1 database, web
dashboard, kiosk, pairing, and secrets.

Operations instructions must be task-oriented and include prerequisites,
an expected-success check after each major step, and safe troubleshooting and
recovery paths. An easy glossary must be available for terms a new
administrator may encounter.

Avoid unexplained acronyms, assumed command-line knowledge, verbose AI-style
exposition, and duplicating technical internals in the operations guide. Keep
deeper architecture and implementation reference material in the separate
technical track.

### Confirmed screenshot-led documentation standard

Public operations and technical documentation must be screenshot-led. Wherever
a user needs to act, include an annotated screenshot with arrows or callouts
identifying the exact control. This applies to LancerLogin dashboard and kiosk
screens as well as third-party Cloudflare and Google OAuth setup.

Screenshots must use redacted or example data only, match the current UI and
third-party version, and include concise alt text and captions. Regenerate them
when the related UI changes. Maintain screenshots as source assets rather than
pasting them ad hoc into documentation.

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
- [ ] Verify guided CLI bootstrap supports Google OAuth, local
  username/password administration, or both; local credentials use a modern
  salted hash and recovery guidance is available without documenting plaintext
  credentials.
- [ ] Verify basic offline fingerprint attendance without email, Discord, Google
  OAuth, or captive-portal authentication.
- [ ] Confirm release documentation meets the accessibility standard: a
  non-technical school or club administrator can complete deployment with
  plain-language definitions at first use, task-oriented prerequisites and
  success checks, useful visual cues, safe recovery guidance, and a glossary;
  detailed technical internals remain in the technical documentation.
- [ ] Confirm operations and technical documentation is screenshot-led: every
  user action has a current annotated control-level screenshot with concise alt
  text/caption, redacted or example data, and maintained source assets,
  including LancerLogin and Cloudflare/Google OAuth setup screens.
- [ ] Confirm the first-login dashboard provides persistent, cross-admin,
  resumable onboarding for the core checklist; optional integrations are safely
  skippable, completion is verified/derived or auditable, normal navigation is
  never blocked, and completed onboarding remains available through Setup/Help.
- [ ] Confirm authenticated Integrations/Setup is self-serve and covers each
  supported optional integration with non-secret status, last-success data,
  safe tests, rotation/removal, disabled state, annotated setup guidance, and
  copyable non-secret values; saved secrets are never displayed.
- [ ] Review the release candidate for privacy, security, accessibility, and
  contributor-readiness before publication.

## Open Questions

These are unresolved; they are not commitments.

- Does **LancerLogin** remain the product name after availability, trademark,
  and community-fit review?
- What exact branding configuration model, storage location, validation, and
  cache-refresh behavior should be used?
- What session, reset, recovery, and authentication-security design should the
  implementation use for local administrator credentials?
- What installation-specific secret storage, encryption-key provisioning, and
  recovery design passes security review for integrations?
- What should the later optional one-click Cloudflare deployment experience be?
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
3. Validate the provisional LancerLogin name and decide the ownership/governance
   model before publishing public materials.
4. Design and test the empty-database bootstrap plus a clean Cloudflare/Pi
   installation path in an isolated future snapshot.
5. Perform the dependency/license audit before finalizing Apache-2.0.

## Decision Log

| Date | Status | Decision or note |
| --- | --- | --- |
| 2026-08-30 | Confirmed | Future community edition will start from a standalone sanitized snapshot with fresh Git history, never as a branch, worktree, or linked fork. |
| 2026-08-30 | Confirmed | The edition will be open source under the Apache-2.0 direction, pending a dependency/license audit. |
| 2026-08-30 | Confirmed | The first supported path is organization-owned Cloudflare self-hosting with a Raspberry Pi kiosk; integrations stay optional and fingerprint sign-in is the first-release default. |
| 2026-08-30 | Confirmed | The current production installation and its resources remain out of scope and unaffected. |
| 2026-08-30 | Suggested | Validate the detailed configuration, setup, packaging, governance, and migration choices listed above before implementation. |
| 2026-08-30 | Confirmed | First release is single-kiosk only. Advanced multi-kiosk operation and biometric/template synchronization are explicitly deferred. |
| 2026-08-30 | Confirmed | Fingerprints are the primary first-release sign-in method; non-biometric sign-in is explicitly deferred. |
| 2026-08-30 | Confirmed | First-release theming is customized headers, primary/secondary themed colors, and global light/dark modes only. Broad terminology overrides and expansive theming are explicitly deferred. |
| 2026-08-30 | Confirmed | Release operations documentation must enable non-technical school or club staff to deploy safely through plain language, task-oriented steps, success checks, recovery guidance, visual cues where useful, and a glossary; deeper technical reference stays separate. |
| 2026-08-30 | Confirmed | First-login dashboard onboarding is persistent and resumable across administrators and sessions, with a concise non-blocking next step until the core checklist completes; detailed wizard UX and completion data-model design remain future work. |
| 2026-08-30 | Confirmed | The provisional community-release product name is LancerLogin. |
| 2026-08-30 | Confirmed | Public operations and technical documentation is screenshot-led: each user action has a current annotated screenshot with redacted/example data, concise alt text/caption, and maintained source assets; this includes LancerLogin and Cloudflare/Google OAuth setup. |
| 2026-08-30 | Confirmed | Bootstrap administration supports Google OAuth, local username/password credentials, or both. Local passwords use a modern salted hash, never plaintext; reset/recovery guidance is documented while detailed session/security design remains implementation work. |
| 2026-08-30 | Confirmed | The first Cloudflare path is guided CLI deployment; an optional one-click deployment may be added later. |
| 2026-08-30 | Confirmed | Biometric consent, retention, deletion, and legal/privacy policy are each deploying organization's responsibility; documentation explains that responsibility only. |
| 2026-08-30 | Confirmed | No support SLA is promised. Users may contact RoboLancers and assistance may be available without a response-time or coverage commitment. |
| 2026-08-30 | Confirmed | The future standalone repository name is LancerLogin and the default public documentation target is robolancers.github.io/LancerLogin/. |
| 2026-08-30 | Confirmed | Optional integrations are configured through authenticated in-dashboard Integrations/Setup, not AI/chat instructions, with self-serve guidance, non-secret status, tests, rotation/removal, and clear disabled state. Saved secrets are never displayed; secret storage and recovery require security review before implementation. |
