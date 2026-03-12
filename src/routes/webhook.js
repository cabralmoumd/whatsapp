// src/routes/webhook.js

import { supabase } from '../lib/supabase.js'
import { enviarMensagem } from '../lib/evolution.js'
import { interpretarResposta, extrairTexto } from '../services/parser.js'

const PATCH_MARKER = 'WEBHOOK_RPC_PHONE_V3_2026_03_11'
const BUILD_SHA = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'local'

const MSG_CONFIRMACAO_OPTIN = `✅ Ótimo! Você está na nossa lista de novidades do EncantaKids.

Você vai receber lançamentos de novos personagens e ofertas especiais por aqui. 🎉

Se quiser sair a qualquer momento, é só responder *SAIR*.`

const MSG_CONFIRMACAO_OPTOUT = `Tudo bem! 😊 Você foi removido da nossa lista de novidades.

Se mudar de ideia, é só nos chamar aqui. Até mais! 👋`

const MSG_CONFIRMACAO_NAO = `Sem problemas! 😊 Não vamos te enviar novidades.

Se mudar de ideia futuramente, é só nos chamar. Tchau! 👋`


// ========================================
// Normalização de telefone (com sourcePath)
// ========================================
function extractPhone(payload) {
  const paths = [
    { key: 'data.key.remoteJid', value: payload?.data?.key?.remoteJid },
    { key: 'data.sender', value: payload?.data?.sender },
    { key: 'data.message.key.remoteJid', value: payload?.data?.message?.key?.remoteJid },
    { key: 'sender', value: payload?.sender },
    { key: 'data.remoteJid', value: payload?.data?.remoteJid },
  ]

  const found = paths.find(p => p.value)
  const raw = found?.value || ''
  const digits = raw.split('@')[0].replace(/\D/g, '')

  return { digits, sourcePath: found?.key || 'none' }
}


// ========================================
// Busca cliente via RPC do Supabase
// ========================================
async function findClientByPhone(digits) {
  console.log('🔎 Buscando cliente pelo telefone:', digits)

  const t0 = Date.now()
  const { data, error } = await supabase.rpc(
    'buscar_cliente_por_telefone',
    { p_telefone: digits }
  )
  const latencyMs = Date.now() - t0

  if (error) {
    console.error('❌ Erro ao buscar cliente:', error)
    console.log(`🔍 LOOKUP_RESULT | matched=false | digits=${digits} | latencyMs=${latencyMs} | error=${error.message}`)
    return null
  }

  if (!data || data.length === 0) {
    console.log(`🔍 LOOKUP_RESULT | matched=false | digits=${digits} | latencyMs=${latencyMs}`)
    return null
  }

  console.log(`🔍 LOOKUP_RESULT | matched=true | clienteId=${data[0].id} | nome=${data[0].nome} | digits=${digits} | latencyMs=${latencyMs}`)
  return data[0]
}


export async function webhookRoutes(fastify) {

  // ========================================
  // WEBHOOK PRINCIPAL
  // ========================================
  fastify.post('/webhook', async (request, reply) => {
    try {
      console.log(`🔥 PATCH ACTIVE | marker=${PATCH_MARKER} | sha=${BUILD_SHA}`)

      const payload = request.body

      console.log('📦 Payload recebido')

      const evento = payload?.event || payload?.type

      if (!evento?.includes('message') && !evento?.includes('upsert')) {
        console.log('⏭ Evento ignorado:', evento)
        return reply.code(200).send({ ok: true, ignorado: true })
      }

      const fromMe =
        payload?.data?.key?.fromMe ||
        payload?.key?.fromMe

      if (fromMe) {
        console.log('⏭ Ignorado: mensagem enviada por nós')
        return reply.code(200).send({ ok: true })
      }

      const { digits: telefone, sourcePath } = extractPhone(payload)
      const texto = extrairTexto(payload)

      console.log(`📥 Webhook recebido | ${telefone}: "${texto}" | source=${sourcePath}`)

      if (!telefone || !texto) {
        console.log('⚠️ Telefone ou texto não identificado')
        return reply.code(200).send({ ok: true })
      }


      // ========================================
      // Buscar cliente
      // ========================================
      const cliente = await findClientByPhone(telefone)

      console.log(
        `👤 Cliente encontrado: ${cliente?.nome || 'NÃO ENCONTRADO'}`
      )

      const intencao = interpretarResposta(texto)


      // ========================================
      // Log da mensagem recebida
      // O trigger trg_vincular_cliente preenche cliente_id automaticamente
      // O trigger trg_atualizar_optin atualiza optin_marketing no cliente
      // ========================================
      await supabase.from('mensagens_log').insert({
        cliente_id: cliente?.id || null,
        telefone_remetente: telefone,
        direcao: 'recebida',
        conteudo: texto,
        intencao_detectada: intencao
      })

      if (!cliente) {
        console.log(`⚠️ Cliente não encontrado para telefone: ${telefone}`)
        return reply.code(200).send({
          ok: true,
          cliente: null
        })
      }

      await processarIntencao(intencao, cliente, texto)

      return reply.code(200).send({
        ok: true,
        cliente_id: cliente.id
      })

    } catch (erro) {
      console.error('❌ Erro no webhook:', erro)
      return reply.code(200).send({
        ok: false,
        erro: erro.message
      })
    }
  })


  // ========================================
  // Endpoint de teste
  // ========================================
  fastify.get('/webhook', async () => {
    return {
      status: 'online',
      servico: 'EncantaKids WhatsApp Webhook',
      marker: PATCH_MARKER,
      buildSha: BUILD_SHA,
      timestamp: new Date().toISOString()
    }
  })
}


// ========================================
// Processamento de intenção
// Os UPDATEs em clientes são feitos pelo trigger trg_atualizar_optin
// Aqui só enviamos mensagens de confirmação e cancelamos fila quando necessário
// ========================================
async function processarIntencao(intencao, cliente, textoOriginal) {

  if (intencao === 'optin_sim') {
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
    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_NAO)

    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_NAO,
      intencao_detectada: 'confirmacao_nao'
    })

    console.log(`❌ Opt-in recusado: ${cliente.nome}`)
  }

  else if (intencao === 'sair') {
    // Cancelar mensagens pendentes na fila (trigger NÃO faz isso)
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
