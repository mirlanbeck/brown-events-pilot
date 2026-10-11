import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSession } from '../api'
import { isRegistrationOpen } from '../conferenceStatus'
import SessionRegistrationPanel from '../components/SessionRegistrationPanel'
import Navbar from '../components/Navbar'

export default function SessionDetailPage() {
  const { id, sessionId } = useParams()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const current = useRef(sessionId)
  useEffect(() => { current.current = sessionId }, [sessionId])

  // Only answers for the session on screen are applied (FE-4): a late answer for a session the user has left is dropped,
  // and a silent reload for it is not started. The first load shows the spinner and the error screen; a silent reload
  // after an action keeps the page and lets the caller report the failure.
  const loadSession = useCallback(({ silent = false } = {}) => {
    const isCurrent = () => sessionId === current.current
    if (silent && !isCurrent()) return Promise.resolve()
    setError(null)
    if (!silent) setLoading(true)
    return getSession(sessionId).then(
      data => {
        if (!isCurrent()) return
        setSession(data.data || data)
        setLoading(false)
      },
      err => {
        if (!isCurrent()) return
        if (silent) throw err
        setError(err.message || 'Failed to load session')
        setLoading(false)
      },
    )
  }, [sessionId])

  useEffect(() => { loadSession() }, [loadSession])

  function formatTime(dt) {
    if (!dt) return '—'
    try { return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
    catch { return dt }
  }

  function formatDate(dt) {
    if (!dt) return '—'
    try { return new Date(dt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }
    catch { return dt }
  }

  if (loading) return (
    <div>
      <Navbar />
      <div className="loading-container"><div className="spinner" /><p>Loading session...</p></div>
    </div>
  )

  if (error) return (
    <div>
      <Navbar />
      <div className="page"><div className="error-container"><h3>Failed to load session</h3><p>{error}</p></div></div>
    </div>
  )

  const speaker = session?.speaker
  const room    = session?.room

  return (
    <div>
      <Navbar />

      <div className="page">
        <div className="breadcrumb">
          <Link to="/">Conferences</Link>
          <span className="breadcrumb__sep">/</span>
          <Link to={`/conferences/${id}`}>Conference</Link>
          <span className="breadcrumb__sep">/</span>
          <span>{session?.title}</span>
        </div>

        <div className="detail-header">
          <h1 className="detail-header__title">{session?.title}</h1>
          <div className="detail-header__meta">
            {session?.startTime && (
              <span>📅 {formatDate(session.startTime)} · {formatTime(session.startTime)} – {formatTime(session.endTime)}</span>
            )}
            {room && <span>🚪 {room.name}</span>}
            {session?.registeredCount != null && session?.capacity != null && (
              <span>{`👥 ${session.registeredCount} / ${session.capacity} registered`}</span>
            )}
            {session?.waitlistCount != null && <span>{`⏳ Waitlist: ${session.waitlistCount}`}</span>}
          </div>
          {session?.description && <p className="detail-header__description">{session.description}</p>}
        </div>

        {isRegistrationOpen(session?.conference?.status) && (
          <SessionRegistrationPanel session={session} conferenceId={id} onChanged={() => loadSession({ silent: true })} />
        )}

        {speaker && (
          <div className="detail-section">
            <h2 className="detail-section__title">Speaker</h2>
            <div className="card">
              <div className="card__title">{speaker.firstName} {speaker.lastName}</div>
              {speaker.bio && <p className="card__description" style={{ WebkitLineClamp: 'unset' }}>{speaker.bio}</p>}
              {speaker.email && <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '8px' }}>✉ {speaker.email}</div>}
            </div>
          </div>
        )}

        {room && (
          <div className="detail-section">
            <h2 className="detail-section__title">Room</h2>
            <div className="card">
              <div className="card__title">{room.name}</div>
              <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '4px' }}>
                {room.location && <span>📍 {room.location}</span>}
                {room.capacity && <span style={{ marginLeft: '16px' }}>👥 Capacity: {room.capacity}</span>}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: '24px' }}>
          <Link to={`/conferences/${id}`} className="btn btn--secondary">← Back to Conference</Link>
          {isRegistrationOpen(session?.conference?.status) && (
            <Link to={`/conferences/${id}/register`} className="btn btn--primary" style={{ marginLeft: '12px' }}>Register for conference</Link>
          )}
        </div>
      </div>
    </div>
  )
}
