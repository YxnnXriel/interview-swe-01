
import { createClient } from 'redis'

const redis = createClient({url : process.env.REDIS_URL , 
  socket: {
    connectTimeout: 10_000,
    reconnectStrategy: (retries) => {
      console.log('Redis reconnect attempt', retries);
      return Math.min(retries * 100, 3000);
    }
  }})


redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

export async function setNewValue(id : string , status : string){
  const prev = await redis.get(id)
  const prevState = prev ? JSON.parse(prev) : null
  const retries = prevState?.retries ?? 0

  const response = { id: id, status: status , retries : retries }

  await redis.setEx( id, 3600, JSON.stringify(response))

  return response
}


export default redis;
