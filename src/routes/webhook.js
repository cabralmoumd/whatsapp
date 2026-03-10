// src/routes/webhook.js
// Recebe e processa todas as respostas dos clientes via Evolution API

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

  // Endpoint principal do webhook
  fastify.post('/webhook', async (request, reply) => {
    try {
      const payload = request.body

      // Filtra apenas eventos de mensagem recebida
      const evento = payload?.event || payload?.type
      if (!evento?.includes('message') && !evento?.includes('upsert')) {
        return reply.code(200).send({ ok: true, ignorado: true })
      }

      // Ignora mensagens enviadas pelo próprio sistema
      const fromMe = payload?.data?.key?.fromMe || payload?.key?.fromMe
      if (fromMe) {
        return reply.code(200).send({ ok: true, ignorado: 'fromMe' })
      }

      // Extrai telefone e texto
      const telefone = extrairTelefone(payload)
      const texto = extrairTexto(payload)

      if (!telefone || !texto) {
        return reply.code(200).send({ ok: true, ignorado: 'sem_telefone_ou_texto' })
      }

      console.log(`📥 Webhook recebido | ${telefone}: "${texto}"`)

      // Busca cliente no banco pelo telefone
      const telefoneLimpo = telefone.replace(/\D/g, '').replace(/^55/, '')
      const { data: cliente } = await supabase
        .from('clientes')
        .select('*')
        .or(`telefone.eq.${telefone},telefone.eq.${telefoneLimpo},telefone.eq.55${telefoneLimpo}`)
        .single()

      // Interpreta a intenção da resposta
      const intencao = interpretarResposta(texto)

      // Registra no log (mesmo se cliente não encontrado)
      await supabase.from('mensagens_log').insert({
        cliente_id: cliente?.id || null,
        direcao: 'recebida',
        conteudo: texto,
        intencao_detectada: intencao
      })

      // Se cliente não encontrado, apenas loga e responde 200
      if (!cliente) {
        console.log(`⚠️  Cliente não encontrado para telefone: ${telefone}`)
        return reply.code(200).send({ ok: true, intencao, cliente: 'nao_encontrado' })
      }

      // Processa a intenção
      await processarIntencao(intencao, cliente, texto)

      return reply.code(200).send({ ok: true, intencao, cliente_id: cliente.id })

    } catch (erro) {
      console.error('❌ Erro no webhook:', erro)
      // Sempre retorna 200 para a Evolution API não reenviar
      return reply.code(200).send({ ok: false, erro: erro.message })
    }
  })

  // Health check do webhook
  fastify.get('/webhook', async (request, reply) => {
    return reply.send({
      status: 'online',
      servico: 'EncantaKids WhatsApp Webhook',
      timestamp: new Date().toISOString()
    })
  })
}

// Processa cada tipo de intenção e toma a ação correta
async function processarIntencao(intencao, cliente, textoOriginal) {

  if (intencao === 'optin_sim') {
    // Confirma opt-in
    await supabase
      .from('clientes')
      .update({
        optin_marketing: true,
        data_optin: new Date().toISOString(),
        data_optout: null
      })
      .eq('id', cliente.id)

    // Envia confirmação
    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_OPTIN)

    // Registra confirmação no log
    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_OPTIN,
      intencao_detectada: 'confirmacao_optin'
    })

    console.log(`✅ Opt-in confirmado: ${cliente.nome}`)
  }

  else if (intencao === 'optin_nao') {
    // Recusa opt-in
    await supabase
      .from('clientes')
      .update({
        optin_marketing: false
      })
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
    // Opt-out — cancela tudo e envia confirmação
    await supabase
      .from('clientes')
      .update({
        optin_marketing: false,
        data_optout: new Date().toISOString()
      })
      .eq('id', cliente.id)

    // Cancela todos os envios pendentes deste cliente
    const { count } = await supabase
      .from('fila_envio')
      .update({ status: 'cancelado' })
      .eq('cliente_id', cliente.id)
      .eq('status', 'pendente')

    if (count > 0) {
      console.log(`🚫 ${count} mensagens canceladas na fila para ${cliente.nome}`)
    }

    await enviarMensagem(cliente.telefone, MSG_CONFIRMACAO_OPTOUT)

    await supabase.from('mensagens_log').insert({
      cliente_id: cliente.id,
      direcao: 'enviada',
      conteudo: MSG_CONFIRMACAO_OPTOUT,
      intencao_detectada: 'confirmacao_sair'
    })

    console.log(`🚪 Opt-out registrado: ${cliente.nome}`)
  }

  else {
    // Resposta não reconhecida — apenas loga
    console.log(`❓ Resposta não reconhecida de ${cliente.nome}: "${textoOriginal}"`)
  }
}
