# 4Liberty Network Hub — Build

Theme + plugin source for the 4Liberty Network hub (wakeupamericashow.com →
new hub → 4libertynetwork.com repoint). Full spec lives in the project's
Claude Code files folder, not here — see:

- `PHASE-1-BUILD-PLAN.md` — this phase's plan, design tokens, task list.
- `PHASE-1-homepage-mockup.html` — the approved visual design.
- `SUPPORT-TIERS-VERIFIED.md` — the verified /support tiers + Square URLs.
- `BUILD-BRIEF.md`, `BUILD-PLAN.md`, `CLAUDE.md`, `PHASE-0-FINDINGS.md` — the
  rest of the project spec and golden rules.

## What's here

```
wp-content/
  themes/fourliberty/       — the custom block theme
  plugins/4liberty-hub/     — the "4Liberty Hub" admin + all custom features
deploy/
  deploy-staging.sh         — pushes theme+plugin files to staging over SFTP
  .env.staging              — staging SFTP/SSH creds (git-ignored, not here)
```

## Deploying to staging

1. `deploy/.env.staging` must exist locally (not in git) with
   `STAGING_SFTP_HOST`, `STAGING_SFTP_PORT`, `STAGING_SFTP_USER`,
   `STAGING_SFTP_PASS`. Get/rotate these from GoDaddy: Hosting → (site) →
   Settings → Staging Site card → SSH/SFTP → Create New Login.
2. Run `bash deploy/deploy-staging.sh` from the project root.
3. In staging wp-admin → Appearance → Themes, activate **4Liberty Network**.
4. Set Appearance → (Site Editor) → Site Identity → Site Logo to the 4Liberty
   eagle logo already in the media library (one-time, ~30 seconds).
5. In Pages, assign the **Support (donations)** template to the existing
   `/support` page (Page ▸ Template dropdown in the editor sidebar).

Never overwrite the database — this script only ever touches
`wp-content/themes/fourliberty` and `wp-content/plugins/4liberty-hub` on the
remote. Production is never touched by anything in this repo until the
Phase 6 cutover, and even then it's a files-only deploy, never a DB push.

## Golden rules (see CLAUDE.md for the full list)

1. Never touch the live production site — staging only until cutover.
2. Protect `/support` — identical URL, identical Square buttons, verified
   twice. The tier data + URLs live in exactly one place:
   `wp-content/themes/fourliberty/patterns/support-tiers.php`.
3. Every custom feature is owner-adjustable from the "4Liberty Hub" admin
   menu — never by editing code.
4. Confirm before anything destructive or irreversible.
