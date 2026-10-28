# ArchiMate guide: reference and modelling patterns

> Verifies that the guide explains the language clearly, that its links land where they say,
> and that it reads well in both themes. Most of this is judgement: read it as someone who
> has heard of ArchiMate but never modelled with it. **10 minutes.**

## Preconditions

- [ ] Build under test: `<commit SHA or Pages deployment>`
- [ ] Test environment: `<local | preview | github-pages>`
- [ ] For steps 5–6: the demo loaded (first-run screen → **Explore the demo** → **Insurance landscape**)

## Steps

1. On the first-run screen (empty browser profile), read the note under the three actions and
   click **Read the guide** — expected: the guide opens in the app, with the left nav, and
   without asking you to create or load a model first.
2. Read the header — expected: one paragraph on what ArchiMate is, then a boxed line saying
   Archipelago implements **ArchiMate 3.2** and that ArchiMate 4 is not supported yet, with a
   link to ADR 0011. Judge whether the version line would surprise someone who learned
   ArchiMate 4.
3. Under **Start here**, click any type — expected: the page moves to that type's entry and
   it is highlighted. Its entry shows the two-letter code, the ArchiMate symbol, a short
   description, an example, and a source line naming the specification's section on that
   concept. Where the entry gives advice, it sits in a separate note marked **Archipelago**.
4. Under **What can connect to what**, pick **Business Actor** → **Application Component**
   — expected: the first list includes **Serving**; the second list shows the other
   direction. Click the swap button — expected: the two selects and the two lists change
   places.
5. Open any element's fact sheet from the inventory and click its type label, under the name
   — expected: the guide opens at that type's entry.
6. Open a view and, in the palette, click a type, then the link at the foot of the palette —
   expected: it reads **About <type>** and opens that type's entry. With no type armed it
   reads **What these types mean** and opens the element reference.
7. Copy the address of an entry (e.g. `…/guide#DataObject`) into a new tab — expected: the
   guide opens at that entry. Reload — expected: still there.
8. Switch the theme — expected: every part of the guide stays legible, including the
   framework grid, the type codes and the relationship lines.
9. Under **How we model**, follow the **Adapted from** link of any pattern — expected: the
   archived **ArchiMate Cookbook** (version 1.0) opens, not the EDGY cookbook now at the
   author's address. Find the figure the citation names — expected: it shows the pattern's
   relationships, or close variants of them.
10. Make the window narrow until the guide column is under about 640px wide — expected: the
    framework becomes one column per layer with an aspect label in each cell, the entries stack
    in one column, and nothing in the guide scrolls sideways.

## Acceptance

- [ ] The guide opens from first run, the left nav, a fact sheet and the view palette
- [ ] Deep links land on their entry, also after a reload
- [ ] The implemented ArchiMate version is stated, with the reason
- [ ] The connection lookup answers both directions and the swap works
- [ ] Both themes are legible; the narrow layout does not scroll sideways
- [ ] Every entry, pattern and convention names its source; advice is marked **Archipelago**
- [ ] Judgement: the descriptions are plain, correct and not copied from the specification
- [ ] Judgement: the patterns under **How we model** would help a new modeller start

## Notes for the tester

- The guide's descriptions are written for Archipelago. If one is wrong or unclear, file it
  with the entry's anchor (e.g. `#Gap`).
- **Known, do not file:** at phone width the app's shell (nav and model tree) takes the whole
  window. The guide itself reflows; the shell has no phone layout yet.
