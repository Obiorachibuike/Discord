export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string[]>) { super(message); }
}
function csrfCookie() {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('; ').find(part => part.startsWith('cove_csrf='))?.split('=')[1] || '';
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', headers: {
    ...(!(options.body instanceof FormData) && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(!['GET','HEAD'].includes(method) && csrfCookie() ? { 'x-csrf-token': csrfCookie() } : {}),
    ...options.headers
  } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error?.code ?? 'REQUEST_FAILED', data.error?.message ?? 'Something went wrong. Try again.', data.error?.fields);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (value: unknown) => JSON.stringify(value);
