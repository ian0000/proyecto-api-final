export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const base = import.meta.env.VITE_API_URL ?? '';
export async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!r.ok) {
    const problem = await r
      .json()
      .catch(() => ({ detail: 'No fue posible comunicarse con el servicio' }));
    throw new ApiError(problem.detail ?? 'Operación fallida', r.status);
  }
  return r.json() as Promise<T>;
}
