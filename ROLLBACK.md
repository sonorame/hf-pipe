# Rollback

Git tags are snapshots of this repository. Secrets and `node.exe` are not in git.

## Restore sources

```text
git fetch --tags
git checkout working-baseline-2026-09-15
```

Install and start from the clone:

```text
npm install
npm start -- clean
npm start -- dirty
```

`boot retry` does not reload Node modules. Restart the process after a checkout.

Return to the branch head:

```text
git checkout main
```

Do not restore `matrix-session.json` from git: it is not there.
