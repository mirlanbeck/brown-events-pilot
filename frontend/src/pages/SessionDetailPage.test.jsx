import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import SessionDetailPage from './SessionDetailPage'
import * as api from '../api'

vi.mock('../api', () => ({
  getSession: vi.fn(),
  registerForSession: vi.fn(),
  joinWaitlist: vi.fn(),
  cancelSessionRegistration: vi.fn(),
}))

const SESSION = {
  id: 4, title: 'Kubernetes for .NET Developers', description: null, startTime: '2026-11-06T10:00:00', endTime: '2026-11-06T11:00:00',
  capacity: 2, registeredCount: 1, waitlistCount: 0, conference: { id: 2, status: 'UPCOMING' }, speaker: null, room: null,
}
const EMAIL = 'ann@x.example'

// What api.js throws for a non-2xx answer (ApiError): message plus the parsed body.
const apiError = (status, reason, message) => Object.assign(new Error(message), { status, body: { statusCode: status, message, reason } })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/conferences/2/sessions/4']}>
      <Routes>
        <Route
          path="/conferences/:id/sessions/:sessionId"
          element={<><SessionDetailPage /><Link to="/conferences/2/sessions/5">next session</Link><Link to="/conferences/2/sessions/4">previous session</Link></>}
        />
      </Routes>
    </MemoryRouter>
  )
}

async function renderReady(session = SESSION) {
  api.getSession.mockResolvedValueOnce(session)
  renderPage()
  await screen.findByRole('heading', { level: 1, name: session.title })
}

const button = (name) => screen.getByRole('button', { name })
function submit(name, email = EMAIL) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(button(name))
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('session header', () => {
  it('shows registered / capacity and the waitlist, including zeros (FE-7)', async () => {
    await renderReady({ ...SESSION, registeredCount: 0, waitlistCount: 0 })
    expect(screen.getByText('👥 0 / 2 registered')).toBeTruthy()
    expect(screen.getByText('⏳ Waitlist: 0')).toBeTruthy()
    expect(screen.queryByText(/Capacity:/)).toBeNull()
  })

  it('leaves out counts the answer does not have (Review Focus 5)', async () => {
    const { registeredCount: _r, waitlistCount: _w, ...old } = SESSION
    await renderReady(old)
    expect(screen.queryByText(/registered$/)).toBeNull()
    expect(screen.queryByText(/Waitlist:/)).toBeNull()
  })
})

describe('session registration panel', () => {
  it('has a labelled required email field', async () => {
    await renderReady()
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('type')).toBe('email')
    expect(input.required).toBe(true)
  })

  it('offers Register for session while seats are free, Join waitlist when full, Cancel always', async () => {
    await renderReady()
    expect(button('Register for session')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join waitlist' })).toBeNull()
    expect(button('Cancel my registration')).toBeTruthy()
    cleanup()
    await renderReady({ ...SESSION, registeredCount: 2 })
    expect(button('Join waitlist')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Register for session' })).toBeNull()
  })

  it('disables all buttons while the request runs', async () => {
    await renderReady()
    api.registerForSession.mockReturnValue(new Promise(() => {}))
    submit('Register for session')
    expect(button('Register for session').disabled).toBe(true)
    expect(button('Cancel my registration').disabled).toBe(true)
  })

  it('keeps the buttons disabled until the refresh ends (decision 8)', async () => {
    await renderReady()
    const refresh = deferred()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockReturnValueOnce(refresh.promise)
    submit('Register for session')
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2))
    expect(button('Register for session').disabled).toBe(true)
    expect(button('Cancel my registration').disabled).toBe(true)
    await act(async () => { refresh.resolve({ ...SESSION, registeredCount: 2 }) })
    expect(button('Join waitlist').disabled).toBe(false)
    expect(button('Cancel my registration').disabled).toBe(false)
  })

  it('registers, shows the status message and refreshes the counts without the loading screen', async () => {
    await renderReady()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 2 })
    submit('Register for session')

    expect((await screen.findByRole('status')).textContent).toBe('You are registered for this session.')
    expect(api.registerForSession).toHaveBeenCalledWith(4, EMAIL)
    expect(screen.getByText('👥 2 / 2 registered')).toBeTruthy()
    expect(button('Join waitlist')).toBeTruthy()
    expect(screen.getByLabelText('Email').value).toBe(EMAIL)
    expect(screen.queryByText('Loading session...')).toBeNull()
  })

  it('joins the waitlist of a full session', async () => {
    await renderReady({ ...SESSION, registeredCount: 2 })
    api.joinWaitlist.mockResolvedValue({ id: 2, status: 'WAITLISTED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 2, waitlistCount: 1 })
    submit('Join waitlist')

    expect((await screen.findByRole('status')).textContent).toBe('You are on the waitlist.')
    expect(api.joinWaitlist).toHaveBeenCalledWith(4, EMAIL)
    expect(screen.getByText('⏳ Waitlist: 1')).toBeTruthy()
  })

  it('cancels with a neutral message', async () => {
    await renderReady()
    api.cancelSessionRegistration.mockResolvedValue({ id: 1, status: 'CANCELLED' })
    api.getSession.mockResolvedValueOnce({ ...SESSION, registeredCount: 0 })
    submit('Cancel my registration')

    expect((await screen.findByRole('status')).textContent).toBe('Your registration or waitlist place is cancelled.')
    expect(api.cancelSessionRegistration).toHaveBeenCalledWith(4, EMAIL)
  })

  it('keeps the page and reports a failed refresh in the panel', async () => {
    await renderReady()
    api.registerForSession.mockResolvedValue({ id: 1, status: 'CONFIRMED' })
    api.getSession.mockRejectedValueOnce(new Error('HTTP 502'))
    submit('Register for session')

    expect(await screen.findByText('The counts could not be refreshed: HTTP 502. Reload the page to see them.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: SESSION.title })).toBeTruthy()
    expect(screen.queryByText('Failed to load session')).toBeNull()
  })

  it('on CONFERENCE_REGISTRATION_REQUIRED offers Register for conference and Close; Close removes the message', async () => {
    await renderReady()
    api.registerForSession.mockRejectedValue(apiError(409, 'CONFERENCE_REGISTRATION_REQUIRED', 'Register for the conference before registering for its sessions'))
    submit('Register for session')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Register for the conference before registering for its sessions')).toBeTruthy()
    expect(within(alert).getByRole('link', { name: 'Register for conference' }).getAttribute('href')).toBe('/conferences/2/register')
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })

  for (const [reason, message, label, after] of [
    ['SESSION_FULL', 'No seats left in this session; join the waitlist instead', 'Register for session', 'Join waitlist'],
    ['SEATS_AVAILABLE', 'The session has free seats; register instead', 'Join waitlist', 'Register for session'],
  ]) {
    it(`on ${reason} shows the message and refreshes, so the button changes`, async () => {
      const stale = reason === 'SESSION_FULL' ? SESSION : { ...SESSION, registeredCount: 2 }
      const fresh = reason === 'SESSION_FULL' ? { ...SESSION, registeredCount: 2 } : { ...SESSION, registeredCount: 1 }
      await renderReady(stale)
      const call = reason === 'SESSION_FULL' ? api.registerForSession : api.joinWaitlist
      call.mockRejectedValue(apiError(409, reason, message))
      api.getSession.mockResolvedValueOnce(fresh)
      submit(label)

      expect((await screen.findByRole('alert')).textContent).toContain(message)
      expect(await screen.findByRole('button', { name: after })).toBeTruthy()
    })
  }

  it('shows other errors as they are, without a refresh', async () => {
    await renderReady()
    api.registerForSession.mockRejectedValue(apiError(409, 'ALREADY_REGISTERED', 'Attendee is already registered for this session'))
    submit('Register for session')

    expect((await screen.findByRole('alert')).textContent).toBe('Attendee is already registered for this session')
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })

  for (const status of ['COMPLETED', 'CANCELLED']) {
    it(`is not shown for a ${status} conference`, async () => {
      await renderReady({ ...SESSION, conference: { id: 2, status } })
      expect(screen.queryByLabelText('Email')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Cancel my registration' })).toBeNull()
    })
  }
})

describe('loading (FE-4)', () => {
  it('ignores the answer for a session the user has already left', async () => {
    const slow = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? slow.promise : Promise.resolve({ ...SESSION, id: 5, title: 'OpenTelemetry End-to-End' })))
    renderPage()
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await screen.findByRole('heading', { level: 1, name: 'OpenTelemetry End-to-End' })
    await act(async () => { slow.resolve(SESSION) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OpenTelemetry End-to-End')
  })

  it('does not reload the session the user has left when an action on it completes', async () => {
    const registration = deferred()
    const next = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? Promise.resolve(SESSION) : next.promise))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    await act(async () => { next.resolve({ ...SESSION, id: 5, title: 'OpenTelemetry End-to-End' }) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OpenTelemetry End-to-End')
    expect(api.getSession).toHaveBeenCalledTimes(2)
  })

  it('is not left loading when the user comes back and a reload from the earlier visit fails', async () => {
    const registration = deferred()
    const back = deferred()
    const reload = deferred()
    const answers = [Promise.resolve(SESSION), back.promise, reload.promise]
    api.getSession.mockImplementation((id) => (String(id) === '4' ? answers.shift() : new Promise(() => {})))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    fireEvent.click(screen.getByRole('link', { name: 'previous session' }))
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    await act(async () => { back.resolve(SESSION) })
    await act(async () => { reload.reject(new Error('HTTP 502')) })
    expect(screen.getByRole('heading', { level: 1, name: SESSION.title })).toBeTruthy()
    expect(screen.queryByText('Loading session...')).toBeNull()
  })

  it('keeps the error screen of the current session when an action on the left one completes', async () => {
    const registration = deferred()
    api.getSession.mockImplementation((id) => (String(id) === '4' ? Promise.resolve(SESSION) : Promise.reject(new Error('HTTP 500'))))
    api.registerForSession.mockReturnValue(registration.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: SESSION.title })
    submit('Register for session')
    fireEvent.click(screen.getByRole('link', { name: 'next session' }))
    await screen.findByText('Failed to load session')
    await act(async () => { registration.resolve({ id: 1, status: 'CONFIRMED' }) })
    expect(screen.getByText('Failed to load session')).toBeTruthy()
    expect(api.getSession).toHaveBeenCalledTimes(2)
  })
})
