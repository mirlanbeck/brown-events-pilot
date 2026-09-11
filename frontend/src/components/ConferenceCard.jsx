import { Link } from 'react-router-dom'

export default function ConferenceCard({ conference }) {
  function formatDate(d) {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
    catch { return d }
  }

  function statusClass(s) {
    switch ((s || '').toLowerCase()) {
      case 'active':    return 'badge badge--active'
      case 'upcoming':  return 'badge badge--upcoming'
      case 'cancelled': return 'badge badge--cancelled'
      case 'completed': return 'badge badge--completed'
      default:          return 'badge badge--upcoming'
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div className="card__title">{conference.title}</div>
        <span className={statusClass(conference.status)}>{conference.status || 'UPCOMING'}</span>
      </div>
      {conference.description && (
        <p className="card__description">{conference.description}</p>
      )}
      <div className="card__meta">
        {conference.location && <span>📍 {conference.location}</span>}
        {conference.startDate && (
          <span>📅 {formatDate(conference.startDate)} – {formatDate(conference.endDate)}</span>
        )}
      </div>
      <div style={{ marginTop: '16px' }}>
        <Link to={`/conferences/${conference.id}`} className="btn btn--secondary btn--sm">View Details</Link>
        <Link to={`/conferences/${conference.id}/register`} className="btn btn--primary btn--sm" style={{ marginLeft: '8px' }}>Register</Link>
      </div>
    </div>
  )
}
