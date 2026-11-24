// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { uploadLibraryAsset } from './assetClient';
import { MAX_ASSET_BYTES } from '../../../shared/asset-limits';

afterEach(() => vi.unstubAllGlobals());
const file = () => new File(['media'], 'network error ENOENT.png', { type: 'image/png' });

it('rejects empty and oversized files before sending a request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(new File([], 'empty.png'))).rejects.toMatchObject({ outcome: 'rejected', reason: 'unreadable' });
  const oversized = file(); Object.defineProperty(oversized, 'size', { value: MAX_ASSET_BYTES + 1 });
  await expect(uploadLibraryAsset(oversized)).rejects.toMatchObject({ outcome: 'rejected', reason: 'size' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects SVG by extension or MIME type before sending a request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const file of [new File(['<svg/>'], 'logo.SVG'), new File(['<svg/>'], 'logo', { type: 'image/svg+xml' })]) {
    await expect(uploadLibraryAsset(file)).rejects.toMatchObject({ outcome: 'rejected', reason: 'unsupported' });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [413, '', 'size'],
  [400, JSON.stringify({ error: 'This file is not readable image, video or audio media' }), 'unreadable'],
  [400, JSON.stringify({ error: 'The media file could not be decoded' }), 'unreadable'],
  [400, JSON.stringify({ error: 'Unsupported media type' }), 'unsupported'],
  [409, JSON.stringify({ error: 'Internal runtime detail', applied: false }), undefined],
])('recognizes explicit refusals without exposing diagnostics (%s / %s)', async (status, body, reason) => {
  const fetcher = vi.fn(async () => new Response(body, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'rejected', reason, message: 'File was not uploaded.' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  [200, ''], [200, '{}'], [200, '{"asset":{"id":"a"}}'], [200, '{"asset":{"id":"a","currentVersionId":"v","versions":[]}}'],
  [502, '<html>proxy error</html>'], [400, '{"error":"Failed cleanup after saving /private/path"}'],
])('keeps an unconfirmed response uncertain (%s / %s)', async (status, body) => {
  const fetcher = vi.fn(async () => new Response(body, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'unknown', reason: undefined });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([new TypeError('Failed to fetch'), new DOMException('Timed out', 'AbortError')])('does not retry a transport error', async error => {
  const fetcher = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'unknown' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('completes the 3-step presigned upload flow (ticket -> PUT -> confirm) and returns the confirmed asset', async () => {
  const asset = { id: 'asset', currentVersionId: 'version', versions: [{ id: 'version' }] };
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/motion-api/assets/uploads/tickets' && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      expect(payload).toMatchObject({ filename: 'network error ENOENT.png', mimeType: 'image/png', targetAssetId: 'asset', purpose: 'library_asset' });
      expect(payload.requestId).toMatch(/^[\w-]+$/);
      return Response.json({
        uploadId: 'upl-1',
        uploadUrl: 'https://s3.example.test/staging/upl-1?sig=abc',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '5' },
      }, { status: 201 });
    }
    if (input === 'https://s3.example.test/staging/upl-1?sig=abc' && init?.method === 'PUT') {
      const headers = (init.headers ?? {}) as Record<string, string>;
      expect(headers['Content-Type']).toBe('image/png');
      expect(headers['Content-Length']).toBeUndefined();
      return new Response('', { status: 200 });
    }
    if (input === '/motion-api/assets/uploads/upl-1/confirm' && init?.method === 'POST') {
      return Response.json({ state: 'committed', asset });
    }
    throw new Error(`Unexpected fetch ${input}`);
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file(), { assetId: 'asset', parentVersionId: 'parent' })).resolves.toEqual(asset);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('falls back to legacy direct upload when presigned ticket endpoints return 404', async () => {
  const asset = { id: 'asset', currentVersionId: 'version', versions: [{ id: 'version' }] };
  const fetcher = vi.fn(async (input: string) => {
    if (input.includes('/assets/uploads')) return new Response('', { status: 404 });
    return Response.json({ asset });
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file(), { assetId: 'asset', parentVersionId: 'parent' })).resolves.toEqual(asset);
  const legacyUrl = new URL(String(fetcher.mock.calls.at(-1)?.[0]), 'http://localhost');
  expect(legacyUrl.pathname).toBe('/motion-api/assets/upload');
  expect(legacyUrl.searchParams.get('assetId')).toBe('asset');
  expect(legacyUrl.searchParams.get('parentVersionId')).toBe('parent');
});
