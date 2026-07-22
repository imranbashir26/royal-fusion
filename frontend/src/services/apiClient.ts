const MOCK_DELAY = 120
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const apiClient = {
  async get<T>(data: T): Promise<T> {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(data), MOCK_DELAY)
    })
  },

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      ...options,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ message: 'Request failed.' }))
      throw new Error(payload.message ?? 'Request failed.')
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  },

  async post<TResponse, TPayload = unknown>(
    data: TResponse,
    _payload: TPayload,
  ): Promise<TResponse> {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(data), MOCK_DELAY)
    })
  },
}
