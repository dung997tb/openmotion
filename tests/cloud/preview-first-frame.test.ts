import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { PREVIEW_FIRST_FRAME } from '../../src/studio/engine/preview-first-frame.ts';

function media(start = 0) {
  return {
    tagName: 'VIDEO', readyState: 0, error: null as unknown, preload: 'metadata', currentSrc: 'video.mp4',
    hasAttribute: (name: string) => name === 'data-start',
    getAttribute: (name: string) => name === 'data-start' ? String(start) : name === 'data-duration' ? '5' : null,
    parentElement: undefined, checkVisibility: () => true,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 200, bottom: 120, width: 200, height: 120 }),
  };
}
it('waits for the visible frame, ignoring future and hidden media, then releases the list', () => {
  const visible = media(), later = media(5), hidden = { ...media(), checkVisibility: () => false };
  let scans = 0;
  const visualFrameStatus = runInNewContext(PREVIEW_FIRST_FRAME + '\nvisualFrameStatus', {
    document: { querySelectorAll: () => { scans++; return [visible, later, hidden]; } }, innerWidth: 320, innerHeight: 180,
  });
  assert.equal(visualFrameStatus(0), 'loading');
  assert.equal(visible.preload, 'auto');
  assert.equal(later.preload, 'metadata');
  assert.equal(hidden.preload, 'metadata');
  visible.readyState = 2;
  assert.equal(visualFrameStatus(0), 'ready');
  assert.equal(visualFrameStatus(10), 'ready');
  assert.equal(scans, 1);
});
it('settles on media errors so that the host can offer a retry', () => {
  const item = media();
  item.error = { code: 4 };
  const status = runInNewContext(PREVIEW_FIRST_FRAME + '\nvisualFrameStatus(0)', {
    document: { querySelectorAll: () => [item] }, innerWidth: 320, innerHeight: 180,
  });
  assert.equal(status, 'error');
});

it('rechecks a replacement for a still-loading DOM node', () => {
  const old = { ...media(), isConnected: true }, fresh = media();
  let nodes = [old];
  const status = runInNewContext(PREVIEW_FIRST_FRAME + '\nvisualFrameStatus', {
    document: { querySelectorAll: () => nodes }, innerWidth: 320, innerHeight: 180,
  });
  assert.equal(status(0), 'loading');
  old.isConnected = false;
  nodes = [{ ...fresh, readyState: 2, isConnected: true }];
  assert.equal(status(0), 'ready');
});
