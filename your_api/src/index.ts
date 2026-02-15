import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono  } from 'hono'
import { logger } from 'hono/logger'

import z from 'zod/v4'
import { zValidator } from '@hono/zod-validator'

import axios from 'axios'
import redis, { setNewValue } from './utils/redis.js'

import { ResponseStatusApi } from './utils/type.js'
import { processTransaction } from './utils/index.js'
import { CLIENT_WEBHOOK_URL } from './utils/constante.js'


const app = new Hono()
const PORT = parseInt(process.env.PORT || "18000") 


app.use(logger())

await redis.connect()


app.post('/transaction',zValidator('json', z.object({
  id : z.uuid()
})) , async(c) => {
  const data = c.req.valid("json")

  const exists = await redis.get(data.id)

  if(exists){
    return c.json({id : data.id , status : JSON.parse(exists).status})
  }

  const response = { id: data.id, status: ResponseStatusApi.pending , retries : 0 }
  await redis.setEx(data.id, 3600 , JSON.stringify(response))
  
  queueMicrotask(() => processTransaction(data.id))

  return c.json(response)
})



app.post('/webhook', zValidator('json', z.object({
  id: z.uuid(),
  status: z.enum(['completed', 'declined', 'pending'])
})), async (c) => {
  const data = c.req.valid("json")

  const response = await setNewValue(data.id, data.status);

  queueMicrotask(() => {
    axios.put(`${CLIENT_WEBHOOK_URL}/transaction`, {...response, retries : undefined})
      .catch((e) => console.log("Erreur webhook client", e))
  })
  
  return c.json({ ok: true })
})


serve({
  fetch: app.fetch,
  hostname : "0.0.0.0",
  port: PORT
}, (info) => {
  console.log(`Server is running on http://${info.address}:${info.port}`)
})


