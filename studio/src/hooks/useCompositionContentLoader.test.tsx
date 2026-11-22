// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { studioApiFetch } from '../utils/studioApiFetch';
import { useCompositionContentLoader } from './useCompositionContentLoader';

vi.mock('../utils/studioApiFetch', () => ({ studioApiFetch: vi.fn() }));

it('keeps the last selected clip when the initial composition finishes loading later', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  const setEditingFile = vi.fn(), showToast = vi.fn();
  let select!: (path: string) => void;
  let finishInitial!: (response: Response) => void;
  vi.mocked(studioApiFetch)
    .mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }))
    .mockResolvedValueOnce(Response.json({ content: 'Selected clip' }));
  function Editor() {
    select = useCompositionContentLoader({ projectId: 'p', setEditingFile, setActiveCompPath: vi.fn(), showToast });
    return null;
  }
  try {
    await act(async () => root.render(<Editor />));
    await act(async () => { select('index.html'); select('clip.html'); });
    await act(async () => finishInitial(Response.json({ content: 'Late initial response' })));
    expect(setEditingFile).toHaveBeenLastCalledWith({ path: 'clip.html', content: 'Selected clip' });
    expect(showToast).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
