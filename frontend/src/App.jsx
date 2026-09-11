import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ConferenceListPage from './pages/ConferenceListPage'
import ConferenceDetailPage from './pages/ConferenceDetailPage'
import SessionDetailPage from './pages/SessionDetailPage'
import RegistrationPage from './pages/RegistrationPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConferenceListPage />} />
        <Route path="/conferences/:id" element={<ConferenceDetailPage />} />
        <Route path="/conferences/:id/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/conferences/:id/register" element={<RegistrationPage />} />
      </Routes>
    </BrowserRouter>
  )
}
