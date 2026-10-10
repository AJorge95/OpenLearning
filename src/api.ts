import type { Course, CourseAccessUser, User } from './types';
import type { PlatformConfiguration } from './branding';

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
    ? parseJsonBody(await response.text(), response.status) as ApiErrorPayload
    : null;
  if (isCsrfRejection(data?.code)) csrfToken = null;
  return new ApiError(response.status, data?.error || `Request failed (${response.status}).`, data?.code);
}

async function refreshCsrf(): Promise<string> {
  if (csrfRefreshPromise) return csrfRefreshPromise;
  const generation = csrfGeneration;
  const pending = (async () => {
    const response = await fetch('/api/csrf', { credentials: 'same-origin' });
    if (!response.ok) throw new ApiError(response.status, 'Unable to start a secure session. Refresh and try again.');
    if (!isJsonContentType(response.headers.get('content-type') || '')) throw invalidResponse(response.status);
    const data = parseJsonObject(await response.text(), response.status);
    if (typeof data.token !== 'string' || !data.token) throw invalidResponse(response.status);
    if (generation !== csrfGeneration) return ensureCsrf();
    csrfToken = data.token;
    return csrfToken;
  })();
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

function uploadAbortError() {
  return new DOMException('Upload cancelled.', 'AbortError');
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(uploadAbortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(uploadAbortError()); };
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
  let response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    if (requiresCsrf && isCsrfRejection(error.code)) {
      headers.set('X-CSRF-Token', await refreshCsrf());
      response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
    } else {
      throw error;
    }
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await errorFromResponse(response);
  const contentType = response.headers.get('content-type') || '';
  const data = isJsonContentType(contentType)
    ? parseJsonObject(await response.text(), response.status)
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
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  refreshCsrf,
  clearCsrf: () => {
    csrfGeneration += 1;
    csrfToken = null;
    csrfRefreshPromise = null;
  },
  upload: async <T>(path: string, fields: Record<string, string>, file: File, onProgress: (value: number) => void, options: Pick<RequestInit, 'signal'> = {}): Promise<T> => {
    if (options.signal?.aborted) throw uploadAbortError();
    const token = await waitForAbort(ensureCsrf(), options.signal);
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
        if (!options.signal?.aborted && event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => { removeAbortListener(); reject(new ApiError(0, 'Upload failed. Check your connection and try again.')); };
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
              void waitForAbort(refreshCsrf(), options.signal).then((freshToken) => {
                if (options.signal?.aborted) throw uploadAbortError();
                onProgress(0);
                return send(freshToken, true);
              }).then(resolve, reject);
              return;
            }
          }
          reject(new ApiError(xhr.status, data?.error || `Upload failed (${xhr.status}).`, data?.code));
          return;
        }
        if (!isJsonContentType(contentType)) {
          reject(invalidResponse(xhr.status));
          return;
        }
        resolve(data as T);
      };
      try { xhr.send(body); }
      catch (error) { removeAbortListener(); reject(error); }
    });
    return send(token, false);
  },
};

export async function getSetupStatus() {
  return api.get<{ configured: boolean } & PlatformConfiguration>('/api/setup/status');
}

export async function getMe() {
  return api.get<{ user: User | null } & PlatformConfiguration>('/api/auth/me');
}

export async function fetchCourse(courseId: string, managed = false, options: Pick<RequestInit, 'signal'> = {}) {
  const path = managed ? `/api/manage/courses/${courseId}` : `/api/courses/${courseId}`;
  return api.get<{ course: Course }>(path, options);
}

export async function fetchAccess(courseId: string, query = '', page = 1, options: Pick<RequestInit, 'signal'> = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('q', query);
  return api.get<{ users: CourseAccessUser[]; total: number; page: number; pageSize: number }>(`/api/manage/courses/${courseId}/access?${params}`, options);
}
