# File round trip: export, reimport, export again

> Verifies the promise the whole product rests on: your model is in **your files**, it comes
> back exactly as it left, and two exports of the same model are byte-identical so the file
> can live in git. **8 minutes**, plus a text editor and (optionally) a terminal.

## Preconditions

- [ ] Build under test: `<commit SHA or Pages deployment>`
- [ ] Test environment: `<local | preview | github-pages>`
- [ ] Empty browser profile, then **Explore the demo** → **Insurance landscape**
- [ ] A text editor. A terminal with `diff` makes step 8 exact; eyeballing works otherwise.

## Steps

1. Note the save-state indicator — expected: **LOCAL · 1 UNSAVED**.
2. Click **SAVE FILE** — expected: in Chrome/Edge a picker asks where to put it; in
   Firefox/Safari the file downloads. Save it as `first.json`.
3. Look at the header — expected: a one-line notice says where the file went, the indicator
   now reads **LOCAL · SAVED**, and the notice disappears on its own after a few seconds.
   Nothing else becomes a popup.
4. Open `first.json` in the text editor — expected: readable JSON, two-space indent, keys in
   alphabetical order, one element per block, a trailing newline at the end of the file.
   You should be able to find "CRM System" by eye.
5. Back in the app, click **Import** → **Choose a file…** and pick `first.json` — expected:
   the model loads and the dialog closes by itself, because there was nothing to report. The
   counts are unchanged: **29 of 29 elements**, **29 elements · 47 relations**.
6. Click **SAVE FILE** again and save as `second.json`.
7. Compare the two files — expected: **identical**, byte for byte.
   ```bash
   diff first.json second.json && echo "identical"
   ```
8. Click **Export** (next to Import) and save the XML — expected: an ArchiMate Model Exchange
   Format file. Open it in [Archi](https://www.archimatetool.com/) if you have it (**File →
   Import → Open Exchange XML Model…**): the 29 elements and 47 relationships come through.
   The demo has no views or folders, so this step cannot check those. Views and folders do
   round-trip; [`archimate-import.md`](archimate-import.md) step 7 checks them with a model
   that has both.
9. Now the failure path. In the editor, break `first.json` — delete a `}` — save it as
   `broken.json`, and import it — expected: the dialog **stays open** and says nothing could
   be read from that file, naming the problem. The model you had open is untouched.
10. Close the dialog and confirm the app still shows 29 elements.

## Acceptance

- [ ] SAVE FILE produces a file and clears the unsaved counter — and only then
- [ ] The exported JSON is human-readable and diff-friendly
- [ ] Reimporting an exported file restores the same element **and relationship** counts
- [ ] Export → import → export is byte-identical
- [ ] The XML export opens in Archi (skip if Archi is not installed — note it as skipped)
- [ ] A corrupt file produces an explanation, not a silent failure or a lost model
- [ ] Nothing was uploaded anywhere: the files only ever went to your own disk

## Notes for the tester

- Chromium browsers keep a **handle** on the file you saved into, so the next SAVE FILE
  writes straight back to it with no picker — that is what makes "keep the JSON in a git
  working copy" practical. Firefox and Safari have no such API and download a new copy each
  time; both behaviours are correct for their browser.
- Byte-identical is not a nice-to-have. If step 7 shows a diff, the file is not git-friendly
  and it is a bug worth filing with both files attached.
- The demo workspace exports as `archisurance.json` — the file name comes from the workspace
  name, not from the demo.
