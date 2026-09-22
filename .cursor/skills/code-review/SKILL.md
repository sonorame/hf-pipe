---
name: code-review
description: "Review the changes since a fixed point along Standards and Spec axes. Use when reviewing a branch, PR, or work-in-progress against hf-pipe rules and the originating plan."
---

# Code review

Two-axis review of `HEAD` against a fixed point (commit, branch, tag, merge-base):

- **Standards**: hf-pipe rules (`package-unit`, `tdd`, `hop-autonomy`, `no-doc-meta`, russian typography in user-facing strings). No Task/sub-agents; review in this chat.
- **Spec**: the originating plan (here: native Cursor CONNECT egress).

Command: `git diff <fixed>...HEAD` and `npm test`.

Smell baseline (judgement, not auto-fail): Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man.

Do not spawn sub-agents. Report `## Standards` then `## Spec`.
