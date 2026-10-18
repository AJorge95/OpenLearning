import type { Course, CourseAccessUser, CourseGroup, User } from './types';
import type { PlatformConfiguration } from './branding';
import { normalizePercentage } from './percentage.ts';

let csrfToken: string | null = null;
let csrfRefreshPromise: Promise<string> | null = null;
let csrfGeneration = 0;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ApiErrorPayload = { error?: string; code?: string };

function parseJsonBody(body: string, status: number): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw invalidResponse(status);
  }
}

function parseJsonObject(body: string, status: number): Record<string, unknown> {
  const data = parseJsonBody(body, status);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidResponse(status);
  return data as Record<string, unknown>;
}

function invalidResponse(status: number) {
  return new ApiError(status, 'The server returned an invalid response. Refresh and try again.', 'invalid_response');
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function transportError(message = 'The server could not be reached. Check your connection and try again.') {
  return new ApiError(0, message, 'network_error');
}

function throwTransportFailure(error: unknown): never {
  if (error instanceof ApiError || isAbortError(error)) throw error;
  throw transportError();
}

async function fetchResponse(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(path, options);
  } catch (error) {
    return throwTransportFailure(error);
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return throwTransportFailure(error);
  }
}

function isJsonContentType(contentType: string) {
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function isCsrfRejection(code?: string) {
  return code === 'csrf_invalid' || code === 'csrf_missing';
}

async function errorFromResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  const data = isJsonContentType(contentType)
    ? parseJsonBody(await readResponseText(response), response.status) as ApiErrorPayload
    : null;
  if (isCsrfRejection(data?.code)) csrfToken = null;
  return new ApiError(response.status, data?.error || `Request failed (${response.status}).`, data?.code);
}

async function refreshCsrf(options: Pick<RequestInit, 'signal'> = {}): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) throw requestAbortError();
  if (!signal && csrfRefreshPromise) return csrfRefreshPromise;
  const generation = csrfGeneration;
  const pending = (async () => {
    const response = await fetchResponse('/api/csrf', { credentials: 'same-origin', ...options });
    if (!response.ok) throw new ApiError(response.status, 'Unable to start a secure session. Refresh and try again.');
    if (!isJsonContentType(response.headers.get('content-type') || '')) throw invalidResponse(response.status);
    const data = parseJsonObject(await readResponseText(response), response.status);
    if (typeof data.token !== 'string' || !data.token) throw invalidResponse(response.status);
    if (generation !== csrfGeneration) return signal ? refreshCsrf(options) : ensureCsrf();
    csrfToken = data.token;
    return csrfToken;
  })();
  // A startup caller owns its abort signal; do not cache its request for unrelated callers.
  if (signal) return waitForAbort(pending, signal);
  csrfRefreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (csrfRefreshPromise === pending) csrfRefreshPromise = null;
  }
}

async function ensureCsrf(): Promise<string> {
  return csrfToken ?? refreshCsrf();
}

function requestAbortError() {
  return new DOMException('Request cancelled.', 'AbortError');
}

function uploadAbortError() {
  return new DOMException('Upload cancelled.', 'AbortError');
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal | null, createAbortError = requestAbortError): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(createAbortError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const requiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (requiresCsrf) headers.set('X-CSRF-Token', await ensureCsrf());
  let response = await fetchResponse(path, { ...options, method, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (requiresCsrf && isCsrfRejection(error.code)) {
      headers.set('X-CSRF-Token', await refreshCsrf());
      response = await fetchResponse(path, { ...options, method, headers, credentials: 'same-origin' });
    } else {
      throw error;
    }
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await errorFromResponse(response);
  const contentType = response.headers.get('content-type') || '';
  const data = isJsonContentType(contentType)
    ? parseJsonObject(await readResponseText(response), response.status)
    : null;
  if (!isJsonContentType(contentType)) throw invalidResponse(response.status);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  get: <T>(path: string, options: Pick<RequestInit, 'signal'> = {}) => request<T>(path, options),
  post: <T>(path: string, body?: unknown) => request<T>(path, json('POST', body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, json('PUT', body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, json('PATCH', body)),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  refreshCsrf: (options: Pick<RequestInit, 'signal'> = {}) => refreshCsrf(options),
  clearCsrf: () => {
    csrfGeneration += 1;
    csrfToken = null;
    csrfRefreshPromise = null;
  },
  upload: async <T>(path: string, fields: Record<string, string>, file: File, onProgress: (value: number) => void, options: Pick<RequestInit, 'signal'> = {}): Promise<T> => {
    if (options.signal?.aborted) throw uploadAbortError();
    const token = await waitForAbort(ensureCsrf(), options.signal, uploadAbortError);
    if (options.signal?.aborted) throw uploadAbortError();
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    body.append('file', file);
    const send = (token: string, hasRetried: boolean): Promise<T> => new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(uploadAbortError());
        return;
      }
      const xhr = new XMLHttpRequest();
      const removeAbortListener = () => options.signal?.removeEventListener('abort', abortRequest);
      const abortRequest = () => xhr.abort();
      xhr.open('POST', path);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', token);
      options.signal?.addEventListener('abort', abortRequest, { once: true });
      xhr.upload.onprogress = (event) => {
        if (!options.signal?.aborted && event.lengthComputable) {
          // Browser progress events are external input; keep every upload surface within valid percentage bounds.
          const progress = event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0;
          onProgress(normalizePercentage(progress));
        }
      };
      xhr.onerror = () => {
        removeAbortListener();
        reject(transportError('The upload connection was interrupted. Reload the course editor to check whether the file was added before retrying.'));
      };
      xhr.onabort = () => { removeAbortListener(); reject(uploadAbortError()); };
      xhr.onload = () => {
        removeAbortListener();
        if (xhr.status === 204) {
          resolve(undefined as T);
          return;
        }
        const contentType = xhr.getResponseHeader('content-type') || '';
        let data: ApiErrorPayload | null = null;
        try {
          if (isJsonContentType(contentType)) data = parseJsonObject(xhr.responseText, xhr.status) as ApiErrorPayload;
        } catch (error) {
          reject(error);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          if (isCsrfRejection(data?.code)) {
            csrfToken = null;
            if (!hasRetried) {
              if (options.signal?.aborted) {
                reject(uploadAbortError());
                return;
              }
              // The global CSRF guard runs before Multer, so a rejected token cannot have stored the file.
              // Replaying the body is safe here and remains limited to one retry.
              void waitForAbort(refreshCsrf(), options.signal, uploadAbortError).then((freshToken) => {
                if (options.signal?.aborted) throw uploadAbortError();
                onProgress(0);
                return send(freshToken, true);
              }).then(resolve, reject);
              return;
            }
          }
          // Node or a trusted reverse proxy can time out a request before Express returns JSON.
          const timeoutMessage = 'The upload exceeded an HTTP request timeout. Ask the platform administrator to check REQUEST_TIMEOUT_MS and any reverse-proxy upload timeout for large or slow uploads, then retry.';
          const isRequestTimeout = xhr.status === 408;
          reject(new ApiError(
            xhr.status,
            data?.error || (isRequestTimeout ? timeoutMessage : `Upload failed (${xhr.status}).`),
            data?.code || (isRequestTimeout ? 'request_timeout' : undefined),
          ));
          return;
        }
        if (!isJsonContentType(contentType)) {
          reject(invalidResponse(xhr.status));
          return;
        }
        resolve(data as T);
      };
      try { xhr.send(body); }
      catch (error) {
        removeAbortListener();
        // Keep synchronous browser failures on the same actionable transport contract as onerror.
        reject(error instanceof ApiError || isAbortError(error)
          ? error
          : transportError('The upload could not be started. Check your connection and try again.'));
      }
    });
    return send(token, false);
  },
};

export function fetchAppVersion(options: Pick<RequestInit, 'signal'> = {}) {
  return api.get<{ version: string }>('/api/version', options);
}

export async function getSetupStatus(options: Pick<RequestInit, 'signal'> = {}) {
  return api.get<{ configured: boolean; setupAvailable: boolean } & PlatformConfiguration>('/api/setup/status', options);
}

export async function getMe(options: Pick<RequestInit, 'signal'> = {}) {
  return api.get<{ user: User | null } & PlatformConfiguration>('/api/auth/me', options);
}

export async function fetchCourse(courseId: string, managed = false, options: Pick<RequestInit, 'signal'> & { includeQuizQuestions?: boolean; includeLatestAttempts?: boolean; includeLessonDetails?: boolean; quizId?: string } = {}) {
  const { includeQuizQuestions = true, includeLatestAttempts = true, includeLessonDetails = true, quizId, ...requestOptions } = options;
  const path = managed ? `/api/manage/courses/${courseId}` : `/api/courses/${courseId}`;
  // Keep full course data by default; learner summaries omit unused questions, attempts, or lesson content.
  const params = new URLSearchParams();
  if (!managed && !includeQuizQuestions) params.set('includeQuizQuestions', '0');
  if (!managed && !includeLatestAttempts) params.set('includeLatestAttempts', '0');
  if (!managed && !includeLessonDetails) params.set('includeLessonDetails', '0');
  if (!managed && quizId) params.set('quizId', quizId);
  const query = params.toString();
  return api.get<{ course: Course }>(`${path}${query ? `?${query}` : ''}`, requestOptions);
}

export async function fetchAccess(courseId: string, query = '', page = 1, options: Pick<RequestInit, 'signal'> = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('q', query);
  return api.get<{ users: CourseAccessUser[]; total: number; page: number; pageSize: number }>(`/api/manage/courses/${courseId}/access?${params}`, options);
}

export function fetchCourseGroups(options: Pick<RequestInit, 'signal'> = {}) {
  return api.get<{ groups: CourseGroup[] }>('/api/manage/course-groups', options);
}

export function createCourseGroup(payload: { name: string; description: string }) {
  return api.post<{ group: CourseGroup }>('/api/manage/course-groups', payload);
}

export function assignCourseToGroup(groupId: string, courseId: string) {
  return api.put<{ course: CourseGroup['courses'][number] }>(`/api/manage/course-groups/${encodeURIComponent(groupId)}/courses/${encodeURIComponent(courseId)}`);
}

export function removeCourseFromGroup(groupId: string, courseId: string) {
  return api.delete(`/api/manage/course-groups/${encodeURIComponent(groupId)}/courses/${encodeURIComponent(courseId)}`);
}
