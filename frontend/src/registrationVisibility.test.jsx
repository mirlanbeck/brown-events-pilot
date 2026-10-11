import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ConferenceCard from './components/ConferenceCard'
import ConferenceDetailPage from './pages/ConferenceDetailPage'
import SessionDetailPage from './pages/SessionDetailPage'
import * as api from './api'

vi.mock('./api', () => ({
  getConference: vi.fn(),
  getConferenceSessions: vi.fn(),
  getConferenceRegistrations: vi.fn(),
  registerAttendee: vi.fn(),
  getSession: vi.fn(),
  registerForSession: vi.fn(),
  joinWaitlist: vi.fn(),
  cancelSessionRegistration: vi.fn(),
}))

const OPEN = ['UPCOMING', 'ACTIVE']
const CLOSED = ['COMPLETED', 'CANCELLED', undefined, 'SOMETHING_NEW']

beforeEach(() => {
  api.getConferenceSessions.mockResolvedValue([])
  api.getConferenceRegistrations.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('conference card (list)', () => {
  const renderCard = (status) => render(
    <MemoryRouter><ConferenceCard conference={{ id: 2, title: 'CloudOps Days', status }} /></MemoryRouter>
  )

  for (const status of OPEN) {
    it(`shows Register for ${status}`, () => {
      renderCard(status)
      expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/conferences/2/register')
    })
  }

  for (const status of CLOSED) {
    it(`hides Register for ${status}`, () => {
      renderCard(status)
      expect(screen.queryByRole('link', { name: 'Register' })).toBeNull()
      expect(screen.getByRole('link', { name: 'View Details' })).toBeTruthy()
    })
  }
})

describe('conference page', () => {
  async function renderPage(status) {
    api.getConference.mockResolvedValue({ id: 2, title: 'CloudOps Days', status })
    render(
      <MemoryRouter initialEntries={['/conferences/2']}>
        <Routes><Route path="/conferences/:id" element={<ConferenceDetailPage />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByRole('heading', { name: 'Registrations' })
  }

  for (const status of OPEN) {
    it(`shows Register Now for ${status}`, async () => {
      await renderPage(status)
      expect(screen.getByRole('button', { name: 'Register Now' })).toBeTruthy()
      expect(screen.queryByText('Registration is closed')).toBeNull()
    })
  }

  for (const status of CLOSED) {
    it(`shows "Registration is closed" instead of Register Now for ${status}`, async () => {
      await renderPage(status)
      expect(screen.queryByRole('button', { name: 'Register Now' })).toBeNull()
      expect(screen.getByText('Registration is closed')).toBeTruthy()
    })
  }
})

describe('session page', () => {
  async function renderPage(conference) {
    api.getSession.mockResolvedValue({ id: 1, title: 'EF Core Performance Deep Dive', conference })
    render(
      <MemoryRouter initialEntries={['/conferences/1/sessions/1']}>
        <Routes><Route path="/conferences/:id/sessions/:sessionId" element={<SessionDetailPage />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByRole('link', { name: '← Back to Conference' })
  }

  for (const status of OPEN) {
    it(`shows Register for conference for ${status}`, async () => {
      await renderPage({ id: 1, status })
      expect(screen.getByRole('link', { name: 'Register for conference' })).toBeTruthy()
    })
  }

  for (const status of CLOSED) {
    it(`hides Register for conference for ${status}`, async () => {
      await renderPage({ id: 1, status })
      expect(screen.queryByRole('link', { name: 'Register for conference' })).toBeNull()
    })
  }

  it('hides Register for conference when the session has no conference', async () => {
    await renderPage(undefined)
    expect(screen.queryByRole('link', { name: 'Register for conference' })).toBeNull()
  })
})
