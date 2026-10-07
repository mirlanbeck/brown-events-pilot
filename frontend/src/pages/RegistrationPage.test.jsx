import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RegistrationPage from './RegistrationPage'
import * as api from '../api'

vi.mock('../api', () => ({
  getConference: vi.fn(),
  registerAttendee: vi.fn(),
}))

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/conferences/2/register']}>
      <Routes><Route path="/conferences/:id/register" element={<RegistrationPage />} /></Routes>
    </MemoryRouter>
  )
}

const input = (name) => document.querySelector(`input[name="${name}"]`)

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  api.registerAttendee.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('registration page opened by URL', () => {
  for (const status of ['UPCOMING', 'ACTIVE']) {
    it(`shows the form for ${status}`, async () => {
      api.getConference.mockResolvedValue({ id: 2, title: 'CloudOps Days', status })
      renderPage()
      expect(await screen.findByRole('button', { name: 'Complete Registration' })).toBeTruthy()
      expect(screen.queryByText('Registration is closed')).toBeNull()
    })
  }

  for (const status of ['COMPLETED', 'CANCELLED']) {
    it(`shows "Registration is closed" instead of the form for ${status}`, async () => {
      api.getConference.mockResolvedValue({ id: 2, title: '.NET Summit 2024', status })
      renderPage()
      expect(await screen.findByText('Registration is closed')).toBeTruthy()
      expect(screen.getByText(`The conference is ${status}.`)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Complete Registration' })).toBeNull()
      expect(screen.getByRole('link', { name: '← Back to Conference' }).getAttribute('href')).toBe('/conferences/2')
    })
  }

  it('shows the readable load error instead of the form', async () => {
    api.getConference.mockRejectedValue(new Error('Conference 2 not found'))
    renderPage()
    expect(await screen.findByText('Conference 2 not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete Registration' })).toBeNull()
  })

  it('shows the readable 409 message after submit', async () => {
    api.getConference.mockResolvedValue({ id: 2, title: 'CloudOps Days', status: 'UPCOMING' })
    api.registerAttendee.mockRejectedValue(new Error('Attendee is already registered for this conference'))
    renderPage()
    await screen.findByRole('button', { name: 'Complete Registration' })

    fireEvent.change(input('firstName'), { target: { value: 'Ann' } })
    fireEvent.change(input('lastName'), { target: { value: 'Lee' } })
    fireEvent.change(input('email'), { target: { value: 'ann@x.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))

    expect(await screen.findByText('Attendee is already registered for this conference')).toBeTruthy()
  })
})
