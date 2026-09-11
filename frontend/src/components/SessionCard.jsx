import { Link } from 'react-router-dom'

export default function SessionCard({ session, conferenceId, onSessionClick }) {
  function formatTime(dt) {
    if (!dt) return '—'
    try { return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
    catch { return dt }
  }

  return (
    <div className="card session-card" onClick={() => onSessionClick && onSessionClick(session)} style={{ cursor: 'pointer' }}>
      <div className="card__title">{session.title}</div>
      <div className="card__meta">
        {session.startTime && <span>⏰ {formatTime(session.startTime)} – {formatTime(session.endTime)}</span>}
        {session.room && <span>🚪 {session.room.name || session.room}</span>}
        {session.speaker && <span>🎤 {session.speaker.firstName} {session.speaker.lastName}</span>}
        {session.capacity && <span>👥 {session.capacity} seats</span>}
      </div>
      {session.description && <p className="card__description">{session.description}</p>}
      <div style={{ marginTop: '12px' }}>
        <Link
          to={`/conferences/${conferenceId}/sessions/${session.id}`}
          className="btn btn--ghost btn--sm"
          onClick={e => e.stopPropagation()}
        >
          Details →
        </Link>
      </div>
    </div>
  )
}
