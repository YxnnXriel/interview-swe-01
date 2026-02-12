import { serve } from '@hono/node-server'
import { Hono  } from 'hono'
import { zValidator } from '@hono/zod-validator'
import z from 'zod/v4'
import { createClient } from 'redis'
import axios from 'axios'
import 'dotenv/config'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

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


await redis.connect()

const PORT = parseInt(process.env.PORT || "18000") 
const MAX_RETRIES = 5
const BASE_DELAY = 5000 


enum ResponseStatusApi {
  pending = "pending",
  completed = "completed",
  declined = "declined",
}


const THIRD_PARTY_URL = process.env.THIRD_PARTY_URL || 'http://localhost:3000'
const CLIENT_WEBHOOK_URL = process.env.CLIENT_WEBHOOK_URL || 'http://localhost:3100'
const YOUR_API_WEBHOOK_URL = process.env.YOUR_API_WEBHOOK_URL || 'http://localhost:18000'


app.post('/transaction',zValidator('json', z.object({
  id : z.uuid()
})) , async(c) => {
  const data = c.req.valid("json")

  const exists = await redis.get(data.id)

  if(exists){
    console.log("Essaie : " , data.id)
    return c.json({id : data.id , status : JSON.parse(exists).status})
  }

  const response = { id: data.id, status: ResponseStatusApi.pending , retries : 0 }
  await redis.setEx(data.id, 3600 , JSON.stringify(response))
  
  queueMicrotask(() => processTransaction(data.id))

  return c.json(response)
})

async function setNewValue(id : string , status : string){
  const prev = await redis.get(id)
  const prevState = prev ? JSON.parse(prev) : null
  const retries = prevState?.retries ?? 0

  const response = { id: id, status: status , retries : retries }

  await redis.setEx( id, 3600, JSON.stringify(response))
}

app.post('/webhook', zValidator('json', z.object({
  id: z.uuid(),
  status: z.enum(['completed', 'declined', 'pending'])
})), async (c) => {
  const data = c.req.valid("json")
  
  const prev = await redis.get(data.id)
  const prevState = prev ? JSON.parse(prev) : null
  const retries = prevState?.retries ?? 0

  const response = { id: data.id, status: data.status , retries : retries }

  await redis.setEx( data.id.toString(), 3600, JSON.stringify(response))
  
  // console.log({ "data" :response , "function" : "webhook"})
  
  queueMicrotask(() => {
    axios.put(`${CLIENT_WEBHOOK_URL}/transaction`, {...response, retries : undefined})
      .catch((e) => console.log("Erreur webhook client", e))
  })
  
  return c.json({ ok: true })
})


async function processTransaction(id : string) {
  try {
    await axios.post(`${THIRD_PARTY_URL}/transaction`, {
      id , 
      webhookUrl : `${YOUR_API_WEBHOOK_URL}/webhook`
    })
    
    scheduleCheckStatus(id)
  }catch (e: any) {
    if (e.response?.status === 504) {
      scheduleCheckStatus(id)
    }
  }
}

const checkStatus = async (id: string) => {
  try {
    const res = await axios.get(`${THIRD_PARTY_URL}/transaction/${id}`)

    // console.log({ "data" :res.data , "function" : "checkStatus"})

    await setNewValue(id, res.data.status)

    await axios.put(`${CLIENT_WEBHOOK_URL}/transaction`, {
      id: res.data.id,
      status: res.data.status
    }).catch(() => {})

    if (res.data.status === "pending") {
      scheduleCheckStatus(id)
    }
  } catch (e) {
    scheduleCheckStatus(id)
  }
}

async function scheduleCheckStatus(id: string) {
  const raw = await redis.get(id)
  if (!raw) return

  const tx = JSON.parse(raw)

  if (tx.retries >= MAX_RETRIES) {
    console.log(`Abandon transaction ${id}`)

    await setNewValue(id, ResponseStatusApi.declined)

    await axios.put(`${CLIENT_WEBHOOK_URL}/transaction`, {
      id,
      status: ResponseStatusApi.declined
    }).catch(() => {})

    return
  }

  const delay = BASE_DELAY * Math.pow(2, tx.retries)

  await redis.setEx(
    id,
    3600,
    JSON.stringify({ ...tx, retries: tx.retries + 1 })
  )

  setTimeout(() => checkStatus(id), delay)
}


serve({
  fetch: app.fetch,
  hostname : "0.0.0.0",
  port: PORT
}, (info) => {
  console.log(`Server is running on http://${info.address}:${info.port}`)
})


