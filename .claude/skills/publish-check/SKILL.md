---
name: publish-check
description: Scan for secrets and private details before anything from this repo is published. Use it before every commit and every push, before changing the repository's visibility, and whenever the user asks whether something is safe to commit, push, share or make public. The repository is public, so whatever is pushed is published for good.
---

# Publish check

This repository is public. A pushed commit can be copied by anyone within seconds and stays in the history even if a later commit removes it. So the check happens before the commit, not after.

## Run the scan

```bash
git add -A                                                   # or the specific files
node .claude/skills/publish-check/scripts/scan.mjs           # what is staged
node .claude/skills/publish-check/scripts/scan.mjs --history # every commit; before a visibility change
```

It prints nothing sensitive: matched values are masked. Exit code 1 means there are findings.

It looks for:

- secret shapes: private keys, access tokens, eBay keyset IDs and tokens, database addresses that contain a password;
- the live deployment: hosting addresses and project links;
- personal details: email addresses other than placeholders and GitHub's no-reply, and home-folder paths;
- files that should never be tracked: `.env` (other than `.env.example`), key files, local settings.

## Judge each finding

A scanner cannot tell a real secret from a look-alike, and it cannot see everything.

- A finding in test data or documentation may be harmless (a made-up token, `demo@example.com`). Confirm that it is made up, then go on. If a harmless pattern keeps coming back, extend the allow-list in `scripts/scan.mjs` rather than ignoring the output.
- A real one: remove it from the change, and keep it out of the working tree's tracked files. If it was already pushed, tell the user plainly that it is public and must be replaced at its source (a new password, a new key); deleting the commit is not enough.

Also read the diff yourself for what no pattern catches: the live app's address written without its domain, seller or customer names, screenshots or logs with real data, an answer copied from production.

## What must stay out

Secrets and login details, the live app's address, hosting project, service and bucket identifiers, the owner's personal or work email addresses, local paths, and real eBay data (seller name, item IDs, order IDs).

## Commits

Commit and push only when the user asks. Commits use the repository's own git identity (a GitHub no-reply address); do not change the global git configuration, which belongs to a different account.
