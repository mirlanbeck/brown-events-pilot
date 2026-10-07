import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getConference, getConferences, registerAttendee, request, updateConference } from './api'

const REQUEST_ID = '9923426d-e9c3-4af8-9b23-77c2bf6a28e7'

function answer(status, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

const json = (status, body) => answer(status, JSON.stringify(body))

let fetchMock

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
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
