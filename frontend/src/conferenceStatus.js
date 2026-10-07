// Same rule as the API (backend/src/common/status.ts): registration is accepted only while a conference is UPCOMING
// or ACTIVE. A missing or unknown status counts as closed, so the UI never offers a registration the API refuses.
export const isRegistrationOpen = (status) => status === 'UPCOMING' || status === 'ACTIVE'
