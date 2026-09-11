# Privacy

YouTube Playlist Organizer has no server, no accounts, no analytics and no telemetry. It collects nothing.

## What it stores

- **Settings**, including the API key you enter, in the browser's extension sync storage (`chrome.storage.sync` / `browser.storage.sync`). Sync storage may be replicated by your browser to other profiles signed into the same browser account; that is the browser's behaviour, not the extension's.
- **Working state** — per-video "treat as unwatched" overrides, the last analysis result, and the group headings for the current playlist — in the browser's extension local storage.

Removing the extension removes all of it.

## What it sends, and to whom

- **To the AI provider you configured** (Anthropic, OpenAI, Google, OpenRouter, a local Ollama, or a custom OpenAI-compatible server): the titles, channel names and YouTube category labels of the videos in the playlist you are sorting, together with your category list and extra instructions, authenticated with your own API key. This happens only when you click **Analyze & sort**. **Sort by duration** sends nothing anywhere. The provider's own privacy policy governs what it does with the request.
- **To YouTube**: playlist reads and reorder requests, made from the page using your existing signed-in session, the same way the YouTube page itself makes them. No credentials are copied or stored.

Nothing is sent to the extension's author or to any other third party.

## Permissions

- `storage` — the settings and working state above.
- `activeTab` and the `https://www.youtube.com/*` host permission — to run on playlist pages and talk to YouTube's API from there. Firefox asks you to grant the host permission explicitly.

## Contact

Questions about this policy or the extension's data handling: Dan Cormier <dancamus860@gmail.com>, or open an issue on the repository.
