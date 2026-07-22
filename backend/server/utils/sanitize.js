const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const EVENT_HANDLER = /\son[a-z]+\s*=\s*(['"]).*?\1/gi
const JS_PROTOCOL = /javascript:/gi

export function sanitizeValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(SCRIPT_TAG, '')
      .replace(EVENT_HANDLER, '')
      .replace(JS_PROTOCOL, '')
      .trim()
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)])
    )
  }

  return value
}

export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body)
  }
  next()
}
