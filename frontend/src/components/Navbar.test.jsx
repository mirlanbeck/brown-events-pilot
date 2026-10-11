import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Navbar from './Navbar'

afterEach(cleanup)

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>)
const link = (name) => screen.getByRole('link', { name })

describe('Navbar (BEVN-203 spec 6.3)', () => {
  it('links the brand and Conferences to / and My registrations to /dashboard', () => {
    renderAt('/')
    expect(link('BrownEvents').getAttribute('href')).toBe('/')
    expect(link('Conferences').getAttribute('href')).toBe('/')
    expect(link('My registrations').getAttribute('href')).toBe('/dashboard')
  })

  it.each([
    ['/', 'Conferences'],
    ['/dashboard', 'My registrations'],
    ['/conferences/2', null],
  ])('marks the current page on %s', (path, current) => {
    renderAt(path)
    for (const name of ['Conferences', 'My registrations']) {
      expect(link(name).getAttribute('aria-current')).toBe(name === current ? 'page' : null)
    }
    expect(link('BrownEvents').getAttribute('aria-current')).toBeNull()
  })
})
