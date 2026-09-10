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

Do this in **both** Firefox and Chrome before opening a pull request that touches `content/`, `background/`, `popup/` or the manifests. Load `dist/firefox/` as a temporary add-on and `dist/chrome/` unpacked.

1. Open the popup. In Firefox, the **Grant access to YouTube** banner appears the first time; grant it and reload YouTube. In Chrome the banner must not appear.
2. Set a provider and key, click **Load models**, confirm the list fills and one entry is marked **(recommended)**. Save. Close and reopen the popup: every field reads back what you saved.
3. Open a playlist with more than one page (over 100 videos). The toolbar icon turns red on that tab and stays gray on others. The **Organize** button appears.
4. **Sort by duration**: preview appears, apply it, the page reloads in the new order.
5. **Analyze & sort**: preview shows group headings in your category order; toggle **treat as unwatched** on one video and confirm it moves without a second model call (the status should not say it is analysing again); apply.
6. Reload the page. Headings persist in the right places. Drag a video to a new position — YouTube's own drag-to-reorder must still work.
7. **Hide group headings**, reload, confirm they stay gone.
8. Switch the provider to one whose key you have not entered and run **Analyze & sort**: the error says to open the settings, and nothing is sent.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat(popup): …`, `fix(headings): …`, `docs: …`. No AI attribution trailers in commits, pull requests or code.
- **Branches:** feature branches off `main`; pull requests target `main`.
- **Comments** explain why, not what. If a comment restates the line below it, delete it.
- **Tests** for content-script globals go through `tests/helpers/load-global.js`. Objects created inside that sandbox fail `assert.deepEqual` against outer literals — spread them at the assertion (`[...result]`, `{ ...obj }`).
- **Version** lives only in `package.json`; the source manifests deliberately read `0.0.0` and the build injects the real number.

## Forks

Change the gecko id in `manifest.firefox.json` (`browser_specific_settings.gecko.id`) before signing or publishing a fork. Firefox treats the id as the add-on's identity, and Mozilla will not sign a second add-on under an id that is already registered to someone else.
