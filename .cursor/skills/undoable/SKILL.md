---
name: undoable
description: Makes software changes reversible by planning safe implementation steps, auditing diffs for rollback risk, splitting mixed changes, and creating rollback plans. Use before implementing risky hop changes, before opening PRs, or before merging.
---

# Undoable

Make the change safe to review, test, revert, and roll back.

hf-pipe: revert is `git revert` on `feat/clean-cursor-egress` plus ordinary push. Live hop rolls back via signed `previous`, not `git checkout`. Cursor proxy keys and `HFPipe-Cursor-*` firewall rules that hop wrote must be removed on undo.

## Modes

1. `plan` - reversible steps before code.
2. `diff` - audit a diff for rollback risk.
3. `split` - one seam per commit.
4. `rollback` - triggers and verification.

## Checklist

- mixed refactor + behavior
- protocol bump mixed with unrelated UI
- firewall/settings writes without undo
- live pack patched file-by-file

## Output

Verdict, main risks, recommended split, rollback plan, tests.
