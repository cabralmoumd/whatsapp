// src/server.js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { webhookRoutes } from './routes/webhook.js'
import { campanhaRoutes } from './routes/campanhas.js'
import { verificarAvancoPerfil } from './jobs/perfilAvancar.js'
import { reconciliarCampanhas } from './jobs/reconciliar.js'

const PATCH_MARKER = 'WEBHOOK_RPC_PHONE_V3_2026_03_11'
const BUILD_SHA = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'local'

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
  versao: '1.2.0',
  marker: PATCH_MARKER,
  buildSha: BUILD_SHA,
  timestamp: new Date().toISOString()
}))

fastify.get('/health', async () => ({
  status: 'ok',
  marker: PATCH_MARKER,
  buildSha: BUILD_SHA,
  timestamp: new Date().toISOString()
}))

// ── Jobs periódicos ──────────────────────────────────────────
setInterval(verificarAvancoPerfil, 6 * 60 * 60 * 1000)
setInterval(reconciliarCampanhas, 10 * 60 * 1000)

verificarAvancoPerfil()
reconciliarCampanhas()

// ── Start ────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000')
const HOST = '0.0.0.0'

try {
  await fastify.listen({ port: PORT, host: HOST })
  console.log(`
╔══════════════════════════════════════════╗
║   EncantaKids WhatsApp Backend v1.2      ║
║   Porta ${PORT} | SHA ${BUILD_SHA}              ║
╠══════════════════════════════════════════╣
║  🏷️  Marker: ${PATCH_MARKER}            ║
║  ✅ Correção 1: Retry webhook Evolution  ║
║  ✅ Correção 2: Validação WEBHOOK_SECRET ║
║  ✅ Correção 3: Reconciliação campanhas  ║
║  ✅ Correção 4: Lookup robusto telefone  ║
╚══════════════════════════════════════════╝
  `)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
