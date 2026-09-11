## Summary

What changed and why. Link the issue if there is one.

## Verification

- [ ] `npm test` passes (paste the test count)
- [ ] `./build.sh` completes and `node --check dist/firefox/background/background.bundle.js` passes
- [ ] No `import`/`export` added to `content/`; any new `lib/` file is in `build.sh`'s `LIB` list

### Manual checklist ([CONTRIBUTING.md](../CONTRIBUTING.md))

Required for changes under `content/`, `background/`, `popup/`, `styles/` or the manifests. Run it in **both** browsers and note the result of each step, or say which steps do not apply and why.

- [ ] Firefox: steps … passed; step … skipped because …
- [ ] Chrome: steps … passed; step … skipped because …

## Screenshots

For any visual change: before and after, light and dark theme.
