// content/innertube.js
// The only module that knows about YouTube's internal API.
// Loaded as a content script global — no imports, no exports.

const WLInnerTube = {
  ORIGIN: 'https://www.youtube.com',
  _config: null,

  /** Pull InnerTube client config from page HTML. Pure — takes source, returns config. */
  parseConfig(source) {
    const pick = (re) => {
      const match = source.match(re);
      return match ? match[1] : null;
    };
    return {
      apiKey: pick(/"INNERTUBE_API_KEY":"(.*?)"/),
      clientName: pick(/"INNERTUBE_CLIENT_NAME":"(.*?)"/) || 'WEB',
      clientVersion: pick(/"INNERTUBE_CLIENT_VERSION":"(.*?)"/),
      delegatedSessionId: pick(/"DELEGATED_SESSION_ID":"(.*?)"/),
    };
  },

  /** Scan inline script text only — YouTube's full innerHTML is multiple MB. */
  getConfig() {
    if (this._config) return this._config;

    const scripts = [...document.querySelectorAll('script')]
      .map(s => s.textContent || '')
      .filter(t => t.includes('INNERTUBE_API_KEY'));
    const source = scripts.length ? scripts.join('\n') : document.documentElement.innerHTML;

    this._config = this.parseConfig(source);
    return this._config;
  },

  readCookie(name) {
    const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
    return match ? match[2] : null;
  },

  async sha1Hex(input) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /** Google's scheme: SHA1("<unix seconds> <SAPISID> <origin>"). */
  async buildAuthHeader(sapisid, timestamp, origin) {
    const hash = await this.sha1Hex(`${timestamp} ${sapisid} ${origin}`);
    return `SAPISIDHASH ${timestamp}_${hash}`;
  },

  /** Live auth from the page's cookie jar. Returns null when no cookie is readable. */
  async currentAuth() {
    const sapisid =
      this.readCookie('SAPISID') ||
      this.readCookie('__Secure-3PAPISID') ||
      this.readCookie('__Secure-1PAPISID');
    if (!sapisid) return null;
    return this.buildAuthHeader(sapisid, Math.floor(Date.now() / 1000), this.ORIGIN);
  },
};
