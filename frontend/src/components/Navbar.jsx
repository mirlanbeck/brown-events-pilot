import { Link, NavLink } from 'react-router-dom'

// One header for every page (BEVN-203 spec 6.3). NavLink sets aria-current="page"; `end` keeps Conferences current
// only on the list itself.
export default function Navbar() {
  return (
    <nav className="navbar">
      <Link to="/" className="navbar__brand">BrownEvents</Link>
      <NavLink to="/" end className="navbar__link">Conferences</NavLink>
      <NavLink to="/dashboard" className="navbar__link">My registrations</NavLink>
    </nav>
  )
}
