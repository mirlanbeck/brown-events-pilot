import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelRegistration, getAttendeeRegistrations } from '../api'
import Navbar from '../components/Navbar'
import { isRegistrationOpen } from '../conferenceStatus'
import { registrationBadgeClass } from '../registrationStatus'

// Dates come without a zone and are parsed as local time, so the day shown is the venue's day, as on the conference page.
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// The conference status is shown only when it explains why a registration can no longer change (spec 6.2).
const SHOWN_CONFERENCE_STATUSES = ['CANCELLED', 'COMPLETED']

function RegistrationRow({ reg, busy, onCancel }) {
  const { conference } = reg
  const open = isRegistrationOpen(conference.status)
  const hintId = `cancel-hint-${reg.id}`
  return (
    <li className="card" style={{ marginBottom: '12px' }}>
      <div className="card__title"><Link to={`/conferences/${conference.id}`}>{conference.title}</Link></div>
      <p>📅 {formatDate(conference.startDate)} — {formatDate(conference.endDate)}</p>
      <p>
        <span className={registrationBadgeClass(reg.status)}>{reg.status}</span>
        {SHOWN_CONFERENCE_STATUSES.includes(conference.status) && (
          <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>Conference {conference.status}</span>
        )}
      </p>
      {reg.status === 'CONFIRMED' && (
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label={`Cancel registration for ${conference.title}`}
            aria-describedby={open ? undefined : hintId}
            disabled={!open || busy}
            onClick={() => onCancel(reg)}
          >
            Cancel registration
          </button>
          {!open && (
            <span id={hintId} style={{ marginLeft: '12px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Registration is closed for this conference, so it can no longer be cancelled.
            </span>
          )}
        </div>
      )}
    </li>
  )
}

export default function DashboardPage() {
  // The email lives only in state: never in the address or in storage (spec 6.2).
  const [email, setEmail] = useState('')
  const [lookup, setLookup] = useState(null) // { email, loading } | { email, registrations } | { email, error }
  const [notice, setNotice] = useState(null) // { kind: 'success' | 'error', text, refreshError? }
  const [busyIds, setBusyIds] = useState([])
  const searchNo = useRef(0) // every search: answers that belong to an older search are dropped
  const loadNo = useRef(0) // every load: an older answer never replaces a newer list
  const inFlight = useRef(new Set()) // cancels running now; a ref, so a double click sees the first click at once

  async function fetchList(forEmail, search, { quiet }) {
    const load = ++loadNo.current
    const current = () => search === searchNo.current && load === loadNo.current
    try {
      const registrations = await getAttendeeRegistrations(forEmail)
      if (current()) setLookup({ email: forEmail, registrations })
    } catch (err) {
      if (!current()) return
      if (quiet) setNotice(n => ({ ...n, refreshError: `The list could not be refreshed: ${err.message}. Search again to see it.` }))
      else setLookup({ email: forEmail, error: err.status === 400 ? 'Enter a valid email address' : err.message })
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const forEmail = email.trim()
    searchNo.current += 1
    inFlight.current.clear()
    setBusyIds([])
    setNotice(null)
    setLookup({ email: forEmail, loading: true })
    fetchList(forEmail, searchNo.current, { quiet: false })
  }

  async function handleCancel(reg) {
    if (inFlight.current.has(reg.id)) return
    if (!window.confirm(`Cancel your registration for ${reg.conference.title}?`)) return
    const search = searchNo.current
    const forEmail = lookup.email
    inFlight.current.add(reg.id)
    setBusyIds(ids => [...ids, reg.id])
    setNotice(null)
    let next
    let refresh
    try {
      await cancelRegistration(forEmail, reg.id)
      next = { kind: 'success', text: `Your registration for ${reg.conference.title} is cancelled.` }
      refresh = true
    } catch (err) {
      next = { kind: 'error', text: err.message }
      // A 409 means the list is out of date (already cancelled, or the conference closed meanwhile).
      refresh = err.status === 409
    }
    if (search !== searchNo.current) return
    setNotice(next)
    if (refresh) await fetchList(forEmail, search, { quiet: true })
    if (search !== searchNo.current) return
    inFlight.current.delete(reg.id)
    setBusyIds(ids => ids.filter(id => id !== reg.id))
  }

  const registrations = lookup?.registrations
  const alertText = lookup?.error ?? (notice?.kind === 'error' ? notice.text : null)

  return (
    <div>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1 className="page-header__title">My registrations</h1>
        </div>

        <form className="card" style={{ maxWidth: '600px', marginBottom: '16px' }} onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="dashboard-email">Email</label>
            <input id="dashboard-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <button type="submit" className="btn btn--primary">Show registrations</button>
        </form>

        {/* Both live regions stay mounted so screen readers announce what is put into them (BEVN-202 lesson). */}
        <div role="status">{notice?.kind === 'success' && <p>{notice.text}</p>}</div>
        <div role="alert">
          {alertText && <p>{alertText}</p>}
          {notice?.refreshError && <p>{notice.refreshError}</p>}
        </div>

        {!lookup && <p style={{ color: 'var(--text-muted)' }}>Enter the email you registered with to see your conference registrations.</p>}
        {lookup?.loading && (
          <div className="loading-container"><div className="spinner" /><p>Loading registrations...</p></div>
        )}
        {registrations?.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No registrations found for {lookup.email}.</p>}
        {registrations?.length > 0 && (
          <ul aria-label="Registrations" style={{ listStyle: 'none', padding: 0, marginTop: '16px' }}>
            {registrations.map(reg => (
              <RegistrationRow key={reg.id} reg={reg} busy={busyIds.includes(reg.id)} onCancel={handleCancel} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
