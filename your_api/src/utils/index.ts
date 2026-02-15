
import axios from 'axios'
import { ResponseStatusApi } from './type.js'
import redis from './redis.js'
import { BASE_DELAY, CLIENT_WEBHOOK_URL, MAX_RETRIES, REDIS_CACHE, THIRD_PARTY_URL, YOUR_API_WEBHOOK_URL } from './constante.js';



/**
 * Initiates the transaction with the Third-Party API.
 * Handles the unstable nature of the partner (504 timeouts and 429 rate limits).
 */
export async function processTransaction(id: string) {
  try {

    await axios.post(`${THIRD_PARTY_URL}/transaction`, {
      id,
      webhookUrl: `${YOUR_API_WEBHOOK_URL}/webhook`
    });

    /** * Success: Start polling after BASE_DELAY to allow the Webhook 
     * some time to arrive first.
     */
    setTimeout(() => scheduleCheckStatus(id), BASE_DELAY);

  } catch (e: any) {
    const status = e.response?.status;

    /** * Handle "Uncertain" states: 
     * 504 (Timeout) or 429 (Rate Limit) doesn't mean failure.
     * The request might have reached the partner's DB. 
     * We fall back to the polling mechanism to verify the actual state.
     */
    if (status === 504 || status === 429 || !e.response) {
      console.warn(`Transaction ${id} in uncertain state (${status || 'Network Error'}). Starting polling...`);
      scheduleCheckStatus(id);
    } else {
      /** * Hard errors (400, 401, 403, 422): 
       * These are definitive failures that polling won't fix.
       */
      await handleFinalStatus(id, ResponseStatusApi.declined);
    }
  }
}


async function handleFinalStatus(id: string, status: string) {
  await axios.put(`${CLIENT_WEBHOOK_URL}/transaction`, { id, status })
    .catch(() => {});
}

const checkStatus = async (id: string) => {
  try {
    const res = await axios.get(`${THIRD_PARTY_URL}/transaction/${id}`);
    const status = res.data.status;

    /** * Stop polling if we reach a final state (e.g., success, failed, declined).
     * This avoids unnecessary API calls.
     */
    if (status !== ResponseStatusApi.pending) {
      await handleFinalStatus(id, status);
      return;
    }

    await scheduleCheckStatus(id);

  } catch (e: any) {

    /** * On network error or partner downtime: 
     * We don't give up. We reschedule the check, relying on the 
     * exponential backoff to reduce pressure on their API.
     */
    await scheduleCheckStatus(id);
  }
};

async function scheduleCheckStatus(id: string) {
  const raw = await redis.get(id)
  if (!raw) return

  const tx = JSON.parse(raw)

  // Stop condition: If we exceed MAX_RETRIES, we assume failure
  if (tx.retries >= MAX_RETRIES) {
    await handleFinalStatus(id, ResponseStatusApi.declined); 
    return;
  }

  /** * Calculate delay: Exponential Backoff (e.g., 5s, 10s, 20s, 40s...)
   * This spreads out the requests to stay under the partner's rate limits.
   */
  const delay = BASE_DELAY * Math.pow(2, tx.retries)

  await redis.setEx(
    id,
    REDIS_CACHE,
    JSON.stringify({ ...tx, retries: tx.retries + 1 })
  )

  /** Trigger the next check after the calculated delay */
  setTimeout(() => checkStatus(id), delay)
}

