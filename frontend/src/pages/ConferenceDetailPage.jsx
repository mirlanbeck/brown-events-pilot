import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getConference, getConferenceSessions, getConferenceRegistrations, registerAttendee } from '../api'
import SessionList from '../components/SessionList'


export default function ConferenceDetailPage() {
  const { id } = useParams()

  const [conference, setConference] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sessionsError, setSessionsError] = useState(null)

  // Registration modal state
  const [showModal, setShowModal] = useState(false)
  const [selectedSession, setSelectedSession] = useState(null)
  const [registrationLoading, setRegistrationLoading] = useState(false)
  const [registrationError, setRegistrationError] = useState(null)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)

  const [registrations, setRegistrations] = useState([])
  const [registrationsLoading, setRegistrationsLoading] = useState(true)
  const [registrationsError, setRegistrationsError] = useState(null)

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    dietaryRequirements: ''
  })

  useEffect(() => {
    setLoading(true)
    setError(null)
    getConference(id)
      .then(data => {
        const conf = data.data || data
        setConference(conf)
        console.log('conference loaded:', conf)
        setLoading(false)
      })
      .catch(err => {
        console.log('error loading conference:', err)
        setError(err.message || 'Failed to load conference')
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    setSessionsLoading(true)
    setSessionsError(null)
    getConferenceSessions(id)
      .then(data => {
        setSessions(Array.isArray(data) ? data : [])
        setSessionsLoading(false)
      })
      .catch(err => {
        setSessionsError(err.message || 'Failed to load sessions')
        setSessionsLoading(false)
      })
  }, [id])

  useEffect(() => {
    setRegistrationsLoading(true)
    setRegistrationsError(null)
    getConferenceRegistrations(id)
      .then(data => {
        setRegistrations(Array.isArray(data) ? data : [])
        setRegistrationsLoading(false)
      })
      .catch(err => {
        setRegistrationsError(err.message || 'Failed to load registrations')
        setRegistrationsLoading(false)
      })
  }, [id])

  function handleSessionClick(session) {
    console.log('clicked session:', session)
    setSelectedSession(session)
  }

  function handleRegisterClick() {
    console.log('opening registration modal')
    setShowModal(true)
    setRegistrationSuccess(false)
    setRegistrationError(null)
    setFormData({ firstName: '', lastName: '', email: '', phone: '', company: '', dietaryRequirements: '' })
  }

  function handleModalClose() {
    setShowModal(false)
    setSelectedSession(null)
    setRegistrationError(null)
  }

  function handleFormChange(e) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  async function handleRegistrationSubmit(e) {
    e.preventDefault()
    setRegistrationLoading(true)
    setRegistrationError(null)
    console.log('submitting registration:', formData)
    try {
      const result = await registerAttendee(id, {
        ...formData,
        sessionId: selectedSession ? selectedSession.id : null
      })
      console.log('registration result:', result)
      setRegistrationSuccess(true)
      setRegistrationLoading(false)
    } catch (err) {
      setRegistrationError(err.message || 'Registration failed. Please try again.')
      setRegistrationLoading(false)
    }
  }

  function getStatusBadgeClass(status) {
    if (!status) return 'badge badge--upcoming'
    switch (status.toLowerCase()) {
      case 'active':    return 'badge badge--active'
      case 'upcoming':  return 'badge badge--upcoming'
      case 'cancelled': return 'badge badge--cancelled'
      case 'completed': return 'badge badge--completed'
      default:          return 'badge badge--upcoming'
    }
  }

  function formatDate(dateString) {
    if (!dateString) return 'TBD'
    try {
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch { return dateString }
  }

  if (loading) {
    return (
      <div>
        <nav className="navbar">
          <Link to="/" className="navbar__brand">BrownEvents</Link>
          <Link to="/" className="navbar__link">Conferences</Link>
        </nav>
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading conference...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <nav className="navbar">
          <Link to="/" className="navbar__brand">BrownEvents</Link>
          <Link to="/" className="navbar__link">Conferences</Link>
        </nav>
        <div className="page">
          <div className="error-container">
            <h3>Failed to load conference</h3>
            <p>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <nav className="navbar">
        <Link to="/" className="navbar__brand">BrownEvents</Link>
        <Link to="/" className="navbar__link">Conferences</Link>
      </nav>

      <div className="page">
        <div className="breadcrumb">
          <Link to="/">Conferences</Link>
          <span className="breadcrumb__sep">/</span>
          <span>{conference?.title || 'Conference'}</span>
        </div>

        <div className="detail-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <h1 className="detail-header__title" style={{ marginBottom: 0 }}>{conference?.title}</h1>
            <span className={getStatusBadgeClass(conference?.status)}>
              {conference?.status || 'Upcoming'}
            </span>
          </div>
          <div className="detail-header__meta">
            {conference?.location && <span>📍 {conference.location}</span>}
            {conference?.startDate && (
              <span>📅 {formatDate(conference.startDate)} — {formatDate(conference.endDate)}</span>
            )}
          </div>
          {conference?.description && (
            <p className="detail-header__description">{conference.description}</p>
          )}
        </div>

        <div className="detail-section">
          <h2 className="detail-section__title">Details</h2>
          <div className="card">
            <table className="info-table">
              <tbody>
                <tr><td>Location</td><td>{conference?.location || '—'}</td></tr>
                <tr><td>Venue</td><td>{conference?.venue || '—'}</td></tr>
                <tr><td>Start Date</td><td>{formatDate(conference?.startDate)}</td></tr>
                <tr><td>End Date</td><td>{formatDate(conference?.endDate)}</td></tr>
                <tr>
                  <td>Status</td>
                  <td><span className={getStatusBadgeClass(conference?.status)}>{conference?.status || 'Upcoming'}</span></td>
                </tr>
                <tr><td>Max Attendees</td><td>{conference?.maxAttendees ?? '—'}</td></tr>
                <tr><td>Organizer</td><td>{conference?.organizerName || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="detail-section">
          <h2 className="detail-section__title">Sessions</h2>
          {sessionsLoading ? (
            <div className="loading-container" style={{ padding: '40px 0' }}>
              <div className="spinner" /><p>Loading sessions...</p>
            </div>
          ) : sessionsError ? (
            <div className="error-container"><h3>Failed to load sessions</h3><p>{sessionsError}</p></div>
          ) : sessions.length === 0 ? (
            <div style={{ color: '#666', padding: '20px 0', textAlign: 'center' }}>No sessions scheduled yet.</div>
          ) : (
            <SessionList sessions={sessions} conferenceId={id} onSessionClick={handleSessionClick} />
          )}
        </div>

        <div className="detail-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h2 className="detail-section__title" style={{ marginBottom: 0, borderBottom: 'none' }}>Registrations</h2>
            <button className="btn btn--primary" onClick={handleRegisterClick}>Register Now</button>
          </div>

          {registrationsLoading ? (
            <div className="loading-container" style={{ padding: '40px 0' }}>
              <div className="spinner" /><p>Loading registrations...</p>
            </div>
          ) : registrationsError ? (
            <div className="error-container"><h3>Failed to load registrations</h3><p>{registrationsError}</p></div>
          ) : registrations.length === 0 ? (
            <div style={{ color: '#666', padding: '20px 0', textAlign: 'center', fontStyle: 'italic' }}>No registrations yet.</div>
          ) : (
            <div className="card">
              {registrations.map(reg => {
                const a = reg.attendee || {}
                return (
                  <div key={reg.id} className="attendee-row">
                    <span>{a.firstName} {a.lastName}</span>
                    <span>{a.email || '—'}</span>
                    <span>{reg.registeredAt ? new Date(reg.registeredAt).toLocaleDateString() : '—'}</span>
                    <span><span className="badge badge--upcoming">{reg.status || 'CONFIRMED'}</span></span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {selectedSession && (
          <div className="detail-section">
            <h2 className="detail-section__title">Selected Session</h2>
            <div className="card" style={{ borderColor: '#6c9fff' }}>
              <div className="card__title">{selectedSession.title}</div>
              {selectedSession.description && <p className="card__description">{selectedSession.description}</p>}
              <div style={{ marginTop: '12px' }}>
                <Link to={`/conferences/${id}/sessions/${selectedSession.id}`} className="btn btn--secondary btn--sm">
                  View Details
                </Link>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelectedSession(null)} style={{ marginLeft: '8px' }}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleModalClose() }}>
          <div className="modal">
            <div className="modal__header">
              <h2 className="modal__title">Register for {conference?.title}</h2>
              <button className="modal__close" onClick={handleModalClose}>✕</button>
            </div>

            {registrationSuccess ? (
              <div className="success-box">
                <h3>Registration Successful!</h3>
                <p>You've been registered. A confirmation will be sent to <strong>{formData.email}</strong>.</p>
                <button className="btn btn--secondary" style={{ marginTop: '16px' }} onClick={handleModalClose}>Close</button>
              </div>
            ) : (
              <form onSubmit={handleRegistrationSubmit}>
                {registrationError && (
                  <div className="error-container" style={{ marginBottom: '16px' }}><p>{registrationError}</p></div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div className="form-group">
                    <label>First Name *</label>
                    <input type="text" name="firstName" value={formData.firstName} onChange={handleFormChange} required />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input type="text" name="lastName" value={formData.lastName} onChange={handleFormChange} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Email Address *</label>
                  <input type="email" name="email" value={formData.email} onChange={handleFormChange} required />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input type="tel" name="phone" value={formData.phone} onChange={handleFormChange} />
                </div>
                <div className="form-group">
                  <label>Company</label>
                  <input type="text" name="company" value={formData.company} onChange={handleFormChange} />
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn--ghost" onClick={handleModalClose} disabled={registrationLoading}>Cancel</button>
                  <button type="submit" className="btn btn--primary" disabled={registrationLoading}>
                    {registrationLoading ? 'Registering...' : 'Complete Registration'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
