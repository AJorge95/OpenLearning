export const pendingRegistrationCountChangedEvent = 'openlearning:pending-registration-count-changed';

// Keep the persistent staff navigation in sync after either approval workflow succeeds.
export function notifyPendingRegistrationCountChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(pendingRegistrationCountChangedEvent));
}
