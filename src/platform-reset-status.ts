export type PlatformResetStatus = {
  pending: boolean;
  phase?: 'preparing' | 'ready' | 'resetting';
  confirmationId?: string;
  backupLocation?: string;
  expiresAt?: number;
};

export async function readResetStatusAfterConflict(
  error: unknown,
  loadStatus: () => Promise<PlatformResetStatus>,
): Promise<PlatformResetStatus | undefined> {
  if (typeof error !== 'object' || error === null || !('code' in error)
    || error.code !== 'platform_reset_in_progress') return undefined;
  try {
    const status = await loadStatus();
    return status.pending ? status : undefined;
  } catch {
    return undefined;
  }
}
