// src/routes/webhook.js
import { supabase } from '../lib/supabase.js'
import { enviarMensagem } from '../lib/evolution.js'
import { interpretarResposta, extrairTelefone, extrairTexto } from '../services/parser.js'

const MSG_CONFIRMACAO_OPTIN = `✅ Ótimo! Você está na nossa lista de novidades do EncantaKids.

Você vai receber lançamentos de novos personagens e ofertas especiais por aqui. 🎉

Se quiser sair a qualquer momento, é só responder *SAIR*.`

const MSG_CONFIRMACAO_OPTOUT = `Tudo bem! 😊 Você foi removido da nossa lista de novidades.

Se mudar de ideia, é só nos chamar aqui. Até mais! 👋`

const MSG_CONFIRMACAO_NAO = `Sem problemas! 😊 Não vamos te enviar novidades.

Se mudar de ideia futuramente, é só nos chamar. Tchau! 👋`

export async function webhookRoutes(fastify) {

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.routerPath !== '/webhook' || request.method !== 'POST') return
    const secret = process.env.WEBHOOK_SECRET
    if (!secret) return
    const headerSecret = request.headers['x-webhook-secret']
      || request.headers['x-api-key']
      || request.body?.secret
    if (headerSecret !== secret) {
      console.warn(`⚠️  Webhook rejeitado — secret inválido. IP: ${request.ip}`)
      return reply.code(401).send({ erro: 'Não autorizado' })
    }
  })

  fastify.post('/webhook', async (request, reply) => {
    try {
      const payload = request.body

      // 🔍 LOG TEMPORÁRIO — ver estrutura exata da Evolution API
      console.log('🔍 PAYLOAD RAW:', JSON.stringify(payload, null, 2))

      const evento = payload?.event || payload?.type
      if (!evento?.includes('message') && !evento?.includes('upsert')) {
        return reply.code(200).send({ ok: true, ignorado: true })
      }

      const fromMe = payload?.data?.key?.fromMe || payload?.key?.fromMe
      if (fromMe) {
        return reply.code(200).send({ ok: true, ignorado: 'fromMe' })
      }

      const telefone = extrairTelefone(payload)
      const texto = extrairTexto(payload)

      if (!telefone || !texto) {
        return reply.code(200).send({ ok: true, ignorado: 'sem_telefone_ou_texto' })
      }

      console.log(`📥 Webhook | ${telefone}: "${texto}"`)

      const soDigitos = telefone.replace(/\D/g, '')
      const semDDI    = soDigitos.replace(/^55/, '')
      const comPlus   = '+' + soDigitos

      const { data: cliente } = await supabase
        .from('clientes')
        .select('*')
        .or([
          `telefone.eq.${comPlus}`,
          `telefone.eq.${soDigitos}`,
          `telefone.eq.${semDDI}`
        ].join(','))
        .single()

      const intencao = interpretarResposta(texto)

      await supabase.from('mensagens_log').insert({
        cliente_id: cliente?.id || null,
        direcao: 'recebida',
        conteudo: texto,
        intencao_detectada: intencao
      })

      if (!cliente) {
        console.log(`⚠️  Cliente não encontrado: ${telefone}`)
        console.log(`🔍 Buscou por: comPlus=${comPlus} | soDigitos=${soDigitos} | semDDI=${semDDI}`)
        return reply.code(200).send({ ok: true, intencao, cliente: 'nao_encontrado' })
      }

      await processarIntencao(intencao, cliente, texto)

      return reply.code(200).send({ ok: true, intencao, cliente_id: cliente.id })

    } catch (erro) {
      console.error('❌ Erro no webhook:', erro)
      return reply.code(200).send({ ok: false, erro: erro.message })
    }
  })

  fastify.get('/webhook', async (request, reply) => {
    return reply.send({
      status: 'online',
      servico: 'EncantaKids WhatsApp Webhook',
      timestamp: new Date().toISOString()
    })
  })
}

async function processarIntencao(intencao, cliente, textoOriginal) {

  if (intencao === 'optin_sim') {
    await supabase
      .from('clientes')
      .update({
        optin_marketing: true,
        data_optin: new Date().toISOString(),
        data_optout: null
      })
      .eq('id', cliente.id)

    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_OPTIN)

    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_OPTIN,
      intencao_detectada: 'confirmacao_optin'
    })

    console.log(`✅ Opt-in confirmado: ${cliente.nome}`)
  }

  else if (intencao === 'optin_nao') {
    await supabase
      .from('clientes')
      .update({ optin_marketing: false })
      .eq('id', cliente.id)

    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_NAO)

    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_NAO,
      intencao_detectada: 'confirmacao_optout'
    })

    console.log(`❌ Opt-in recusado: ${cliente.nome}`)
  }

  else if (intencao === 'sair') {
    await supabase
      .from('clientes')
      .update({
        optin_marketing: false,
        data_optout: new Date().toISOString()
      })
      .eq('id', cliente.id)

    await supabase
      .from('fila_envio')
      .update({ status: 'cancelado' })
      .eq('cliente_id', cliente.id)
      .eq('status', 'pendente')

    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_OPTOUT)

    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_OPTOUT,
      intencao_detectada: 'confirmacao_sair'
    })

    console.log(`🚪 Opt-out: ${cliente.nome}`)
  }

  else {
    console.log(`❓ Resposta não reconhecida de ${cliente.nome}: "${textoOriginal}"`)
  }
}
