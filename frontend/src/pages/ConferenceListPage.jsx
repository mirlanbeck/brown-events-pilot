import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getConferences } from '../api'
import ConferenceCard from '../components/ConferenceCard'

export default function ConferenceListPage() {
  const [conferences, setConferences] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getConferences()
      .then(data => {
        setConferences(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Failed to load conferences')
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <nav className="navbar">
        <Link to="/" className="navbar__brand">BrownEvents</Link>
        <Link to="/" className="navbar__link">Conferences</Link>
      </nav>

      <div className="page">
        <div className="page-header">
          <h1 className="page-header__title">Conferences</h1>
        </div>

        {loading && (
          <div className="loading-container">
            <div className="spinner" />
            <p>Loading conferences...</p>
          </div>
        )}

        {error && (
          <div className="error-container">
            <h3>Failed to load conferences</h3>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && conferences.length === 0 && (
          <div style={{ textAlign: 'center', color: '#666', padding: '40px 0' }}>
            No conferences found.
          </div>
        )}

        <div className="card-grid">
          {conferences.map(conf => (
            <ConferenceCard key={conf.id} conference={conf} />
          ))}
        </div>
      </div>
    </div>
  )
}
