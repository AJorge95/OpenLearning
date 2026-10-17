export const pendingRegistrationCountRefreshRequestedEvent = 'openlearning:pending-registration-count-refresh-requested';

// Ask the persistent staff navigation to refresh after approval or an explicit retry.
export function requestPendingRegistrationCountRefresh() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(pendingRegistrationCountRefreshRequestedEvent));
}
