import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, cancelRegistration, cancelSessionRegistration, getAttendeeRegistrations, getConference, getConferences, joinWaitlist, registerAttendee, registerForSession, request, updateConference } from './api'

const REQUEST_ID = '9923426d-e9c3-4af8-9b23-77c2bf6a28e7'

function answer(status, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

const json = (status, body) => answer(status, JSON.stringify(body))

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function errorOf(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected the request to fail')
}

describe('request(): API errors', () => {
  it('uses message from the JSON body, not the raw body', async () => {
    fetchMock.mockResolvedValue(json(409, {
      statusCode: 409, error: 'Conflict', message: 'Attendee is already registered for this conference', requestId: REQUEST_ID,
    }))
    const err = await errorOf(registerAttendee(2, { email: 'ann@x.example' }))

    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Attendee is already registered for this conference')
    expect(err.status).toBe(409)
  })

  it('keeps requestId on the error and out of the message', async () => {
    fetchMock.mockResolvedValue(json(404, {
      statusCode: 404, error: 'Not Found', message: 'Conference 999 not found', requestId: REQUEST_ID,
    }))
    const err = await errorOf(getConference(999))

    expect(err.requestId).toBe(REQUEST_ID)
    expect(err.message).not.toContain(REQUEST_ID)
    expect(err.body).toMatchObject({ statusCode: 404, message: 'Conference 999 not found' })
  })

  it('shows the field messages of a 400', async () => {
    const errors = [
      { field: 'firstName', messages: ['firstName should not be empty'] },
      { field: 'email', messages: ['email must be an email address'] },
    ]
    fetchMock.mockResolvedValue(json(400, {
      statusCode: 400, error: 'Bad Request', message: 'Validation failed', requestId: REQUEST_ID, errors,
    }))
    const err = await errorOf(registerAttendee(2, {}))

    expect(err.message).toBe('firstName should not be empty; email must be an email address')
    expect(err.errors).toEqual(errors)
  })

  for (const [what, body] of [
    ['an empty body', ''],
    ['an HTML body', '<html><body>Bad Gateway</body></html>'],
    ['JSON without message', '{"detail":"x"}'],
  ]) {
    it(`falls back to "HTTP <status>" for ${what}`, async () => {
      fetchMock.mockResolvedValue(answer(502, body))
      const err = await errorOf(getConferences())

      expect(err).toBeInstanceOf(ApiError)
      expect(err.message).toBe('HTTP 502')
      expect(err.requestId).toBeNull()
    })
  }
})

describe('request(): headers', () => {
  const sentHeaders = () => fetchMock.mock.calls[0][1].headers

  it('sends no Content-Type on GET', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getConferences()

    expect(sentHeaders()).not.toHaveProperty('Content-Type')
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  it('sends Content-Type with a body', async () => {
    fetchMock.mockResolvedValue(json(201, { id: 1 }))
    await registerAttendee(2, { email: 'ann@x.example' })

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"email":"ann@x.example"}' })
    expect(sentHeaders()).toEqual({ 'Content-Type': 'application/json' })
  })

  it('sends Content-Type on PUT', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 1 }))
    await updateConference(1, { title: 'T' })

    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(sentHeaders()).toEqual({ 'Content-Type': 'application/json' })
  })

  it('keeps Content-Type when the caller passes its own headers', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 1 }))
    await request('/api/x', { method: 'POST', body: '{}', headers: { 'X-Trace': '1' } })

    expect(sentHeaders()).toEqual({ 'Content-Type': 'application/json', 'X-Trace': '1' })
  })
})

describe('request(): success bodies', () => {
  it('returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 2, status: 'UPCOMING' }))
    expect(await getConference(2)).toEqual({ id: 2, status: 'UPCOMING' })
  })

  it('returns null for 204 without calling res.json()', async () => {
    const res = { ok: true, status: 204, text: async () => '', json: vi.fn() }
    fetchMock.mockResolvedValue(res)

    expect(await getConference(2)).toBeNull()
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('session registration (BEVN-202)', () => {
  for (const [name, call, action] of [
    ['registerForSession', registerForSession, 'register'],
    ['joinWaitlist', joinWaitlist, 'waitlist'],
    ['cancelSessionRegistration', cancelSessionRegistration, 'cancel'],
  ]) {
    it(`${name} posts the email only to /api/sessions/{id}/${action}`, async () => {
      fetchMock.mockResolvedValue(json(201, { id: 1 }))
      await call(4, 'ann@x.example')

      expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:5000/api/sessions/4/${action}`)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"email":"ann@x.example"}' })
    })
  }

  it('keeps the reason of a 409 in err.body', async () => {
    fetchMock.mockResolvedValue(json(409, {
      statusCode: 409, error: 'Conflict', message: 'No seats left in this session; join the waitlist instead', requestId: REQUEST_ID, reason: 'SESSION_FULL',
    }))
    const err = await errorOf(registerForSession(4, 'ann@x.example'))

    expect(err.message).toBe('No seats left in this session; join the waitlist instead')
    expect(err.body.reason).toBe('SESSION_FULL')
  })
})

describe('attendee registrations (BEVN-203 spec 6.1)', () => {
  it('puts the encoded email into the path of the list (Review Focus 1)', async () => {
    fetchMock.mockResolvedValue(json(200, []))
    await getAttendeeRegistrations('ann+tag/x@example.com')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5000/api/attendees/ann%2Btag%2Fx%40example.com/registrations')
    expect(init.method).toBeUndefined()
  })

  it('cancels with POST and an empty JSON object', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 7, status: 'CANCELLED' }))
    await cancelRegistration('ann@example.com', 7)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5000/api/attendees/ann%40example.com/registrations/7/cancel')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('does not log requests and has no deleteRegistration (FE-6)', async () => {
    const log = vi.spyOn(console, 'log')
    fetchMock.mockResolvedValue(json(200, []))
    await getAttendeeRegistrations('ann@example.com')
    expect(log).not.toHaveBeenCalled()
    expect(await import('./api')).not.toHaveProperty('deleteRegistration')
  })
})
