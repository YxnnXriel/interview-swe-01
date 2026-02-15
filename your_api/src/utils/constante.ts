
/** * Safety threshold to prevent spamming the partner's API. 
 * Combined with exponential backoff, 5 retries cover roughly 2.5 minutes 
 * of total polling time.
 */
export const MAX_RETRIES = 5;

/** * Initial 5-second delay. 
 * This strategic buffer allows a window for the partner's Webhook 
 * to arrive before we trigger the first status check (Polling).
 */
export const BASE_DELAY = 5000;

export const REDIS_CACHE = 3600

export const THIRD_PARTY_URL = process.env.THIRD_PARTY_URL || 'http://localhost:3000'
export const CLIENT_WEBHOOK_URL = process.env.CLIENT_WEBHOOK_URL || 'http://localhost:3100'
export const YOUR_API_WEBHOOK_URL = process.env.YOUR_API_WEBHOOK_URL || 'http://localhost:18000'

