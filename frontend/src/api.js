const BASE_URL = 'http://localhost:5000'

// Error thrown for a non-2xx answer. The API sends {statusCode, error, message, requestId, errors?}; requestId is
// kept for support and logs, body keeps the whole answer for callers that need more than the message.
export class ApiError extends Error {
  constructor(status, body) {
    super(errorMessage(status, body))
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.requestId = typeof body?.requestId === 'string' ? body.requestId : null
    this.errors = Array.isArray(body?.errors) ? body.errors : null
  }
}

// Field messages of a 400 already name the field ("email must be an email address"), so they are shown as is.
// A body that is not the API's JSON (empty, HTML from a proxy) falls back to the status code.
function errorMessage(status, body) {
  const fieldMessages = Array.isArray(body?.errors)
    ? body.errors.flatMap(e => (Array.isArray(e?.messages) ? e.messages : [])).filter(m => typeof m === 'string' && m)
    : []
  if (fieldMessages.length) return fieldMessages.join('; ')
  if (typeof body?.message === 'string' && body.message) return body.message
  return `HTTP ${status}`
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

export async function request(path, options = {}) {
  const { headers, ...rest } = options
  // Content-Type only with a body: a GET without it is a simple CORS request and needs no preflight.
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: { ...(rest.body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
  })
  const text = await res.text()
  if (!res.ok) throw new ApiError(res.status, text ? parseJson(text) : null)
  return text ? JSON.parse(text) : null
}

export const getConferences = () => request('/api/conferences')

export const getConference = (id) => request(`/api/conferences/${id}`)

export const createConference = (data) =>
  request('/api/conferences', { method: 'POST', body: JSON.stringify(data) })

export const updateConference = (id, data) =>
  request(`/api/conferences/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const getConferenceSessions = (id) =>
  request(`/api/conferences/${id}/sessions`)
    .then(res => res.data || res)

export const getConferenceRegistrations = (id) =>
  request(`/api/conferences/${id}/registrations`)

export const registerAttendee = (id, data) =>
  request(`/api/conferences/${id}/register`, { method: 'POST', body: JSON.stringify(data) })

// BEVN-203: the email is the attendee's identity (no sign-in, SEC-2); encoded because it may hold + / ? # and spaces.
export const getAttendeeRegistrations = (email) =>
  request(`/api/attendees/${encodeURIComponent(email)}/registrations`)

// The cancel takes no body, but every POST to the API must be JSON, so an empty object is sent.
export const cancelRegistration = (email, id) =>
  request(`/api/attendees/${encodeURIComponent(email)}/registrations/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) })

export const getSession = (id) => request(`/api/sessions/${id}`)

export const registerForSession = (id, email) =>
  request(`/api/sessions/${id}/register`, { method: 'POST', body: JSON.stringify({ email }) })

export const joinWaitlist = (id, email) =>
  request(`/api/sessions/${id}/waitlist`, { method: 'POST', body: JSON.stringify({ email }) })

export const cancelSessionRegistration = (id, email) =>
  request(`/api/sessions/${id}/cancel`, { method: 'POST', body: JSON.stringify({ email }) })

export const getSpeakers = () => request('/api/speakers')
