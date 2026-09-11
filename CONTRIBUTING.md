# Contributing

## Run the tests and build

```sh
npm install
npm test        # node --test tests/*.test.js — the glob is required
./build.sh      # dist/chrome/, dist/firefox/, and the .xpi if web-ext is installed
```

There is no test framework and no test dependency; tests use `node:test` and `node:assert` only. Keep it that way. `build.sh` runs `node --check` on the Firefox background bundle, so a build that prints `Build complete` has at least parsed.

CI runs both commands on every pull request.

## Two things that break at runtime, not in tests

- **`content/` files are globals, not modules.** One `const WLThing = {...}` each, load-ordered by the `content_scripts` list in both manifests. An `import` or `export` in one of them breaks the extension in the browser while every test still passes.
- **`lib/` files are ES modules** shared by the background and the popup. The Firefox background is built by concatenating them and stripping module syntax with `sed`, which only understands `export function`, `export async function`, `export const` and `import` lines. Use only those forms, and add any new `lib/` file to the `LIB` array in `build.sh` in dependency order — a file missing from that list still builds and only fails with a `ReferenceError` in Firefox at message time.

[ARCHITECTURE.md](ARCHITECTURE.md) has the rest of the constraints and the measured InnerTube behaviour.

## Manual test checklist

Do this in **both** Firefox and Chrome before opening a pull request that touches `content/`, `background/`, `popup/`, `styles/` or the manifests. Load `dist/firefox/` as a temporary add-on and `dist/chrome/` unpacked. Check the light and dark themes for anything visual (YouTube's theme for the page, the OS theme for the popup).

1. **Popup.** Open it. In Firefox the **Grant access to YouTube** banner appears the first time; grant it and reload YouTube. In Chrome the banner must not appear. Set a provider and key, click **Load models**, confirm the list fills and one entry is marked **(recommended)**. Change the three **Sort defaults** rows, including the **Group in progress** switch. Save. Close and reopen the popup: every field reads back what you saved.
2. **Icon and chip.** Open a playlist with more than one page (over 100 videos). The toolbar icon turns red on that tab and stays gray on others; navigating that same tab to a non-YouTube site turns it gray again. (Tabs that were already open when the extension was installed or reloaded stay gray until reloaded.) The **Organize** button appears at the end of the "Manual / All / Videos / Shorts" chip row, floating at the bottom right only if YouTube changed that row.
3. **Two accounts.** If a second Google account is signed into the same profile, switch to it and open its Watch Later: the modal must list that account's videos, not the first account's.
4. **Simple sorts.** **Sort by duration**, **Sort by title** and **Sort by channel** each show a preview with no group headings and no eye control; apply one, the page reloads in that order.
5. **Manual sort switch.** Set the playlist's sort chip to **Date added (newest)**, then apply any sort: the chip flips to **Manual** on its own before the moves are sent, and the new order appears. If you can, switch YouTube's display language to a non-English one, set a non-Manual sort, and apply again: the apply still runs, and the timeout error names Manual sort.
6. **Analyze & sort.** The preview shows group headings in your category order with a count and time left on each. Open **Sort options**: each of the three rows opens its choices, picking one re-sorts without a second model call (the status says "Re-sorting…", never "Categorizing…"), and the **Group in progress** switch moves started videos between their own top group and their categories. Reopen the popup afterwards: the Sort defaults match what you picked.
7. **Eye control.** Hover a started video (one that reads `2:14 / 5:24`) and click the eye: it moves into its category as unwatched, its time reads as a total only, and the eye stays visible; click again to undo. An unwatched video has no eye. Tab to a row with the keyboard: the eye appears on focus.
8. **Apply and headings.** Apply the AI sort. After the reload the headings sit above the right videos, and a **Hide headings** chip sits after Organize. Drag a video to a new position: YouTube's own drag-to-reorder must still work.
9. **Headings toggle.** Click **Hide headings**: they disappear and the chip reads **Show headings**. Reload: still hidden, chip still says Show. Click it: they come back. Then open Organize → **Hide group headings**: headings and chip both go, and a reload does not bring them back.
10. **No key.** Switch the provider to one whose key you have not entered and run **Analyze & sort**: the error says to open the settings, and nothing is sent.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat(popup): …`, `fix(headings): …`, `docs: …`. No AI attribution trailers in commits, pull requests or code.
- **Branches:** feature branches off `main`; pull requests target `main`.
- **Comments** explain why, not what. If a comment restates the line below it, delete it.
- **Tests** for content-script globals go through `tests/helpers/load-global.js`. Objects created inside that sandbox fail `assert.deepEqual` against outer literals — spread them at the assertion (`[...result]`, `{ ...obj }`).
- **Version** lives only in `package.json`; the source manifests deliberately read `0.0.0` and the build injects the real number.

## Forks

Change the gecko id in `manifest.firefox.json` (`browser_specific_settings.gecko.id`) before signing or publishing a fork. Firefox treats the id as the add-on's identity, and Mozilla will not sign a second add-on under an id that is already registered to someone else.
