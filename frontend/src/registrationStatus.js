// Badge of a conference registration status (BEVN-203 spec 6.2): the dashboard and the conference page show it alike.
const BADGES = { CONFIRMED: 'badge badge--active', CANCELLED: 'badge badge--cancelled' }

export const registrationBadgeClass = (status) => BADGES[status] ?? 'badge badge--upcoming'
