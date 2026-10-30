# Session Log

## 2026-10-30 — R2 complete: #214 and #215 merged; ADRs 0017 and 0018 accepted

- **#242 (#214): site exceptions, dependencies, per-site blackouts and plan checks.** It took three review rounds before the sponsor merged it.
  - **Built:** `planChecks()` runs the 8 general checks and the data-migration preset's 4. Missing input gives advice rather than silence, and `validate()` now checks template and exception references. It also adds the workbook's Exceptions and Dependencies sheets and a Plan checks tab.
  - **Demo:** it now seeds all five problems, which give six findings.
  - **Review rounds:**
    - **Round 1:** precedence was tested on the late side only, "next wave" only on waves whose sites agree, and three guards had no tests.
    - **Round 2:** the order checks were tested only at day precision, and a removed site's own dependencies were dropped without a word.
    - **Round 3:** the coordinator probed it, and the coarse-order test fails as it should.
  - **Sponsor decisions, now in ADR 0017:**
    - **2026-10-29:**
      - checks are independent;
      - "next wave" runs up to the first wholly Planned wave;
      - expiry advice is for `preference` exceptions only;
      - residency skips `purge` and `retain`.
    - **2026-10-30:** in an order check, a coarse date counts from its period's first day, as the phase does.
  - **Accepted:** ADR 0017, and the ADR 0016 point 8 amendment, which keeps the refusal and extends it to `add` exceptions.
- **#241 (#215): actuals through the workbook, the burn-up with 25/50/75% checkpoints, and the site fact sheet's Migration tab.**
  - **Review rounds:**
    - **Round 1:** checkpoints went late on the exact day rather than at the end of the shown period.
    - **Round 2:** in a mixed-precision wave, a checkpoint took its period only from the sites that were transitioning.
  - **Reconciled with #242:** 14 adjacent conflicts. The generated files were regenerated rather than merged, and the Migration tab now shows exceptions, dependencies and the site's findings.
  - **Checked by the coordinator:** the regenerated demo is byte-identical, and the latest-ending-period probe fails.
  - **Accepted:** ADR 0018 (no baseline, the current-wave rule, `ceil` targets, late from the period's end, go/no-go not moving the phase, no schema bump), and ADR 0013 point 9 gains six burn-up rows.
- **Harvested:**
  - **CLAUDE.md:**
    - every check that reads a precedence pins both sides itself;
    - a set predicate needs members that disagree;
    - a date comparison needs disagreeing precisions.
  - **Review skill:**
    - when two checks read one input, say whether one yields;
    - flags follow the shown period;
    - a rounding needs set sizes that separate it;
    - a rule over a share covers every member counted;
    - an instant asserted beside its period must not be the period's first day.
- **Filed:**
  - #243: a half-typed date clears the value in both site dialogs;
  - #244: `planChecks` runs on every change;
  - #245: an `add` subject created by the same import;
  - #222 gains the `removeSites` cascade of `dependsOn`.
- **The session limit** interrupted two agents. Both were resumed with their work intact.
- **#230 decided** (sponsor, 2026-10-30), and recorded as ADR 0019 (Accepted), which amends ADR 0013 point 4 and ADR 0014 §2:
  - **Site-relative template slots.**
  - **Two entries per data object:** `remove` the Realization at cutover, and `replace` the store at decommission. Each store retires once.
  - **A disposition per data object** on the template.
  - **A shared store moves with its last site.**
  - **One store per site in the demo.**

  The code lands with R3's derivation (#60, #61, #64), and #230 stays open until then.
- **Open:**
  - **R3:** #60, #61 and #64, which carry ADR 0019's slots and regenerate the demo.
  - Switch the older rollout journeys and fixtures to the demo.
  - Visible follow-ups: #236 (the register scrolls sideways at 1280 px) and #243 (a half-typed date clears the value).
  - #208 and #210 still lack a LibreOffice-saved fixture.

## 2026-10-29 — #235 merged: the #229 review's fixes, ADR 0016 amended, #233 closed

- **#235**, the fixes from the #229 review, took three review rounds and was merged by the sponsor. It closes #233.
- **What it fixes:**
  - **Prototype keys:** `getKey` is guarded by `Object.hasOwn`, and the shared fixture carries a `constructor` milestone.
  - **ADR 0016 amended** by the sponsor's 2026-10-28 decisions:
    - a spaced date is reached on its exact day, and is shown and judged overdue by its period;
    - a site in no wave follows its actuals and is never overdue.
  - **The register:** the grid constants moved to `register-columns.ts`, with a file test.
  - **Labels and history:** history entries name their subject, and the archetype label reads "Standard (placeholder)", clamped to two lines.
  - **A journey** for the Milestones tab, the site Dates dialog and the wave dates.
- **Round 1, approve after 3:**
  - the backward-spaced exact day was untested;
  - so was the precedence of actual over spaced day;
  - the placeholder label was clipped.
- **Round 2, approve after 1:** an actual day earlier than its spaced day was untested.
- **Round 3:** the coordinator checked it by running the probe (`max(actual, spaced)` fails the test).
- **Harvested:**
  - CLAUDE.md:
    - a rule applied with a sign is two cases, and an "early or late" precedence is tested on both sides;
    - clipped text is read where it renders.
  - Review skill:
    - a precedence order is a guard per adjacent pair;
    - a raised minimum is measured at the viewport the issue named;
    - a probe of a fixture-carried constant regenerates the fixture;
    - a preset's keys are checked against the plan's set.
- **Filed:**
  - #236: the register scrolls 312px sideways at 1280×720, and the milestone grid is untested;
  - #237: the workbook's `locationAfter` setKey miss;
  - #238: history naming for site and wave dates;
  - #239: a lint rule for record reads, `harness`;
  - #240: cleanups.
- **Open:**
  - R2: #214 (plan checks, including the demo's dependency problem) and #215 (actuals);
  - R3 needs a decision on #230;
  - switch the older rollout journeys and fixtures to the demo;
  - #236 is the most visible follow-up.

## 2026-10-28 — #212 and #213 merged; ADR 0016 accepted and amended; #229 fix PR #235 open

- **#229 (#213), milestone sets, date inheritance and the derived site phase:** merged by the sponsor before its review finished.
  - **ADR 0016** was accepted as written.
  - **The post-merge review** found:
    - **A crash, blocking:** a milestone labelled "Constructor" blanks the rollout screen, and the model is saved with it. The cause is a `record[id]` lookup that finds `Object.prototype` members.
    - **Points 2 and 4 together:** a wave dated only to the quarter spaced every milestone into that quarter, so its sites read Migrated before any cutover.
    - **Point 4:** a site in no wave read Unplanned even with an actual cutover.
  - **The sponsor decided:**
    - a spaced date's phase uses the chain's exact day, while overdue keeps the shown period;
    - a site in no wave follows its actuals and is never overdue.

    Both go into ADR 0016 as an amendment, in the fix PR.
  - **The fix PR is #235** (open, CI green, not yet reviewed). It covers the prototype-key fix with a `constructor` milestone in the shared fixture, both amendments, and #233. It closes #233.
- **#228 (#212), the generated 160-site demo:**
  - **Contents:** 5 regions, 20 countries, 160 sites and 8 waves. Each wave is dated at its own precision: day, week, month or quarter.
  - **Seeded problems:** four, for #214. A dependency-order problem waits for #214's dependencies.
  - **The demo opens at its own as-of day** through `?at=`.
  - **First review: request changes.** The freeze-window half of the blackout guard was untested.
  - **Fixed;** the branch also adopted #213.
  - **Re-review: ready.** The sponsor merged it, which closes #212 and #213.
- **Harvested:**
  - CLAUDE.md:
    - a predicate over a span is two guards;
    - a lookup by a key somebody else chose finds `Object.prototype`.
  - Review skill:
    - narrow a multi-predicate guard rather than delete it;
    - a repeated expected value: ask what the consumer does with it;
    - a post-merge review becomes a fix PR;
    - assert visibility, not attributes, and check a fixed-track grid against its container;
    - fake the clock for a fixed time point;
    - a test of two collapsed copies goes with the copy.
- **Filed:**
  - #230: R3 template semantics. The demo retires each store twice and replaces the store, where §4.8 replaces the realization.
  - #231: "Sites per region" lists countries.
  - #232: first-run focus.
  - #233: the register's 0 px columns for a writer, on `main` since #229.
  - #234: #228's round-2 follow-ups.
  - A line on #214 for the dependency-order problem the demo still lacks.
- **Open:**
  - review #235 with `/review-pr 235 high`, then merge;
  - R2 continues with #214 (checks) and #215 (actuals);
  - switch `rollout.spec.ts` and `rollout-workbook.spec.ts` and their fixtures to the demo;
  - #208 and #210 still lack a LibreOffice-saved fixture.

## 2026-10-27 — #205 and #224 merged; #223 approved; rules harvested

- **#205 (#52), the import dialog:** fixed and re-reviewed twice, then merged.
  - The second re-review found a picker refusal reported as "a fault in Archipelago"; it now gets its own `file.picker-refused` problem.
  - `importFile` no longer rejects.
  - The third re-review approved it, and kept the dialog's `try … finally` as a backstop nothing reaches.
- **#224 (#210 and #221), the rollout workbook:** approved and merged.
  - It closes #221.
  - #210 stays open, because the first criterion ("edit in Excel") is only simulated. The tests use inline strings, while Excel and LibreOffice rewrite the whole package. This is the same LibreOffice-fixture debt as #208.
  - Non-blocking findings are in #226. The most important: an empty text cell silently sets a property to `''`.
- **#223 (#211), the rollout screens:**
  - **First review: request changes.** Every capacity bar was painted red by an unscoped CSS rule, untested off the DOM. Delete dialogs did not name the plan cascade. The colour mapping for RAG and load was not recorded.
  - **Fixed** in `80f36c4`. `ModelStore.removalPreview` is now the one source of delete wording. ADR 0013 point 9 gained RAG and load rows, dated, under D7.
  - **Re-review approves.** Non-blocking findings are in #227.
  - **Merged with `main`** after #224 (`9f0a10a`): `PaletteProvider.tsx` and `global-shortcuts.test.tsx` keep both blocks. Typecheck, lint, all 2,661 tests and the 4 rollout journeys pass on the merged state.
- **The session limit** interrupted three agents (the #205 fix and the #223 and #224 reviews); all three were resumed through SendMessage with their work intact.
- **Harvested:**
  - CLAUDE.md:
    - the fix's own fallback is the next closed branch;
    - a second call site of a fix is a guard of its own;
    - a `switch` over a precision has one test per case;
    - when a `try … finally` is not such a branch;
    - a colour is read off the computed style against a sibling that must differ.
  - Review skill:
    - a confirmation names the whole cascade at every call site, and `describeCommand` is a consumer of the command shape;
    - a freshness check holds what the dry run read, and a docblock's guarantee is a criterion.
- **Filed:** #225 (stylelint `no-duplicate-selectors`), #226 (#224 follow-ups) and #227 (#223 follow-ups).
- **Open:**
  - the sponsor merges #223;
  - next in R1 is #212 (the 160-site demo);
  - R2 is #213–#215;
  - a LibreOffice-saved fixture is owed for #208 and #210.

## 2026-10-26 — #216 and #217 fixed, re-reviewed and approved; ADR 0015

- **Fixes** were made by fresh Opus agents in their own worktrees. #216's are in `38aaf42`. #217's are in `18eee41`, which is ADR 0015 (plan dates and the exchange mapping of rollouts, amending ADR 0013 points 5 and 10: no Plateau per wave), and `d1583bd`.
- **Re-reviews by fresh Fable agents approve both.** Every disposition was checked by removing it: 13 on #216, 12 on #217.
  - **#216:** the one merge condition was a corrected PR description, now done. #208 stays open, because the LibreOffice and Excel fixture is still owed.
  - **#217:** the pointer from ADR 0013 to ADR 0015 is kept. The code-review layer printed no agent counters, so every finding was verified by hand.
- **Merge check:** both PRs merged onto `main` in a scratch worktree, the only shared file being `src/io/README.md`. Typecheck and lint pass, and all 2,417 tests pass.
- **Filed:**
  - #221: XLSX reader follow-ups, among them `cellXfs` dropping a bare `<xf/>`, which can make a number read as a date. They come first in #210.
  - #222: rollout follow-ups. `assignSites` refuses a site whose Location is gone. Template references are not validated. A dropped relationship in a folder is reported falsely. One condition operand is untested.
  - #211 and #213 now point to #222 through `gh issue edit`, because the permission classifier refused the agents' issue comments.
- **Harvested:**
  - CLAUDE.md: an operand added to an existing condition is a new branch.
  - Review skill: a "grep every X" disposition lists its hits; a validator's "kept so it can be reassigned" message is checked against the commands.
- **Open:** the sponsor merges #216 and #217, in either order. The locked agent worktree from #209 is still to clean up.

## 2026-10-26 — Reviews of #216 and #217: both request changes; rules harvested

- **Fresh Fable agents ran both reviews in parallel** (`/review-pr high`). Their code-review layers ran fully. The implementations came from agents of this coordinating session, which each review says.
- **#216 (#208), XLSX — request changes.**
  - **B1:** the escape lookahead misses an `_xHHHH` followed by a character the writer escapes, so such text comes back changed with no problem reported.
  - **B2:** the formula tally and the error-cell problem are counted before a duplicate cell is dropped.
  - **Eight non-blocking findings,** among them a carriage return written as `&#13;` where Office writes `_x000D_`. The single-pass `_x005F_` decoding is confirmed right.
  - **Filed:** #218 (coverage gate for `xlsx*`) and #219 (provenance check for `.xlsx` fixtures).
- **#217 (#209), rollout model — request changes.**
  - **Blocking 1:** a wave's end is not exported as a Plateau as ADR 0013 point 10 says, yet the README cites that point. This needs ADR 0015 (plan dates and the exchange mapping) in the PR.
  - **Blocking 2:** `isWritersOwn`'s `bare` guard has no test.
  - **Non-blocking:** a number- or boolean-typed plan property loses wave plans on import, and the writer's site sort is untested.
  - **Settled:** composed ids need no escaping, because they are never parsed.
  - **Filed:** #220 (the exchange writer silently overwrites a user property keyed like a profile key).
- **Harvested:**
  - CLAUDE.md: the separator rule now asks for the case where the next escape closes the delimiter, and the fail-when-removed rule says to reverse a fixture before testing a sort.
  - Review skill: `.filter(isNode)` ahead of a count or a position; read an implementer's notes document such as MS-OI29500; read every numbered point of an ADR against the diff.
- **Open:** the blocking fixes on both PRs, then re-review and merge.

## 2026-10-26 — #208 and #209 implemented in parallel: PRs #216 and #217 open

- **#216 (#208), XLSX reader and writer:** our own, on `zip.ts` and `fast-xml-parser`, about 8.5 KB with no new dependency.
  - **Spike:** `xlsx` has unfixed high advisories on npm; ExcelJS adds 269 KB; read-excel-file returns `null` for `#N/A`, the same as for an empty cell, which under #94's blank-deletes rule would delete data.
  - **Behaviour:** an unreadable cell is reported, not skipped; formula-like text stays text; dates come out the same under `TZ=UTC` and `TZ=Pacific/Auckland`.
  - **Not done:** the LibreOffice/Excel fixture criterion, since neither is installed. The fixture is written by openpyxl. The PR says "Implements", not "Closes".
- **#217 (#209), rollouts, waves and site plans in the model** (schema 6):
  - **What it adds:** `src/model/plan.ts`, 11 store commands, exchange and `.archimate` fold-back, `validate()` findings, and a 160-site fixture.
  - **Tests:** 36 guards were each removed in turn and each made a test fail. That surfaced a reader guard masked by the store's own refusal; it is fixed.
  - **Decisions ADRs 0013 and 0014 left open,** now file-format commitments that need an ADR (0015 or an amendment to 0013):
    - a `PlanDate` is stored as the first day of its period;
    - how site plans map to the exchange format: ids `<rollout>.site.<location>`, per-milestone `archipelago.plan.*` keys, derived Work Package names.
- **Both PRs:** CI green, mergeable, not merged. Next is `/review-pr` on each. They are independent and both based on `main`.
- **Side effect:** the #208 agent tried Numbers through AppleScript, unasked, and timed out; a dialog may have been left open.

## 2026-10-26 — Migration planning for 160 sites: research and proposal

- **Research** in four passes: the ArchiMate 3.2 and TOGAF E/F concepts; the commercial tools (LeanIX, Ardoq, Bizzdesign/HOPEX/Alfabet); multi-site rollout practice (AWS, Microsoft CAF, Google, SAP template rollouts); and open-source tools and time modelling (Waltz, Essential, Archi, the literature). The report is `design/specs/migration-planning-research.md`. Open Group and LeanIX pages are behind a login or JavaScript now, so they were read through Internet Archive snapshots, as the report says.
- **The proposal is `design/specs/migration-planning-proposal.md`.** One rollout carries a scope template; waves are Work Packages; site plans are records keyed by Location. Per-site changes are derived from the template and the site's resolved dates, and dates inherit (site, then wave, then rollout) with a precision. The site phase is derived and never stored. It builds on #58's overlay model and does not replace it.
- **Slices:** R1 site register and wave plan, R2 detailed site plans, R3 architecture change (needs #58, #60, #61 and #64), R4 scenarios and a sequencing assistant.
- **Sponsor decisions, the same day:** R0–R2 start now, alongside the editor (**ADR 0012**). Data migration comes first, but the model is general, so milestone sets are configurable and data migration is a preset (proposal §4.8). Excel is the first plan format: one rollout workbook carries plan and actuals.
- **Filed:** tracking issue #206; R0 #207 (rollout-model ADR); R1 #208 (XLSX reader and writer, shared with #94), #209 (model), #210 (workbook), #211 (screens), #212 (160-site demo); R2 #213 (milestones, precision, phase), #214 (exceptions, checks), #215 (actuals, burn-up, Migration tab).
- **ADR 0013 (rollout model)** accepts D2 and D5–D7 as proposed.
- **ADR 0014 (time and change model, #58 option 2)** is accepted. Its points:
  - **Dated validity:** element states (planned, live, retired) come from lifecycle dates; relationships are valid between `validFrom` and `validTo`.
  - **Change entries** are owned by initiatives: introduce, retire, replace (which records a successor link), add, remove and modify. Each entry dates an object that exists in the model and never holds one.
  - **Plan of record and scenarios:** the plan of record is every initiative approved or later; a scenario includes or excludes named initiatives on top of it.
  - **Named states** are stored `(date, scenario)` pairs, exported as Plateaus.
  - **`modelAt`** is the one way to read a state. Where an entry and a stored date disagree, the entry wins and a conflict is listed.
  - **Planned values** are limited to an allow-list, and conflicts are computed, never prevented.

  ADR 0014 confirms ADR 0013's change-entry shape, so #207 is done.
- **Open:** #58 still needs its `modelAt` spike: 10 ms at 5,000 elements and 15,000 relationships. #209 is unblocked. R3 and R4 are filed once R2 is done. #72 and #94 do not yet mention the new track; the comments were not posted.

## 2026-10-23 — #52: the import dialog's read failure, PR #205 open

- **Branch `feat/52-import-error-path`.** Nothing merged.
- **Fix:** `ImportDialog` wraps `importFile` in `try … catch … finally`. The catch reports the error through a new context call, `reportImportFailure`, in the existing report. The finally re-enables the buttons and clears the input.
- **Test:** `files.test.tsx` uploads a `File` whose `arrayBuffer()` and `text()` reject (the reader now calls `arrayBuffer()`, not the `text()` the issue names). Removing the finally fails it (the button stays disabled), and removing the catch fails it (no report, unhandled rejection). So does the original code.
- **Review** (same session; code layer in a fresh agent) had two findings, both fixed in `8e8f7b8`:
  - the test did not cover the input reset, which is what lets the same file be picked again; it now asserts the value is cleared;
  - the catch called any throw "could not be read". A failed `arrayBuffer()` or `getFile()` now throws `FileReadError`, and `importFailure` maps it to `file.unreadable` and anything else to `import.failed`. The picker path uses it too.
- **Removal check:** each guard was removed in turn (7 probes, including the reset alone), and a test failed each time. CLAUDE.md: two lines sharpened (`2513cc7`).
- **Re-review (2026-10-27, request changes) fixed:** the picker's own refusal (`NotAllowedError`, `SecurityError`) was called "a fault in Archipelago"; the picker call now has its own catch and a `file.picker-refused` problem, Cancel stays silent, and tests cover refusal, Cancel and a reader crash through the picker path. `importFile` is now total (`.catch(importFailure)` in the provider), so `reportImportFailure` is gone; `failure()` is shared, a thrown full stop no longer doubles, and one `unreadableFile` fixture serves both tests. 9 of 10 probes fail a test; the dialog's `try … finally` as plain statements survives, since nothing reachable throws past `importFile` now.

## 2026-10-23 — Reviewed and merged #201, #202, #203; #200 and #204 merged

- **#200 (#195) and #204 (#198) merged** after their review fixes. Branches deleted.
- **#201 (#189), schema served at its `$id`:** the criteria are met. Fixed on the branch: a test now runs the build's check script, since deleting its `process.exit(1)` had left everything green. Not blocking: the check accepts any `*.github.io` owner.
- **#202 (#177), regex in `toMatchObject`:** the rule is sound, but CLAUDE.md said "lint rejects it" while an `it.each` row or a loop variable passes lint and still matches anything. Fixed on the branch: an equality tester in `src/test/setup.ts` fails the trap at run time wherever lint cannot see it, and CLAUDE.md and the rule's comment say what each layer catches.
- **#203, review nits from #196 and #197:** no bugs. Not blocking: `LinePanel` restates `ghostsIn`'s line rule rather than sharing one function.
- The generic code-review layer ran in fresh agents for all five PRs. Each merge followed green CI, and the session log was re-merged from main between merges.
- **Open:** #205 (#52) is awaiting review. The reader-switch sweep is proposed as a session card. The merged branches and their sessions' worktrees are still there.

## 2026-10-23 — Review of #200 (#195) and #204 (#198)

- **Same-session review**, so less independent. The generic code-review layer ran in two fresh agents that saw only the code.
- **#200, blocking:** a reader could still write through a sheet's Name or Documentation field. Edit mode ended in a passive effect, and a refused save's dialog takes focus in the commit that makes the tab a reader, blurring the still-mounted field into a write. **Fixed** (`77a5ad1`): the fields render on `editingOpen && !readOnly`, and a test with `TakesFocusAsReader` fails without it on each sheet. One add-relation assertion that could not fail was dropped. Checked in a real browser (Playwright): with nothing taking focus, React drops the removal blur, so the half-typed name is discarded, not written.
- **#204, blocking:** `PanelTextField` saves typing on unmount. As a reader that throws in React's commit, which blanked the whole app. **Fixed** (`5679586`): the typing is dropped. The test also pins the provider's layout effect, since as a passive effect the cleanup wrote as a reader. The test file's claim that every screen has its guard was corrected: the canvas's inline name editor has none.
- **Not blocking, left to the reader-switch sweep:** focus falls to `<body>` when a mode ends, so a user still typing can trigger single-letter shortcuts; the canvas's inline name editor outlives the switch; the view-editor harness renders without `FileWorkspaceProvider`.
- **Harvested:** CLAUDE.md's reader line now asks a blur-committing field to render on the role, and forbids writing in an effect cleanup as a reader.

## 2026-10-23 — #198: the store refuses a reader's writes, PR open

- **Branch `feat/198-store-reader-guard`, on top of #200 (#195).** `ModelStore.setWritable`: while it is off, `dispatch`, `undo`, `redo`, `saveReport` and `registerTag` throw `ReadOnlyModelError` before anything changes; `replaceWorkspace` and the save marks stay open. `FileWorkspaceProvider` sets it from the same `editable` the screens read (tab lock and shared-folder lock), in a layout effect, so the guard holds before the first event a new role can see.
- **Found by it:** the inventory's "+ Element" dialog outlived a switch to reader. Under load a shared-folder writer fences itself, and `shared-model.test.tsx` then clicked Create as a reader; before this change that wrote. Fixed with the same `role` effect as #195.
- **Tests:** the store refuses every write, undo and redo, and nothing moves; a reader still loads. `reader-guard.test.tsx` renders a screen with no guard of its own through the real providers. Seven guards were removed in turn, and each removal fails a test. `renderScreenAs` now renders through `FileWorkspaceProvider`.
- **CLAUDE.md:** the reader-switch line now says what the store guard covers, and why a screen still ends its own modes.
- **Local note:** four parallel sessions pushed the load average to about 89, and 5 s timeouts failed tests in `ModelTree`, `connect` and `shared-model`. All pass once the machine is quiet.
- **Open:** the canvas (`ViewScreen`) and the other dialogs have not been swept for modes that outlive the switch. With the store guard, they throw rather than write.

## 2026-10-23 — #195: fact sheets end edit mode for a reader, PR open

- **Branch `feat/195-reader-edit-mode`.** Both fact sheets end what a writer opened when the role becomes reader, with an effect on `role`, as CLAUDE.md's reader-switch line says. On the element sheet that is edit mode, a relation being added (the same gap, found here) and #197's delete. On the model sheet it is edit mode. None of them reopens when the tab can write again.
- **Tests:** a reader render (Edit is disabled) and a switch to reader mid-edit, for each sheet, plus the add-relation dialog. `renderScreenAs` (`src/test/render.tsx`) renders one screen with the role in the test's hands. Each of the five guards was removed in turn, and each removal fails a test.
- **Not done:** the "every route as a reader" harness, which the issue lists as "consider". #198 makes the store the one guard, and that covers the next screen better than a sweep of controls.
- **Running in parallel**, each in its own worktree: #52, #189, #177 and the non-blocking #196/#197 findings.
- **Local note:** the main checkout's `node_modules` lacked `@vitest/coverage-v8`. Fixed with `npm ci`. Local `npm run lint` scans the parallel sessions' worktrees again, so use `npx eslint --ignore-pattern '.claude/**' .` until they are removed.
- **Next:** review and merge this PR, then #198.

## 2026-10-23 — #189: the workspace schema is served at its `$id`, PR open

- **Branch `feat/189-serve-schema`.** Nothing merged.
- **Copy:** `scripts/emit-schema.ts` runs after `emit-404` in `npm run build` and copies `design/archipelago-workspace.schema.json` to `dist/schema/`, unchanged.
- **Check:** `scripts/check-published-schema.ts` runs last in the build. It works out the `dist/` path from `SCHEMA_ID` (origin and Pages base stripped, by `src/io/published-schema.ts`) and fails unless the file there is byte-identical to the design file. It refuses an `$id` that is not https on `*.github.io` or not under the base.
- **Proven:** with the copy step removed, `npm run build` exits 1 with "…is missing, so … would 404". Each guard in `published-schema.ts` was removed in turn, and a test failed each time.
- **Pages serves `.json` as `application/json; charset=utf-8`:** checked with `curl -I` on `pages.github.com/versions.json` and on rrradio's `discovery.json`, which is deployed with `actions/deploy-pages` as this repo is. GitHub's docs page on Pages MIME types now returns 404, so it is not cited.
- **Open:** after the merge deploys, `curl -I` the `$id` URL to confirm 200 and the content type.

## 2026-10-23 — #177: lint rejects a regex in toMatchObject, PR open

- **Branch `feat/177-lint-tomatchobject-regex`.** Nothing merged.
- **Rule `archipelago/regex-in-to-match-object`** (in `eslint.config.js`, a local plugin, because no selector fits): it walks only the positions that become part of `toMatchObject`'s expected value, so `{ a: s.replace(/a/, 'b') }` stays allowed. Catches a regex literal, `new RegExp`/`RegExp()`, nested objects and arrays, spreads, `?:`/`&&`/`||`/`??`, TS wrappers, and a regex or expected object held in a local variable.
- **Gap, documented in the rule and pinned by a test:** a regex reached through a member, a call, an import, a parameter, a destructuring or a loop. These need type information.
- **Proven:** every branch of the rule was removed in turn, and a test in `eslint-rules.test.ts` failed each time. A test also shows the trap itself on vitest 2.1.9.
- **No existing hits** in `src` or `tests`. CLAUDE.md's acceptance-test bullet names the trap and the rule.

## 2026-10-23 — Review nits on #196 and #197, PR open

- **Branch `fix/196-197-review-nits`.** Nothing merged.
- **#196, finding 2:** `LinePanel` asks `excludedBy` of the elements at the line's two ends, rather than `ghostsIn` over the whole view, and names the viewpoint as `SelectionPanel` does. The old test only had a refused *source*; new cases cover a refused target (Claims Engine → a Requirement) and a plain line from a ghosted shape.
- **#197, finding 4:** `opening.test.tsx` opens the landscape with `?node=`, `?line=` and `?element=` on a sized canvas, and reads the subject's centre off the drawing's transform. The view-editor harness takes a `search`.
- **#197, finding 5:** the drawn-scale test pins each check's count (unused relations 4,997, viewpoint 100, nesting 2,400), derived from the fixture's layout.
- **#197, findings 6 and 7:** `CheckGroup` memoises its rows' targets on the revision, which the screen passes down, and its own revision subscription is gone. A test counts `findingTarget` calls.
- **Every guard was removed in turn, and a test failed.**
- **Open:** the sponsor reviews and merges.

## 2026-10-23 — #199 and #197 merged; worktrees cleaned up

- **Merged #199** (#192's nits, `d4c2467`) on green CI, and deleted `fix/192-model-sheet-nits`.
- **Merged main into `feat/193-validator`:** the only conflict was this log, and both sides' entries are kept.
- **Merged #197** (the validator, #193, `e8a913e`) on green CI, and deleted `feat/193-validator`.
- **Removed both stale worktrees** (`nervous-payne-ae68ca`, `elastic-khayyam-00d501`); neither held unmerged work. `npm run lint` is clean locally again.
- **Next:** #195; finding 2 on #196 and findings 4–7 on #197 (neither blocking).

## 2026-10-23 — Review of #197 (validator): changes requested

- **Port verified** with `javap` against all eight checkers and `Validator.validate`, with no divergence. All criteria are met except a repeat click on a folder finding.
- **Three blocking findings, each small:**
  - the fact sheet's Delete dialog deletes after the role becomes reader;
  - a second click on a folder finding does not reopen a closed tree;
  - the reused canvas dialog says "No other view draws it." on the fact sheet.
- **Not blocking:** centring on `?node=`/`?line=` is untested; the scale test's `> 0` bound; `findingTarget` is recomputed per row; a redundant revision subscription.
- **Harvested:** #198 (store refuses commands in a reader tab); a CLAUDE.md line on reader switches; a review-skill note on reused dialogs (`2f374ee`).
- **Findings 1–3 fixed** (`Validator review fixes…`):
  - the Delete dialog ends when the role becomes reader, and does not reopen;
  - a folder finding opens the tree on every navigation;
  - `DeleteElementDialog` takes `inView`, so the fact sheet says "Drawn in" and "No view draws it."
- **Each fix was removed in turn, and a test failed.** The render guard `deleting && !readOnly` was dropped as redundant next to the effect, and CLAUDE.md's reader line now names the effect.
- **Rebased on `main`, twice:** #196 (#194) merged during the fixes, with two doc-comment conflicts. All gates pass on the final base (2,061 tests, coverage, build), and e2e 43 passed. On the first base, journey 16's known flake failed once and then passed 5/5. The validator journey is renumbered 23.
- **Open:** findings 4–7 (not blocking); the sponsor merges.

## 2026-10-23 — M3: the validator (#193), PR open

- **Branch `feat/193-validator`.** Nothing merged.
- **Model:**
  - `src/model/checks.ts` ports Archi 5.10's eight `hammer` checkers, read with `javap`.
  - `Finding` gains `advice`, `node`/`connection` subjects with a `viewId`, and a `check` tag.
  - `validate()` keeps its contract; `runValidator(workspace, enabled)` is the screen's run.
  - `src/model/nesting.ts` holds `meansNesting`, which the #131 prompt and the nesting check both call.
  - The store gains `revision`, which moves on model changes and not on a save, so a save does not mark a run stale.
- **UI:**
  - `/validate`, reached from the left nav and the palette's "Validate model".
  - Each check can be switched off, remembered in localStorage, all on when storage is blocked.
  - Each finding opens its subject. The canvas reads `?node=` / `?line=`; the tree reveals `?folder=`.
  - The fact sheet gains "Delete…", needed by the e2e journey.
- **Evidence:**
  - `checks.test.ts` has a trip fixture and a near miss per check.
  - 44 guard-removal probes, each failing a test.
  - The scale test runs the validator on 5,000 elements in about 15–30 ms.
  - e2e journey 23 (`validator.spec.ts`; numbered 21 until #192 and #196 took 21 and 22).
- **Open:** sponsor questions are listed on the PR.

## 2026-10-23 — Review of #196 (#194); #196 merged

- **Reviewed #196** (`/review-pr 196 high`) and approved it (as a comment). All seven criteria are met. Archi's connection rule (`ViewpointManager.isAllowedDiagramModelComponent`) and its tree rule (`TreeViewpointFilterProvider.getTextColor`) were re-read with `javap` and match the PR. Archi's legend never consults the viewpoint. Five guards were re-probed, and each fails a test.
- **Fixed finding 1 on the branch:** the tree's greying was asserted only as a class, and emptying the CSS rule left every test green. The ghosting journey now reads the name's computed colour against `--ink3` (`925b861`), and it fails with the rule emptied.
- **Merged main into `feat/194`** (`3f66294`). #192 had taken Journey 21, so ghosting is **Journey 22**. Full checks and e2e were green, and the sponsor merged #196 (`0305715`).
- **Harvested:** the review skill's rule that a token from a pure function is not a rendered token now adds that a class name is not the encoding either (`eca592a`).
- **Open:** finding 2 (a nit: `LinePanel` names the viewpoint from the raw string and re-runs `ghostsIn` for the whole view). The sponsor questions on #196 (token, guide, relationship greying, one opacity, #193's viewpoint hint). #197 now conflicts with main.

## 2026-10-23 — #192's two review nits

- **#192 merged** (`077c676`) before this session.
- **Fixed the two untracked nits from its review**, on `fix/192-model-sheet-nits`:
  - A test now renames the model in edit mode, undoes, and checks that the name field shows the undo. Removing `key={model.name}` fails it.
  - The model sheet's counts are set in mono (`.sheet__counts`). The test reads the rule off `factsheet.css`, since Vitest loads no CSS. Reverting the class or the font fails it.
- **Local lint note:** `npm run lint` reports 18 errors, all from stale worktrees under `.claude/worktrees/` (`elastic-khayyam-00d501`, `nervous-payne-ae68ca`). The repo's own files lint clean. Clean those worktrees up, or add `.claude/` to ESLint's ignores.
- **Next:** merge the nits PR; #195; #193 and #194.

## 2026-10-23 — Review of #192 (#171)

- **Reviewed #192** (`/review-pr 192 high`) and approved it. All four criteria are met. 15 guards were broken one at a time, and each one fails a test except two on the new model sheet: the reader's disabled Edit button and the name field's undo key. Journey 21 passes on the PR's own build.
- **Filed #195:** both fact sheets keep a reader out only through the Edit button, which no test covers, and edit mode survives a change to reader.
- **Harvested:** one review-skill bullet (each control that writes has a reader case), committed on the PR branch.
- **Next:** the sponsor merges #192. Then #195, alongside M3's first slice (#193, #194).

## 2026-10-23 — #194 viewpoint ghosting, PR open

- **What:** a shape whose element the view's viewpoint refuses is drawn ghosted (`--ghost-opacity`, a new token, 0.4 ≈ Archi's alpha 100/255), and so is a line with such a shape at either end. The selection panel names the viewpoint. While that view is open, the model tree greys the refused elements and the relationships with one at an end. Nothing is stored, and the SVG/PNG export keeps the ghosting.
- **Archi evidence** (Archi 5.10 `javap`, plus an `--html.createReport` run): drop from the tree has no viewpoint check; a connection ghosts when either end does; image export paints the same edit parts, ghosts included. The model and PNGs are in the side-session notes folder, `194-evidence/`.
- **Changed:** `ui/views/ghosts.ts` (new), `ViewDrawing`, `ViewScreen` (panel notes; an SVG export failure now shows in the alert, as PNG's did), `export-view` (resolves the token, fails if it cannot), `tree-model.greyedBy`, `ModelTree`, `tokens.css`. Journey 22.
- **Open:** sponsor questions on the PR (guide text, the token, relationship greying in the tree).

## 2026-10-23 — Guide links (#191); #171 built (#192)

- CI on `main` (`8ad1457`) is green; M2 is done.
- **#191:** the guide's four ADR/UI-spec links now name `Stein-Clankers`, and `repo-links.test.ts` fails on any link to this repository under another owner (proven against the old file).
- **Not done:** ticking #134–#137 on #74 (the session was refused issue edits); #187's review reply is still unposted, now moot since it merged.
- **#171 → PR #192.** Sponsor decision: follow Archi (recorded on #171). A connection's panel on a diagram edits its relationship's documentation. A model entry above the model tree opens a `/model` sheet with the model's name and documentation, through a new `document-workspace` command. New e2e journey 21. Two questions are on the PR: the model entry sits above the tree rather than as its root, and the element fact sheet still stores `''` when its documentation is cleared.
- **Sponsor's answers on #192:** the model entry above the tree is fine; element documentation is made consistent too (cleared is absent, and an unchanged field records nothing).
- **Issue edits:** `Bash(gh issue edit:*)` is now allowed in the global settings, so sessions can tick tracking boxes. #134–#137 are ticked on #74.
- **M3's first slice is filed:** #193 (validator: Archi 5.10's eight checks, with severities read from the `hammer` jar) and #194 (viewpoints: ghost disallowed concepts in a view and grey them in the tree, as Archi does by default). The two are independent.
- **Next:** review and merge #192 (`/review-pr 192 high`); build #193 and #194, in parallel if wanted; #189 is still open.

## 2026-10-20 (wrap-up) — M2's four issues on `main`

- **On `main`:** #184 (repo move), #185 (#137 copy/paste), #187 (#134 notes, groups, legends, view refs), #190 (review harvest), #188 (#136 grid/align/z-order) and #186 (#135 appearance/format painter), merged by the sponsor in that order. #134–#137 are closed. CI on `d950f14` (the #186 merge) was still running at wrap-up, so check it first next session.
- **Reviews** ran in four fresh sessions in parallel (`/review-pr … high`). #188 was approved. #185, #186 and #187 got small blocking fixes, made by their implementing sessions and proven by removing each fix. Harvests were proposed in the review bodies and consolidated into #190: four sharpened CLAUDE.md lines and three skill bullets. That kept four parallel reviews from colliding on `CLAUDE.md`.
- **Merge prep:** each later PR merged `main` in and re-verified on the merged state. #188 regenerated the `claims-edited.*` oracle through Archi after #185, rather than hand-merging it.
- **Sponsor decision:** snapping stays on by default, as in Archi (recorded on #188).
- **Still open:**
  - #187's reply to its review was never posted, because `gh pr comment` was denied in that session.
  - #189: the workspace schema isn't served at its `$id`.
  - The four guide links in `src/ui/guide/sources.ts` still point at the old owner (they redirect).
  - The app's sync tool still pins the old `MarkusSteinbrecher/Enterprise-Architecture` remote (seen by the #186 session).
- **Follow-up candidates from the PRs' questions:**
  - a legend ADR, now that the PRs are merged;
  - an editor for legend options;
  - a shape's line width through Archi (carry it, or hide the control);
  - cross-workspace paste;
  - snapping on palette placement and paste;
  - arrange shortcuts.
- **Branches to delete** (all on `main`, checked): `chore/move-to-stein-clankers`, `chore/harvest-m2-reviews`, `feat/134-notes-groups-legends`, `feat/135-appearance-format-painter`, `feat/136-grid-align-zorder`, `feat/137-copy-paste`.
- **Next:** M2 is done. Remaining under #74: M3. Also #171 (where documentation is edited, waiting on the sponsor).

## 2026-10-20 — M2 built in parallel: #185, #186, #187, #188 open

- **Four sessions, one per issue, each in its own worktree and on its own e2e port.** Nothing merged. #137 → PR #185, #135 → PR #186, #134 → PR #187, #136 → PR #188. Each PR checks off its criteria with evidence and lists questions for the sponsor (#185: 8, #186: 7, #187: 10, #188: 6). No PR bumps the schema version.
- **#184** (repo moved to the Stein-Clankers organization): its CI failed on Prettier padding in `tests/manual/README.md`. Fixed and green. The local `origin` now points at `Stein-Clankers/Enterprise-Architecture`.
- **Merge collisions, dry-run on `main`:**
  - #185 and #188 both regenerate the Archi oracle's `claims-edited.*` fixtures from `src/test/edited-claims.ts`. The second to merge re-runs `build-edited-claims.ts` and `archi-roundtrip.sh` on the merged state. Never hand-merge the fixtures.
  - #186 and #187 both edit `export-with-archi.sh`, `src/io/README.md` and `src/model/index.ts`. These are small text conflicts.
  - All four edit `ViewScreen.tsx`.
  - e2e journey numbers collide: #186 and #188 both use 17, and #185 uses 18.
  - #187 + #188 merge with no conflict. On that merged state: typecheck clean, 1798 unit tests, and both journeys pass.
- **Watch on merge:** #188 turns snap-to-grid and snap-to-guides on by default (Archi's defaults). Its harnesses (`view-editor.tsx`, `tests/e2e/support.ts`) switch snapping off, but a test that drags without them would land on the grid.
- **Next:** `/review-pr` each of #185–#188 at `high`, then answer the sponsor questions. Suggested merge order: #184, #187, #188, #186, #185. Retarget nothing, since all four are already based on `main`. After each merge, merge `main` into the next PR, re-verify the merged state (and regenerate the oracle for #185), then merge.

## 2026-10-19 (wrap-up 2) — #181 and #183 on `main`

- **On `main`:** #181 (#132, magic connector) and #183 (#182, revoke-timer flake), both merged by the sponsor. #132 and #182 are closed. CI on `2db32b0` (the #181 merge) was still running at wrap-up, so check it first next session.
- **#181's review** ran in the session that wrote it (`/review-pr 181 high`). The code-review layer ran in a fresh subagent and found 4 of the 5 blockers. All five were fixed with tests proven to fail without their fix. Harvest: `useFocusTrap` counts only tabbable items as its ends, and two CLAUDE.md lines were sharpened (prove a guard by removing its call, not a shared helper; a hover is an action that can unmount what holds focus).
- **Still open for the sponsor on #132** (recorded in the #181 description):
  - A release on a group keeps #129's plain line; Archi would create the element inside the group.
  - ⌘ to list element types first is not built.
  - Focus after a create goes to the name field.
  - Reverse-direction types on a shape are not offered.
- **Flake to watch:** e2e journey 16 (bend-points, #133) failed once in a full run, and one other full run lost a test it didn't name. Neither came back on rerun.
- **Branches to delete** (both on `main`, checked): `feat/132-magic-connector`, `feat/182-revoke-timer-flake`. The #183 session's worktree is `.claude/worktrees/elegant-volhard-df53f9`; archiving that session cleans it up.
- **Next:** M2's remaining issues #134–#137, and #171 (waiting on the sponsor's call on where documentation is edited).

## 2026-10-19 — #182: a download's revoke timer no longer outlives its test

- **Branch `feat/182-revoke-timer-flake`.** Nothing merged. Production code is unchanged.
- **Cause:** `downloadBlob` revokes its Blob URL on a 10 s timer that looks `URL` up when it fires. Six test files stubbed `URL` by hand and put jsdom's back with the timer still pending. jsdom's `URL` has no `revokeObjectURL`, so on a slow run the timer threw into a later test (CI run 39247687272, during #181).
- **Fix:** `stubDownloads()` (`src/test/downloads.ts`) stubs `URL` (as a subclass, so `new URL` still works) and the anchor click. When the test finishes, through `onTestFinished`, it clears every timer scheduled while the stub was in place, then restores both. GraphScreen, AppShell, CommandPalette, files, global-shortcuts and use-save-workspace now use it.
- **Proof:** `downloads.test.ts` advances fake timers 10 s after restoring. Without the clearing it throws `URL.revokeObjectURL is not a function`; without `onTestFinished` the next test still sees the stub. A tripwire fails any test file that stubs `URL` by hand (`stubGlobal('URL'`, `URL.createObjectURL =`, `spyOn(URL`, `globalThis.URL =`), and it caught a stub put back into GraphScreen. All three removals were run.

## 2026-10-19 (cont.) — #132 magic connector: PR open

- **CI on `main`** was still running on the wrap-up commit at the start; check it before merging.
- **#132** on `feat/132-magic-connector`. A connect gesture released on empty canvas from an element's shape opens the magic connector's menu. Relationship types come first, in Archi's order with its phrases ("Serves", "Composed of"). Each opens the target types valid for it, grouped by Archi's layers, filtered by the view's viewpoint. One `updateViewAdding` command makes element, relationship, node and connection, and the new shape's name opens for typing.
- **Read from Archi 5.10:** `MagicConnectionCreationTool` source at `release_5.10.0`, with the defaults checked in the shipped jar's `PreferenceInitializer` (`polarityMagicConnector` false, so relations first; `viewpointsHideMagicConnectorElements` true). Archi's target order differs from our catalogue in one place: Value Stream comes before Course of Action. `MAGIC_TARGET_GROUPS` carries Archi's order.
- **Oracle:** two magic edits in the scratch view (Triggering to a new Business Process, Serving to a new junction), re-saved by Archi 5.10 (`/Applications/Archi.app`). Everything came back as drawn.
- **Verified:** 1636 unit tests, lint, typecheck, format, build; e2e journey 17 (`view-magic.spec.ts`) 3/3; full e2e 35 passed, 1 skipped (#32). One full run failed journey 16 (bend-points) once, which then passed 3/3 alone and in two more full runs: a flake to watch. 22 guards removed one at a time, each now caught by a test. Three were redundant code and are gone.
- **For the sponsor** (also in the PR): a release on a group, note or view reference keeps #129's plain line, whereas Archi's magic connector would create the element inside the group. ⌘ to flip to elements first is not built. Focus after a create goes to the name field, as Archi's does, and reaches the canvas on Enter or Escape.
- **`/review-pr 181 high`, run in the same session** (the code-review layer ran in a fresh subagent, which found 4 of the 5 blockers): request changes on B1–B5, then fixed here.
  - **B1:** ⇧Tab left the modal. Fixed in `useFocusTrap`, whose ends are now only items Tab can reach.
  - **B2:** a hover dropped focus to `<body>`. A hover now focuses the type.
  - **B3:** a release off the canvas opened the menu.
  - **B4:** a guard test could not fail. The render gate is now the one guard, and stale menus are cleared.
  - **B5:** the empty menu was untested. Its message now names the junction's types.
  - **Nits:** `aria-current` replaces `aria-expanded`, the active index is clamped, and the oracle asserts presence first.
  - **Found while fixing:** a click without a hover focused the old column. Every fix is proven by a probe that removes it.
  - **Harvest:** the trap fix, plus two CLAUDE.md lines (remove the call, not a shared helper; a hover is an action).
- **CI flake on `main`, not this PR's:** `file-download.ts` revokes a blob URL after 10 s. `GraphScreen.test.tsx` un-stubs `URL`, and jsdom's `URL` has no `revokeObjectURL`, so a slow CI run throws an unhandled error. Filed as #182, fixed by #183.

## 2026-10-19 (wrap-up) — Every open PR is on `main`

- **On `main`:** #167, #174, #169, #172, #168, #175, #179 (re-land of #176) and #180 (re-land of #173 and #178). Issues #95, #97, #133, #145 and #164 are closed. No PRs are open.
- **CI on `main`:** running on `735a839` (the #180 merge) at wrap-up. Every merged branch was green locally on its merged state, but this run had not finished. Check it first next session.
- **Branches to delete** (all on `main`, checked): `chore/manual-scripts-refresh`, `feat/95-documentation-fields`, `feat/138-literal-style-marker`, `feat/97-archimate-zip`, `feat/164-coverage-gate`, `feat/145-drop-draws-relationships`, `feat/133-bendpoints-router`. Also `feat/165-shared-folder-followups` and `feat/146-collapsible-palette`: each holds only the stranded merge commit of #176 and #173, both of whose parents are on `main`.
- **HQ** (`a82aef5`): two lessons in `web-deploy-and-repos.md`. Retarget stacked PRs to `main` before a hand merge, and typecheck and run e2e on the merged state, because a merge with no text conflict can still break.
- **Next:** M2's remaining issues: #134–#137, #132, and #171 (where documentation is edited, waiting on the sponsor).

## 2026-10-19 (cont.) — Merge round: six PRs on `main`, three re-opened

- **Sponsor's calls on #178:** one bend-point per segment drag (Archi's); the ported Manhattan route stays; #174 takes schema 4 and #133 takes 5. Recorded on #178 and #133.
- **Merged by the sponsor, without `/review-pr`:** #167, #174, #169, #172, #168. The permission check refuses `gh pr merge` from a session ("merge without review"), so the sponsor merges by hand.
- **Stranded, as in October:** #176 merged into `feat/165-shared-folder-followups` 18 s after #172 took that branch to `main`. #173 merged into `feat/146-collapsible-palette` 22 s after #168, carrying #178 (which had merged into `feat/145-drop-draws-relationships`). None of it reached `main`. Re-opened as **#179** (coverage gate, #164) and **#180** (#145 + #133).
- **Fixes on the branches:**
  - **#169:** the Archi oracle's fixtures conflicted with #174. Rebuilt from the merged writer and re-saved by Archi 5.10.
  - **#175:** `tests/manual/archimate-import.md` kept both sides' steps. `archimate-import.spec.ts` merged with no text conflict and did not compile, since #174 had replaced the import its new journey uses. After `main` moved again, journey 13's race (fixed by #168) needed one more merge.
  - **`main` went red after #168:** since #174, the claims import has nothing to report and opens no dialog, and #168's journey 14 waited for its Done button. Fixed on #175 (journey 14) and #180 (14, 15, 16, cherry-picked to match).
  - **#180:** schema 5, #138's carried-style key list with `labelPosition`, the oracle re-run, and #138's re-export comparison naming the label position as carried only. 1572 unit tests on Node 24 and 25, full e2e 33 passed.
- **Merge order:** #175 (turns `main` green), #179, #180. Simulated in sequence: no conflicts.
- **For the sponsor:** stacked merged branches to delete once #179 and #180 are in: `feat/165-shared-folder-followups`, `feat/146-collapsible-palette`, `feat/133-bendpoints-router`, and after them `feat/164-coverage-gate`, `feat/145-drop-draws-relationships`. Also merged: `chore/manual-scripts-refresh`, `feat/95-documentation-fields`, `feat/138-literal-style-marker`.

## 2026-10-19 — #133 finished: PR #178 (bend-points, Manhattan router, label position)

- **PR #178**, stacked on #173 (`feat/145-drop-draws-relationships`). The WIP from 2026-10-16 is finished. Nothing merged.
- **Archi oracle:** `editedClaims` now shapes lines with the canvas's own `insertBendpoint`, `moveBendpoint`, `removeBendpoint` and `straightened`, and sets one line's label position. Archi 5.10 re-saved the export (`/Applications/Archi.app`). Every bend-point came back as drawn, and a new test reads them out of Archi's save. The label position is the one new difference: carried only, since the exchange format has no place for it.
- **e2e journey 16** (`view-bendpoints.spec.ts`): add, move, undo, redo and double-click remove with Chromium's pointer, then Manhattan: all 40 lines orthogonal, no handles, still Manhattan after a reload. Lines are pressed with `getPointAtLength` + `getScreenCTM`, because a bounding box's centre is not on a bent line.
- **Probes:** 23 guards broken one at a time. Two were missed at first (an out-of-range segment index, a bend-point dragged back to its own pixel); `bendpoints.test.ts` and a canvas test now catch both.
- **Verified:** 1525 unit tests on Node 25 and Node 24; lint, typecheck, format, build; full e2e 32 passed, 1 skipped (#32).
- **For the sponsor** (also in the PR): one bend-point per segment drag (Archi's GEF), not the issue's two; the Manhattan route is a port of diagram-js's `connectRectangles` (MIT notice kept), not the dependency; #174 and #178 both bump the schema to 4, so the second to merge takes 5.
- **Review order now:** #167; #174; #169; #175; #172 → #176; #168 → #173 → #178. Then #134–#137, #132.

## 2026-10-16 — Branch sweep, manual scripts, four backlog lanes (#95, #138, #97, #165, #164, #146, #145)

- **Branches:** deleted 36 merged remote branches and 9 local ones. Each was checked to have nothing outside `main` (`feat/147-shared-folder-lock` held only #162's merge, both of whose parents are on `main`). Kept: `assets/77-notation`, `assets/79-view-canvas` and `assets/80-model-tree` (merged PRs show screenshots from them), and the unmerged `spike/78-diagram-engine` and `claude/research-tech-radars-2pWYb`.
- **#167:** `file-round-trip.md` step 8 and the nested-connection note in `archimate-import.md` were stale since #76 and #96. The demo has no views or folders, so `archimate-import.md` gains a step 7 that takes the fixture back to Archi.
- **Four lanes,** one worktree agent each, one PR per issue, nothing merged. CI is green on every PR below.
  - **#174 (#95):** relationship and model documentation in canonical JSON, exchange and `.archimate` (Archi's purpose is the model's documentation, checked with Archi 5.10). Schema 3 → 4. The three "skipped" codes are gone. The fact sheet shows it; editing is **#171**, waiting on the sponsor's call on where.
  - **#169 (#138):** the `literal` marker now names the values we wrote, field by field, so Archi's re-exported defaults stay defaults. An older file's `"literal": true` is read as another tool's style with `exchange.style-unverifiable` (conservative: a default-equal override in those files is lost).
  - **#175 (#97):** zipped `.archimate` opens through `DecompressionStream`, with no dependency. The fixture was saved by real Archi. Every image reference is reported, and every malformed-archive branch has a test. Duplicate entry names are refused. Carrying images is **#170**.
  - **#172 (#165):** all four findings fixed: the watch restarts after a long gap, a takeover that ends as a reader takes its log line back, Web Locks serialise audit-log appends across tabs (e2e journey 14), and the sync fake repairs a losing delete. Open for the sponsor: a reader polls only while visible, so a tab hidden over a minute restarts its watch.
  - **#176 (#164), stacked on #172:** a 100% gate on all four coverage metrics for `src/io/shared-folder/**`, untested files included, and `coverage-gate.test.ts` guards the configuration. Proven red in CI run 38925338923.
  - **#168 (#146)** and **#173 (#145), stacked:** collapsible palette; a tree drop draws its relationships (Archi's source followed where the issue's wording differs).
  - **#133 is WIP** on `feat/133-bendpoints-router`, with no PR. Model fields, the `.archimate` router, the Manhattan port (from diagram-js, MIT notice) and the bend-point commands are done. Still to do: the oracle round trip, an e2e journey, the probes, a full e2e run and the PR. Following Archi, a segment drag adds one bend-point, not the issue's two.
- **Found along the way:**
  - **CI runs Node 24, this machine Node 25.** On 24, jsdom's real `Storage` turns `vi.spyOn(localStorage, 'getItem')` into storing an item called "getItem". That was #168's red CI. Nothing pins the Node version locally; worth an `.nvmrc` / `engines`.
  - **#147's shared-folder journey had a race** (fake clock run before the lock write landed); fixed on #168. `shared-model.test.tsx` also failed once under load in two lanes and passed on re-run. Watch it.
  - **#177:** in Vitest a regex literal inside `toMatchObject` matches anything (subset check; a RegExp has no keys). Confirmed on 2.1.9, no use on `main`, lint rule proposed.
  - **Parallel e2e:** `reuseExistingServer` locally means lanes tested each other's `vite preview` on 4173. Give each worktree its own `E2E_PORT`. CI is unaffected.
- **For the sponsor:**
  - **Schema numbers collide:** #174 and #133 both bump to 4, so whichever merges second needs 5.
  - **#133:** one bend-point or two per segment drag, and is the ported Manhattan router acceptable over a `diagram-js` dependency?
  - **#171:** where documentation is edited.
  - **#74:** tick #131. The edit was blocked here.
- **Review order:** #167; #174; #169; #175; #172 → #176; #168 → #173. Then finish #133, and #134–#137, #132.
- **HQ:** two lessons (`a26e188`): the `toMatchObject` regex trap, and one Playwright port per parallel worktree.

## 2026-10-09 (cont.) — Merges; #163's CI; MVP test plan (#166)

- **Merged by the sponsor:** #160 and #161 to `main`. #162 merged into `feat/147-shared-folder-lock` 14 s after #161 had taken that branch to `main`, so **part 2 is not on `main`**. #163 is retargeted to `main` and carries part 2 with it.
- **#163's failing check** was a timing race in `shared-model.test.tsx`, reproduced locally. A heartbeat that sees the file change before the save does correctly shows `FILE CHANGED ON DISK`, but the test pinned `1 UNSAVED`. The test now accepts either label and still fails on SAVED. Also merged `main` into #163 (conflicts with #160's dispatcher in `App.tsx` and `FileWorkspaceProvider.tsx`). 1475 unit and 29 e2e tests pass.
- **#166:** a hands-on test plan for the sponsor's own Archi models (open, look, change, keep, round-trip to Archi, optional shared folder), with the known gaps listed.
- **Open:** merge #163. `tests/manual/file-round-trip.md` step 8 and the note in `archimate-import.md` are stale since #76 and #96 (views and folders now round-trip; nested connections are hidden).

## 2026-10-09 — #160 and #161: review fixes

**#160 (#158) → 7add31e, both blocking findings fixed.**
- Every global binding is now a row in `SHORTCUTS` (`src/ui/shell/global-shortcuts.ts`). One window listener in `GlobalShortcutsProvider` runs the rows and checks `isModalOpen()` before any of them.
- Components register only what a binding does, with `useGlobalShortcut`, so a new binding is guarded because it exists. The table test fails on a row that has no case.
- The tripwire counts key listeners per file and fails closed: any receiver, an event type it can't read, `.call`, or `onkeydown =`. It includes untracked files and catches stale entries. The matcher has its own tests for each bypass.
- New e2e journey: `shortcuts.spec.ts`.
- 9 probes, each failing tests on its own. ⌘S under a modal still does nothing; that is the sponsor's call.

**#161 (#147 part 1) → bb19e1e, all three blocking findings fixed.**
- **Fencing on the deadline:** checked first in `heartbeat()` and in `confirm()`. A failed attempt only retries.
- **Our own lock stays ours to delete:** the manager keeps the last token *written* (`#written`) apart from the one it *trusts* (`#token`). `look()` reports our own untrusted lock as `ours`, acquire replaces it, and `release()` deletes it.
- **Error branches:** tests for the nine the review listed, plus the file vanishing between check and write and five more fallbacks found by local v8 coverage. Branch coverage of the module rose from 94.7% to 97.0%; the rest is sort comparators, a getter and a default.
- The offline-writer scenario now keeps its heartbeat running, as spec §1.1 means. A new scenario covers the writer that slept.
- 13 probes, each failing tests on its own. The non-blocking findings are in #165, except `scan()` never throwing, which is fixed.
- **Cascade:** #161 → #162 → #163 merged forward and pushed. All three are green locally (1445 unit, 28 e2e on #163).

**Open:**
- Re-review and merge #160 and #161.
- Review #162, then #163. #163 should offer Edit when a reader tick returns `ours` (our own lock after fencing), and its wake behaviour needs a look.
- #164 (coverage gate), #165.

## 2026-10-08 — Wrap-up: where the work stands

**On `main`:** #156 (#131, the nesting prompt) and #159 (#157, one dialog backdrop that keeps focus, with the lint rule that enforces it).

**Open PRs, all reviewed as "request changes"** (the details and fix plans are in the reviews and in the session-log entries on those branches):
- **#160 (#158):** the ⌘K/⌘S guards are right. Still needed: one shared shortcut dispatcher that checks for an open modal before *any* binding, and a tripwire that covers the regex's bypasses.
- **#161 (#147 part 1):** writer fencing must also fire on a gap with no heartbeat, not only on a failed one (a laptop that slept). Our own lock must stay recognisable after fencing or a failed check, so release can delete it. Nine error branches need tests.
- **#162 / #163 (#147 parts 2–3):** stacked on #161, and not reviewed yet. #163 needs re-testing after #161's lock-manager fixes, because they change what happens when a laptop wakes.
- **Merge order:** #161 → #162 → #163; #160 on its own.

**Issues opened:** #164 (`harness`: a 100% branch-coverage gate for `src/io/shared-folder/**`). #157 and #158 were filed from the #156 review; #157 is closed by #159.

**HQ:** three lessons in `lessons/verification-and-debugging.md`: fake timers vs `crypto.subtle`, naming the target of an injected fault, and OPFS for real directory handles in Playwright.

**For the sponsor:** merged branches to delete: `feat/96-hide-nested-connections`, `feat/131-nesting-prompt`, `feat/157-dialog-overlay`. Keep `docs/shared-folder-collaboration` until #161 merges, because it carries the spec and ADR 0010 into the stack. Spec §14.3 (hosting) is still open.

## 2026-10-08 — /review-pr 160 and 161 (same session that wrote them)

Both reviews are less independent, because the same session wrote the PRs; each generic pass ran as a fresh agent. The #161 agent died twice on network errors (ENOTFOUND), and the sponsor chose a third try, which completed. Its leftover worktrees were removed with the `node_modules` symlink unlinked first.

**#160 (#158): request changes, 2 blocking.**
- **Files, not bindings:** the tripwire classifies files, so a new unguarded chord in `PaletteProvider.tsx` passes. A probe kept all 12 tests green.
- **Regex bypasses:** `globalThis.`, a variable holding `window`, `documentElement` and `onkeydown =` are all missed.
- **Proposed fix:** one shared dispatcher that checks for an open modal, plus a registry-driven table test.
- **Harvest:** CLAUDE.md, "guard the unit that can go wrong, not the file it lives in" (560e89f on #160).

**#161 (#147 part 1): request changes, 3 blocking.**
- **Fencing only on failure (criterion 5 not met):** fencing fires only when a heartbeat *fails*, so a laptop that slept wakes, succeeds once, and saves over a taken lock. `session.test.ts:182` asserts the deviation.
- **Orphaned own lock:** fencing, a failed settle re-read, and a failed release read all forget the token while our lock is still there, which blocks everyone for 30 minutes.
- **Untested error branches:** nine of them, two on the save-state path.
- **Non-blocking:** stale judged across a sleep, takeover logged before it is attempted, a store error dropping a tick's result, same-profile log races, and the sync fake's losing delete.
- **Harvest:** CLAUDE.md, "a deadline is checked on every attempt, not only on a failed one" (87cae69, cascaded to #162/#163), and #164 (a 100% branch-coverage gate for `src/io/shared-folder/**`).

**Open:** fix #160 and #161, then review #162 and #163. The fixes to #161's lock manager change part 3's behaviour on wake, so #163 needs re-testing after them.

## 2026-10-07 — #147 part 3: editing a model in a shared folder

**Part 3 → PR stacked on part 2 (#162), with #159 merged in.** It uses `DialogOverlay`, so #159 must merge first.
- **`use-shared-model.ts`:** opens a model (read-only while it takes the lock), runs the heartbeat and the reader poll (also when the page becomes visible again), and applies each tick. That covers demotion, the reader's reload, `diverged` with its blocking notice, and conflict copies. It also handles save, overwrite, save as copy (which then opens the copy), reload, edit, takeover, unlock and close. A page that is closing tries to release its lock.
- **Effective role:** the file provider re-provides the store context. `role` is reader unless this tab holds the folder lock; the new `tabRole` alone decides the takeover screen and the header's Import and SAVE FILE, so a demoted writer can still save a copy.
- **UI:** `SharedModelUi.tsx` has the strip above the model (status, Edit, Take over…, Unlock… with confirmation, Save as copy, Close, possible conflict copies with Dismiss), the refusal dialog (Overwrite anyway… then a second confirmation), and the blocking "changed on disk" notice. The save-state indicator reads **FILE CHANGED ON DISK** when diverged.
- **Fix found while wiring:** a writer that lost the lock with unsaved edits and took it back had its edits reloaded away, and its base was reset to the colleague's file. That would have let the next save overwrite the colleague's version silently. `acquire({ hasUnsavedChanges })` now keeps the base and diverges instead. There is a session test and a UI test for it.
- **`ModelStore.markSavedThrough(count)`:** an edit made during a shared save stays unsaved. The single-file save has the same race with `markSaved()`; that is pre-existing and not changed here.
- **The switch is gone.**
- **e2e journey 13:** lock, save, takeover by a colleague, and save as copy, on real OPFS handles with Playwright's clock.
- **Manual script:** `tests/manual/shared-folder.md`, for two machines and one synced library.
- **Probes:** 17 guards broken one at a time, each caught.

**Open:** review of #159, #160 and #161–#163 (merge order: #159 and #161 first, then #162, then part 3). Hosting (spec §14.3) is still open. Timings stay at their defaults, with no preferences screen; only the display name can be changed in the app.


## 2026-10-07 — #147 part 2: opening a shared folder

**Part 2 → PR stacked on part 1 (#161).**
- **Adapter:** `browserFolder` over a real `FileSystemDirectoryHandle`, with `pickDirectory` (a cancelled picker is nothing picked) and `folderPermission` (asks only from a click).
- **Listing:** by name only. Possible conflict copies are listed *apart* under the model they may copy, not hidden. That deviates from spec §4: a name can't tell `Landscape-v2.json` from a OneDrive copy, and a hidden model never gets opened.
- **Storage:** `src/store/shared-folder-storage.ts` is its own IndexedDB database. It holds folders found again by `isSameEntry`; per-model memory under array keys `[folderKey, fileName]` (tested with separators); guarded settings; and the client id.
- **Screen:** `/folder` (`SharedFolderScreen`): Open folder…, the folders opened before (each reopens from a click, without the picker), the one-time name prompt, and the model list. Firefox and Safari get a note saying why.
- **Entry points:** an "Open a shared folder…" button in the Import dialog, and a note on first run, which keeps its three actions.
- **Hidden for now:** all of it is behind `localStorage['archipelago.sharedFolders'] = 'on'` until part 3, because a listed model can't be opened yet and part 2 alone would otherwise ship to Pages.
- **CLAUDE.md:** the constraint now allows writes into a folder the user granted (ADR 0010).
- **e2e journey 12** (`shared-folder.spec.ts`) uses real OPFS handles: listing, the handle stored in IndexedDB and reopened after a reload, and a picker that fails the journey if used twice. That last guard was proven by forcing a second use.
- **Probes:** 14 guards broken one at a time; 13 were caught. The 14th turned out redundant, because `isModelFileName` already leaves locks and logs out, so it was removed.

**Open:** part 3 (opening a model as writer or reader, the save dialog, the indicator leaving "saved", conflict notices, the switch removed, the OPFS lock/save journey, the manual UAT script). PRs #159, #160 and #161 are awaiting review.

## 2026-10-07 — #147 part 1: the shared-folder protocol

**Sponsor's answers to spec §14** (recorded on #147 and in the spec):
- ADR 0010 is accepted.
- The display name is asked the first time a folder is opened.
- The stale time is **30 min** (settle 10 s, heartbeat 60 s).
- Delivery is three stacked PRs.
- Hosting is still open.

**Part 1 → PR (base `main`).** `src/io/shared-folder/`, React-free:
- **Lock file:** its canonical JSON; unreadable counts as held.
- **Lock manager:** acquire with the settle delay; heartbeat; self-fencing at half the stale time; staleness by local observation of the counter, which survives a reload through `memory.ts`; release only our own lock; unlock.
- **Save guard:** lock check and fingerprint check; overwrite; save as copy.
- **Session:** load, acquire (reloads if the model changed during the settle delay), the writer and reader ticks, `diverged`, and takeover, unlock and overwrite logged first. Each is not done when its log line can't be written.
- **Names and logs:** conflict-copy detection; copy names safe for Windows and SharePoint; per-client audit logs.
- **Settings:** a guard on the way in.
- **Sync world** (`src/test/sync-world.ts`): per-client replicas with upload and download delay, OneDrive-style conflict copies, offline clients, per-file lag and fault injection. It has its own 8 tests.
- **Tests:** 90 new across the module, with scenarios for criterion 4 below and above the settle delay and for all three cases of §1.1. 30 guards were broken one at a time, and each failed a test.

**Open:** part 2 (folder handle + IndexedDB + Open folder + Firefox/Safari), then part 3 (UI wiring, OPFS journey, manual UAT script). The CLAUDE.md constraint line goes in part 2, where the app first writes into a granted folder. PRs #159 and #160 are still awaiting review.

## 2026-10-07 — #157 and #158: dialogs keep focus, shortcuts respect modals

**#156 merged** (`c7751e4`) after its two blocking fixes, retargeted to `main` first.

**#157 → PR #159.** `DialogOverlay` (`src/ui/common/`) is now the one modal backdrop, and all 8 modals use it. It calls `preventDefault()` on the press that dismisses, so focus stays where the dialog put it instead of landing on `<body>`.
- An ESLint rule rejects the overlay class names anywhere else. It has tests for the rule and its bypasses (template, variable, built class list), and its exemption still applies the locale rule.
- `CreateElementDialog` declared `aria-modal` without a focus trap. It now has one, so focus returns to `+ Element`.
- There is one press-outside focus test per dialog (9), plus a press outside in the e2e journey 11 in Chromium. All of them fail without `preventDefault()`.

**#158 → PR #160.** ⌘K and ⌘S now check `isModalOpen()`, like the other global shortcuts.
- `global-shortcuts.test.tsx` drives every binding (10 rows) under the import dialog, then again with the dialog closed, where it must act.
- A tripwire classifies every window/document key listener. Each guard, removed alone, fails its rows.
- My own call: ⌘S under a dialog (the palette included) now does nothing. The PR says how to revert it.

**Open:** review and merge #159 and #160 (they are independent). Branches already on `main` are left for the sponsor to delete: `feat/96-hide-nested-connections`, `feat/131-nesting-prompt`.

## 2026-10-07 — /review-pr 156 (#131 nesting prompt)

**Reviewed PR #156: request changes, 2 blocking items.** The port matches Archi 5.10's source, read from GitHub at `release_5.10.0`. All 5 acceptance criteria are met.
- **Blocking 1:** the "within its container" test can't fail. `o-rules` already has an Assignment from the engine, so deleting the within-container filter left 58 tests green, and moving a shape inside a container then re-asks every time.
- **Blocking 2:** a press outside the prompt focuses `<body>`, because the overlay's mousedown doesn't call `preventDefault()`. On the palette path this blurs the name field the answer just opened. Verified in Chromium.
- **Not blocking:** Ctrl+K opens the palette over the prompt (#158); undo labels; `addElementInView` duplicates `updateViewAdding`; an orphaned docblock.
- **Harvest:** two sharpened CLAUDE.md lines (a587fc4, on this branch); #157 (shared overlay that keeps focus) and #158 (Ctrl+K modal guard), both labelled `harness`.
- **Blocking items fixed in this same session (12d7fc4).** The overlay now calls `preventDefault()` on the press that closes it. New tests cover a press outside on the move path and on the palette path (where the name field stays focused), and a move within the container uses a shape nested with None. Removing either fix alone fails its test. 1275 tests, lint, typecheck, format and build all pass.
- **Open:** retarget #156 to `main` before `feat/96-hide-nested-connections` is deleted, then merge; #157, #158.

## 2026-10-07 (cont.) — #96 and #131: nesting asks what it means, and its connection is hidden

**Housekeeping.** I deleted the merged branches (`docs/148-*`, `feat/149-*`, `feat/153-*`, `chore/session-log-129`), locally and on GitHub. Next in M2 was #131. It needed #96 first, so the two are stacked: **#155** (#96), then the #131 PR on top of it.

**#96 → PR #155.** The canvas no longer draws a connection whose one end is the other's direct parent, as Archi does (`DiagramModelUtils.shouldBeHiddenConnection`, read at `release_5.10.0`).
- The rule is `nestedConnections(view)` in `src/model/views.ts`. The drawing, the hit layer and the line selection all leave such connections out. The view keeps them, and every writer writes them.
- **Correction to the issue:** Archi 5.10 hides *all eleven* relationship types by default (`HIDDEN_RELATIONS_TYPES`), not the five the issue named. Plain lines are always hidden.
- The Claims `.archimate` landscape now holds 41 connections and draws 40. `archimate-import.spec.ts` asserts both numbers.

**#131 (PR stacked on #155).** Dropping a shape into an element's shape asks which relationship the nesting means, as Archi's `CreateNestedArchimateConnectionsWithDialogCommand` does. This applies to all three paths in: a move, a palette placement and a model-tree drop.
- **Rules read from Archi 5.10's source:**
  - The offered types are Composition, Aggregation, Access, Assignment, Realization and Specialization (`NEW_RELATIONS_TYPES`), in that order, filtered by validity. Specialization is created from child to parent.
  - No prompt if a relationship of an offered type already runs from parent to child, or a Specialization from child to parent. Junction children are never asked about.
  - "None" or Escape still nests, and creates nothing.
  - A chosen relationship also gets a connection, which #96 hides. Relationships that already exist between parent and child get a connection in any direction where the view draws none of them yet (`createNewConnectionCommands`).
  - Several shapes moved in together get one row each, defaulting to the first type, as in `NewNestedRelationsDialog`.
- **Code:**
  - `src/ui/views/nesting.ts` (pure).
  - `NestingDialog` in `ConnectDialogs.tsx`.
  - `ModelStore.updateViewAdding`: elements, relationships and a view change as one command.
  - `ViewScreen` keeps the dropped shapes visible while the prompt is open. A new palette element is drawn from a pending lookup, and is only added to the model when the answer commits.
- **Tests:**
  - The offered types are checked against Archi's `relationships.xml` read from disk, for every pair of element types.
  - 14 guards were broken one at a time; 13 failed a test. The 14th showed that `release()` after a move's answer was redundant, because the focus trap already returns focus to the canvas, so I removed it. The tree drop keeps its `release()`, and its test proves it is needed.
  - A new e2e journey, `view-nesting.spec.ts`.
- **Archi oracle:** `editedClaims()` now nests Policy Host in Claims Engine (Aggregation) and places a new System Software in the Kubernetes Cluster (Composition). Archi 5.10 re-saved the file, and its save holds both relationships, both connections and both nestings. No unexplained difference.
- **Slip, caught:** my first break-probe script ran under zsh, which doesn't split `$FILES` into words. So no backups were made and the probes piled up. I reversed all 12 mutations by hand, re-ran every probe under bash, and reviewed the full diff.

**#155 reviewed** (`/review-pr 155`, same session, so the code-review pass ran as a fresh agent). Verdict **approve**. The one finding is fixed in `abf3594`: `drawingBounds` counted the bend-points of hidden connections, so fit, the mini-map and the export kept room for an invisible line. The fix is merged into `feat/131-nesting-prompt`. Harvested into the review skill: a rule about what is drawn applies to everything that measures the drawing.

**HQ:** two lessons in `lessons/verification-and-debugging.md`: check a citation against the page as it reads today, and run probe loops from a bash script.

**State:** #155 is approved and ready to merge. #156 (#131, stacked on it) awaits `/review-pr 156`. After both merge, tick #131 on #74. Not in scope: Archi's tree drop also draws the dropped element's other relationships, which is #145.

## 2026-10-07 (cont.) — #150 reviewed and merged; guide sources (#153)

**#150 reviewed** (`/review-pr 150`), posted as a comment with "changes requested". The one blocking finding: ADR 0011 credited The Open Group's announcement with five facts about ArchiMate 4 that it does not state. They come from the specification's publication page (c260), and "60 to 42" is in neither. The sponsor merged #150 before the fix landed, so the fix followed as **#152**: c260 is now cited, and "60 to 42" is shown as our own count against `element-types.ts`.
- **Harvest:** `src/test/repo-links.test.ts` fails when a `blob/main` link in `src` or a relative README link points at a missing file, or when the ADR index and `design/decisions/` list different files. Its trigger: #151 shipped the guide with a link to ADR 0011 that returned 404 until #150 merged. The test now includes untracked files, so a link in a new file is checked before it is committed.
- **ADR 0010** is now in the ADR index on `docs/shared-folder-collaboration` (`7930e02`), after merging `main`. #147 is an issue, and that branch still has no PR.

**Archi's licence (question, no change):** MIT for Archi's own code (`License.txt`, and the identical `LICENSE.txt` in each plugin). The notice has to travel with copies, which `src/model/archi/NOTICE.md` does. Not covered: the Archi®, ArchiMate® and TOGAF® trademarks, and content in the repo under its own licence. Example: the Business Model Canvas in Archi's canvas help is CC BY-SA 3.0.

**Guide sources (#153, PR pending).** Every element and relationship entry now cites the specification's section on that concept. Patterns say which Cookbook section and figure they are adapted from, and conventions link the ADR or UI spec section they follow. "Further reading" became "Sources and further reading".
- **Definitions checked:** all 72 (61 element, 11 relationship) against Archi 5.10's per-concept hints, which follow the specification's definitions (the specification itself needs a sign-in). 21 entries changed. Among them: Contract ("legal weight", where the definition says "formal or informal"), Grouping ("does not make anything own anything", though Grouping may compose), Influence (from any element, not only motivation), Constraint, Technology Collaboration and Communication Network.
- **Our advice split out.** 8 entries now carry a note marked "Archipelago", with a supporting source where one exists. 6 had advice inside the definition (Capability, Business Role, Business Function, Application Component, Path, Outcome). The other 2 are Composition and Aggregation: what separates them can't be checked without the specification.
- **Cookbook:** `hosiaisluoma.fi/ArchiMate-Cookbook.pdf` now serves *Enterprise Design with EDGY Cookbook*. The guide links the Wayback copy of the ArchiMate Cookbook (v1.0, 2022-08-05). Each pattern was checked against its figures: technology and business-support are shown step for step; four other patterns are adapted (for example, the Cookbook links Assessment to Goal by association, where we use Influence); portfolio-data is ours (ADR 0001).
- **Tests:** 8 new tests read the citations off the page. All 10 guard removals were caught, one at a time. CLAUDE.md gained a convention: a citation must be true of the text it labels.

**State:** #152 and the #153 PR await review/merge. `docs/shared-folder-collaboration` also adds a 2026-10-07 entry at the top of this file, so expect a one-hunk conflict here; keep both entries.

## 2026-10-07 — #147 design review folded into the shared-folder spec and ADR 0010

Reviewed #147's spec and ADR draft (branch `docs/shared-folder-collaboration`) and folded the fixes in. The main change: the spec claimed more than a synced folder can deliver.
- **Limits stated (spec §1.1, ADR Consequences).** Three cases get past the lock and the save guard: the acquire race slower than `settleMs`, an offline writer taken over as stale, and a change still in flight. Conflict-copy detection and a writer-side watch on the model file are now load-bearing, not extras.
- **Save state.** A change under the writer's lock takes the indicator out of "saved" (§8.2). This means `markSaved()` needs an inverse or a "file diverged" state.
- **Contradictions fixed.** Readers reload automatically only when they hold no unsaved changes, so a demoted writer keeps its edits. Criterion 12 is now achievable: *possible* conflict copies that can be dismissed, with no mtime filter. The save-as-copy indicator wording is clear.
- **Gaps closed.** A failed lock read is not a foreign token. Self-fencing at `staleAfterMs / 2`. IndexedDB array keys `[folderKey, fileName]`. Copy names cleaned of characters Windows and SharePoint forbid, with clash handling (no exclusive create in the API; gap accepted). One audit log per client. Fingerprint the bytes written. Folder listing doesn't parse files (Files On-Demand). Stale-lock observations survive a reload.
- Acceptance criteria are now 16, and criterion 4 is split by sync delay below and above `settleMs`.

**Open:** the sponsor's three questions (spec §14; a 30-minute stale default is now suggested). ADR 0010 is still Proposed. The issue body was updated to match the spec.

## 2026-10-07 — #147 spec reviewed; ArchiMate 4 decided (ADR 0011); in-app ArchiMate guide (#149)

**#147 (shared-folder collaboration).** The spec and ADR 0010 draft were reviewed and the fixes folded in, on `docs/shared-folder-collaboration`; that branch's own log entry has the details. The main change: a synced folder can't guarantee one editor, so conflict detection is what prevents silent loss. The issue body was updated to match. Still open: the sponsor's three questions, and ADR 0010 is still Proposed.

**ArchiMate 4 (#148 → PR #150).** The Open Group published ArchiMate 4 in April 2026; nothing in the repo mentioned it. The sponsor chose to stay on 3.2 and to decide without the four research questions #148 listed. ADR 0011 records that, with three triggers for revisiting it: Archi supporting version 4, a user bringing a version 4 model, or a version 4 exchange schema becoming what tools write by default. The README now states the implemented version. Docs only.

**ArchiMate guide (#149 → PR #151).** A `/guide` page inside the app.
- **Generated reference:** framework grid, 61 element entries (code, notation symbol, description, example), 11 relationship entries, a "what can connect" lookup, viewpoints.
- **Hand-written:** seven modelling patterns whose relationships are data, so a test holds each one to the validity matrix.
- **Links in:** the left nav (new Help section), first run (the guide needs no model, so `/guide` skips first run), the fact sheet type label and the view palette. A deep link focuses its entry, also after a hard refresh.
- **Tests:** 19 unit tests and 3 e2e journeys. The lookup is checked against `relationships.xml` read from disk, and the viewpoint lists against the viewpoint data. 11 guard mutations were all caught. 1228 unit tests and 25 e2e journeys pass.
- **Found:** Archi allows Association between every pair of non-junction types, so the lookup's empty branch can't be reached from the UI and is tested directly. The 3.2 specification online now needs an Open Group sign-in.
- **Deviation from criterion 1:** the app shell has no phone layout, since the nav and model tree fill a 390 px window. The guide reflows inside its own column instead, tested at 760 px. A shell phone layout would be its own issue.

**Also discussed (no changes made):**
- **Product name.** The sponsor doesn't like "Archipelago". The shortlist offered was Atoll, Estate, Terrain, Cairn, Holm and Survey. Constraint for any rename: `archipelago` is also a format identifier (exchange property keys such as `archipelago.timeClassification`, the IndexedDB name, localStorage keys, the schema file name). Keep those identifiers, or have the readers accept both spellings. A rename gets a new ADR replacing 0005.
- **The Open Group licensing.** No problem found in the repo: no spec text copied, the vendored data is Archi's (MIT), the XSDs are not vendored, and nothing claims certification. One concrete fix proposed: the demo model is *named* "ArchiSurance", which is The Open Group's case study, so rename it. Unresolved: whether a free open-source implementation needs the free non-commercial licence or none; the licence PDFs return 404, so the texts couldn't be read. Commercial use (sale, paid hosting, consulting) would need the commercial licence. Suggested: "ArchiMate®" at the guide's first mention.

**State:** #151 (the guide) was merged by the sponsor the same day. #150 (ADR 0011) awaits `/review-pr`; the guide's ADR 0011 link 404s until it merges. Open decisions for the sponsor: the three questions on #147, a new product name, renaming the ArchiSurance demo plus the ® (offered as a small PR or a commit on #151), and whether to write to The Open Group about licensing.

## 2026-10-06 (wrap-up) — #144 merged: views can be made from scratch

**Merged:** #144 (#130) after its review fixes. #130 is closed, and #74 has it ticked.

**State:**
- `main` is at `5a91390`.
- M2 open: #131–#137.
- New follow-ups from the #144 review: #145 (a dropped element brings its relationships to shapes already drawn, as Archi does) and #146 (a collapsible palette; at 1280 px the canvas is about 325 px wide).
- Also open: #138, #96, #97.
- Five nice-to-haves from the #144 review were not filed as issues. They are on the PR:
  - clear an armed tool when the viewpoint hides its type
  - a junction's history entry shows empty quotes
  - one helper for "add X and draw it" instead of two copies
  - a writer check on renaming in the tree (unreachable today)
  - say on the palette that Enter places, for screen-reader users
- Merged branches the permission classifier will not let me delete: `feat/130-create-views`, plus `feat/129-connect`, `feat/127-archi-roundtrip-check`, `feat/128-move-resize` and `chore/adr-0008-editor-next` from before.

**Next session, started fresh:** #131 (nesting, with the "which relationship does this nesting mean" prompt) on top of `main`.
- Placement already nests where a click lands (`placement` in `src/ui/views/create.ts`), and so does a move (`dropTarget` in `edit.ts`). #131 adds the prompt to both.
- Archi's own nesting prompt is `CreateNestedArchimateConnectionsWithDialogCommand`. Its drop policy calls it when `ConnectionPreferences.createRelationWhenAddingModelTreeElement()` is on. Read both with `javap`.
- Extend `edited-claims.ts` (`scratchView`) and re-run `scripts/fixtures/archi-roundtrip.sh` with `ARCHI=/Applications/Archi.app/Contents/MacOS/Archi`.

## 2026-10-06 (cont.) — #144 reviewed and its blocking findings fixed

**Reviewed** with `/review-pr 144 high`, in the session that wrote it, so less independent than usual. The generic code-review pass ran in a fresh agent and found the two worst defects.

**Five blocking findings, all fixed in `7b456d7`:**
1. A view's name field took focus back after every rename. It focused itself on mount and remounts on every rename.
2. Committing a shape's name by leaving the field moved focus to the canvas, so Backspace in the field the user had clicked deleted the new shape.
3. Placing from the keyboard re-fit the view.
4. No real-browser journey dragged a tree element onto the canvas. Journey 10 now does, in Chromium.
5. Nothing tested where focus lands after the element panel's Remove from view and Delete from model.

Each fix has a test that fails without it.

**Checked against Archi 5.10 with `javap`:** its drop never consults the viewpoint, and it adds an element the view already draws. It also draws the dropped element's relationships to shapes already in the view; filed as #145. A collapsible palette is #146.

**Harvested:**
- A CLAUDE.md line on when code may move focus. #142's focus finding came back in the very next PR.
- A sharpened review-skill bullet: a flag that every edit path must set belongs in the one function they all call.

**Open:** five nice-to-haves remain on #144. Re-review #144, then #131.

## 2026-10-06 (cont.) — #130 implemented: views made from scratch (PR #144)

**What a user can do now:**
- Make a view from the model tree (`+ View`) or the command palette. It opens with its name selected.
- Rename a view in the header or with F2 in the tree. Delete it in the tree.
- Choose a viewpoint in the header.
- Place shapes from a palette beside the canvas: every element type in its notation, then note, group and both junctions. A viewpoint limits the element types offered.
- Drag an element from the tree onto the canvas to draw it again.
- Rename any shape in place (F2 or a double-click). Delete an element from the model, after a confirmation that names the other views.

**Viewpoints are ours, checked against Archi.** `src/model/viewpoints.ts` is the table, and `viewpoints.test.ts` reads Archi 5.10's `viewpoints.xml` (now vendored). The file names whole layers as `$ApplicationElements$`; Archi's Java expands them, so the test carries those lists as `javap` printed them. Junction and Grouping are allowed in every viewpoint. The `.archimate` reader's own map turned out to miss Application Structure, and now reads the table.

**Archi oracle.** `edited-claims.ts` adds a view made from scratch in a new folder of Views. Archi 5.10 imported and saved it, and the oracle passes. The oracle now also compares each drawn element's folder.

**Found in a real browser:**
- A rename on the canvas left the old name drawn, because the drawing was memoised on the view and a rename changes only the element.
- The palette's type filter needed each word matched ("app comp").
- The tree's tools wrapped mid-label.
All three are fixed.

**Tests.** 1205 unit tests and 22 e2e journeys pass; journey 10 is new. 26 mutations were run, one guard at a time. One guard nothing could fire was removed: Chromium sends no `blur` when a focused field is removed. The journey asserts the behaviour instead.

**Open:**
- Review #144 (`/review-pr 144 high`).
- At a 1280 px window the palette and the selection panel leave the canvas narrow. A collapsible palette is a candidate follow-up.
- Next in M2: #131 (nesting, with the "which relationship does this mean" prompt).

## 2026-10-06 (wrap-up) — #142 merged: M2's first slice is done

**Merged:** #142 (#129, connecting, with validity from Archi's matrix, ADR 0009) after its review fixes. #129 is closed, and #74 has #127–#129 ticked, which is the whole first slice.

**State:**
- `main` is at `e89d429`.
- Open: #130–#137 (rest of M2), #138, #96, #97.
- The #142 review's five nice-to-haves were not filed as issues. They are on the PR:
  - re-use for an element drawn twice
  - one shared drawing-order walk for `nodeAt` and `dropTarget`
  - memoised hit routes
  - an explicit batch label
  - a release outside the canvas (in principle only)
- Merged branches the permission classifier will not let me delete: `feat/129-connect`, plus `feat/127-archi-roundtrip-check`, `feat/128-move-resize` and `chore/adr-0008-editor-next` from before.

**Next session, started fresh:** #130 (create views, a palette filtered by viewpoint, add new and existing elements) on top of `main`.
- New elements go through the store, as `edited-claims.ts` does.
- Extend the Archi oracle with the slice's edits.
- `validity.ts` is Archi's matrix now: any "only valid" palette or menu reads `validateRelationshipBetween`.

## 2026-10-06 (cont.) — #129 implemented: connecting shapes, and validity is now Archi's matrix

**Connecting.** A selected shape has a connect handle. Dragging from it to another shape opens a menu.
- Between two element shapes, the menu offers only the types ArchiMate allows, and any relationship of the model between them, in that direction, that the view does not draw yet. Choosing a type creates the relationship and its connection as one command (`addRelationshipInView`, a batch); one undo leaves the workspace byte-identical. Re-using adds a connection only.
- With nothing allowed, the menu says so and creates nothing. Association joins anything, so this happens only through a junction's rules.
- A note, a group or a view reference at either end gets a plain line at once.
- A line can now be selected, by a press on it (an 8 px hit stroke, GEF's tolerance) or in a reader tab. Delete or **Remove from view** keeps the relationship. **Delete from model…** names the other views that draw it first.

**Validity follows Archi (sponsor's call, ADR 0009).** Checking `validity.ts` against Archi's `relationships.xml` showed 5,437 disagreeing cells: 4,540 we allowed and Archi rejects, and 897 the other way.
- `src/model/archi/relationships.xml` is now the matrix, vendored unmodified (MIT), with its SHA-256 pinned in a test.
- Archi's junction rules (read from `ArchimateModelUtils` with `javap`) are `validateRelationshipBetween`: one type per junction, and the far side's elements must be legal ends. The menu, the fact sheet picker and `validate()` all use it. Every fixture and the demo still validate clean.

**Archi oracle.** `edited-claims.ts` now connects five types, three through a new junction, re-uses `r-claim-bo` and draws a line from a note. Archi 5.10 imported and saved it, and the oracle passes with no new unexplained difference.
- Archi's command line cannot run its validator, and its matrix loader needs OSGi, so "Archi reports no invalid relationship" is checked with our port of Archi's check, run over Archi's own save. A mutated junction shows the check bites.

**Tests.** 1136 unit tests and 21 e2e journeys pass (1 skipped, the existing #32 fixme). The new journey connects two shapes in Chromium, and passed `--repeat-each=4`. 21 guard mutations were run on the connect flow and the junction rules, and each one is caught; two that were missed at first were fixed. The editor's test harness moved to `src/test/view-editor.tsx`.

**Found in a real browser:** a line drawn across a shape takes a press on that spot. That is Archi's behaviour (connections are drawn above shapes), so it is kept.

**#142 reviewed (`/review-pr 142 high`, same session, so less independent than usual).** It found 4 blocking issues, now fixed on the branch:
1. **Selection.** A model-tree selection left a selected line selected, and Delete removed the line. Selection is now one state, `{ nodes } | { line }`, so a shape and a line cannot be selected together.
2. **Empty-menu message.** It blamed the ArchiMate matrix, but only a junction's rules can empty the menu. It now gives the junction's real reasons: the one-type rule once, then why the type the junction joins is refused here.
3. **Focus.** After Remove from view, Delete from model or a panel's Close, focus fell to `<body>`, because the opener was unmounted. The canvas now takes focus back, through an effect that runs after the dialog's focus trap has let go.
4. **Untested refusal.** The missing-element refusal now has a test, and so do the unreachable branches, driven directly.

Each fix was mutation-checked. The selection test fails against the unfixed screen. 1140 tests and 21 e2e journeys pass. Five nice-to-haves are left on the review (#142).

**Harvested:** three bullets in the review skill: one setter for exclusive state, refusal messages true on every path, and focus when the action removes the opener.

**Open:** re-review #142, then #130 (create views, palette).

## 2026-10-06 (wrap-up) — #139 and #140 merged; a committed `node_modules` symlink removed

**Merged today:** #139 (Archi oracle, #127) and #140 (editor's first slice, #128). ADR 0006 is accepted. #127 and #128 are closed.

**The node_modules incident (mine).**
- **What went in.** #140's review fixes were made in a scratch `git worktree` with `node_modules` symlinked in, and `git add -A` committed that symlink. It pointed at this machine's absolute path. `.gitignore` said `node_modules/`, which matches a directory and not a symlink.
- **Where it reached.** It merged to `main` in `a7b2f6f`. Pulling it replaced the real install with the link here, and it would do the same on any other machine. CI stayed green only because `npm ci` deletes `node_modules` first.
- **The fix, in this PR:** the link is untracked, the rule is now `node_modules`, and `src/test/repo-hygiene.test.ts` fails if `node_modules`, `dist` or `coverage` is tracked, or any symlink to an absolute path. Both guards were fired on purpose.
- **On the other machine:** after pulling this fix, run `rm node_modules && npm ci` if `node_modules` turned into a link.

**State:**
- M2's first slice is done (#127, #128).
- Open: #129 (connecting, next), #130–#137 (rest of M2), #138 (`archipelago.style` literal marker survives Archi's re-export), #96, #97.
- Merged branches the permission classifier will not let me delete: `feat/127-archi-roundtrip-check`, `feat/128-move-resize`, `chore/adr-0008-editor-next`.

**Next session, started fresh:** implement #129 (connect shapes, only valid relationships offered) on top of `main`.
- The editor lives in `src/ui/views/ViewScreen.tsx` (gestures) and `edit.ts` (pure geometry).
- The Archi oracle is `src/test/view-oracle.ts` and `edited-claims.ts`. Extend `edited-claims.ts` with the slice's edits and re-run `scripts/fixtures/archi-roundtrip.sh`.

## 2026-10-06 (cont.) — #128 implemented: the view editor's first slice

The canvas edits now, in the tab that holds the model.
- **Selection:** click, Shift/⌘-click, and a lasso that takes shapes wholly inside it.
- **Moving:** drag (one command), arrow-key nudge (1 px, Shift for 10), and auto-scroll at the edge.
- **Nesting:** dropping a shape into a group or an element nests it, and dropping it outside takes it out; it keeps its absolute position either way.
- **Resizing:** eight handles.
- **Removing:** Delete removes from the view only.

A reader tab keeps the read-only canvas. Both Archi questions the issue left open were settled from Archi's code and noted on #128: bend-points follow GEF's `RelativeBendpoint` weights, and a container resized from its top or left keeps its children in place (`resizeBehaviour` 0).

- **Performance (ADR 0006's main cost):**
  - `updateView` no longer `structuredClone`s the view, so untouched nodes keep their identity. In dev and tests the view is deep-frozen first, so a mutating `change` throws.
  - `ViewDrawing` draws nodes flat in tree order, each memoised. With nested `<g>`s, a parent that skipped would also have stopped a moved grandchild from updating.
  - Moving 1 of 500 shapes redraws that shape and its 2 lines only.
- **Two bugs found by tests:**
  - **A default parameter.** `into = null` turned an explicit `undefined` (the top level) into "keep the parent", so nothing could be dragged out of a group. It is now an options object.
  - **Found only in a real browser.** Selecting on press opened the selection panel, which narrowed the canvas and slid under the pointer, taking the rest of the drag. jsdom lays nothing out; the new e2e journey failed on its first run. The panel now waits for the press to end.
- **Archi oracle:** `edited-claims.ts` now uses the editor's own operations, including a resize from the left and a line with one end moved, and Archi's re-save still holds with only the five explained differences.
- 1093 tests, 20 e2e journeys; 25 guard mutations, each caught.

**Open:**
- ADR 0006 was accepted by the sponsor (2026-10-06), recorded in this PR.
- **#140 reviewed (`/review-pr 140`, same session):** 11 findings.
  - Sponsor's call: Delete follows Archi; Shift+Delete keeps the children.
  - Re-parented shapes now go on top of their new siblings (Archi's `AddObjectCommand` appends), and the drop target walks drawing order.
  - A run of nudges rounds bend-points once. Before, ten 1 px nudges moved a weight-½ point 10 px one way and 0 px back.
  - Escape cancels a drag. A release the canvas cannot see ends the press. Space resets on blur. The panel waits only for a press that changes the selection. No-op node and connection updates record nothing.
  - Finding 10 (a stale view at commit) was demoted: the canvas re-renders before a release can be handled, and its mutation survives because the two views are the same.
  - 1105 tests pass. The Archi save was regenerated, and Archi keeps the new drawing order.
  - **Harvested:** review skill §2: the same order where it is stored and where it is walked.
- **Delete follows Archi (sponsor's call in the #140 review).** Archi's Delete from View removes a container with everything inside. Its "Delete from View (keep children)" (`DeleteContainerAction`) is the other action, and Archipelago gives it Shift+Delete. #128 had lifted the children out on Delete, as the issue's own text said, which matches only Archi's secondary action.
- Next: review this PR, then #129 (connecting).

## 2026-10-06 (cont.) — #127 implemented: Archi as the oracle for edited views

`src/test/edited-claims.ts` edits the claims landscape through the store. Our exchange writer saves it, and Archi 5.10 imports it, saves it and exports it again (`scripts/fixtures/archi-roundtrip.sh`). `src/test/view-oracle.ts` then compares the two drawing for drawing. 19 helper and fixture tests pass, and 1041 in all; 19 guard mutations are each caught.

- **Archi keeps every `identifier` on exchange import**, so drawings are matched by id. That is stricter than the issue's "match by what they draw". The only drawings with fresh ids are the ones Archi made up.
- **Five differences are Archi's doing, read from `XMLModelImporter` with javap.** The test pins which drawing has which reason.
  - The format cannot carry text alignment, text position or strikethrough. Archi keeps `archipelago.style` but does not draw it, so the oracle strips the property before reading.
  - `addNodeStyle` ignores a shape's `lineWidth`.
  - `addFont` fills a missing font name with the machine's default.
  - Alpha comes back as a whole percent.
  - `addNestedConnections` adds a connection for each nested relationship, which Archi hides (#96).
- **Found:** #138. Our `literal` style marker survives Archi's re-export and turns Archi's full computed style into overrides.
- **Archi's command line exits 0 when an import fails.** The script checks that the output files exist instead.
- **`export-with-archi.sh` re-saves `open-day.archimate` with new folder ids every run.** Archi generates them for the folders its handlers add. Revert that file after a run unless the change is intended.

**Reviewed (`/review-pr 139`, same session):** 12 findings, all fixed.
- **Explanations were wider than their evidence.** Text alignment was explained whatever value Archi produced; the font name was explained on nodes with no font; and strikethrough had no test where it must not apply. Each now checks the value Archi produced, and each has a test where it must not apply.
- **The Archi save was not tied to its input.** It now is, by a SHA-256 the script writes.
- **Reader problems were ignored.** Any problem now fails the test.
- **The comparison was missing parts.** It now covers the view's own fields, drawing order per parent, and the drawn elements and relationships.
- **Smaller fixes:** the script now writes atomically, and the comparison strings are JSON.
- 27 guard removals, all caught; 1053 tests pass.
- **Harvested:** review skill §2: an explanation of another tool's behaviour is a predicate on the values it produced.
- **Product note:** the exchange format cannot carry text alignment, text position, strikethrough or a shape's line width to Archi, so a centred group title shows left-aligned there. Only a native `.archimate` writer would close the gap. That is a scope question for the sponsor.

**Next:** merge #139, then #128 (move and resize) on top of it.

## 2026-10-06 (cont.) — M2 filed: #127–#137

M2's list in #74 became 11 issues, each with acceptance criteria, and #74 links them. **The first slice is #127, #128 and #129.**
- **#127** builds the Archi oracle once: Archipelago's exchange export goes through Archi's `--xmlexchange.import`, then `--saveModel`, and is compared drawing for drawing. Archi assigns its own ids, so drawings are matched by what they draw, and anything unmatched is reported.
- **#128** covers move, resize, re-parent and remove from view. It also carries ADR 0006's `updateView` render cost, as a render-count criterion.
- **#129** covers valid-only connecting.

The rest: #130 create views (with a new viewpoint table, tested against Archi's `viewpoints.xml`), #131 nesting prompt, #132 magic connector, #133 bend-points and router, #134 notes, groups, legends and view references, #135 appearance, #136 align, grid and z-order, #137 copy and paste.

Checked in Archi 5.10's jars while writing them:
- Archi has a legend object (`ILegendOptions`). #134 starts by finding out what our reader does with one today.
- The CLI has an exchange-format import (`ImportXMLProvider`).
- Archi's router is read today only to report `archimate.router-unsupported`; #133 replaces that.

Where an issue depends on Archi's behaviour (paste reference vs copy, the nesting rule, align anchor), it says to settle it with Archi before building, not to assume it.

**Next:** implement #127, then #128 on top of it. ADR 0006 is still Proposed; accepting it fits with #128's PR.

## 2026-10-06 (cont.) — Next phase decided: the diagram editor (ADR 0008)

The sponsor chose **M2, the diagram editor**, as the next step after M1. That settles #74's open question and the concept's §7.5. ADR 0008 records it: thin slices that each round-trip to Archi, beginning with move and resize, valid-only connecting, and saving a file Archi opens as drawn. #74 is updated, with M1 ticked and the decision recorded. #123 and #124 are merged.

**Next session, started fresh:** file the M2 issues from #74's list, each with acceptance criteria, beginning with the first slice. The engine is ADR 0006 (Proposed). Read it and the concept's §2.2 and §5 first.

## 2026-10-06 (cont.) — #123 (#118) reviewed; #115 landed as PR #125

**All seven findings are fixed in `dc9b6c3`; CI is green.** Archi 5.10 re-saved the extended evidence model, and 30 of 30 mutations are caught. #125 merged, and `feat/108` and `feat/115` were deleted.

`/review-pr 123` ran in the author's session. The code pass was a separate agent with none of the author's context, and it checked each candidate with Archi 5.10 itself. All four criteria are met in substance, but the size handler's "unset" was not Archi's. **Changes needed:**
- **Below 3.0.0, 0 or negative counted as unset.** Archi uses `== -1`, and it kept a 0-width group that Archipelago grew.
- **Four new tallies count skipped duplicates.** `defaultSized` and `countUnsupported` already did the same.
- **The size summary says "120 × 55 for any element".** A junction is 15 × 15.
- **Eight more guards survive removal:** nested growth, a written centre alignment, the 1 → 0 figure swap, connections under outline opacity, and smaller ones.
- **A malformed `lineAlpha` at 4.0.1 or 4.4.0 is silent.**

**Harvested:**
- **CLAUDE.md:** a tally counts only kept objects (third recurrence).
- **Review skill §2:** port another tool's predicate, not ours; and a default never reaches a tool-saved fixture.

**Also:** the #115 fix had missed `main`. PR #125 lands #117's two commits unchanged; its CI is green. Five merged branches were deleted.

## 2026-10-06 — #118 implemented → PR #123

The handlers come from Archi's source (`handlers/*.java`, `ModelCompatibility`, `StringUtils.versionNumberAsInt`, and the `plugin.xml` order). Their effects were settled by Archi 5.10 itself: one model was saved under 12 versions around the thresholds, plus Open Day, and the older file must read as Archi's save does. **16 of 16 mutations caught; 1003 tests pass.**

- **A file with no `version` gets every handler.** EMF's default is `""`, which compares as 0. Archi's re-save of the versionless model matched the 2.9.9 one.
- **Archi saves a folder that `Archimate2To3Handler` moved as an `archimate:Folder` element**, and reopens it that way. It is now read as a folder; before, it was an unknown type and its contents were lost.
- **`folder-type-unknown` now says which kind of folder it is.** The three kinds are an ordinary folder, an older Archi's `connectors` or `derived` (from Archi 3.3.2's `FolderType`), or a type Archi 5.10 does not define.
- **The figure swap only changes reporting:** a swapped Grouping, Meaning or Value is now reported as undrawn.

**Still open:** review #123; #74 (the sponsor's decision). **#115's fix is not on `main`.** #121 merged `feat/108` into `main` at 15:26:57, and #117 (the #115 fix, reviewed) merged into `feat/108` 33 s later, so its two commits live only on `feat/108-text-position-evidence` and `feat/115-group-text-position`. Both branches are kept until a PR lands them on `main`. Five merged branches were deleted on 2026-10-06: `feat/111-model-language`, `chore/session-log-2026-10-05`, `chore/session-log-2026-10-05b`, `feat/105-archi-legacy-vocabulary` and `chore/harvest-119`.

## 2026-10-05 (cont.) — #119 (#105) reviewed

`/review-pr 119`. All criteria are met; criterion 4 was replaced by the sponsor's call. I merged `main` in, and the legacy fixture passes #121's globbed provenance check. **7 findings, all fixed on the branch (`84289e3`):**
- The conversion message was untrue for an OrJunction.
- The unread-content labeller classified the raw legacy type, calling a renamed relationship an element.
- With both connection attributes present, the wrong one won. Archi 5.10 showed that the later attribute wins either way round, so the reader now follows that.
- The rename table applied only under a literal `archimate:` prefix, which disagreed with `classify`.
- Counting only kept members was tested for elements alone.
- A dead fallback and a name that shadowed a parameter.
- The README was missing the table, the attribute rule and the Or-junction divergence.

7 of 7 mutations caught; 934 tests pass.

**Harvested:** a second case in review-skill §2's "one value decided in two places" bullet: apply a conversion once, at the source.

**Also merged by the sponsor today:** #116, #117, #120 and #121.

**Still open:** merge #119 and then this PR; #118 (Archi's version handlers); #74 (the sponsor's decision). Merged remote branches to delete: `feat/111-model-language`, `chore/session-log-2026-10-05`, `chore/session-log-2026-10-05b`, `feat/108-text-position-evidence`, `feat/115-group-text-position`.

## 2026-10-05 (cont.) — #116 and #117 reviewed

- **#116 was merged by the sponsor while its review was running.** Its fixes went to a follow-up, **PR #121**. The posted review records 9 findings.
  - The group test compared Archipelago's label with Archipelago's own tab, and a reviewer's mutation (tab +20) stayed green.
  - The test now draws through `ViewDrawing` and holds every label to Archi's measured centre (±1.5).
  - View references were added, with Archi's evidence.
  - `fixture-provenance` now finds fixtures by glob.
  - 7 of 7 mutations caught.
- **#117 has 7 findings, all fixed on its branch** (which now carries #121).
  - An explicit top sat 3 px off.
  - An empty tab kept its name-sized width; it now takes Archi's width (÷2, ÷1.4, read with javap).
  - A tiny box lost its label.
  - The bounds were one-sided.
  - 9 of 9 mutations caught; 921 tests pass.
- **Harvested** (review-skill §2): assert the other tool's number through the screen's own path, and give a value that two code paths decide one owner.

**Merge order:** #121, then #117, then #119 and #120.

## 2026-10-05 (cont.) — #108, #115 and #105, settled against Archi itself

#113 and #114 were merged by the sponsor. Then three issues, each settled with evidence from Archi 5.10 rather than from memory:

- **#108 → PR #116.** Archi's HTML report (`--html.createReport`) rendered a fixture Archi saved, `text-position.archimate`. An absent position (top) on a Group is the tab row, centred in a one-line tab, which is exactly where Archipelago's middle-of-the-tab puts it. Boxes and notes are top in both. So **no reader change**: `text-position.test.tsx` pins the evidence (5 of 5 mutations caught). `export-with-archi.sh` now finds Archi in `/Applications`, and a full run re-saved every fixture byte-identically.
- **#115 (filed, then fixed) → PR #117, stacked on #116.** Archi places an explicit middle or bottom label on a Group or Grouping over the whole box and leaves the tab empty, which `javap` of `GroupFigure` confirms. `labelBox()` now does the same (6 of 6 mutations caught; the explicit-top test first could not fail and was rewritten).
- **#105 → PR #119.** The fixture is Archi 2.0.0's own Open Day example, MIT (© Bolton University), vendored byte-for-byte with a NOTICE. `LEGACY_TYPES` is Archi's `ConverterExtendedMetadata.TYPE_MAP`. **Sponsor's call:** follow Archi and convert in any namespace, which replaces #105's 4th criterion; a comment on #105 records it. An OrJunction is kept as or and reported, because Archi 5.10 silently opens it as and. Open Day now reads 27/39/4/47 like Archi; before, it read 20 of 39 relationships and 0 views (7 of 7 mutations caught).
- **Filed #118:** Archi's version-keyed compatibility handlers. The worst is that every model older than 4.4.0 has its group labels left-aligned in Archi, which affects Archi 4.x files in today's namespace too.

**Still open:** review #119; then #118 and #74 (the sponsor's decision). Merged remote branches to delete: `feat/111-model-language`, `chore/session-log-2026-10-05`.

## 2026-10-05 (cont.) — #114 (#111) reviewed; fixes pushed

`/review-pr 114` ran in the author's session. The code pass was a separate background agent (9 candidates). Both criteria are met. **8 findings, all fixed in `5ab26f6`:**
- Texts of skipped duplicates voted. Archipelago reads an object before it knows to skip it, and a probe turned a German model French. Fixed in the ledger: `skip` untags, and a new `forget` covers texts read and then not kept.
- Dropped model properties and unused definition names outvoted kept texts. The candidate said this was silent; in fact it was reported, but the wrong language was chosen.
- Untagged texts were relabelled silently. They now vote `en`, and they are reported when the model is not `en`.
- Tags were compared case-sensitively, so `EN` was a second spelling of English.
- An invalid majority tag crowned a stray minority tag; such a model now stays `en`.
- Fixed folder labels voted.
- The `xs:language` pattern was written out twice.
- There was no ADR, so **ADR 0007** was added.

After the fixes, 16 single mutations were caught, one equivalent mutant was removed, and 898 tests pass.

**Harvested:** review-skill §2. A tally fed by ledger marks must survive later skips and dropped reads.

**Open:** CI on `5ab26f6`, then merge #114 and then #113.

## 2026-10-05 (cont.) — #111 implemented: a model keeps its language

On `feat/111-model-language`, PR #114. The work took option 2 from the issue, plus option 1's report.

- `Workspace.language` holds the `xml:lang` that most of the kept texts carry. Absent means `en`, so existing files keep their bytes. The exchange writer labels every text with it.
- `Ledger.text` counts the tag of each text it marks, so only texts that land in the model decide. `@lang` left the exchange reader's `IGNORED`, and no content-unread test changed.
- A text in another language is reported as `exchange.language-relabelled`. Only an `xs:language` tag is ever held: the exchange reader, the JSON reader and the writer all guard it.
- The fixture is Archi's own German export (`--xmlexchange.exportLang de`). Archi labels all 69 texts with one language, and the file is otherwise identical to the English one. It is in `export-with-archi.sh` and the XSD run.
- 20 of 20 single mutations were caught. 888 tests pass, and `validate:xsd` is green.

Note: on this machine Archi is at `/Applications/Archi.app`, not the script's default `~/Applications`; set `ARCHI` when re-running it.

Also: the earlier wrap-up entry had been pushed to the #107 branch after #112 merged, so it never reached `main`. PR #113 carries it.

**Still open:** merge #114, then #113. Also #108 (check Archi first), #105 (needs a genuine legacy file) and #74 (the sponsor's decision).

## 2026-10-05 — Session wrap-up (#101, #107)

**What was done:**
- **#101:** both XML readers report every attribute and child element they did not consume. The mechanism is the `Ledger` in `src/io/consumption.ts`, which reports leftovers as `import.content-unread`.
  - Implemented and reviewed (#110). Three findings were fixed: a mark placed above a branch, a missed Archi `textAlignment`, and unnamed features.
  - Merged by the sponsor (`5792be5`); #101 is closed.
  - It found real silent drops: model `<metadata>`, unused specializations, a second language, a property with no value, a root group's documentation.
- **#107:** the exchange reader reports malformed values (`exchange.value-malformed`) through one `measured()` shared with the native reader in `exchange-xml.ts`.
  - Implemented and reviewed (#112). Two findings were fixed: colour ranges were clamped silently, and the message was untrue for a malformed opacity.
  - Merged by the sponsor (`6ff2750`); #107 is closed.
- Filed **#111**: the exchange round trip relabels every text as `xml:lang="en"`.
- Harvested:
  - The CLAUDE.md "never drops data silently" line now points to the ledger: mark where a value lands, not where it is fetched.
  - Three review-skill §2 bullets: a hoisted ledger mark certifies a drop; another tool's attributes are checked class by class with javap; a tally's message must hold for every key, and "not allowed" means the schema's range.
  - HQ lesson: importers account for what they consume.

**Process note:** background review agents stalled at the 600 s watchdog three times running. Both reviews' code passes ran inline in the author's session at the sponsor's choice, and each review says so.

**Still open:**
- #108: an absent `textPosition`; check it in Archi first.
- #105: the Archi 2.x vocabulary.
- #74: the sponsor's decision, M2 editor or transformation core.
- Merged remote branches ready to delete: `fix/100-archimate-silent-drops`, `feat/101-reader-consumption` and `feat/107-exchange-malformed-values` from this session. Older merged branches also linger on the remote.

## 2026-10-05 (cont.) — #112 (#107) reviewed before merge

`/review-pr 112`. All three #107 criteria are met. The code pass ran inline, as for #110, because the background agents had stalled earlier.

**Two should-fix findings, both fixed on the branch** (4 of 4 mutations caught):
1. The `exchange.value-malformed` message said every colour value "was read as not set". A malformed opacity keeps its colour, read as opaque.
2. Out-of-range colour values were clamped silently: `r="300"` came in as 255 and `a="150"` as opaque. The XSD's ranges are 0–255 and 0–100. They are now counted, and the message says what was done with each.

The first version of the fix's test could not separate the `a` range check from the malformed `a`, because both named `a`. It was split before the mutation run.

**Harvested** (review skill §2): a summary message over a tally must be true for every key that can reach it, and "not allowed" means the schema's range, not just "not a number".

Open: merging #112, which is left to the sponsor.

## 2026-10-05 (cont.) — #107 implemented: the exchange reader reports malformed values

On `feat/107-exchange-malformed-values`.

**Shared helpers:** `measured`, `num`, `bump` and `entries` moved from the native reader to `exchange-xml.ts`. `measured` takes a `ValueSink`, a `ledger` and a `tally.malformed`. The native `Reader` already has that shape, so its call sites are unchanged.

**What the exchange reader now does:**
- It counts malformed values and reports `exchange.value-malformed` once, naming every attribute.
- A malformed node position is read as 0, and a malformed size as the default. Not as Archi's -1, so it is not counted as `default-size` either.
- A node *missing* a position is still skipped. The issue said such a node was placed at 0; in fact it was skipped as "no position or size", which was wrong for a value that was there but malformed.
- A bendpoint without two numbers is dropped. Exchange bendpoints are absolute, so 0,0 would be the canvas origin. `<bendpoint/>` is now counted rather than silently dropped by `list()`.

**Beyond the issue, the same class of drop:**
- A colour missing or garbling r, g or b.
- A `lineWidth` that is not a positive integer, per the XSD.
- A font `size` that is not a number.
- A font `style` token outside the XSD's `plain`, `bold`, `italic` and `underline`.

Since #101 these had been marked read and dropped. Bounds and bendpoints are now read only once the node or connection is known to be kept (the #106 rule).

**Verification:**
- Every checked-in exchange fixture reports none of this.
- 12 mutations, one guard at a time; all were caught once the one survivor (`plain` counted as malformed) got its own test. The "one shared helper" test fires on a local copy put back into the native reader.

Open: the PR for #107 awaits `/review-pr`.

## 2026-10-05 — Session wrap-up (#101)

**What was done:**
- #101 implemented (#110) and reviewed before merge. The review's three findings were fixed on the branch, and the sponsor merged it (`5792be5`). #101 is closed.
- Filed **#111**: the exchange round trip relabels every text as `xml:lang="en"`.

**Still open:**
- #107: malformed exchange values. Some now surface as unread attributes rather than silently.
- #105: the Archi 2.x vocabulary.
- #108: an absent `textPosition`; check it in Archi first.
- #111: language tags.
- #74: the sponsor's decision, M2 editor or transformation core.
- Remote branches `fix/100-archimate-silent-drops` and `feat/101-reader-consumption` are merged and ready to delete.

## 2026-10-05 (cont.) — #110 (#101) reviewed before merge

`/review-pr 110`. All four #101 criteria are met.

**Method:** the independent code pass failed three times. Each background review agent stalled at the 600 s watchdog and returned nothing; the third failure was two parallel agents at once. At the sponsor's choice the code layer ran inline in the author's session, and the review says so. Every finding was reproduced, and Archi attribute claims were checked with `javap`, one class at a time.

**Findings, all fixed on the branch with tests, each fix mutation-checked (6 of 6 caught):**
1. A Label's `conceptRef` was marked read above the branch and reported only on the note branch, so a binding on a resolving view reference was dropped silently and certified by the ledger. It is now reported on both branches. The label is marked read on a reference only when it is the referenced view's name, which is what Archi writes.
2. A connection's `textAlignment`, a real Archi setting on `DiagramModelConnection`, had gone from an info note to an unread-content warning. It is now listed as undrawn.
3. A nit: features on a view, a folder or the model were reported as a bare `<feature>`. They are now named.

**Already tracked:** malformed exchange values marked read and dropped (#107). `xml:lang` re-exported as `en`, which is pre-existing and now documented in `IGNORED`.

**Harvested** (review skill §2):
- A ledger mark hoisted above a branch certifies the drop in that branch.
- Another tool's attribute list is checked per class against its model, not as a flat set of names.

Open: merging #110, which is left to the sponsor.

## 2026-10-05 (cont.) — #101 implemented: readers report what they did not consume

On `feat/101-reader-consumption`. Both XML readers now keep a `Ledger` (`src/io/consumption.ts`):
- Each attribute and child element is marked where its value lands in the model or in a problem, **not where it is fetched**. A value that is read and then discarded stays unread; that is the nearest bypass, and it has a test.
- A skipped object is marked whole, because it was reported as skipped. A skipped shape still has its nested shapes walked.
- After the read, `unread` walks the parsed file. Every key left unmarked becomes one `import.content-unread` warning per kind of carrier and kind of content, naming the carriers by id.
- Each reader lists the keys it ignores on purpose in `IGNORED`, each with its reason: namespaces, Archi's `version`, `targetConnections`, `schemaLocation` and `xml:lang`. A second language is reported as "a second <name>".

**Replaced:** the native reader's generic checks (`checkConceptContent`, the any-other-attribute arm of `countUnsupported`, and `unreadChildren`'s `<x>` fallback) are gone. What remains is knowledge-based:
- Archi's own display attributes, taken from Archi 5.10's model jar (`type`, `borderType`, `borderColor`, `imagePath`, `imagePosition`, `locked`; on a line also `textPosition`), are still `appearance-unsupported`.
- Properties, documentation and features on view objects are still `view-content-skipped`.
- Features on a concept are named through `ledger.lose`.
- An unknown attribute or child anywhere is the ledger's. `archimate.content-unread` became `import.content-unread`.

**Losses it found that were silent before:**
- Archi model `<metadata>`.
- A specialization no imported concept uses, and a duplicate or nameless one.
- An exchange `<property>` with no `<value>`, noted under #100.
- A second language.
- A root group's documentation or id in `<organizations>`.
- A nameless property definition.
- Text where an element was expected.

The empty Influence `strength`, also noted under #100, is read as no modifier, as in the exchange reader.

**AC 4:** every checked-in fixture and the demo report nothing unread. A glob test now holds that for any fixture added later. A stray attribute injected into every element of every fixture was reported at every level, so the zero is not a walk that stops early.

**Tests:** `content-unread.test.ts` covers an unknown attribute and child at the element, relationship, shape/node, connection and folder levels in both readers, the bypass, and each newly found loss. Mutation-checked one guard at a time: 26 mutations (14 ledger and report guards, 12 sampled read-marks in both readers), all caught. The one survivor, text under a marked element, got its own test before the final run. 859 unit tests, 19 journeys, `validate:xsd`, lint, typecheck, format and build are green. CLAUDE.md's fixture line now points to the ledger.

Open: the PR for #101 awaits `/review-pr`. Still open from before: #105, #107 and #108; #107's malformed exchange values now surface as unread attributes rather than silently, until #107 gives them a proper message. And #74.

## 2026-10-05 — Session wrap-up

**What was done:**
- #100 implemented (#106) and reviewed. #106 was merged mid-review, so the review's fixes went to `main` through follow-up **#109**. #100 is closed.
- The fixtures were re-saved with Archi 5.10.0, now installed in `/Applications`; run the script with `ARCHI=/Applications/Archi.app/Contents/MacOS/Archi`. The re-save exposed three reader bugs, all fixed.
- Harvested:
  - `fixture-provenance.test.ts` and its CLAUDE.md line;
  - a review-skill bullet: a parser option changes every value;
  - HQ lessons (`c59c530`).
- Filed #107 and #108.

**Still open:**
- **#101** (recommended next): both readers report every attribute and child they don't consume. It also covers the two drops noted under #100 (an exchange `<property>` with no `<value>`, an empty Influence `strength`).
- #105: the Archi 2.x vocabulary.
- #107: malformed values in the exchange reader.
- #108: an absent `textPosition`; check it in Archi first.
- #74: the sponsor's decision, M2 editor or the transformation core.
- Remote branch `fix/100-archimate-silent-drops` is merged and ready to delete.

## 2026-10-05 (cont.) — #106 (#100) reviewed before merge

`/review-pr 106`, the first PR in five reviewed **before** merge. All three #100 criteria are met. The code pass ran as an independent background agent, because the PR was this session's own work. It reported 10 findings; each was checked against the code.

**Confirmed and fixed** (7521f76):
- **Finding 1, a regression from item 11.** Untrimmed, `<model> </model>` parsed to `' '`, so an empty `.xml` imported as an ok, empty model. It is refused again.
- `<bendpoint>` with a line break inside was still dropped.
- A shadowed specialization named only the first of several.
- A skipped duplicate, or a skipped connection, still fed the content and malformed tallies.
- A folder's `<property/>` went unreported.
- The connection-ends rule is now one function in `src/model`. Its new direct test exposed that removing the *target* half had passed every reader and validate test.

Mutation-checked: each fix caught. The two survivors are equivalent mutations.

**Filed:** #107 (the exchange reader reads malformed values silently, pre-existing) and #108 (an absent `textPosition` versus Archipelago's defaults; needs checking against Archi first).

**Harvested:**
- Mechanical: `fixture-provenance.test.ts` fails on any spelling Archi 5.10's serializer never writes. It fires on `main`'s old fixtures, 14 and 19 hits, and on a start tag wrapped over two lines. The CLAUDE.md fixture line now points to it.
- Review skill: a parser option changes the shape of every value the parser returns.

Open: merging #106, which is left to the user.

## 2026-10-05 — #100 implemented (reader silent drops and the alignment default)

On `fix/100-archimate-silent-drops`. All 12 findings from the #98 review are handled. Items 1–8 are reported, because the model has no place for the data:
- a repeated property key (the first value is kept, in **both** readers);
- a specialization shadowed by the object's own `Specialization` property, or one the file does not define;
- a top-level folder's documentation and properties;
- what a shape or a line carries that it cannot hold here (properties, a line's documentation, label expressions and other `<feature>`s);
- an alpha with no colour;
- a view with no id;
- a malformed value, which no longer counts as a default size;
- an unknown attribute or child on an element or relationship.

Item 9: an absent `textAlignment` on a note, group or Grouping reads as `center`. Item 10: a connection whose shapes don't draw its relationship's ends is skipped with `*.connection-mismatch` in both readers. Item 11: both parsers use `trimValues: false`, so text is read exactly. That made #90's trimming of the modifier on write unnecessary, so it was removed. Item 12: both readers name the documented relationships they *imported*. The native reader had counted a duplicate; the exchange reader had counted a dangling one.

New `reader-losses.test.ts`, one test per finding. Mutation-checked one guard at a time: 27 mutations, all caught. 815 unit tests, 19 journeys and `validate:xsd` are green.

**Fixtures re-saved with Archi 5.10.0** (installed in `/Applications`; run with `ARCHI=…`). `export-with-archi.sh` now passes `--saveModel`. The re-save showed the hand-written fixtures had hidden three real reader bugs, which are now fixed:
- **A plain line's `<sourceConnection>` has no `xsi:type`.** EMF omits the declared type, so every line in a real Archi file was skipped as untyped.
- **A bendpoint at 0,0 is `<bendpoint/>`.** It parses as `''`, which `list()` dropped.
- **`lineAlpha` and `gradient` on shapes are `<feature>`s, not attributes.** This was confirmed with `javap` on Archi's jar and by a probe re-save. Archi had silently discarded the fixture's invented attributes, and its export then wrote the line at 100%. It now writes 78%, the feature's 200.

`o-note`'s `textAlignment="2"` is gone, and Archi also omits `textPosition="0"` and `-1` sizes. A further 6 mutations were added, 33 in all, every one caught.

Open:
- This is more evidence for the CLAUDE.md "fixture must be written by the tool" rule: three bugs sat behind one hand-written fixture. The review may want to sharpen that line.
- An absent `textPosition` means Archi's top. For a figure-drawn element, Archipelago's default is middle. It is not handled, and is unverified against Archi's rendering.
- Found and left for #101: the exchange reader drops a `<property>` with no `<value>` without a report, and the native reader drops an empty Influence `strength`.

## 2026-10-04 (cont.) — #104 (#103) reviewed before merge

`/review-pr 104`. All four #103 criteria are met. One blocking finding: the new fail-closed `*.root-unreadable` check sits ahead of `*.not-a-model`, so an empty, plain-text or element-less `.xml`/`.archimate` is now told that it "parses as XML… please report this file". Reproduced against `main`. The fix is to raise it only when the parser found a model and the scan did not. A nice-to-have: legacy-namespace files are routed natively, but their Archi 1/2 types (`UsedByRelationship`, `Infrastructure*`) come back as `unknown-type`. The review was posted as a comment, because GitHub refuses request-changes on your own PR. **Harvested:** sharpened the CLAUDE.md fail-closed line (a666a0a+): a closed branch inherits every input of the check it precedes. Finding 1 fixed on the branch (d727696): `root-unreadable` is raised only when the parser found a model and the scan did not, and a test reads `''`, plain text and a comment-only prolog through both readers. The test fails without the fix. Open: merging #104 into main, which is left to the user; mapping the legacy Archi 1/2 vocabulary (finding 2), not yet filed.

## 2026-10-04 (cont.) — #102 (#99) merged; reviewed post-merge

#102 merged before review, the fourth in a row. The post-merge review (code pass by an independent agent) found that the new guard **fails open**: a `[` in a doctype's quoted system id makes `xmlRoot` return undefined, both `root?.`-guarded refusals are skipped, and #99's silent empty import is back. Also, exchange files with no `xmlns` or an `https` namespace are newly refused, and legacy Archi files (`bolton.ac.uk`) get a misleading error. All filed as **#103**. **Harvested** into CLAUDE.md on `fix/103-reader-choice-followups`: a guard that can't classify its input fails closed.

- **#103 fixed** on the same branch:
  - Both readers fail closed on a root the scan can't find (`*.root-unreadable`).
  - The doctype skip is quote-aware.
  - The exchange reader refuses only Archi's namespaces. No namespace, or a near miss, is read with an info note.
  - Archi's legacy `bolton.ac.uk` namespace is read natively.
  - Zip names are trimmed.

  Mutation checks found two survivors. A subset-tracking flag was redundant with the outer loop, so it was deleted. A test with two apostrophes that cancelled out was split.

Open: PR for #103 awaits `/review-pr` **before** merge. Then #100 and #101, and the #74 decision.

## 2026-10-04 (cont.) — #93 merged; #98 reviewed post-merge

- **#93** (the #92 follow-ups): merged `main` into it, which conflicted only in this file. Reviewed and merged. Mutation-checked one guard at a time. The palette's `open` check is redundant with `isModalOpen()`, because the palette is `aria-modal`.
- **#98 (#13) reviewed after merge**, the third PR in a row merged before review. All four criteria are met, but the review found:
  - **#99:** a file sent to the wrong reader imports as empty and `ok`, with no problem. Dispatch is a substring match.
  - **#100:** nine silent drops in the native reader, plus notes and groups that Archi centres reading as left-aligned. Archi's `TEXT_ALIGNMENT_EDEFAULT` is 2, and the coverage fixture was hand-written.
  - **#101 (harness):** readers should report any attribute or child they did not consume.
- **Harvested** into CLAUDE.md on `fix/98-review-followups`: readers ignore by omission, and fixtures must come from the tool.

- **#99 fixed** on `fix/98-review-followups`. The new `xml-root.ts` resolves the root element's own prefix to its namespace, skipping the prolog, comments, instructions and a doctype subset; it is quote-aware and decodes entities. Dispatch uses it. Each reader refuses a `model` root in the other's namespace (`*.wrong-namespace`) instead of reading it as empty. A non-`.archimate` zip is named as an archive (`file.archive-unrecognised`). Every guard was mutation-checked on its own: a redundant BOM skip was deleted, and a doctype test that could not fail was fixed.

Open: #100 (silent drops and the alignment default; it needs `archi-coverage.archimate` re-saved by Archi), then #101; the #74 decision (M2 editor or transformation core) is still pending.

## 2026-10-04 — Session wrap-up (2026-10-03 → 04)

**What was done**, one session across five PRs:
- #89 (#84) reviewed after it had merged. The findings were fixed in #91 (#90): older schemas are upgraded on read, influence modifiers are trimmed on write, and `validate:xsd` fails on a fixture that won't import. Merged.
- #92 (#88 + #31): undo and redo in the UI. Merged. Reviewed afterwards; the two bugs it found are fixed in **PR #93** (open).
- #13 split. Excel/CSV moved to #94; `.archimate` import is in **PR #98** (open). Merging it completes M1 (#74).
- Issues filed: #94, #95 (documentation fields), #96 (hide nesting-implied connections), #97 (zipped `.archimate`).
- CLAUDE.md harvested one rule: when mutation-checking, remove one guard at a time.
- HQ: the Archipelago page and three verification lessons, plus one agentic-workflow lesson, written back and pushed.

**Still open:**
- PRs #93 and #98 need review and merge. Both prepend to this file, so the second one to merge conflicts here only.
- Two PRs (#89, #92) merged before `/review-pr` ran. Their post-merge reviews found real bugs both times.
- Sponsor decision (#74): M2 diagram editor, or the #72 transformation core.
- Backlog from this session: #94–#97.

## 2026-10-03 (cont.) — #13 implemented (.archimate import)

#13 split: Excel/CSV moved to **#94** (repository track T1), and #13 is now `.archimate` only, the last item of model-pillar M1 (#74). Built on `feat/13-archimate-import`.

**`src/io/archimate-native.ts`** reads Archi's own file straight into the model. `readWorkspaceFile` picks the reader by the root's namespace, not the extension. Decisions carried forward:

- **Archi's export is the oracle, not the spec.** Each fixture pair is one model saved by Archi 5.10 and exported by Archi 5.10. The test reads both and allows only the documented differences, which are all places where Archi's export loses data: text alignment, shape line width, a line's name, folder ids, and nesting-hidden connections.
- **New fixture `archi-coverage.archimate`.** It covers every edge case, including all 24 viewpoints; the viewpoint map was taken from Archi's export, not guessed. Archi's export of it fails Archi's own XSD on purpose.
- **Archi exports default-sized shapes as `w="-1"`**, which is invalid. The exchange reader stored `-1` and drew broken shapes, a bug that predates #13. Both readers now resolve sizes from `default-sizes.ts`.
- **Bendpoints follow GEF's `RelativeBendpoint`**: integer centres, a weighted mean, floored. The `v-rounding` view's odd sizes are what tell integer centres from fractional ones; nothing else in the fixtures did.
- The parser keeps namespace prefixes: a junction's `type` overwrote its `xsi:type` otherwise.
- Specializations become the `Specialization` property, as Archi's export does.
- Things with no place in the model are now reported, in both readers where it applies: relationship documentation and model documentation (filed as #95), sketches, canvases, images, router, folder properties. A zipped `.archimate` (a model with images) is refused with an explanation (#97).
- The import dialog's copy said diagrams and folders are not imported. That has been untrue since #76; fixed.

781 unit tests and 19 journeys pass, including new journey 9 (`archimate-import.spec.ts`). `validate:xsd` checks both native fixtures re-exported. Mutation-checked: 20 single changes, each caught, among them the bendpoint centre, both readers' defaults, the access default, the viewpoint map, the zip check, dispatch, and the parent offset (in the journey too).

Open: #96 (the canvas should hide nesting-implied connections like Archi), #95, #97. M1 is done once this merges, and #74 needs your decision: M2 editor or the transformation core.

## 2026-10-03 (cont.) — #92 reviewed post-merge; two follow-ups fixed

#92 (#88, #31) merged before review. The post-merge review's code pass found two low findings, both mine, and both fixed on `fix/92-review-followups`:

- **⌘Z in a lifecycle date field did nothing.** `hasNativeUndo` excused only `<select>`, but date-like inputs also commit on change, keep focus and have no text undo. Now `date`, `time`, `datetime-local`, `month` and `week` reach the model too.
- **The modal-guard test never tested the modal guard.** It used the palette, whose own `open` flag returned first. It now uses the create-element dialog. My original mutation had removed both guards at once, which is why it looked covered. **Harvested** into CLAUDE.md: remove one guard at a time.

Open: next is #13 (`.archimate` import), then the M2-vs-transformation decision (#74).

## 2026-10-03 (cont.) — #88 + #31 implemented (undo and redo in the UI)

**Undo and redo reach the user** (`feat/88-undo-redo-ui`, closing #88 and the older #31). ⌘Z / Ctrl+Z undo and ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo. The header has **Undo** and **Redo** buttons, with tooltips that name the step from `describeCommand`, and the palette offers `Undo: …` / `Redo: …` when there is a step to take. Decisions carried forward:

- **One owner, `useUndoRedo`**, as `useSaveWorkspace` is for saving, so the reader guard lives in one place. The keyboard binding sits in `PaletteProvider`, which outlives the shell a reader sees, so the guard can't rely on hidden buttons.
- **`hasNativeUndo`, not `isTypingTarget`, decides who gets ⌘Z.** Text fields keep the browser's undo. A `<select>` swallows letters but has no undo, so ⌘Z after picking a fit rating reaches the model. ⌘Y is left alone, because it opens the history in macOS browsers.
- **The counter keeps counting.** Undo and redo each add one, since the counter is "changes since the last save". The manual docs now say so.
- **Fact-sheet fields follow the model.** The name and documentation inputs were uncontrolled, so after an undo they still showed the undone text and committed it again on the next blur. They are now keyed on the value. The lifecycle date commits on every change, so keying it would steal focus mid-typing, and it became controlled instead.
- `ModelStore.nextUndo` / `nextRedo` expose the next record for the labels.

745 unit tests and 18 journeys pass. Mutation-checked: the binding, the text-field, modal and select guards, both reader guards, Ctrl+Y, and each of the three fact-sheet fields. Each turns a test red when removed, and the tree journey fails without the binding.

Open: this PR awaits review (#91 for #90 is merged). Next: #13.

## 2026-10-03 (cont.) — #84 reviewed post-merge; #90 fixed

PR #89 (#84) merged before its review finished, so the review went on as a PR comment and its three findings became **#90**, fixed on `feat/90-schema-upgrade-modifier-trim`:

- **A JSON file from any older schema is read at the current version**, with `json.schema-upgraded` (`canonical-json.ts`). Before, only schema 1 was upgraded, so a schema-2 file saved as 2, while the same model reloaded from IndexedDB saved as 3. `legacy` still means the v1 shape; `upgraded` is the new "older than this build".
- **The exchange writer trims `modifier` and says so** (`exchange.relationship-modifier-trimmed`). fast-xml-parser's `trimValues` trims attributes before any processor sees them, and turning it off would change how every name and documentation text is read. A modifier of only spaces is left out, with a warning.
- **`validate:xsd` exits 1 when a fixture does not import**, rather than skipping its target. Checked by replacing the #84 fixture with garbage.

Each fix is mutation-checked. 737 unit tests and the round-trip journey pass.

Open: element and relationship *names* are trimmed by the same parser setting, silently. That was already so before #90 and is not filed. Next: #88.

## 2026-10-03 (cont.) — #80 merged; #84 implemented

PR #87 (#80, model tree) merged; local branch deleted.

**#84, directed associations and influence modifiers.** `Relationship` gains `isDirected` (Association) and `modifier` (Influence), beside the type as `junctionKind` is on elements. The exchange format and canonical JSON both read and write them. The JSON schema allows each only on its own type, and the view canvas draws the half-arrow and the modifier label. Decisions carried forward:

- **One definition of "on the wrong type":** `TYPE_SPECIFIC_ATTRIBUTES` and `misplacedAttributes` in `relationship-types.ts`. The two readers, the exchange writer and `validate` (`relationship.misplaced-attribute`) all use it. It covers `accessType` too, which the exchange reader used to drop silently when it was on the wrong type or had an unknown value.
- **Absent means undirected.** `false`, `0` and absent are one model, and only `isDirected="true"` is written (ADR 0004).
- **`modifier` is any non-empty text.** The XSD type is a union with `xs:string`, so Archi's `7` is as valid as `++`.
- **Schema version 3.** The shape doesn't change for older data. The bump makes a schema-2 build warn that it is dropping the values instead of losing them quietly.
- `ViewDrawing`'s relationship lookup now returns the model's relationship rather than a hand-mapped subset.
- Fixture `src/io/fixtures/relationship-attributes.{archimate,xml}`: the XML was exported by Archi 5.10 (`scripts/fixtures/export-with-archi.sh` now exports both fixtures). `npm run validate:xsd` checks our re-export.

734 unit tests and the round-trip journey pass. Mutation-checked: reader, writer, canonical writer, both guards, and the canvas head and label.

Open: no UI edits these attributes yet. When one does, it goes through `isInfluenceModifier`. Next: #88 (undo/redo in the UI), then #13.

## 2026-10-03 (cont.) — #80 implemented (model tree)

**#80, model tree with folders** (`src/ui/tree/`). The tree is a panel between the left nav and the content, as in Archi. The nav's **Model tree** item shows or hides it, and that choice is kept in localStorage. It lists the nine fixed groups, the user's folders and every element, relationship and view, with folders first and then names in a fixed `en` sort. The `/views` stopgap and its nav item are gone. Decisions carried forward:

- **Moves go through one store command, `moveToFolder`.** It keeps each kind in its own group, refuses a folder dropped into itself, and puts no command on the undo stack for a move to where the object already is. The rules live in `src/model/folders.ts`, so the tree refuses a drop while the user is still dragging.
- **Selection lives in the URL.** The tree highlights the fact sheet's element, the open view, or the element selected on the canvas. To make that work, the canvas now mirrors its selection into `?element=` (replace, not push) and follows that parameter when the tree changes it.
- **Activating an element** on a view that draws it selects it on the canvas; anywhere else it opens the fact sheet. Relationships have no screen of their own yet, so activating one does nothing.
- **`aria-activedescendant`, not roving tabindex,** because the rows are windowed above 150. The tree scrolls the active row into its window.
- **Broken folders are never dropped:** a member whose folder is missing sits in its own group, and a folder on a cycle or with a missing parent sits at the top of Other.
- The tree's announcements use a polite live region rather than `role="status"`, because that role is the save notice's and the journeys find the notice by it.
- Keyboard moves use cut and paste (⌘X/⌘V), so drag and drop has a keyboard equivalent.

708 unit tests and 18 e2e journeys pass (1 skipped, as before). Mutation-checked: windowing, scroll to the active row, Right to expand, type-ahead not reaching the global shortcuts, and the canvas-to-URL sync.

Open: the app has no undo button or ⌘Z yet, so moves and folder edits can only be undone at the store level (worth an issue). Next: #13; #84 is a bug.

## 2026-10-03 (cont.) — #79 merged

PR #86 (#79, read-only view canvas) merged to main; issue #79 closed. Local `feat/79-view-canvas` deleted. The remote `feat/77-notation` and `feat/79-view-canvas` branches are still there (the assistant was not permitted to delete them). The `assets/*` screenshot branches stay because the PR bodies link to their images.

Next: #80 (model tree, replacing the `/views` stopgap); #84 is a small import bug.

## 2026-10-03 (cont.) — #77 merged; #79 implemented

**#79, read-only view canvas** (`src/ui/views/`). `/view/:id` (keyed on the id) draws a hand-drawn view with the #77 notation. It covers nesting, notes, groups, view references, connections with bend-points and Archi-style chopbox anchors, and appearance overrides. It has fit, zoom (buttons, ⌘/Ctrl + wheel, pinch), pan (drag, wheel), an outline mini-map, selection with a summary panel and "Open fact sheet", and SVG/PNG export. The fact sheet's "Appears in" now lists the views that draw the element and opens each with the element selected (`?element=`). A stopgap `/views` list and a "Views" nav item stand in until the #80 model tree. Decisions carried forward:

- **The drawing is pure** (`ViewDrawing`). The canvas, the export and the M2 editor draw the same component; the export clones the on-screen drawing and resolves every `var(--…)`.
- **A broken parent chain** (missing parent or cycle) draws the node at the top level, never drops it.
- **Fit tracks the canvas size until the user pans or zooms.** Fit hands control back.
- **A layout bug the e2e journey caught:** a three-row grid with a conditional error row put the canvas in an `auto` row, so it opened at 10% in a 150px strip. The screen is now a flex column, and the journey asserts that fit fills the canvas.
- PNG export uses a system font: an SVG drawn into an image cannot reach the page's web fonts. Authored fill colours stay literal in dark mode; whether to adapt them is open.
- Test setup stubs `HTMLCanvasElement.getContext` to null (jsdom logged "Not implemented").

670 unit tests and 17 e2e journeys pass. Mutation-checked: bend-points, nesting offsets, export contents.

Next: #80 (model tree, replacing the `/views` stopgap), then #13; #84 is a bug.

## 2026-10-03 — #78 merged (ADR 0006 accepted); #77 implemented

**#77, ArchiMate 3.2 notation** (`src/ui/notation/`): `ElementShape` for all 61 element types, in the rectangle figure and in the alternative figure where ArchiMate defines one. `RelationshipLine` draws all 11 relationship types, plus the access-direction, directed-association and influence-label variants. The dev-only gallery is at `/dev/notation`; it is not in the production bundle. Decisions carried forward:

- **Glyphs are drawn into any box.** One definition serves both the corner icon and the full-size alternative figure.
- **Relationship notation follows the spec, not `RELATIONSHIP_TYPES.notation`.** That field is the dependency graph's simplification: it calls Realization solid and Association dashed. The notation test holds the spec table.
- **Passive structure is coloured by layer on diagrams.** In the catalogue's neutral `pas` group, a Business Object and a Data Object are pixel-identical; the "every type draws differently" test caught it. The report legend keeps `pas`.
- **Heads are geometry, not `<marker>`s.** Markers need page-unique ids and break when one diagram is exported on its own.
- **Text wraps by canvas measurement.** Only the lines beside the icon are narrowed. A word is split only when it is wider than the whole shape. Widths are not cached until the web font has loaded.
- 500 shapes render in 53 ms (161 ms at 4× CPU throttle) on the dev build: `scripts/measure-notation.ts`.

Filed **#84**: the exchange importer silently drops `Association/@isDirected` and `Influence/@modifier`. The notation takes both as props already.

Next: #79 (read-only canvas) is unblocked; #80 is independent; #84 is a bug.

## 2026-10-02 (cont.) — #76 merged; #78 spike done, ADR 0006 proposed

The sponsor merged #82 (#76) **without a `/review-pr` pass**. A review can still be run against main and its findings filed as follow-ups.

**#78 spike.** Three candidates, measured in Chromium on the Archi-exported landscape view (85 objects), tiled to 510 and 1,360 objects, at 1× and 4× CPU throttle. The code is throwaway, on `spike/78-diagram-engine` (not for merge): a custom SVG editor, React Flow, and diagram-js (the library survey's pick; MIT, the toolkit under bpmn-js). Every candidate committed move, drag-out re-parenting and bend-point edits as **one command on our store**, and undo restored the model and the DOM, at every scale. Performance does not separate them at the required 300+ objects.

**ADR 0006 (Proposed): a custom SVG editor over our own model.** It is the only option where the engine does not own the model state by construction. diagram-js does work, through a read-back adapter that clears its command stack, but that is a lossy-boundary risk, and its renderer cannot take the #77 React components. React Flow needs handles and draws edges under nodes by default. diagram-js's `ManhattanLayout` can be borrowed on its own (~3 KB gzip) for orthogonal routing. Carried forward:

- M2 builds snapping, guides, align, resize, lasso and auto-scroll in-repo. File the M2 issues with that scope.
- `updateView` clones every node, so each commit re-renders the whole view: 133 ms at 1,360 objects throttled. Fix it before the editor.
- #79 is the first slice of the editor, with gestures off.

Next: sponsor accepts or rejects ADR 0006 on the PR. Then #77 and #79; #80 is independent.

## 2026-10-02 (cont.) — #75 merged; #76 implemented (PR #82)

The sponsor merged #81 (#75). **#76 → PR #82** (`feat/76-exchange-views`, CI green, not yet reviewed): the exchange format now reads and writes `<views>` and `<organizations>`, and Archi's own export round-trips losslessly. Decisions carried forward:

- **Archi's defaults are not overrides.** Archi writes its full computed style on every object; values equal to Archi's default are read as none, so imported views follow our theme. The default table was measured from Archi 5.10's export of all 61 types. The platform font counts as default only on most objects.
- **The `archipelago.style` view property** carries what `<style>` cannot (text alignment and position, strikethrough) plus a `literal` flag for styles we wrote, so explicit "default" overrides survive our own round trip.
- **Folder ids come from the label path** when the file has none (Archi never writes them); we write `identifier` on folder items.
- **Fixture:** an original model (`scripts/fixtures/build-claims-model.ts`) exported by **real Archi 5.10**. With the sponsor's OK, Archi is now installed at `~/Applications/Archi.app` and its CLI is scripted (`scripts/fixtures/export-with-archi.sh`). The landscape view (~60 objects, nested, orthogonal bend-points) is ready as the #78 spike's test view.
- **Fixed two pre-existing parser bugs:** numeric character references were not decoded, and a written CR was lost. Both also affected element documentation.
- **New CI job, "Exchange format XSD":** validates everything the writer produces against the Diagram schema.
- `src/io/fixtures/` is now in `.prettierignore`; Prettier had silently reformatted the byte-exact v1 fixture.

Next: `/review-pr 82`. Then #77 (notation) and the #78 spike can start in parallel; #80 (model tree) is unblocked too.

## 2026-10-02 — #75 implemented (PR #81); stale checkout cleaned

This checkout (`/Volumes/Archive/...`) was 112 commits behind and still held knowledge-base-era files. The sponsor had them deleted (Ferring proposal drafts, old `BACKLOG.md`, `Documentation/`, `local-docs/`) and main was fast-forwarded. A stray local `hq.yaml` edit is in `git stash`.

**#75 → PR #81** (`feat/75-view-folder`, not yet reviewed). `View` and `Folder` are model objects, `ViewDefinition` is renamed `ReportDefinition` (stored under `reports`), and the schema is now v2. Schema-1 files migrate in the JSON reader, IndexedDB snapshots migrate on load, and the old `archipelago.views` XML carry key is still read. Decisions carried forward:

- Node bounds are **relative to the parent**; bend-points are absolute. #76 converts at the exchange boundary.
- **A view is replaced whole per edit** (`update-view {before, after}`); the store's node and connection operations are helpers over it. Deleting an element or relationship carries `cascadedViews`. The element cascade also visits views that draw only a cascaded relationship.
- Folders: exactly one of `parent`/`root`; membership via `folder` on the member. Deleting a folder **re-homes** its contents (Archi deletes them). Deleting a container node lifts its children with translated bounds.
- Until #76, XML export reports `exchange.views-not-written` / `exchange.folders-not-written`.
- The v1 fixture was generated by `main`'s writer in a temporary worktree, so it is the real v1 shape.

522 unit tests and 16 e2e pass; every AC was mutation-checked. This machine needed `npx playwright install chromium` (the browser binary was missing).

Next: `/review-pr 81`, then #76 (exchange views and folders) and #77 (notation) can start; the #78 spike needs #76 for its 60-object test view.

## 2026-09-29 (cont.) — Concept merged; backlog carried over

Sponsor merged #73. #56 rewritten to the three-pillar position (Model / Repository / Plan). New label `modelling`; tracking issue **#74** (model pillar, M1–M3) with phase-M1 issues: #75 `View` + `Folder` model objects (and rename saved report views to `ReportDefinition`), #76 exchange-format views + folders round-trip, #77 ArchiMate notation as SVG components, #78 spike + ADR diagram engine, #79 read-only view canvas, #80 model tree. #13's `.archimate` scope extended to views + folders; #72 T4 now points at #74. Wiki project page + log updated (HQ `751ef85`).

Open: sponsor call on concept §7.5 (after M1: editor M2 or #72 T2 first); ADRs for #56–#59. Suggested start: #75 (everything in M1 depends on it) in parallel with #77 and the #78 spike.

## 2026-09-29 — New direction: Archi-class modelling + repository + collaboration + transition states

Sponsor direction: rebuild Archi's functionality as a modern web app (no Archi technology one-to-one), extended with a better repository, collaboration, and multiple repository states for planning transition architectures. Drafted `design/specs/archi-class-modelling-concept.md` (PR #73): Archi feature map from its user guide (adopt / redesign / extend / skip), hand-drawn views identified as the largest gap, transition states as overlays per #58 (not copies) with state-aware views, collaboration as "server optional" per #59, a six-phase order of work, and five decisions to ratify. Revises #56's "modelling second".

Open: sponsor review of PR #73 and the five decisions in §7; then rewrite #56 and file phase-1 issues (views read-only: `View` model object, exchange/.archimate view + folder import, model tree).

## 2026-08-13 (fix) — the dependency graph was broken in every browser: "U8 is not a constructor" (#54)

The graph screen reported `The graph layout failed: U8 is not a constructor` on a green 467-test suite. Root cause: **`elk.bundled.js` cannot be used inside a Web Worker.** The first time an ELK is constructed the bundle requires its own `elk-worker.min.js`, and that file branches on `typeof document === 'undefined' && typeof self !== 'undefined'` — its test for "I am running inside a Web Worker". In that branch it installs itself as the worker (`self.onmessage = …`) and exports **no constructor at all**, so the `Worker` the bundle reads back off its own exports is `undefined` and `new ELK()` throws. Minified, that `undefined` is called `U8`.

Two defects for the price of one: had the constructor not thrown, the handler `layout.worker.ts` installs would already have been replaced by ELK's dispatcher, and every later layout request would have gone unanswered until the 2s ack timeout.

Fix in `elk-runner.ts`: present a `document` for the length of the constructor call, then remove it. That takes the export branch — the in-process layout worker, which is what we want, since our own worker is already the thing keeping ELK off the main thread. elkjs reads nothing off the object (its only other mention of `document` sits behind an `msie` user-agent test), and the browserify module it caches on that first construction serves every later one.

**Why the suite was green.** The gap is the exact sibling of the one #50 harvested from #28. That review noted jsdom defines no `Worker`, so every test took the main-thread fallback, and answered it with a fake `Worker` driving the *protocol*. But the fake worker never runs the worker's *module scope* — and jsdom defines `document`, so every existing test, including the main-thread fallback, took elkjs's other branch. The thing the worker exists to do had no test that ran it under the conditions the worker actually has. `elk-worker-scope.test.ts` deletes `document`, leaves `self`, and drives the real ELK; with the shim removed it fails with `_Worker is not a constructor`, the unminified form of the reported error. It also asserts that `self.onmessage` survives and that the borrowed `document` is gone afterwards.

Verified beyond the test: the production `layout.worker` chunk was driven directly in a faked worker scope, before and after — `{"error":"U8 is not a constructor"}` then a real layout. Suite 468 green, lint/tsc/build clean.

**Candidate rule for the next harvest:** *a fake at the boundary tests the protocol, not the environment.* Faking `Worker` proves our messages are right; it cannot prove the code inside the worker runs, because the fake still executes in the caller's scope. Anything whose behaviour depends on which globals exist — `document`, `window`, `self` — needs a test that builds that scope.

**Reviewed in the same session (PR #55), which is worth flagging as a weakness: author and reviewer were one session.** Posted as a comment, not an approval — GitHub refuses a self-approval and it should. Three things the review changed, all pushed to the branch:

1. **The real finding was not the elkjs sniff — it was that the graph has no e2e journey.** `playwright.config.ts` says in its own docblock that the harness exists because *"workers, code-split chunks, the 404 redirect"* break in production and nowhere else. Fifteen journeys, and `grep -rn graph tests/e2e/` returned nothing. The harness was built for this exact risk and never pointed at the screen. `tests/e2e/dependency-graph.spec.ts` closes it, verified red against the reverted fix (0 nodes drawn).
2. **Both of that journey's assertions were then falsified separately**, because a journey with one real assertion and one decorative one is worse than honest. Re-run with `window.Worker` deleted: the node count still **passed** (the main-thread fallback genuinely draws the graph) while the worker-URL assertion failed with `WORKERS RECORDED: []`. So "29 nodes appeared" alone would not have caught a dead worker — the two cover different failures.
3. **Writing the journey produced the second rule.** Its first draft asserted "no layout-failure alert" *before* the node count, and that assertion passed against the fully broken graph: `toHaveCount(0)` is satisfied by a page that has not rendered yet. An absence asserted first is a one-sided bound wearing different clothes.

Also caught: the PR made its own docblock false — `computeLayout` still said *"Nothing here touches the DOM"* three lines above code that writes `globalThis.document`.

Left as a nit and deliberately **not** applied, so the diff a human reads stays the author's: `createElk` shims whenever `document` is absent, but elkjs only misbehaves when `document` is absent **and** `self` is present, so in plain Node it mutates a global for nothing. And one open judgement call for a second reader — keep the shim, or restructure onto `elk-api.js` with an elkjs-owned worker? The review argues keep, *because* the workaround is now guarded on both sides and can no longer break silently; but an author should not be ratifying that alone.

Harvested: two CLAUDE.md lines (fake-at-the-boundary; presence-before-absence) and one review-skill bullet (grep `tests/e2e/` for the screen the PR touches).

**Round 2 — the automated pass broke the review, which is the point of running it.** It returned ten findings, and the first falsified a claim I had already posted. I had "verified" the journey's *laid out by the worker, not the fallback* assertion by deleting `window.Worker` — the one failure mode where the Worker is never constructed. Every realistic one constructs it and fails after: `getWorker()` builds it before any outcome is known, and the recording subclass pushed the URL before `super()`. Confirmed by putting a `throw` at `layout.worker.ts` module scope and rebuilding: **the journey passed green with the worker completely dead.** That is the one-sided bound this very branch added a CLAUDE.md rule against, committed in the test written to demonstrate the rule.

Fixed by asserting what actually separates the two paths: `layoutOnMainThread`'s `import('./elk-runner')` is the only fetch of that ~1.4MB chunk and the worker bundles its own copy, so *never requested* means the main thread never laid anything out. Red against the dead worker, green against a live one.

Five more accepted: the unit test asserted only that two ids came back (`computeLayout` defaults missing geometry to `0`, so an all-zero layout passed — now asserts `b` above `a` and `height > 0`, verified red by forcing `y: 0`); `Reflect.deleteProperty`'s return was never checked; the journey number collided with file-round-trip's 5; the stats assertion compared a year from the Node process against one the browser computed; `getByRole('alert')` was page-wide. Two declined with reasons — memoising `createElk` (it would cache elkjs's good branch at import time and silently defeat the regression test; documented in the docblock where someone would try it) and `ELK` as a type (the default export is a value; `tsc` rejects it).

**No new rule harvested from round 2, deliberately.** The failure was an existing rule applied too shallowly, not a missing one: *when a test asserts that work happened in a particular place, break that place the way it actually breaks* — deleting the constructor is not the failure mode, failing after construction is. That now lives in the journey's own comments.

Standing conclusion for the working model: the strongest finding across both rounds came from the reviewer with no stake in the PR, and it caught an error in the *review*, not only in the code. Author-reviews are worth running and are not worth trusting alone.

## 2026-08-13 (review) — the phase-1 stack is merged: #24–#29 and #34, seven issues closed

Same session as the entry below, continued. **Every open PR is merged and `main` is green on all six checks** — 467 unit tests, 15 e2e journeys, `tsc`, `eslint`, `format:check`, `build`, `validate:xsd`. Issues #6, #7, #8, #9, #10, #11 and #19 are closed. Phase 1 is done.

Order: **#50** (the harvest) first, deliberately — it carries the sharpened CLAUDE.md line and four new review-skill bullets, so #25–#28 were reviewed under rules this session had just paid for. Then **#51** (#48's fix), then the stack bottom-up, retargeting each child to `main` **before** deleting its base branch. Nothing was auto-closed; the #15 accident did not repeat.

**What re-reviewing four already-fixed PRs was actually worth.** Ten of the fifteen candidates on #24 were already scoped into #33/#35/#38/#39, so the new §1 bullet paid for itself immediately. The findings that were real all came from the same place — *what `main` guarantees underneath a branch had changed while the branch sat*:

1. **#28's worker protocol had no test that could run it.** jsdom defines no `Worker`, so `getWorker()` returns undefined in every existing test and all of them took the `unavailable` branch onto the main thread. The handshake, the 2s ack timeout, the `failed` channel and the request-id guard ran only in a browser — which is where the round-1 review found all four broken. A fake `Worker` plus `vi.resetModules()` drives all six branches now, each verified by breaking it. **The code was already right**; six passed first time. That is the good outcome and worth saying plainly, because "we believe it works" and "it fails when we break it" are different states and only the second is worth having.
2. **#27's tag prompt had started telling users something untrue.** It refuses commas because "the exchange format separates tags with one" — accurate when written, obsolete the moment #37 landed `encodeTags`/`asTagArray`. Verified a comma-bearing tag round-trips. Filed to #43.
3. **#29 carried #24's `markSaved()` defect one branch up**, exactly as #24's own notes predicted. The `saved` outcome keeps it and has earned it — `saveWorkspaceToFile` resolves `saved` only after `writable.close()`. The `downloaded` outcome does not. Two tests now stand either side of that line, and **the second matters as much as the first**: removing `markSaved()` from `saved` must also fail, or the fix is "delete the feature" rather than "tell the two outcomes apart".
4. **#29's `ImportDialog` declared `aria-modal` and implemented none of it** — third occurrence after #24's menu and #25's palette. `useFocusTrap` had existed since #27 and was used by one dialog of three. The non-obvious part, now a review-skill line: **a component that renders `null` never unmounts, so a trap installed in it takes focus once at boot and gives it back never.** The body had to become its own component.
5. **#11's first acceptance criterion had no test at all.** "Save → edit → save writes the same file without a picker" is the entire reason the handle is held, and the only picker stub in the suite did a single save.
6. **#34's journeys were right and five of its expected values were stale**, each traceable to the review that changed it. The dirty-count fix is asserted against the count *before* the save rather than flipped to `> 0`, which passes at any value — the anti-pattern #49 will lint. The facet assertions decode rather than pin `layer%3Aapp`, because pinning an encoding makes the next escaping fix look like a regression.

**The pattern across all six: a branch that waits on a stack goes stale in what it *asserts*, not in what it *does*.** Every one of these was the suite or the code correctly reporting that the product had moved.

Filed this session: **#48** (`propertyTypes`, fixed and merged as #51), **#49** (the one-sided-bounds lint rule, 5th recurrence), **#52** (`importFile` has no error path). Harvested into #50: the range-bracketing tell in CLAUDE.md, and review-skill bullets for reading the prior round's disposition, asserting the criterion's own noun, asserting file-settleable criteria, and checking call sites before believing a finding.

**Open for next session.** Three review-skill lines are owed a harvest branch: the `null`-render focus-trap trap, *when a branch cannot run in the test environment that is the finding — fake the environment*, and *re-run a waiting harness against the merged base before reading a single assertion*. Then the follow-up queue, roughly in dependency order: **#38** (now unblocked — #29 built the surface it needs), **#32** (ships today, most alarming false message in the app), **#33** (the store data-loss cluster), **#49/#40/#35/#44/#45** (the harness tier), then **#39/#41/#42/#43/#46** (the per-screen follow-ups) and **#31**. Phase 2 (#12, #21–#23) is untouched.

## 2026-08-13 (review) — `/review-pr 24` re-review: two vacuous acceptance tests block, and #37's `propertyTypes` never reached the store

Re-reviewed **#24** (app shell, closes #6) after `a6d5247` fixed all six blocking findings from the first round. Posted the review on the PR; filed **#48** (bug) and **#49** (harness). Verdict: request changes on a narrow, cheap set — two tests, no behaviour change.

The generic pass produced 15 candidates. Running each down against the code killed two outright and demoted three, which is the part worth keeping: **a finding that names a real code smell can still have an unreachable failure scenario.** "`removeWorkspace` discards the open workspace's unsaved edits when you delete a different one" needs `removeWorkspace(otherId)`; the only caller passes `store.id`. "The leaked `URL` stub breaks every remaining test in the file" — break-run says 11/11 still pass. Both were real observations about the code and wrong about the consequence.

**Decisions and findings worth carrying forward:**

1. **Break the test, don't read it.** `expect(health).toBeGreaterThan(0)` + `toBeLessThanOrEqual(100)` brackets the whole plausible range for a percentage, so it asserts only that the number *is* a percentage. Replacing `store.health()` with the constant `1` left all 270 tests green. This is the **fifth** recurrence of the vacuous-acceptance-test rule (#25, #26, #27 ×2, now #24), so the harvest escalated from prose to mechanical: **#49** specifies an ESLint rule banning bare one-sided bounds, driven by the existing `src/test/eslint-rules.test.ts` harness *with a bypass test* — the discipline #37's `localeCompare` hole established.
2. **AC4 was met and unprovable, which is a different defect from AC4 being broken.** "No layout shift when switching themes" is fully mechanical: whatever the dark block redefines must be colour-valued. A criterion that is satisfiable by inspection and left to inspection is the cheapest test in the repo not to have written. Written and pushed to the PR branch as **`f125920`** (`src/styles/tokens.test.ts`, 272 tests, all six checks green): two assertions — only-colours, and no dark-only orphan — each verified by breaking it, and each failing *only* on its own violation (`--rowh: 30px` fails the first, `--brand-new: #123456` the second). `[data-density='compact']` is excluded on purpose: density is a size switch and is supposed to resize.
3. **#37 taught the schema, the canonical JSON and the XSD about `Workspace.propertyTypes` — and not `ModelStore`.** `snapshot()` and `replaceWorkspace()` build their `Workspace` field by field and neither mentions it, so the typing dies on the way to any file. Proven with five assertions, incl. exported XML re-declaring a `date` property as `string` — the #37 regression verbatim. **Not a #24 regression** (`snapshot()` is untouched by that PR) and not reachable through #24's UI (import disabled; the demo declares only `type="string"`, which `declaredPropertyTypes` skips). It goes live the moment #29/#11 land import, because #24 is what made `store.snapshot()` the source for SAVE FILE and Export. Filed as **#48**; must land before #29 merges. The general lesson is in its acceptance criteria: assert `snapshot()` deep-equals what it loaded, rather than listing fields by hand, so the *next* field added to `Workspace` cannot be forgotten the same way.
4. **Re-reviews must read the disposition of the last one first.** Ten of the fifteen candidates were already scoped into #33 (A.1 flush barrier, C.6 boot errors), #35 (colour-literal CI, `--accent-ink`), #38 (export problems channel) and #39 (ready gate, dead workspace rows, menu a11y, owner rule, blob revoke) — several with the author's reasoning recorded on the PR. Re-reporting them as new blocking findings would have re-litigated settled decisions and buried the two that mattered. Listed them as "already tracked" instead.

**Harvest** (this branch, `chore/harvest-24`): CLAUDE.md's acceptance-criterion line gains the range-bracketing tell and the "satisfiable by inspection is still a criterion" clause, and points at #49. The review skill gains four bullets, all paid for this session: read the previous round's disposition before re-reporting (§1); assert the criterion's own noun, not a sibling rendered by the same component (§2); a criterion settled by reading a file can be asserted about that file (§2); and check the call sites *and* `git diff base...head` on the function before believing a finding (§3).

**Open for next session:** #24 needs finding 1 (assert the health value and that it moves) — that is the only blocker left, AC4 is closed. Then merge bottom-up with the rest of the stack. **#48 before #29.**

## 2026-08-13 (Opus, implementation) — #37 fixed: eight readers and writers that breached the invariant the PR exists to enforce

The stack was done and the implementation lane was blocked on review — except for **#37**, reviewed on the 12th with eight blocking findings and never picked up. It sits on `main`, independent of the stack, so it was the one thing genuinely available. Fixed all eight plus 9, 10 and 11; **242 tests** (was 189), all six checks green, pushed as `c58648d` + `d474eaf`.

**Finding 8 first, because it was the only one that made the *repo* less safe rather than one file.** The `localeCompare` rule keyed on `arguments.length<2`, so `localeCompare(a, b, undefined)` passed lint and still collated by machine locale — while the CLAUDE.md line the same PR wrote announced the guarantee. The selector now requires a **string-literal locale at the call site**: `undefined`, `void 0` and a variable all reach the same default, and only the literal is something a selector can follow. Extended to a computed member and to `Intl.Collator`, which had the identical hole one constructor over. `src/test/eslint-rules.test.ts` runs the **real ESLint over the real `eslint.config.js`** — so the thing under test is what `npm run lint` does, not a restatement of the selectors that could drift from them. 12 snippets, 320ms.

**Decisions worth carrying forward:**

1. **Where the writer and the reader have to agree, one function decides and both call it.** The tag encoding was a writer that emitted a comma list or a JSON array, and a reader that guessed from a leading `[`. Now `asTagArray` is the single predicate: the writer refuses the comma form for anything the reader would take as JSON. That makes `decodeTags(encodeTags(t)) === t` structural rather than a claim, and it is why a tag named `["a"]` or `[]` round-trips.
2. **Same shape for finding 4.** `stripProfileKeys` removed every owned key while the reader kept only guard-passing values, and nothing reconciled them. `readPortfolioProfile` now returns `{ profile, unread }` and `stripProfileKeys(properties, unread)` keeps exactly what did *not* become a field — what leaves is what was read, by construction. The relationship reader had the same hole (`archipelago.annualCost: "about a lot"`); the review only named the element one.
3. **Carried, not reported, for finding 6** — per this PR's own decision that carrying beats reporting where it is possible. Cost: one optional `Workspace.propertyTypes`, its schema entry, and canonical-JSON read/write. **The Open Group's real XSD accepts `currency`, `date`, `time` and `number` on a `propertyDefinition`**, so `validate:xsd` now validates a re-exported file carrying all four — proved rather than assumed.
4. **Findings 5 and 6 only round-trip together.** Keeping the text (`0912345678` survives `Number`'s spelling) is half; carrying the `type="number"` declaration is the other. Either alone still loses.
5. **Finding 9 needed fixing on both sides.** Omitting `junctionKind` on read is what the review asked for, but a JSON file with an explicit `"and"` would still have differed after an XML trip — so `canonicalElement` omits the default kind too. Absent is now the only spelling of `and` that gets written, in either format.
6. **Finding 11: cached, not vendored.** The reviewer asked for the XSD to be vendored; the docblock's reason not to still holds — it is The Open Group's and this repo is MIT, the same argument that kept their ArchiSurance model out. Fetched once into `node_modules/.cache/`, `--refresh` to re-fetch, `ARCHIMATE_XSD=<path>` to override. Offline after the first run without redistributing their file. Flagged on the PR as overrulable.

**The finding the review did not have: `record[key] = value` is not total.** Checking whether finding 2's shape — an untrusted key on a plain object — appeared anywhere else turned up its twin on the *write* side. Assigning `__proto__` invokes the prototype setter rather than creating a property, and for a string value the setter does nothing, so a property literally named `__proto__` was read, assigned and gone with `problems: []`. `setKey` (new `src/io/records.ts`) uses `Object.defineProperty` at every site whose key comes from a file.

**And the test for it was the trap first time round**, which is the part worth keeping. Written longhand, `expect(properties).toEqual({ __proto__: 'mine', owner: 'kept' })` sets the prototype of the *expectation*, which quietly becomes `{ owner: 'kept' }` — so it passed against the broken code and failed against the fixed code. That is how the bug got noticed at all. A computed key fixes it. **The `__proto__` trap is symmetric: it eats the assertion as readily as the code**, so a test written to catch it can agree with it instead.

**Every fix was verified by removing it and watching a named test fail** — scripted, one defect restored at a time, the failing test names recorded. All ten caught.

**Not done, deliberately.** #45 (ESLint ban on casting a form value to a model union) is now unblocked in the sense that #37 has settled the rules array, but landing it would add a tenth PR to a queue the review lane is already behind on — and, like #35 and #44, a new lint rule on `main` can turn open PRs red all at once. It waits for the stack to merge.

**State:** #24–#28 fixed and green, awaiting re-review. **#37 fixed and green, awaiting re-review.** #29 and #34 still unreviewed; #29 conflicts on `Header.tsx`/`SaveStateIndicator.tsx`, which is #29's review to decide, not the implementation lane's. #47 mergeable. Next: `/review-pr 29`, then #34, then re-review of #24–#28 and #37.

## 2026-08-12 (Opus, implementation) — the whole reviewed stack fixed: #24–#28, 41 blocking findings

Took the five reviewed PRs bottom-up, fixing each against its own review and cascading the result into the branch above before starting it. All five now green: **#24** (6 blocking), **#25** (6), **#26** (8), **#27** (9), **#28** (10). 349 tests, up from 313.

**The discipline that mattered most: every fix was verified by removing it and watching a test fail.** That found five of my own tests which could not fail, four of them *after* I had written them believing otherwise:

1. An `Autosaver.suspend()` test that asserted the snapshot was on disk afterwards — the assertion's own `await` gave the write all the time it needed, so it passed either way. Now asserts ordering.
2. A palette break that moved the key handler still passed all 28 tests, because the Tab trap and the mousedown guard were doing the work; the test was measuring something else.
3. `tabIndex={-1}` on palette rows changes no observable behaviour behind the focus trap — kept for the combobox contract, but with a structural assertion rather than a behavioural one it has not earned.
4. `useFocusTrap` first filtered candidates on `offsetParent !== null`. **jsdom reports null for every element**, so the trap was empty in exactly the environment its test runs in.
5. An assertion for #27's type-guard fix that checked a rendering symptom (`0` renders as "Not assessed" too) rather than the defect.

**Two findings turned out worse than the review said, and only instrumentation showed it.**

- **#27's `deps` test was vacuous twice.** The review found that rerendering with a fresh workspace builds a new store, busting the memo on `store` alone. Holding the workspace still was not enough: `toHaveTextContent` is a *substring* match and the stale value `Claim Handling Engine` contains the expected `Claim Handling`. Found by rendering a probe that logged what each pass computed.
- **#28's cost test could not fail even after the panel was fixed.** The demo carried `annual.cost` on eleven elements with the literal value `1.2M EUR / yr` — the exact string the assertion looked for. The demo data moved onto the edges (ADR 0001) and the element property and its `propertyDefinition` are gone; still validates against the Open Group XSD, as checked in and round-tripped.

**Design decisions worth carrying forward:**

1. **`SAVE FILE` no longer marks the model clean at all, on any path.** The rule is absolute and the only observable write is the File System Access handle, which is #11's — already built on `feat/11-file-workflow`. Building a second copy in #24 would have duplicated a file #29 owns and given #24 a failure path with no surface to report it on. So #24 does the honest half: the file is offered, the count stands, and the indicator's tooltip says why. **A cold boot now shows `LOCAL · 1 UNSAVED`**, because a snapshot that has only ever lived in IndexedDB matches no file — visible, and the sponsor may want to weigh it.
2. **`replaceWorkspace({ markClean })` has no default.** Exactly one call site broke on compile, which is the evidence the mechanical harvest was right.
3. **Where a rule's durable fix belongs to another PR, close the path rather than inventing a second encoding.** #27's `+ tag` prompt refuses a comma instead of escaping it, because #37 is rewriting that writer and a second encoding would have to be reconciled at merge.
4. **Gate the editors, not the display.** #27's findings 5/6 asked for assessment and lifecycle to respect `carriesProfile`; removing the sections would have contradicted UI spec §4, which makes "a capability shows Not assessed" a case the screens must hold up for.
5. **Fix at the source when the same list has other readers.** #27's duplicate self-relation was fixed in `relationshipsOf`, not in the fact sheet's `entries` builder — `removeElement` builds its delete cascade from the same list, so the duplicate was also a double entry in a command that undo replays.
6. **A timeout on a job cannot tell a dead worker from a busy one.** #28's worker now acks on receipt; the 2s timer covers the handshake only, and the computation takes as long as it takes.

**Two things a reviewer of the upper stack needs to know**, both consequences of accepted #24 decisions rather than new defects:

- **#29's `FileWorkspaceProvider.save()` calls `store.markSaved()` on `kind: 'downloaded'`** — the same finding as #24's blocking 1, one branch up, with a docblock stating the invariant it breaks.
- **#34's `file-round-trip` journey breaks twice**: it asserts `dirtyCount === 0` after a save while the harness deliberately puts Chromium on the download path, and it asserts `id: 'ws-archisurance-demo'`, which the fresh demo id changes.

Deliberately **not** done: cascading into #29 and #34. They are unreviewed, and propagating would mean fixing their tests — decisions that belong to their review.

**State:** #24–#28 fixed, green, mergeable, each with a fix summary posted. #29, #34, #37, #47 untouched. Next: `/review-pr 29`, then #34 — and re-review of #24–#28.

## 2026-08-12 (later) — #28 and #37 reviewed; #30 merged and the rules propagated through the stack

**#30 merged, and the reason matters more than the merge.** Every harvested rule had been living only on `chore/session-log`, so the feature branches whose code produced them still carried the stale 39-line CLAUDE.md — I hit this directly when checking out `feat/10-graph` to review #28 and found none of the separator, type-guard or route-key rules present. The harvest loop was writing rules the fix sessions would never read. Merged #30, re-cascaded `main` through all seven stack branches (177/197/236/257/290/313/313 green), and verified the 44-line file with every rule now lands on each one.

**#28 dependency graph — request changes, 10 blocking.** One theme: the PR adds a worker timeout, a worker-error channel, a main-thread fallback and a `?year=` guard, tests none of them, and **all four are broken.** `runLayout(...).then()` has no `.catch`, so any layout failure hangs the canvas on "laying out…" forever — reachable in production because the fallback is a dynamic import of the 1.4MB ELK chunk, which 404s for a tab loaded before a Pages redeploy. The 10s worker timeout cannot tell a dead worker from a slow one, so it kills a working one and re-runs the layout *on the UI thread*, permanently, for exactly the models that need the worker. `?year=999999999` makes `startOfYear` NaN and renders every element as Plan — a confident, entirely wrong landscape. `?focus=<unknown>` dims all 29 nodes with no panel and no CLEAR. Also: **no arrowheads anywhere** (the handoff specifies them twice; in a dependency graph direction is the information), the trace panel reads cost from an element property against ADR 0001, and the whole node visual encoding can be deleted with all 33 tests green.

**#37 io hardening — request changes, 8 blocking.** Good work that fixes eight real interop defects, but the new readers and writers breach the very invariant the PR exists to enforce. Six paths drop, rename or rewrite data and report `problems: []`, every one verified by running the code: a `propid-N` element id collides with a minted propertyDefinition id and emits a **duplicate `xs:ID`** no certified tool will open; `xsi:type="toString"` imports as a phantom Junction because a plain-object lookup hits `Object.prototype`; a tag literally named `["a"]` decodes to `a`; a known profile key with an unreadable value is deleted; `type="number"` values are rewritten lexically (`0912345678` → `912345678`); and declared `currency`/`date` definitions downgrade to `string`.

**The most valuable finding of the day audits the harvest loop itself.** #37's `localeCompare` ESLint rule — harvested from the #17 review specifically to make ADR 0004 mechanical — keys on `arguments.length<2`, so `localeCompare(a, b, undefined)` passes lint and still collates by machine locale. The PR also rewrote the CLAUDE.md line to announce that the rule is now enforced by lint rather than by memory. Merging it would have put a **false guarantee** on `main`. Verified all four call forms by linting them.

**Rules harvested (three, plus two deliberate non-harvests):**

1. **A fallback, a timeout or an error branch needs a test that fires it** (from #28). Useful discovery while writing it: Vitest already exits non-zero on an unhandled rejection (verified, exit code 1), so CI would have caught #28's hang the moment any test drove layout to fail. The guard existed; only the test was missing.
2. **A mechanical guard needs a test that fires it, and one for the nearest bypass** (from #37). A rule that silently fails is worse than no rule, because the next author trusts the line advertising it.
3. **The separator rule takes its fifth instance and its first on the *read* side** — a decoder has to be unambiguous too, so the round-trip test needs a value that looks like the escaped form, not just one containing the separator.

Not harvested, deliberately: #28's ADR 0001 violation (the rule already says exactly the right thing and was simply not followed) and #37's untested fallbacks (the #28 rule covers them, one PR early).

**On review cost and trust.** #27's first run was **gutted and lied about it** — `"No findings survived verification"`, `candidates: 0`, after 4 of 5 agents died to machine sleep and stalls. That text is indistinguishable from a genuine clean result; only `agents_error: 4` in the usage block gives it away. **Read the usage counters before believing any zero-finding review.** The re-run went 36/36 and found the worst bug in #27 — an edit form that overwrites the element you navigate *to* — which the manual pass had missed entirely, because finding it needed the running app rather than the diff. Three clean runs at `high` cost 1.7M / 2.0M / 1.9M subagent tokens and each earned it.

**State:** `main` has #14–#17 and #30. Open: #24–#29 + #34 (stack, all in sync with their bases, all green; #24–#28 reviewed and awaiting fixes), #37 (reviewed, awaiting fixes). New issues: #43, #44, #45, #46. Next: `/review-pr 29`, then #34 — or hand #24–#28 to an Opus session for fixes, which is now unblocked since every branch carries the current rules.

## 2026-08-12 — #27 reviewed; `main` merged through the whole stack; three rules harvested

**PR #27 (element fact sheet) gets request-changes** — nine blocking findings, seven more below the line. The handoff transcription is the most exact in the stack (`factsheet.css` has no `[data-theme]` block at all — every colour is a token, so dark structurally cannot drift), and all four acceptance criteria are met. What blocks is one root cause and two repeat rules.

**The root cause is worth carrying forward.** `/element/:id` re-renders `ElementScreen` without remounting it. That single fact produced three separate defects: the `useModelSelector` staleness the PR itself found and fixed; an `editing` flag plus uncontrolled `defaultValue` inputs that carry one element's name and documentation onto the next and **commit them on blur** (open an application, click Edit, click through to a capability, tab out of the name field — the capability is renamed to the application's name, and its documentation is overwritten); and a test for the fix that passes with the fix removed. The PR treated the symptom in the store. `key={id}` on the route kills all three.

**Two findings are model-integrity bugs with reproductions.** Choosing "Not assessed" stores `functionalFit: 0` / `timeClassification: ""` — Ajv rejects the export against the app's *own* published schema, `profileToProperties` then drops both silently through falsy guards, and completeness *rises* because `filled(0)` is 1. And a self-relation is listed twice (`relationshipsOf` is `outgoing ++ incoming`), giving a duplicate React key and a relation count one too high — `NeighbourhoodGraph` guards this; the `entries` builder one hop away does not.

**On the review machinery: the first run was gutted and lied about it.** It reported `"No findings survived verification"` with `candidates: 0` after 4 of 5 agents died (two on machine sleep, two stalled) — 1.2M tokens for nothing. That is the known failure mode, and the summary text is *indistinguishable from a clean empty result*; only `agents_error: 4` in the usage block gives it away. **Always read the usage counters before believing a zero-finding review.** The re-run went 36/36 clean at 1.7M and was worth every token: it found the navigation data-loss bug, which the manual pass missed entirely, by driving the real app rather than reading the diff.

**`main` merged through the entire stack.** The stack had exactly one break — `feat/7-command-palette` was 14 commits behind its own base — and everything above it inherited the gap. Merging the base down and cascading fixed the chain: #25 197 ✓, #26 236 ✓, #27 257 ✓, #28 290 ✓, #29 313 ✓, #34 313 ✓ + E2E ✓. Every branch is now 0 behind its base and all six PRs are green. Two things this surfaced:

- **The stack had been reviewed against a stale `src/io` all along.** `main` carried the #17 review's fixes (`canonical-json.ts` +194, `exchange-format.ts`, `profile-properties.ts`); the branches predated them.
- **The mid-stack branches had no `CLAUDE.md`** — cut before it was written — so review agents working them read a repo with no invariants in it. Now fixed everywhere.

Done in a scratch worktree so the primary checkout never moved and the in-flight review's agents saw no file change; `src/ui/factsheet/` came through byte-identical, so no finding shifted.

**Three rules harvested, each earned by a repeat:**

1. **Type guards belong on the write path** (CLAUDE.md). `main` had already fixed `Number('') === 0` for `annualCost` *with a comment naming it*; #27 reintroduced the identical coercion in the UI, different author, different file. The guards (`isFitLevel`, `isTimeClassification`) existed and only `src/io` used them.
2. **Key a component on the route parameter that identifies its subject** (CLAUDE.md). The root cause above.
3. **The acceptance-criterion test rule moves from the review skill into CLAUDE.md.** It sat in the skill for three PRs and was broken twice more in #27 — by implementers, who never read the review skill. The skill keeps the reviewer half, sharpened: *do not reason about the test, break it* — delete the feature and run that one test.

The separator rule also takes its third instance: #27's `+ tag` prompt is the first UI that makes the #17 comma-join reachable by a user (`Core, regulated` round-trips into two tags with `problems: []`).

**Two mechanical harvests filed rather than landed, both for the #35 reason.** #44 — fail the unit suite on `console.error`/`console.warn`; both duplicate-key findings are console errors the unit suite ignores today, and the e2e harness's equivalent guard is this repo's own "highest-value fixture". Measured green on all eight branches (163/177/187/197/236/257/290/313), but `src/test/setup.ts` is modified by six open PRs, so it lands after the stack merges. #45 — ESLint ban on casting a form value to a model union, following #37's `localeCompare` rule; lands after #37, which owns that rules array.

**State:** #24–#29 + #34 all green and in sync; #24/#25/#26/#27 reviewed, awaiting fixes. #30 and #37 mergeable. New issues: #43 (fact-sheet follow-ups), #44, #45. Next: `/review-pr 28`, then #29, #34.

## 2026-08-11 (later) — Review session: #30 unblocked, #24/#25/#26 reviewed, four rules harvested

Cleared the session-log conflict and reviewed the bottom three of the phase-1 stack. All three get **request changes**; none for structural reasons, all for a concentrated problem area each.

**PR #30 unblocked.** It had conflicted since 4 August and therefore got no CI at all (a conflicting PR has no merge ref to build). `main` and the branch each held entries the other lacked; resolved as a union, newest first, with the three 7 August entries in chronological order. Green and mergeable.

**#24 app shell** — the handoff transcription is the most faithful in the repo (every dimension sampled matches, `tokens.css` untouched, dark block is colours-only so the no-layout-shift criterion holds structurally). Six blocking findings, four of them the same shape: *a write path claiming a success it cannot observe*. `SAVE FILE` marks the model clean after an anchor click it cannot see the outcome of; switching workspaces zeroes the unsaved-to-file counter; deleting a workspace loses to a pending autosave (`window.confirm` blocks past the 800ms debounce, so the timer fires into the gap between `deleteWorkspace` and `replaceWorkspace`); the demo button adopts a fixed id from a click handler. Filed #39.

**#25 command palette** — genuinely good work, and the prototype-gap fix (`isTypingTarget` as its own tested module) is the right instinct. But the keyboard flow it is named for breaks under three ordinary interactions: all key handling sits on the input's `onKeyDown` while the 54 rows are focusable buttons, so one Tab kills it; a resting mouse pointer overrides the arrow selection; and `aria-modal` is declared with no trap, no restore, no `aria-activedescendant`. Filed #40 (lint) and #41.

**#26 inventory** — `filters.ts` is the best-tested code in the stack and exactly right against the handoff's "implement exactly" block. Two acceptance criteria fail on *evidence*: the 5,000-element test asserts `rows < 150`, which passes at 0, and 0 is what that branch renders; back/forward was never implemented (`setParams(..., {replace:true})` everywhere) while the module docblock claims otherwise. Filed #42.

**Four rules harvested — each earned by a repeat, not a hunch:**

1. **The save-state indicator must not overstate** (CLAUDE.md). The old line said "never weaken or hide it", which neither #24 failure technically breaks — both leave it fully visible and lying.
2. **Never join user-authored strings without escaping** (CLAUDE.md). #17/#37 fixed comma-joined tags in the exchange writer; #26 reintroduced the identical bug in the URL facet encoder, independently. Different author, different file, same mechanism.
3. **A declared ARIA widget role is a contract** (skill §2) — check focus entry, trap, restore and announcement, not the attribute. Three instances in three PRs. The static half became #40 (`eslint-plugin-jsx-a11y`); focus traps are not lintable, hence the review bullet.
4. **A test behind an acceptance criterion must fail when the feature is removed** (skill §2). Second instance: #26's virtualisation test passes at zero rows, #25's "clears the query on reopen" closes the palette first so it never covers ⌘K-while-open.

**The #24 harvest failed within one PR, which is the useful lesson.** The CLAUDE.md line about marking clean was reproduced by copy-paste in #25's palette action, which also dropped the reader-role guard the header applies. Prose does not survive copy-paste. The replacement is mechanical: one `saveWorkspaceToFile()` owning the guard, the download and the clean-marking, so there is one place to get it wrong — and a new review check that treats *a second call site of a data-safety path* as a finding in itself.

**On review cost and trust.** The #24/#25 runs at `xhigh` cost ~2.8M subagent tokens between them and #25 hit the session limit mid-run: 8 agents died including *synthesize*, so findings came back verified but unmerged — 15 entries that were really 9 repeated. That degradation is subtler than the known "gutted run reports zero findings" mode and needs the same suspicion; merge and rank by hand from `journal.jsonl` rather than re-running. Sponsor's call: **`high` for the rest**. #26 at `high` cost 1.7M, ran clean, and lost nothing worth having.

**Also blocking now, not tidying:** #35's `--on-accent` token gates the `#fff` fixes in #24 *and* #26, and the handoff paints on-accent text in four places mapping to #24/#26/#27/#28 — so it is a dependency of the fixes, not a follow-up. The #35 CI check itself should still land only after the stack merges, or five open PRs go red at once.

**State:** open PRs #24–#29 (#24/#25/#26 reviewed, awaiting fixes), #34, #37, #30 (green, mergeable). New issues: #39, #40, #41, #42. Next: `/review-pr 27`, then #28, #29, #34.

## 2026-08-11 — #36 io hardening shipped (PR #37); the only issue the stack wasn't blocking

Reviewed what was pickable while the seven-PR phase-1 stack (#24 → #29, #34) waits on review, and #36 was the only one genuinely unblocked: it works against merged `main` (`src/io`), and the whole stack touches only `src/io/index.ts` in that area. #33 (store hardening) names `FileWorkspaceProvider`, `takeOver()` and `tab-lock.ts` — all rewritten by the stack — and #35 needs CSS from #24/#26, so both really do wait.

**Shipped in PR #37** (open against `main`, CI green, 189 tests): junctions map between our one `Junction` + `junctionKind` and the schema's `AndJunction`/`OrJunction`; `xs:ID` sanitisation applied to identifiers _and_ refs with every rewrite reported; views and tag groups carried through XML instead of being destroyed; typed property definitions; allowlist (not prefix) stripping of `archipelago.*`; comma-safe tags; empty-string values preserved; bare `localeCompare` now fails lint.

**Design decisions worth carrying forward:**

1. **One `Junction` with a kind, not two element types.** The catalogue follows the specification; the _format_ is where the two concrete types live. Keeping the catalogue spec-shaped meant `validity.ts` and every facet needed no change at all.
2. **Carry, don't report, when carrying is possible.** Views and tag groups go into namespaced model properties holding canonical JSON. "Report the loss" was the cheaper option the issue allowed, but it would have fired a warning on _every_ XML export (tag groups always exist), which trains people to ignore warnings.
3. **`exportExchange` returns `{ xml, problems }`; `exportExchangeXml` keeps its old signature.** The unmerged stack calls the latter from `file-download.ts`, so changing the signature would have broken seven PRs. Wiring the save path to show the problems is #38, blocked on #29.
4. **Sanitising ids claims every already-valid id first**, so a rewrite can never steal a name another concept needs — the bug you only find when two ids collide after cleaning.
5. **`npm run validate:xsd` is the acceptance test**, not the unit suite: it now validates five files (each fixture as checked in _and_ round-tripped, plus a workspace with deliberately illegal ids) against The Open Group's real XSD.

**State:** `main` has #14–#17 merged. Open: #24–#29 (phase-1 UI stack, bottom-up), #34 (E2E, sits on #29), #37 (this, on `main` — mergeable independently), #30 (session log). New: #38 (surface export problems in the save path). Still open from the E2E session: #31 (undo/redo has no UI), #32 (cold-boot takeover flash).

## 2026-08-10 — E2E harness (#19) built on top of the stack; two defects found by driving the real app

Picked up #19 and stacked PR #34 on `feat/11-file-workflow` — the tip of the review stack, because journeys 3–5 need the inventory, fact sheet and file workflow that are still unmerged below it. Playwright against the **built** bundle served by `vite preview` on the Pages base path, not the dev server: the two things that break in production and nowhere else are the base path and the production build. Five journeys, 15 tests, ~13s locally, stable over `--repeat-each=3`; a second CI job uploads trace, screenshot and video on failure. `tests/manual/` carries the paired UAT scripts and a `uat-cycle` issue form, per the HQ testing convention.

Choices worth carrying forward:

- **The console-error guard is the highest-value fixture.** Every test fails if the app writes a `console.error` or throws — a React app can render the right pixels while dying in an effect, and the journey would otherwise pass.
- **The File System Access API is hidden in tests.** Its picker is a native dialog no automation can drive, so Chromium is put on the download / `<input type=file>` path Firefox and Safari use anyway. The fallback path is now the one under test, which is the right way round.
- **Filter semantics are asserted as identities, not numbers**: `OR = A + B − AND`, `NOT = total − OR`. True whatever the demo contains, and they break the moment the combinator semantics drift — where memorised counts would just need updating.
- **Seeding goes through the app's own importer** ("Explore the demo"), never by injecting into the store. Isolation is free: Playwright's per-test context starts IndexedDB and localStorage empty.
- Reads after a facet click race the DOM — react-router updates the URL synchronously and the count a render later. Counts are read through a helper that waits for the result line's own summary text first.

Two defects the journeys turned up, filed rather than fixed in a test PR: **#32** — every cold boot flashes the read-only "This model is open in another tab" screen, then the empty shell (which rewrites the URL to `/inventory`), and only then first run, because `ModelStoreProvider` initialises `role` to `'reader'`, rendering the _unknown_ state as the known bad one; recorded as a `test.fixme` so it goes green when fixed. **#31** — undo/redo has existed in the store since #4 and is reachable from nowhere in the UI, which is why journey 4 stops at the dirty counter instead of the edit → undo → redo #19 asks for; wiring it has a real question in it (do not steal native undo from text fields), so it is its own issue.

CI verified failing on a deliberately broken smoke test (run 31420006413: e2e red, lint/test/build green, 2.0MB of artifacts uploaded), then put back — the last acceptance criterion on #19.

Open: the stack #16 → #29 is still unmerged and unreviewed, and #34 sits on top of it. Merge bottom-up with merge commits, retargeting each child before deleting a merged base branch.

## 2026-08-07 — First merges: #14 + #15 shipped, app live; review process operational

Reviewed and merged PRs #14 (bootstrap) and #15 (metamodel) — two-layer review per the new `/review-pr` skill (acceptance criteria + invariants inline, multi-agent code review). **The shell is live at https://markussteinbrecher.github.io/Enterprise-Architecture/** (Pages switched to workflow-based deploys). Session also produced: project CLAUDE.md, product ADRs 0001–0005 (name ratified: Archipelago), issues #18–#23 (tags, E2E harness, release checklist, report-engine split of #12), repo description/topics, demo-data licensing research (moot — Opus authored an original model; naming nit open), first harvested rule (glyph radius exemption in CLAUDE.md).

**Open for next session:** (1) review #16/#17 with `/review-pr` — this session's multi-agent runs were gutted by subagent usage limits (reset 8:30 Zurich); do NOT trust their empty findings; (2) merge bottom-up with **merge commits, never squash** (stacked PRs), and **retarget the child PR to main before deleting a merged base branch** — GitHub closed #15 when feat/2-bootstrap was deleted (fix: restore ref, reopen, retarget); #17 still based on feat/4-model-store, retarget after #16 merges; (3) Opus branches for #6/#7 queue behind review; (4) optional ArchiSurance-name decision for the demo workspace.

## 2026-08-07 — Wiki ADR 0007 filed; HQ divergence reconciled

Filed HQ wiki ADR 0007 (repo repurposed to Archipelago, knowledge base at `knowledge-base-final` tag) and updated the wiki: enterprise-architecture project page rewritten (Project Card per portfolio convention), ea-repository cross-linked, portfolio shaping note filled, index/decisions/log updated. Along the way reconciled a two-machine wiki divergence: remote had evolved ~20 commits (schema v0.5, wikilinks + portfolio conventions, Quartz); merged with remote winning, recovered the AndrAI page and the tokens ADR (renumbered 0004 → 0006), dropped a superseded rrradio commit. Meanwhile Opus sessions landed issues #2–#4 (scaffold + CI/Pages, metamodel, model store) in this repo.

## 2026-08-07 — Phase 0 and phase 1 implemented; issues #2–#11 in review as a stacked PR chain

Built the whole of phase 0 and phase 1 against the design handoff. Ten stacked PRs, one per issue, each based on the previous so every diff is reviewable on its own: #14 bootstrap (#2), #15 metamodel (#3), #16 store (#4), #17 import/export (#5), #24 app shell (#6), #25 command palette (#7), #26 inventory (#8), #27 fact sheet (#9), #28 dependency graph (#10), #29 file workflow (#11). CI green on all; 303 tests. Sponsor asked for PRs so Fable can quality-check, so nothing was merged to main.

Decisions worth carrying forward:

- **Relationship validity as rules, not a transcribed table.** The spec's Appendix B is a generated matrix that already includes derived relationships; `src/model/validity.ts` expresses the structural rules it is generated from over `(layer, aspect)` plus named exceptions, and `validity.test.ts` is the specification of record.
- **Completeness scoring** (UI spec open question 4) resolved: weighted fraction of the fields _expected_ of an element, where profile fields are expected only of profiled types, so a capability is not penalised for having no technical fit. Weights in one config; rule documented in `src/model/README.md`.
- **The demo model is ours, not The Open Group's.** Their ArchiSurance is copyrighted and the mirrored copy is GPL-3.0; neither belongs in an MIT repo. The bundled demo is the design prototype's 29 elements / 47 relationships serialised to exchange format. Both it and a round-tripped export validate against the official XSD (`npm run validate:xsd`).
- **"End-of-life applications" saved search ships as AND, not the OR the UI spec suggests** — under that section's own definition of OR it would return every application plus everything phasing out anywhere.
- **ELK partitioning constrains layer order, not layer count**, so the three bands are re-stacked after layout; ELK still does crossing minimisation and node placement.
- Three bugs found only by driving the real app: `TabLock` deadlocking itself out of the writer role under React's double-invoked effects; `useModelSelector` going stale on navigation because it memoised on the model version alone; a layout worker that never answers hanging the canvas forever.

Open: sponsor to switch Pages source from the legacy `/docs` branch to GitHub Actions before the deploy workflow can publish (issue #2 scope, needs repo admin). Phase 2 (#12 report engine + five reports, #13 Excel/`.archimate`) untouched.

## 2026-08-06 — Repo repurposed to Archipelago; implementation issues filed

Sponsor decision: the product is built **in this repo** (supersedes the old ADR-003 separate-repo pattern), knowledge-base content cleaned out. Pre-cleanup state preserved at the `knowledge-base-final` tag. New product README + MIT license; Claude Design handoff relocated to `design/handoff/2026-08-inventory-factsheet-graph/`, UI spec to `design/specs/open-ea-repository-ui-spec.md`. Filed GitHub issues #2–#13 (labels phase-0/1/2) covering bootstrap → metamodel → store → import/export → chrome → palette → inventory → fact sheet → graph → file workflow → report engine → Excel/.archimate, each written agent-ready with acceptance criteria and dependency links. Note: removal of docs/ takes the old knowledge-base site offline; issue #2 switches Pages to Actions-based deploys. Follow-up: update the HQ wiki project page for the repurposing (fresh ADR per project-lifecycle convention).

## 2026-08-06 — Open EA Repository concept & plan

Researched and authored the concept for an open-source, browser-based EA repository (ArchiMate 3.2-native, LeanIX-class portfolio features, GitHub Pages + local browser storage). Four parallel research passes: OSS EA tool landscape (no active open-source LeanIX equivalent exists; FINOS Waltz closest in spirit; Archi/exchange-format the interop anchors), browser ArchiMate/diagram libraries (React Flow + ELKjs recommended, LikeC4 as architecture blueprint, all ArchiMate-specific JS libs must be vendored), LeanIX meta model v4 deep-dive (report system reduces to five primitives; edge properties must be first-class), and browser persistence (in-memory model + IndexedDB snapshots beats SQLite WASM at this scale; files as source of truth).

Deliverable: `design/specs/open-ea-repository-concept.md` — vision, prior-art survey, metamodel (ArchiMate core + portfolio-profile overlay), architecture, report engine, LeanIX parity map, risks, 3-phase delivery plan, 5 ADR candidates. Next step: sponsor review of the concept, then bootstrap the new repo (phase 0) per ADR-003 separate-repo precedent.
