# Autonomous recovery after host resume — 2026-10-06

## Contract and incident

The dirty host owns the offerer session; both hosts ran signed build `2a019125423b683c`, protocol 3. The user could not use the clean host through the pipe for over 100 seconds after the hosts resumed. The required outcome is autonomous recovery through the installed Windows supervisor without sending a chat message or manually restarting either side. Related tracker: GitHub issue #5.

## Observed evidence

Times below use UTC; add four hours for the operator's local time. Do not compare durations across hosts without accounting for clock correction: the clean host logged time corrections during this wake, and an offer/answer pair initially appeared out of chronological order across their clocks.

Dirty Windows Kernel-Power event 506 occurred on October 5 at 13:58:58.065; event 507 occurred on October 6 at 05:31:59.677. The host's event text establishes entry and exit from Modern Standby. The running task host and bootstrap were created the previous day. They survived the pause.

Dirty bootstrap recorded `supervisor heartbeat stalled` at 05:33:16.889 and its child exit at 05:33:29.079. The next `start` record was at 05:36:16.612, readiness at 05:36:24.557, and RTC open at 05:36:44.691. This is 207.802 seconds from watchdog detection to RTC open, and 285.014 seconds from the Windows resume event to RTC open. Automatic recovery existed, but this observation violated the 60-second recovery budget.

The clean bootstrap likewise recorded a stalled heartbeat and restarted its worker. Its worker was ready well before the dirty offer arrived. Both hosts ultimately recovered without the task registration performed during this chat: the dirty child started at 09:36:16 local time, before the attempted task update at 09:37:21.

An unrestricted Task Scheduler query and process ancestry proved that `HFPipe-dirty` already existed and was running. Restricted shell queries returned an empty task list or a misleading path-not-found error. Restricted WMI and listener queries were also unavailable. These results were initially misinterpreted as missing infrastructure. The resulting task definition change was corrected to the existing signed generation's `task-host.exe`, without interrupting the worker. Absence must never be inferred from an inaccessible management surface.

The legacy operator bridge installation contained an older state/build. The real child executable and its ancestors lived in `~/.hf-pipe/runtime-generations/2a019125423b683c`. Runtime discovery must follow the scheduled task action and process ancestry, not the legacy directory.

## Root cause and limits of the evidence

The installed supervisor compared wall-clock age of the last child heartbeat immediately after its own timer resumed. It did not distinguish a pause affecting both supervisor and child from a child-only hang. Independently, the worker's clock-jump handler exited the entire Matrix process after a long scheduling gap. These two rules can force complete process startup after a normal host pause, even when the resumed worker could produce a fresh heartbeat and reconnect RTC.

[Node's timer documentation](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args) explains that timer callbacks do not have exact execution time or guaranteed ordering. A delayed supervisor callback alone cannot establish that its child was unresponsive while the supervisor continued running.

The old log has no timing records around signature/hash verification. The 167.533-second interval between exit and next start includes the restart delay and synchronous verification path, but does not prove which operation consumed the time. A separate read-only verification of the same signed release, containing 8,370 files and 98,701,844 bytes, completed in 4,132 ms with warm filesystem state. Cold I/O, scheduling pressure, and security inspection remain unmeasured explanations for the longer interval. This change keeps complete signature/hash verification and adds start/completion duration records rather than asserting an unproven explanation.

## Implemented recovery behavior

`supervisor-recovery.mjs` records the supervisor's own check times. A scheduling gap at least as long as the heartbeat deadline, or a backwards clock correction, opens one fresh heartbeat observation window. That window is bounded. Normal supervisor ticks with no child heartbeat still terminate the child; an unresponsive child after resume also gets terminated after the fresh window. Startup readiness remains independently bounded, and boot messages alone do not establish readiness.

The worker's clock-jump path now asks its RTC worker to recycle the peer connection while keeping the verified Matrix process and local RPC endpoint alive. The existing RTC actor and Matrix-staleness recovery remain responsible for persistent connection failures. No chat session, recurring Codex run, disabled TLS validation, new credentials, or skipped signature checks are required.

The bootstrap logs verification timing and supervisor scheduling gaps. The recovery module is included in both stable runtime construction and the signed bootstrap bundle; the fresh-package test checks its inclusion. Installation uses complete matching signed generations and preserves the old generation as the task-action rollback target.

## Verification record

The candidate source was isolated from the operator workspace's unrelated changes, starting from commit `2f413f51ef07c57704c58f0d36b58a6a6bf9ed4e`, which produced the installed generation. The complete suite passed: 274 tests, zero failures and zero skips. Tests include a real bootstrap with a signed synthetic child, a blocking pause in the bootstrap event loop, a child-only hang, bounded post-resume grace, startup readiness and genuine Matrix staleness.

Candidate: `1d122a2bc141639c`, protocol 3. The whole archive is 63,653,416 bytes; SHA-256 `091ddfed40606a254234ecc387ba6488bc1ddad1cbc9ec4bd327a5eb93fac6bc`. Its inventory contains 8,395 files. An archive audit found no private keys, session files, `.env`, logs, mutable runtime directories or repository metadata. It includes public peer identity required by the authenticated pair.

### First paired live candidate

Both scheduled tasks activated complete verified generation `1d122a2bc141639c`, protocol 3. Offer, answer and datachannel completed, followed by a real remote command. Forced exit of the dirty worker recovered automatically in 16.223 seconds, with a new worker PID and no task restart by the operator.

A controlled 65-second suspension of the dirty bootstrap, main worker and RTC worker recovered in 14.202 seconds after resume. The main PID remained unchanged; RTC generation advanced from 3 to 4. Logs recorded `supervisor-resumed gapMs=65273` and `clock jump 66506 recycle RTC after scheduler resume`. This emulates a shared scheduler pause; it is not a physical machine sleep/wake test.

Forced exit of the clean worker exposed a second recovery defect. Its signed release verification took 44.024 seconds; the new worker became ready 50.292 seconds after exit. It then waited 71.494 seconds for a fresh offer, and RTC opened 133.320 seconds after exit, measured entirely using clean-host timestamps. Dirty had issued a replacement offer while the clean worker was still verifying and the restarted answerer did not consume it. The existing 90-second stale-offer rule delayed the next handshake. This is now measured evidence rather than the previously unproven inference about cold verification.

### Final paired candidate

Generation `e046602b64ba6527`, protocol 3, adds an authenticated clean process-session identity to the existing health frame. Dirty requests one fresh offer for each newly observed clean session that is not connected. Repeated health frames from the same session do not disrupt an offer in flight. The complete suite passes 277 tests, zero failures or skips.

The whole signed archive is 63,654,236 bytes with SHA-256 `770bcfb7b737f256ec03992525ec4c07db65c451bc07392616e93ca9aad5f0b7`. A second inventory audit found 8,396 entries, no secret or mutable runtime files, and no ZIP corruption. Both sides staged and verified the same complete archive before task-action activation. Both tasks now point to this generation. The original and first candidate generations remain available for rollback.

The clean worker was deliberately terminated at `06:20:01.387Z`. Complete release verification took 3.216 seconds, readiness occurred at `06:20:13.580Z`, and RTC opened at `06:20:37.484Z`: **36.097 seconds** from exit to recovered clean datachannel, using clean-host timestamps. Dirty logged the new session and immediately requested a fresh offer. Both sides subsequently reported RTC up on the same build; a real remote command succeeded.

On the final candidate, a repeated 65-second shared scheduler pause recovered in **14.188 seconds**, preserving the main PID and advancing RTC generation from 3 to 4. A subsequent forced dirty-worker exit recovered automatically in **25.336 seconds**, replacing only the worker. No task restart was issued during either recovery check. The clean task retains its logon and session-state triggers; both persistent task actions target the final signed generation.

A fresh Kilo request through the clean proxy and dirty egress completed with provider `openai`, model `gpt-6.1-sol`, text `PIPE_OK`, and no error. Its completion record is `2026-10-06T06:22:50.287Z`. The request spanned the controlled live recovery checks. A later remote hostname command also succeeded. The verification receipt was saved as mutable operational data under the active clean generation, not as a source patch.

Synthetic and controlled live tests do not establish a universal recovery bound during an ongoing external network outage or arbitrarily slow host I/O. Signature and complete file verification remain enabled.

## Operator procedure

Read `/status` on port 18765 for current RTC state, and the independent bootstrap board on port 18764 for process readiness and report age. Query Windows task management in an unrestricted host context when the restricted shell cannot access it. If task discovery fails, record the discovery failure; do not register a replacement task against a guessed legacy root.

After resume, the supervisor automatically observes fresh heartbeats, recycles RTC, or restarts a genuinely unresponsive child. For release-regression startup failures, keep the established signed rollback path. For an external outage, keep retrying the existing network protocol and expose the cause and elapsed recovery time; operator intervention must not be part of a routine restart.
