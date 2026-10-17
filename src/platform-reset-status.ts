export type PlatformResetStatus = {
  pending: boolean;
  phase?: 'preparing' | 'ready' | 'resetting';
  confirmationId?: string;
  backupLocation?: string;
  expiresAt?: number;
};

export function shouldClearResetConfirmationAfterFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : undefined;
  const status = 'status' in error ? error.status : undefined;
  return code === 'platform_reset_confirmation_invalid'
    || code === 'platform_reset_recovery_required'
    || (typeof status === 'number' && status >= 500);
}

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
