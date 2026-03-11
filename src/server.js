// src/server.js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { webhookRoutes } from './routes/webhook.js'
import { campanhaRoutes } from './routes/campanhas.js'
import { verificarAvancoPerfil } from './jobs/perfilAvancar.js'
import { reconciliarCampanhas } from './jobs/reconciliar.js'

const isProd = process.env.NODE_ENV === 'production'

const fastify = Fastify({
  logger: isProd
    ? true
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }
})

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
})

await fastify.register(webhookRoutes)
await fastify.register(campanhaRoutes)

fastify.get('/', async () => ({
  status: 'online',
  servico: 'EncantaKids WhatsApp Backend',
  versao: '1.1.0',
  timestamp: new Date().toISOString()
}))

fastify.get('/health', async () => ({ status: 'ok' }))

// ── Jobs periódicos ──────────────────────────────────────────
// Avanço de perfil: a cada 6 horas
setInterval(verificarAvancoPerfil, 6 * 60 * 60 * 1000)

// CORREÇÃO 3: Reconciliação: a cada 10 minutos
setInterval(reconciliarCampanhas, 10 * 60 * 1000)

// Executa imediatamente ao iniciar
verificarAvancoPerfil()
reconciliarCampanhas()

// ── Start ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000')
const HOST = '0.0.0.0'

try {
  await fastify.listen({ port: PORT, host: HOST })
  console.log(`
╔══════════════════════════════════════════╗
║   EncantaKids WhatsApp Backend v1.1      ║
║   Rodando na porta ${PORT}                  ║
╠══════════════════════════════════════════╣
║  ✅ Correção 1: Retry webhook Evolution  ║
║  ✅ Correção 2: Validação WEBHOOK_SECRET ║
║  ✅ Correção 3: Reconciliação campanhas  ║
╚══════════════════════════════════════════╝
  `)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
