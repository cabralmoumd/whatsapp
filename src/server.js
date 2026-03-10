// src/server.js
// Servidor principal — entry point da aplicação EncantaKids Backend

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { webhookRoutes } from './routes/webhook.js'
import { campanhaRoutes } from './routes/campanhas.js'
import { verificarAvancoPerfil } from './jobs/perfilAvancar.js'

// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================
const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }
})

// CORS — permite chamadas do frontend Lovable
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
  versao: '1.0.0',
  timestamp: new Date().toISOString()
}))

fastify.get('/health', async () => ({ status: 'ok' }))

// ============================================================
// JOBS PERIÓDICOS
// ============================================================

// Verifica avanço de perfil a cada 6 horas
setInterval(verificarAvancoPerfil, 6 * 60 * 60 * 1000)

// Roda uma vez na inicialização
verificarAvancoPerfil()

// ============================================================
// START
// ============================================================
const PORT = parseInt(process.env.PORT || '3000')
const HOST = '0.0.0.0' // obrigatório para Railway

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
╚══════════════════════════════════════════╝
  `)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
