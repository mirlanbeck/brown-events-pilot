import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSession } from '../api'

export default function SessionDetailPage() {
  const { id, sessionId } = useParams()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    getSession(sessionId)
      .then(data => {
        setSession(data.data || data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Failed to load session')
        setLoading(false)
      })
  }, [sessionId])

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
      <nav className="navbar"><Link to="/" className="navbar__brand">BrownEvents</Link></nav>
      <div className="loading-container"><div className="spinner" /><p>Loading session...</p></div>
    </div>
  )

  if (error) return (
    <div>
      <nav className="navbar"><Link to="/" className="navbar__brand">BrownEvents</Link></nav>
      <div className="page"><div className="error-container"><h3>Failed to load session</h3><p>{error}</p></div></div>
    </div>
  )

  const speaker = session?.speaker
  const room    = session?.room

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
            {session?.capacity && <span>👥 Capacity: {session.capacity}</span>}
          </div>
          {session?.description && <p className="detail-header__description">{session.description}</p>}
        </div>

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
          <Link to={`/conferences/${id}/register`} className="btn btn--primary" style={{ marginLeft: '12px' }}>Register</Link>
        </div>
      </div>
    </div>
  )
}
