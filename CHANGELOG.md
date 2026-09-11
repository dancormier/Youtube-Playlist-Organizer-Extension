# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). The version lives in `package.json` and is injected into both manifests at build time.

## [Unreleased]

## [0.7.0] - 2026-09-11

First public release. Everything below landed between the last private build (0.6.0) and this version.

### Added
- **Provider choice** for Analyze & sort: Anthropic, OpenAI, Google Gemini, OpenRouter, a local Ollama, or any OpenAI-compatible URL. **Load models** fills the model list live from the provider and marks a recommended small model. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- **Editable categories**, a cap on model-invented categories, and free-text extra instructions, all in the popup. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- **Sort options**: order within a group (shortest, longest, playlist order, title), where started videos go (own group on top, or inside their category), and group order (your category order, largest or smallest first, alphabetical). Set defaults in the popup; change them above the preview without a second model call. ([#4](https://github.com/dancormier/youtube-playlist-organizer/pull/4))
- **Sort by title** and **Sort by channel**, next to Sort by duration. No API key needed. ([#5](https://github.com/dancormier/youtube-playlist-organizer/pull/5))
- Group headings, in the playlist and the preview, show the video count and the time left to watch ("12 videos · 3h 12m"). ([#4](https://github.com/dancormier/youtube-playlist-organizer/pull/4))
- An eye control on started videos in the preview to sort one as unwatched. ([#5](https://github.com/dancormier/youtube-playlist-organizer/pull/5))
- A **Hide headings / Show headings** chip after Organize that toggles the injected headings and remembers the choice. **Clear headings** in the dialog removes them for good. Picking another sort in YouTube's own sort menu drops the headings for good.
- **Undo last sort** in the Organize dialog: restores the order from before the most recent apply, refused once the playlist's videos have changed.
- Applying a sort first switches the playlist to **Manual** sort when another view sort is selected, since a reorder only shows through the Manual view.
- `CHANGELOG.md`, issue and pull request templates, a tag-triggered release workflow that attaches the Chrome zip and an unsigned Firefox xpi to a GitHub Release.

### Changed
- The **Organize** button moved from a floating pill into the playlist's filter-chip row, after YouTube's chips. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- The preview modal was restyled in YouTube's own menu vocabulary, light and dark, with menu-row sort options and section-title headings. ([#5](https://github.com/dancormier/youtube-playlist-organizer/pull/5))
- The settings popup was restyled to match the modal.
- The `tabs` permission was dropped; the toolbar icon is coloured per tab from a message the content script sends. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- README, PRIVACY, ARCHITECTURE and CONTRIBUTING rewritten for outside users and contributors; MIT licence; CI runs the tests and the build on every pull request. ([#2](https://github.com/dancormier/youtube-playlist-organizer/pull/2), [#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))

### Fixed
- Injected group headings are now the first child of their playlist item, so assistive technology reads the heading before the video.
- With several Google accounts in one browser profile, the extension read and would have reordered the first account's Watch Later instead of the active account's. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- A user category named "Other" doubled every video in the sort order. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- The toolbar icon never returned to gray on Chrome after leaving YouTube. ([#3](https://github.com/dancormier/youtube-playlist-organizer/pull/3))
- Two quick sort-option changes could revert each other; replies arriving out of order could paint a stale preview. ([#4](https://github.com/dancormier/youtube-playlist-organizer/pull/4))
- In a non-AI sort the unwatch control re-sorted from the cached AI analysis and replaced the preview with the AI grouping. The control is now AI-only. ([#5](https://github.com/dancormier/youtube-playlist-organizer/pull/5))
- A started video marked unwatched showed "0:00 / total"; it now shows the total only.

## [0.6.0] and earlier

Private development builds: InnerTube-based read and batched reorder, Anthropic-only classification, duration sort, heading injection that keeps YouTube's drag-to-reorder working, unlisted Firefox signing.

[Unreleased]: https://github.com/dancormier/youtube-playlist-organizer/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/dancormier/youtube-playlist-organizer/releases/tag/v0.7.0
