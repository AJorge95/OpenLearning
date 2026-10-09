import type { Course, CourseAccessUser, User } from './types';
import type { PlatformConfiguration } from './branding';

let csrfToken: string | null = null;

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
    throw new ApiError(status, 'The server returned an invalid response. Refresh and try again.', 'invalid_response');
  }
}

async function refreshCsrf(): Promise<string> {
  const response = await fetch('/api/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, 'Unable to start a secure session. Refresh and try again.');
  const data = await response.json();
  csrfToken = String(data.token);
  return csrfToken;
}

async function ensureCsrf(): Promise<string> {
  return csrfToken ?? refreshCsrf();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', await ensureCsrf());
  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? parseJsonBody(await response.text(), response.status) as ApiErrorPayload
    : null;
  if (!response.ok) {
    if (data?.code === 'csrf_invalid' || data?.code === 'csrf_missing') csrfToken = null;
    throw new ApiError(response.status, data?.error || `Request failed (${response.status}).`, data?.code);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, json('POST', body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, json('PUT', body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, json('PATCH', body)),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  refreshCsrf,
  clearCsrf: () => { csrfToken = null; },
  upload: async <T>(path: string, fields: Record<string, string>, file: File, onProgress: (value: number) => void): Promise<T> => {
    const token = await ensureCsrf();
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    body.append('file', file);
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', token);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
      xhr.onload = () => {
        const contentType = xhr.getResponseHeader('content-type') || '';
        let data: ApiErrorPayload | null = null;
        try {
          if (contentType.includes('application/json')) data = parseJsonBody(xhr.responseText, xhr.status) as ApiErrorPayload;
        } catch (error) {
          reject(error);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          if (data?.code === 'csrf_invalid' || data?.code === 'csrf_missing') csrfToken = null;
          reject(new ApiError(xhr.status, data?.error || `Upload failed (${xhr.status}).`, data?.code));
          return;
        }
        resolve(data as T);
      };
      xhr.send(body);
    });
  },
};

export async function getSetupStatus() {
  return api.get<{ configured: boolean } & PlatformConfiguration>('/api/setup/status');
}

export async function getMe() {
  return api.get<{ user: User | null } & PlatformConfiguration>('/api/auth/me');
}

export async function fetchCourse(courseId: string, managed = false) {
  const path = managed ? `/api/manage/courses/${courseId}` : `/api/courses/${courseId}`;
  return api.get<{ course: Course }>(path);
}

export async function fetchAccess(courseId: string, query = '') {
  return api.get<{ users: CourseAccessUser[] }>(`/api/manage/courses/${courseId}/access${query ? `?q=${encodeURIComponent(query)}` : ''}`);
}

