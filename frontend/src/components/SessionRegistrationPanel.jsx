import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelSessionRegistration, joinWaitlist, registerForSession } from '../api'

const ACTIONS = {
  register: { call: registerForSession, success: 'You are registered for this session.' },
  waitlist: { call: joinWaitlist, success: 'You are on the waitlist.' },
  cancel: { call: cancelSessionRegistration, success: 'Your registration or waitlist place is cancelled.' },
}

// These refusals mean the counts on the page are out of date: a refresh switches the button (spec 6.3).
const REFRESH_ON = ['SESSION_FULL', 'SEATS_AVAILABLE']

export default function SessionRegistrationPanel({ session, conferenceId, onChanged }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const action = useRef('register')
  const full = session.registeredCount >= session.capacity

  async function handleSubmit(e) {
    e.preventDefault()
    const { call, success } = ACTIONS[action.current]
    setBusy(true)
    setNotice(null)
    let next
    let refresh
    try {
      await call(session.id, email)
      next = { kind: 'success', text: success }
      refresh = true
    } catch (err) {
      const reason = err.body?.reason
      next = { kind: 'error', text: err.message, reason }
      refresh = REFRESH_ON.includes(reason)
    }
    if (refresh) {
      try {
        await onChanged()
      } catch (err) {
        next = { ...next, refreshError: `The counts could not be refreshed: ${err.message}. Reload the page to see them.` }
      }
    }
    setNotice(next)
    setBusy(false)
  }

  const choose = (name) => () => { action.current = name }

  return (
    <div className="detail-section">
      <h2 className="detail-section__title">Session registration</h2>
      <form className="card" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="session-email">Email</label>
          <input id="session-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        {full ? (
          <button type="submit" className="btn btn--primary" disabled={busy} onClick={choose('waitlist')}>Join waitlist</button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={busy} onClick={choose('register')}>Register for session</button>
        )}
        <button type="submit" className="btn btn--ghost" style={{ marginLeft: '12px' }} disabled={busy} onClick={choose('cancel')}>
          Cancel my registration
        </button>
        <div role="status">{notice?.kind === 'success' && <p style={{ marginTop: '12px' }}>{notice.text}</p>}</div>
        <div role="alert">
          {notice?.kind === 'error' && (
            <div style={{ marginTop: '12px' }}>
              <p>{notice.text}</p>
              {notice.reason === 'CONFERENCE_REGISTRATION_REQUIRED' && (
                <div style={{ marginTop: '8px' }}>
                  <Link to={`/conferences/${conferenceId}/register`} className="btn btn--primary">Register for conference</Link>
                  <button type="button" className="btn btn--ghost" style={{ marginLeft: '12px' }} onClick={() => setNotice(null)}>Close</button>
                </div>
              )}
            </div>
          )}
          {notice?.refreshError && <p style={{ marginTop: '8px' }}>{notice.refreshError}</p>}
        </div>
      </form>
    </div>
  )
}
