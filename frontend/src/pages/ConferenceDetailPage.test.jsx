import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ConferenceDetailPage from './ConferenceDetailPage'
import * as api from '../api'

vi.mock('../api', () => ({
  getConference: vi.fn(),
  getConferenceSessions: vi.fn(),
  getConferenceRegistrations: vi.fn(),
  registerAttendee: vi.fn(),
}))

const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'company']
const SUCCESS = 'Registration Successful!'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/conferences/2']}>
      <Routes>
        <Route path="/conferences/:id" element={<ConferenceDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByRole('button', { name: 'Register Now' })
}

const input = (name) => document.querySelector(`.modal input[name="${name}"]`)
const modal = () => document.querySelector('.modal')

function openModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Register Now' }))
}

function fillForm(values) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(input(name), { target: { value } })
  }
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))
}

const CLOSE = {
  'the ✕ button': () => fireEvent.click(screen.getByRole('button', { name: '✕' })),
  'Cancel': () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
  'the overlay': () => fireEvent.click(document.querySelector('.modal-overlay')),
}

const VALUES = {
  firstName: 'Ann',
  lastName: 'Lee',
  email: 'ann@x.example',
  phone: '+1 555 0100',
  company: 'ACME',
}

function expectFreshForm() {
  expect(modal()).not.toBeNull()
  for (const name of FIELDS) expect(input(name).value).toBe('')
  expect(screen.queryByText(SUCCESS)).toBeNull()
  expect(modal().querySelector('.error-container')).toBeNull()
  const submit = screen.getByRole('button', { name: 'Complete Registration' })
  expect(submit.disabled).toBe(false)
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  api.getConference.mockResolvedValue({ id: 2, title: 'CloudOps Days', status: 'UPCOMING' })
  api.getConferenceSessions.mockResolvedValue([])
  api.getConferenceRegistrations.mockResolvedValue([])
  api.registerAttendee.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('registration modal: closing resets the form (DoD 1)', () => {
  for (const [how, close] of Object.entries(CLOSE)) {
    it(`clears all fields after closing with ${how}`, async () => {
      await renderPage()
      openModal()
      fillForm(VALUES)
      close()
      expect(modal()).toBeNull()

      openModal()
      expectFreshForm()
    })
  }
})

describe('registration modal: closing clears errors (DoD 2)', () => {
  it('does not show the server error after close and reopen', async () => {
    api.registerAttendee.mockRejectedValue(new Error('Attendee is already registered for this conference'))
    await renderPage()
    openModal()
    fillForm(VALUES)
    submitForm()
    await screen.findByText('Attendee is already registered for this conference')

    CLOSE['the ✕ button']()
    openModal()
    expectFreshForm()
  })
})

describe('registration modal: fresh form after success (DoD 3)', () => {
  for (const how of ['the success Close button', 'the ✕ button']) {
    it(`shows an empty form after success and closing with ${how}`, async () => {
      api.registerAttendee.mockResolvedValue({ id: 1 })
      await renderPage()
      openModal()
      fillForm(VALUES)
      submitForm()
      await screen.findByText(SUCCESS)

      if (how === 'the ✕ button') CLOSE['the ✕ button']()
      else fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      openModal()
      expectFreshForm()
    })
  }
})

describe('registration modal: open/close cycles (DoD 4)', () => {
  it('does not carry state between cycles and submits only the last input', async () => {
    api.registerAttendee.mockResolvedValue({ id: 1 })
    await renderPage()

    const closers = Object.values(CLOSE)
    for (let i = 0; i < 3; i++) {
      openModal()
      expectFreshForm()
      fillForm({ firstName: `First${i}`, company: `Company${i}` })
      closers[i]()
    }

    openModal()
    expectFreshForm()
    fillForm({ firstName: 'Last', lastName: 'Cycle', email: 'last@x.example' })
    submitForm()
    await screen.findByText(SUCCESS)

    expect(api.registerAttendee).toHaveBeenCalledTimes(1)
    expect(api.registerAttendee.mock.calls[0][1]).toMatchObject({
      firstName: 'Last',
      lastName: 'Cycle',
      email: 'last@x.example',
      phone: '',
      company: '',
    })
  })
})

describe('registration modal: closing during submit (race)', () => {
  async function submitThenReopen() {
    const pending = deferred()
    api.registerAttendee.mockReturnValue(pending.promise)
    await renderPage()
    openModal()
    fillForm(VALUES)
    submitForm()
    expect(screen.getByRole('button', { name: 'Registering...' }).disabled).toBe(true)

    CLOSE['the ✕ button']()
    openModal()
    return pending
  }

  it('reopened form is not stuck in "Registering..."', async () => {
    await submitThenReopen()
    expectFreshForm()
  })

  it('a late success does not replace the reopened form', async () => {
    const pending = await submitThenReopen()
    await act(async () => { pending.resolve({ id: 1 }) })
    expectFreshForm()
  })

  it('a late error does not appear in the reopened form', async () => {
    const pending = await submitThenReopen()
    await act(async () => { pending.reject(new Error('Attendee is already registered for this conference')) })
    expectFreshForm()
  })
})
