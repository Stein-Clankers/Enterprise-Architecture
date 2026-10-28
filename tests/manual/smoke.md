# Smoke: the app comes up

> Verifies that the deployed app loads on its own URL, renders in both themes, and survives
> a reload on a deep link. Anyone can run this; no EA knowledge needed. **3 minutes.**

## Preconditions

- [ ] Build under test: `<commit SHA or Pages deployment>`
- [ ] Test environment: `<local | preview | github-pages>` (see [README](README.md))
- [ ] Empty browser profile: a fresh private window, or _Clear site data_ for the origin

## Steps

1. Open the app URL — expected: the page loads, the browser tab is titled **Archipelago**,
   and the screen offers **three** actions: Start empty, Import a file, Explore the demo.
2. Look at the type: headings and prose in Space Grotesk, no fallback system font — expected:
   the wordmark and body text look like the design, not like Helvetica.
3. Click **Explore the demo** → **Insurance landscape** — expected: the inventory appears with **29 of 29 elements**.
4. Find the sun/moon glyph at the top right and click it — expected: the whole app switches
   theme. Borders stay hairline, boxes stay square, nothing gains a shadow or a rounded
   corner, no text becomes unreadable against its background.
5. Reload the page (⌘R / Ctrl+R) — expected: the app comes back in the theme you left it in,
   still showing the model.
6. Click an element to open its fact sheet, then reload again — expected: the same fact
   sheet comes back, not a 404 and not the inventory.
7. Open the browser console (⌥⌘J / Ctrl+Shift+J) and reload once more — expected: no red
   errors. Warnings are fine.

## Acceptance

- [ ] All steps completed without error
- [ ] The app loads on the Pages base path (`/Enterprise-Architecture/`) without a manual redirect
- [ ] Both themes render completely — no unstyled or invisible text in either
- [ ] A deep link (fact sheet URL) survives a hard refresh
- [ ] The console shows no errors during a normal load

## Notes for the tester

- On `github-pages`, deep links go through a `404.html` redirect. A brief flicker of the
  address bar on step 6 is expected; a "404 — page not found" is not.
- **Known, do not file:** a cold load flashes "This model is open in another tab" and leaves
  the address bar on `/inventory` before showing the first-run screen — issue #32.
- Nothing here should reach the network beyond the app's own files. If you want to check:
  DevTools → Network, reload, and confirm every request is to the app's own origin.
