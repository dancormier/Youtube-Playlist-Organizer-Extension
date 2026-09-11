## Install

**Chrome:** download `youtube-playlist-organizer-chrome-{{VERSION}}.zip`, unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder.

**Firefox:** `youtube-playlist-organizer-firefox-{{VERSION}}-unsigned.xpi` is **not signed by Mozilla**. Release Firefox only installs signed add-ons, so this file works as a temporary add-on (`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**), which is removed when Firefox restarts. For a permanent install, sign it yourself with `./sign.sh` and your own AMO API credentials (see the README), or wait for a store listing. After installing, open the popup and click **Grant access to YouTube**.

Store listings are not live yet; this release is the source build.
