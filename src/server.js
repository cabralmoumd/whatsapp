// src/server.js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { webhookRoutes } from './routes/webhook.js'
import { campanhaRoutes } from './routes/campanhas.js'
import { verificarAvancoPerfil } from './jobs/perfilAvancar.js'

const isProd = process.env.NODE_ENV === 'production'

const fastify = Fastify({
  logger: isProd
    ? true
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true }
        }
      }
})

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
})

// ============================================================
// ROTAS
// ============================================================
await fastify.register(webhookRoutes)
await fastify.register(campanhaRoutes)

// Health check
fastify.get('/', async () => ({
  status: 'online',
  servico: 'EncantaKids WhatsApp Backend',
  versao: '1.1.0',
  timestamp: new Date().toISOString()
}))

fastify.get('/health', async () => ({ status: 'ok' }))

// ============================================================
// DIAGNÓSTICO — Status da instância na Evolution API
// ============================================================
fastify.get('/instancias/:nome/status', async (request, reply) => {
  const { nome } = request.params
  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return reply.status(500).send({ error: 'EVOLUTION_API_URL ou EVOLUTION_API_KEY não configuradas' })
  }

  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${encodeURIComponent(nome)}`, {
      headers: { apikey: EVOLUTION_API_KEY }
    })
    const data = await res.json()
    return reply.status(res.status).send(data)
  } catch (err) {
    return reply.status(502).send({ error: 'Falha ao conectar na Evolution API', detail: err.message })
  }
})

// ============================================================
// DIAGNÓSTICO — Enviar mensagem de teste via Evolution API
// ============================================================
fastify.post('/mensagens/teste', async (request, reply) => {
  const { instancia, numero, texto } = request.body
  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return reply.status(500).send({ error: 'EVOLUTION_API_URL ou EVOLUTION_API_KEY não configuradas' })
  }

  if (!instancia || !numero || !texto) {
    return reply.status(400).send({ error: 'Campos obrigatórios: instancia, numero, texto' })
  }

  try {
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY
      },
      body: JSON.stringify({ number: numero, text: texto })
    })
    const data = await res.json()
    return reply.status(res.status).send(data)
  } catch (err) {
    return reply.status(502).send({ error: 'Falha ao conectar na Evolution API', detail: err.message })
  }
})

// ============================================================
// JOBS PERIÓDICOS
// ============================================================
setInterval(verificarAvancoPerfil, 6 * 60 * 60 * 1000)
verificarAvancoPerfil()

// ============================================================
// START
// ============================================================
const PORT = parseInt(process.env.PORT || '3000')
const HOST = '0.0.0.0'

try {
  await fastify.listen({ port: PORT, host: HOST })
  console.log(`
╔══════════════════════════════════════════╗
║   EncantaKids WhatsApp Backend           ║
║   Rodando na porta ${PORT}                  ║
╠══════════════════════════════════════════╣
║   POST /webhook     → Recebe respostas   ║
║   POST /campanhas/:id/disparar           ║
║   POST /campanhas/:id/pausar             ║
║   POST /campanhas/:id/cancelar           ║
║   GET  /campanhas/:id/progresso          ║
║   GET  /instancias/:nome/status    [NEW] ║
║   POST /mensagens/teste            [NEW] ║
╚══════════════════════════════════════════╝
  `)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
