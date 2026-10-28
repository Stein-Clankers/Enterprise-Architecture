# Inventory: faceted filtering and saved searches

> Verifies that the filter rail says what it does and does what it says — the three
> combinators, the name query, the saved searches, and the fact that a filtered view is a
> link. **8 minutes.**

## Preconditions

- [ ] Build under test: `<commit SHA or Pages deployment>`
- [ ] Test environment: `<local | preview | github-pages>`
- [ ] Empty browser profile, then **Explore the demo** → **Insurance landscape** — every count below assumes the demo
      workspace (29 elements)

## Steps

1. Look at the filter rail before touching anything — expected: four saved searches at the
   top, then the AND / OR / NOT selector, then groups of facets (Layer, Lifecycle, Time
   classification, Tags), each option carrying a count.
2. Note the count next to **Application** in the Layer group. Click it — expected: the
   result line reads _`<that number>` of 29 elements · 1 filter (AND)_, and the table shows
   exactly those elements. The counts in the rail do **not** move.
3. Look at the address bar — expected: it now carries `?facets=layer:app`. Copy this URL,
   you need it in step 9.
4. Also click **End of Life** in the Lifecycle group — expected: the result line says
   _2 filters (AND)_ and the list shrinks to applications that are also end-of-life
   (intersection). Hover the AND button: the tooltip reads "Match every facet group".
5. Click **OR** — expected: the list grows to everything that is either an application or
   end-of-life (union). Nothing else about the screen changes.
6. Click **NOT** — expected: the list becomes everything that is _neither_. The three counts
   from steps 4–6 should satisfy: `OR = Application + End of Life − AND`, and `NOT = 29 − OR`.
7. Type `policy` into the "Filter by name" box — expected: the list narrows further. The
   query is applied **on top of** the facets in every mode: every row still contains
   "policy" in its name or type.
8. Clear the query, click **Clear** in the rail, then click the saved search **End-of-life
   applications** — expected: three facets light up at once, the mode is AND, and the number
   of rows equals the count that was shown on the saved search itself.
9. Paste the URL from step 3 into a **new tab** — expected: the app loads, restores the model
   from this browser, and comes up with the Application facet already applied. The filter
   travelled in the link.
10. Switch to **CARDS** and back to **TABLE** — expected: the same elements, presented
    differently; the filter survives the switch and the view choice appears in the URL.

## Acceptance

- [ ] Rail counts are global — they do not change as facets are selected
- [ ] A single facet returns exactly the number its own chip promised
- [ ] AND is the intersection, OR the union, NOT the complement of the union
- [ ] The name query is ANDed on top in all three modes
- [ ] A saved search applies its facets **and** its combinator in one click
- [ ] A filtered view can be shared as a URL and reopened in a new tab
- [ ] Filtering 29 elements feels instant — no visible lag between click and result

## Notes for the tester

- "End-of-life applications" deliberately uses AND, not OR: within a group the options OR
  together, across groups they AND. OR here would return every application _plus_ everything
  phasing out anywhere in the model, which is not what the label promises.
- Second tab, one caveat: only one tab may write. The tab you opened in step 9 may show
  "This model is open in another tab" and offer to take over. That is correct behaviour —
  take over, or close the first tab.
- If a count looks wrong, note the exact facet and both numbers in the bug report; a count
  that is off by one is a real bug, not a rounding artifact.
