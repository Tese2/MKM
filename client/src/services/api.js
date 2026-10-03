const API_BASE = import.meta.env.VITE_API_URL ?? '';

export function assetUrl(path) {
  return path?.startsWith('/') && API_BASE ? `${API_BASE}${path}` : path;
}

export async function api(path, options = {}) {
  const { idempotencyKey, ...requestOptions } = options;
  const response = await fetch(`${API_BASE}/api${path}`, {
    credentials: 'include',
    ...requestOptions,
    headers: {
      ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...requestOptions.headers,
    },
  });

  const text = await response.text();
  let result = null;

  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      const error = new Error('The server returned an invalid response.');
      error.status = response.status;
      throw error;
    }
  }

  if (!response.ok || !result?.success) {
    const error = new Error(result?.message ?? 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }

  return result?.data;
}

export function jsonBody(value) {
  return { body: JSON.stringify(value) };
}