export function parseNewsletterResponse(ok: boolean, payload: unknown): { message: string } {
  const body = payload && typeof payload === 'object' ? payload as {
    data?: { message?: unknown }
    error?: { message?: unknown }
  } : null
  if (!ok || typeof body?.data?.message !== 'string' || !body.data.message.trim()) {
    const message = !ok && typeof body?.error?.message === 'string'
      ? body.error.message
      : 'Subscriptions are temporarily unavailable. Please try again later.'
    throw new Error(message)
  }
  return { message: body.data.message }
}
