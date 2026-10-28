# First run: empty state to a model on screen

> Verifies what a brand-new user sees and that each of the three ways in works. This is the
> screen that decides whether the tool gets another five minutes, so judge it as a first-time
> visitor would. **5 minutes.**

## Preconditions

- [ ] Build under test: `<commit SHA or Pages deployment>`
- [ ] Test environment: `<local | preview | github-pages>`
- [ ] Empty browser profile — the first-run screen only appears when there is no model stored
- [ ] For step 7: a workspace file to import. Export one first from the demo
      (SAVE FILE), or use any ArchiMate exchange XML from Archi.

## Steps

1. Open the app URL — expected: a single screen with the Archipelago wordmark, one paragraph
   of explanation, and **exactly three** actions. Not four, not a tour, not a modal.
2. Read the paragraph — expected: it says the model lives in this browser and nothing is
   uploaded. Judge whether you would believe it.
3. Read the note under the three actions — expected: it tells you how this browser saves.
   In Chrome/Edge it offers to write into a folder; in Firefox/Safari it says saves happen
   by downloading a file. Check it matches the browser you are actually in.
4. Click **Explore the demo** — expected: two demos open beneath it, an insurance landscape
   and a data-migration rollout, and the three actions stay three. Click **Insurance
   landscape** — expected: the inventory appears within a second, showing
   **29 of 29 elements**, the left nav badge reads **29**, and the model-health block reads
   **29 elements · 47 relations**.
5. Look at the save-state indicator in the header — expected: it reads **LOCAL · 1 UNSAVED**.
   The demo is loaded, not saved: it exists only in this browser until it is exported.
6. Clear site data and reload, then click **Start empty** — expected: the inventory appears
   with **0 of 0 elements** and a `+ Element` button ready to use.
7. Clear site data and reload, then click **Import a file** → **Choose a file…** and pick your
   file — expected: the model loads. If the file was perfect the dialog closes by itself; if
   anything was skipped, the dialog stays open and lists what and why.

## Acceptance

- [ ] Exactly three actions on the empty state, each with a one-line explanation
- [ ] The demo loads and the counts agree across inventory, nav badge and health block
- [ ] The save-state indicator shows unsaved work immediately after loading the demo
- [ ] Start empty gives a usable empty workspace, not an error
- [ ] Import accepts a canonical JSON and an ArchiMate exchange XML file
- [ ] Nothing on this screen requires an account, a network call, or a decision the visitor
      cannot reverse

## Notes for the tester

- The demo is an insurance landscape authored for this project. It describes no real
  organisation and its numbers are illustrative — do not report them as wrong data.
- Reaching the first-run screen a second time means clearing site data; there is no "reset"
  in the UI yet.
- **Known, do not file:** a brief flash of "This model is open in another tab" during the
  cold load — issue #32.
