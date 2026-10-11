// No fields (spec 4.1): the cancel takes no body, but a POST under /api/ needs Content-Type: application/json, so the
// frontend sends {}. Validated like every body (whitelist + forbidNonWhitelisted): any field is a 400 (plan decision 2).
export class CancelRegistrationDto {}
