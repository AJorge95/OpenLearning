export type FullscreenRequestTarget = {
  requestFullscreen?: () => Promise<void>;
};

export type FullscreenRequestResult = 'entered' | 'unsupported' | 'failed';
export type FullscreenToggleResult = FullscreenRequestResult | 'exited';

export type FullscreenDocument = {
  fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
};

export async function tryEnterFullscreen(
  target: FullscreenRequestTarget | null,
): Promise<FullscreenRequestResult> {
  if (typeof target?.requestFullscreen !== 'function') return 'unsupported';

  try {
    await target.requestFullscreen();
    return 'entered';
  } catch {
    return 'failed';
  }
}

export async function tryToggleFullscreen(
  target: FullscreenRequestTarget | null,
  fullscreenDocument: FullscreenDocument,
): Promise<FullscreenToggleResult> {
  if (!target) return 'unsupported';
  if (fullscreenDocument.fullscreenElement !== target) return tryEnterFullscreen(target);
  if (typeof fullscreenDocument.exitFullscreen !== 'function') return 'unsupported';

  try {
    await fullscreenDocument.exitFullscreen();
    return 'exited';
  } catch {
    return 'failed';
  }
}
