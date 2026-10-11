const registrationAvailabilityErrorCodes = new Set(['registration_disabled', 'user_limit_reached']);

export function isRegistrationAvailabilityError(error: unknown): error is Error & { status: number; code?: string } {
  return error instanceof Error
    && 'status' in error
    && error.status === 403
    && 'code' in error
    && typeof error.code === 'string'
    && registrationAvailabilityErrorCodes.has(error.code);
}
