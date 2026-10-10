export type FullscreenRequestTarget = {
  requestFullscreen?: () => Promise<void>;
};

export type FullscreenRequestResult = 'entered' | 'unsupported' | 'failed';

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
