// tests/viewsort.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobal } from './helpers/load-global.js';

const SELECTORS = { SORT_CHIP: 'chip', SORT_MENU_ITEMS: 'items' };

/**
 * A fake sort chip and menu. `chip.click()` opens the menu on the next tick,
 * the way YouTube renders its dropdown asynchronously; clicking an item
 * relabels the chip after another tick.
 */
function fakePage(current, labels = ['Manual', 'Date added (newest)', 'Date published (newest)']) {
  const state = { label: current, menuOpen: false, clicks: [] };
  const chip = current === null ? null : {
    get textContent() { return `\n  ${state.label}\n  `; },
    click() { state.clicks.push('chip'); setTimeout(() => { state.menuOpen = true; }, 0); },
  };
  const items = labels.map(label => ({
    textContent: ` ${label} `,
    getClientRects: () => (state.menuOpen ? [{}] : []),
    click() { state.clicks.push(label); setTimeout(() => { state.label = label; state.menuOpen = false; }, 0); },
  }));
  const document = {
    querySelector: (sel) => (sel === SELECTORS.SORT_CHIP ? chip : null),
    querySelectorAll: (sel) => (sel === SELECTORS.SORT_MENU_ITEMS && state.menuOpen ? items : []),
  };
  const WLViewSort = loadGlobal('content/viewsort.js', 'WLViewSort', { document, SELECTORS });
  return { WLViewSort, state };
}

describe('WLViewSort.current', () => {
  it('reads the trimmed chip label', () => {
    assert.equal(fakePage('Date added (newest)').WLViewSort.current(), 'Date added (newest)');
  });

  it('is null without a chip', () => {
    assert.equal(fakePage(null).WLViewSort.current(), null);
  });
});

describe('WLViewSort.ensureManual', () => {
  it('reports no-chip when the page has no sort chip', async () => {
    assert.equal(await fakePage(null).WLViewSort.ensureManual(), 'no-chip');
  });

  it('leaves a Manual playlist alone', async () => {
    const { WLViewSort, state } = fakePage('Manual');
    assert.equal(await WLViewSort.ensureManual(), 'manual');
    assert.deepEqual(state.clicks, [], 'nothing clicked');
  });

  it('opens the menu and picks Manual when another sort is selected', async () => {
    const { WLViewSort, state } = fakePage('Date published (newest)');
    assert.equal(await WLViewSort.ensureManual(), 'switched');
    assert.deepEqual(state.clicks, ['chip', 'Manual']);
    assert.equal(state.label, 'Manual');
  });

  it('fails and closes the menu again when it never offers Manual', async () => {
    const { WLViewSort, state } = fakePage('Date added (newest)', ['Date added (newest)', 'Most popular']);
    const started = Date.now();
    assert.equal(await WLViewSort.ensureManual({ timeoutMs: 50 }), 'failed');
    assert.deepEqual(state.clicks, ['chip', 'chip'], 'the second chip click closes the menu it opened');
    assert.ok(Date.now() - started < 5000);
  });

  it('never clicks a Manual item that is not laid out (a closed dropdown\'s copy)', async () => {
    const { WLViewSort, state } = fakePage('Date added (newest)');
    // The menu "opens" but its items report no layout boxes.
    state.menuOpen = false;
    const document = { querySelector: () => ({ textContent: 'Date added', click() { state.clicks.push('chip'); } }),
      querySelectorAll: () => [{ textContent: 'Manual', getClientRects: () => [], click() { state.clicks.push('hidden Manual'); } }] };
    const sort = loadGlobal('content/viewsort.js', 'WLViewSort', { document, SELECTORS });
    assert.equal(await sort.ensureManual({ timeoutMs: 50 }), 'failed');
    assert.ok(!state.clicks.includes('hidden Manual'));
    assert.equal(WLViewSort.isManual('Date added'), false);
  });

  it('fails when the chip never changes after the click', async () => {
    const stuck = fakePage('Date added (newest)');
    const clicks = [];
    stuck.WLViewSort._manualItem = () => ({ click() { clicks.push('ignored'); } });
    assert.equal(await stuck.WLViewSort.ensureManual({ timeoutMs: 50 }), 'failed');
    assert.deepEqual(clicks, ['ignored']);
  });
});

describe('WLViewSort.isManual', () => {
  it('tolerates hidden helper text and whitespace around the label', () => {
    const { WLViewSort } = fakePage('Manual');
    assert.equal(WLViewSort.isManual('\n Sort by\n  Manual \n'), true);
    assert.equal(WLViewSort.isManual('Date added (newest)'), false);
    assert.equal(WLViewSort.isManual(null), false);
  });
});
