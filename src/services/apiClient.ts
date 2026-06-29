const MOCK_DELAY = 120

export const apiClient = {
  async get<T>(data: T): Promise<T> {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(data), MOCK_DELAY)
    })
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
