const BASE_URL = 'http://localhost:5000'

async function request(path, options = {}) {
  console.log('API request:', path, options)
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
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

export const deleteRegistration = (conferenceId, registrationId) =>
  request(`/api/conferences/${conferenceId}/registrations/${registrationId}`, { method: 'DELETE' })

export const getSession = (id) => request(`/api/sessions/${id}`)

export const getSpeakers = () => request('/api/speakers')
