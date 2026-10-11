import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import * as api from '../api'

vi.mock('../api', () => ({ getAttendeeRegistrations: vi.fn(), cancelRegistration: vi.fn() }))

const EMAIL = 'ann@x.example'
const conf = (id, title, status, startDate = '2027-03-05T00:00:00', endDate = '2027-03-06T00:00:00') => ({ id, title, status, startDate, endDate })
const OPEN = { id: 7, status: 'CONFIRMED', registeredAt: '2026-10-10T09:00:00.000Z', conference: conf(2, 'CloudOps Days', 'UPCOMING') }
const CLOSED = { id: 8, status: 'CONFIRMED', registeredAt: '2026-10-10T09:00:00.000Z', conference: conf(3, 'Data & AI Forum', 'CANCELLED') }
const GONE = { id: 9, status: 'CANCELLED', registeredAt: '2026-10-01T09:00:00.000Z', conference: conf(1, '.NET Summit 2024', 'COMPLETED', '2024-10-14T00:00:00', '2024-10-16T00:00:00') }
const CANCELLED_OPEN = { ...OPEN, status: 'CANCELLED' }

// What api.js throws for a non-2xx answer (ApiError): message plus status and body.
const apiError = (status, message, reason) => Object.assign(new Error(message), { status, body: { statusCode: status, message, reason } })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function Location() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search + location.hash}</span>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<><DashboardPage /><Location /></>} />
      </Routes>
    </MemoryRouter>
  )
}

function search(email = EMAIL) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Show registrations' }))
}

const row = (title) => screen.getByRole('link', { name: title }).closest('li')
const cancelButton = (title) => screen.getByRole('button', { name: `Cancel registration for ${title}` })

async function showList(registrations = [OPEN, CLOSED, GONE]) {
  api.getAttendeeRegistrations.mockResolvedValueOnce(registrations)
  search()
  await screen.findByRole('list', { name: 'Registrations' })
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  api.getAttendeeRegistrations.mockReset()
  api.cancelRegistration.mockReset()
})

describe('looking up registrations (spec 6.2)', () => {
  it('starts with a hint and both live regions mounted', () => {
    expect(screen.getByText('Enter the email you registered with to see your conference registrations.')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
  })

  it('looks up the trimmed email and shows the empty state', async () => {
    api.getAttendeeRegistrations.mockResolvedValueOnce([])
    search('  ann@x.example ')
    expect(await screen.findByText('No registrations found for ann@x.example.')).toBeTruthy()
    expect(api.getAttendeeRegistrations).toHaveBeenCalledWith('ann@x.example')
  })

  it('shows conference link, dates, registration badge and the conference status only when closed', async () => {
    await showList()
    const open = row('CloudOps Days')
    expect(within(open).getByRole('link', { name: 'CloudOps Days' }).getAttribute('href')).toBe('/conferences/2')
    expect(within(open).getByText('📅 March 5, 2027 — March 6, 2027')).toBeTruthy()
    expect(within(open).getByText('CONFIRMED').className).toBe('badge badge--active')
    expect(within(open).queryByText(/^Conference /)).toBeNull()
    expect(within(row('Data & AI Forum')).getByText('Conference CANCELLED')).toBeTruthy()
    const gone = row('.NET Summit 2024')
    expect(within(gone).getByText('CANCELLED').className).toBe('badge badge--cancelled')
    expect(within(gone).getByText('Conference COMPLETED')).toBeTruthy()
  })

  it('offers cancel on every CONFIRMED registration: enabled while open, disabled with a linked hint when closed; none on CANCELLED', async () => {
    await showList()
    expect(cancelButton('CloudOps Days').disabled).toBe(false)
    const closed = cancelButton('Data & AI Forum')
    expect(closed.disabled).toBe(true)
    const hint = document.getElementById(closed.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe('Registration is closed for this conference, so it can no longer be cancelled.')
    expect(within(row('.NET Summit 2024')).queryByRole('button')).toBeNull()
  })

  it('says "Enter a valid email address" for a 400 and the API message otherwise', async () => {
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(400, 'email must be an email address'))
    search('ann@x')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address'))
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    search()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The database is busy, retry the request'))
  })

  it('ignores the answer of an older search', async () => {
    const first = deferred()
    const second = deferred()
    api.getAttendeeRegistrations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    search('old@x.example')
    search('new@x.example')
    await act(async () => { second.resolve([]) })
    await act(async () => { first.resolve([OPEN]) })
    expect(screen.getByText('No registrations found for new@x.example.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
  })

  it('keeps the email out of the address', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await screen.findByText('Your registration for CloudOps Days is cancelled.')
    expect(screen.getByTestId('location').textContent).toBe('/dashboard')
  })
})

describe('cancelling (spec 6.2)', () => {
  it('does nothing when the confirmation is declined', async () => {
    await showList()
    window.confirm.mockReturnValueOnce(false)
    fireEvent.click(cancelButton('CloudOps Days'))
    expect(window.confirm).toHaveBeenCalledWith('Cancel your registration for CloudOps Days?')
    expect(api.cancelRegistration).not.toHaveBeenCalled()
  })

  it('cancels, refreshes the list and announces it in the status region', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Your registration for CloudOps Days is cancelled.'))
    expect(api.cancelRegistration).toHaveBeenCalledWith(EMAIL, 7)
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(within(row('CloudOps Days')).queryByRole('button')).toBeNull())
  })

  it.each([
    ['ALREADY_CANCELLED', 'The registration is already cancelled'],
    ['REGISTRATION_CLOSED', 'Registration is closed: the conference is CANCELLED'],
  ])('shows a 409 %s in the alert region and refreshes the list', async (reason, message) => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(409, message, reason))
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message))
    await waitFor(() => expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2))
  })

  it('does not refresh after another error', async () => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The database is busy, retry the request'))
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(1)
    expect(cancelButton('CloudOps Days').disabled).toBe(false)
  })

  it('keeps the list and says so when the refresh after a cancel fails', async () => {
    await showList()
    api.cancelRegistration.mockResolvedValueOnce(CANCELLED_OPEN)
    api.getAttendeeRegistrations.mockRejectedValueOnce(apiError(503, 'The database is busy, retry the request'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'The list could not be refreshed: The database is busy, retry the request. Search again to see it.'))
    expect(screen.getByRole('list', { name: 'Registrations' })).toBeTruthy()
  })

  it('locks the row button while its request runs and sends one request for a double click', async () => {
    await showList()
    const pending = deferred()
    api.cancelRegistration.mockReturnValueOnce(pending.promise)
    api.getAttendeeRegistrations.mockResolvedValueOnce([CANCELLED_OPEN, CLOSED, GONE])
    // Both clicks land in one act() batch, before React commits the disabled state: only the inFlight ref can stop the second.
    const button = cancelButton('CloudOps Days')
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await waitFor(() => expect(cancelButton('CloudOps Days').disabled).toBe(true))
    expect(api.cancelRegistration).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(CANCELLED_OPEN) })
  })

  it('leaves a newer search alone when an older cancel finishes (Review Focus 5)', async () => {
    await showList()
    const pending = deferred()
    api.cancelRegistration.mockReturnValueOnce(pending.promise)
    fireEvent.click(cancelButton('CloudOps Days'))
    api.getAttendeeRegistrations.mockResolvedValueOnce([])
    search('other@x.example')
    await screen.findByText('No registrations found for other@x.example.')
    await act(async () => { pending.resolve(CANCELLED_OPEN) })
    expect(screen.getByText('No registrations found for other@x.example.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
    expect(api.getAttendeeRegistrations).toHaveBeenCalledTimes(2)
  })

  it('clears the list and messages on a new search', async () => {
    await showList()
    api.cancelRegistration.mockRejectedValueOnce(apiError(503, 'busy'))
    fireEvent.click(cancelButton('CloudOps Days'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('busy'))
    const pending = deferred()
    api.getAttendeeRegistrations.mockReturnValueOnce(pending.promise)
    search()
    expect(screen.getByRole('alert').textContent).toBe('')
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
    await act(async () => { pending.resolve([]) })
  })
})
