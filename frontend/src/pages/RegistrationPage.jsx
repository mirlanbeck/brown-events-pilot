import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getConference, registerAttendee } from '../api'
import { isRegistrationOpen } from '../conferenceStatus'

export default function RegistrationPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const [conference, setConference] = useState(null)
  const [conferenceLoading, setConferenceLoading] = useState(true)
  const [conferenceError, setConferenceError] = useState(null)

  // The page can be opened by URL, so it checks the conference itself instead of relying on the hidden buttons.
  useEffect(() => {
    setConferenceLoading(true)
    setConferenceError(null)
    getConference(id)
      .then(data => {
        setConference(data.data || data)
        setConferenceLoading(false)
      })
      .catch(err => {
        setConferenceError(err.message || 'Failed to load conference')
        setConferenceLoading(false)
      })
  }, [id])

  function handleChange(e) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    console.log('registration form submit:', formData)
    try {
      await registerAttendee(id, formData)
      setSuccess(true)
      setLoading(false)
    } catch (err) {
      setError(err.message || 'Registration failed')
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div>
        <nav className="navbar"><Link to="/" className="navbar__brand">BrownEvents</Link></nav>
        <div className="page">
          <div className="success-box">
            <h2>Registration Successful!</h2>
            <p>You are now registered. A confirmation email will be sent to <strong>{formData.email}</strong>.</p>
            <button className="btn btn--primary" style={{ marginTop: '16px' }} onClick={() => navigate(`/conferences/${id}`)}>
              Back to Conference
            </button>
          </div>
        </div>
      </div>
    )
  }

  const navbar = (
    <nav className="navbar">
      <Link to="/" className="navbar__brand">BrownEvents</Link>
      <Link to="/" className="navbar__link">Conferences</Link>
    </nav>
  )

  if (conferenceLoading) {
    return (
      <div>
        {navbar}
        <div className="loading-container"><div className="spinner" /><p>Loading conference...</p></div>
      </div>
    )
  }

  if (conferenceError) {
    return (
      <div>
        {navbar}
        <div className="page">
          <div className="error-container">
            <h3>Failed to load conference</h3>
            <p>{conferenceError}</p>
          </div>
          <Link to="/" className="btn btn--secondary" style={{ marginTop: '16px' }}>← Back to Conferences</Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {navbar}

      <div className="page">
        <div className="breadcrumb">
          <Link to="/">Conferences</Link>
          <span className="breadcrumb__sep">/</span>
          <Link to={`/conferences/${id}`}>{conference?.title || 'Conference'}</Link>
          <span className="breadcrumb__sep">/</span>
          <span>Register</span>
        </div>

        <h1 className="page-header__title">Register for Conference</h1>

        {!isRegistrationOpen(conference?.status) ? (
          <div className="card" style={{ maxWidth: '600px' }}>
            <h3 style={{ marginBottom: '4px' }}>Registration is closed</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              {conference?.status ? `The conference is ${conference.status}.` : 'This conference does not accept registrations.'}
            </p>
            <Link to={`/conferences/${id}`} className="btn btn--secondary" style={{ marginTop: '16px' }}>← Back to Conference</Link>
          </div>
        ) : (
        <div className="card" style={{ maxWidth: '600px' }}>
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="error-container" style={{ marginBottom: '16px' }}>
                <p>{error}</p>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label>First Name *</label>
                <input type="text" name="firstName" value={formData.firstName} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input type="text" name="lastName" value={formData.lastName} onChange={handleChange} required />
              </div>
            </div>

            <div className="form-group">
              <label>Email Address *</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} required />
            </div>

            <div className="form-group">
              <label>Phone Number</label>
              <input type="tel" name="phone" value={formData.phone} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Company / Organization</label>
              <input type="text" name="company" value={formData.company} onChange={handleChange} />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <Link to={`/conferences/${id}`} className="btn btn--ghost">Cancel</Link>
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {loading ? 'Registering...' : 'Complete Registration'}
              </button>
            </div>
          </form>
        </div>
        )}
      </div>
    </div>
  )
}
