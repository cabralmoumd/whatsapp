// src/routes/campanhas.js
// Endpoints para criar e gerenciar campanhas
// CORREÇÃO 3: Proteção contra disparo duplicado via lock no Supabase

import { supabase } from '../lib/supabase.js'
import { processarFila, sortearVariacao, preencherTemplate } from '../services/queue.js'

// Lock em memória — evita duplo disparo simultâneo
const campanhasEmProcessamento = new Set()

export async function campanhaRoutes(fastify) {

  // Dispara campanha existente
  fastify.post('/campanhas/:id/disparar', async (request, reply) => {
    const { id } = request.params

    // CORREÇÃO 3: Bloqueia duplo disparo
    if (campanhasEmProcessamento.has(id)) {
      return reply.code(409).send({ erro: 'Campanha já está sendo processada. Aguarde.' })
    }

    try {
      campanhasEmProcessamento.add(id)

      const { data: campanha, error } = await supabase
        .from('campanhas')
        .select('*, instancias_whatsapp(*)')
        .eq('id', id)
        .single()

      if (error || !campanha) {
        return reply.code(404).send({ erro: 'Campanha não encontrada' })
      }

      if (!['rascunho', 'agendada', 'pausada'].includes(campanha.status)) {
        return reply.code(400).send({ erro: `Campanha não pode ser disparada (status: ${campanha.status})` })
      }

      const instancia = campanha.instancias_whatsapp
      if (!instancia || instancia.status !== 'ativo') {
        return reply.code(400).send({ erro: 'Instância WhatsApp não está ativa' })
      }

      const clientes = await buscarClientesElegiveis(campanha)

      if (clientes.length === 0) {
        return reply.code(400).send({ erro: 'Nenhum cliente elegível encontrado' })
      }

      // Verifica se já tem fila (retomada de campanha pausada)
      const { count: jaNaFila } = await supabase
        .from('fila_envio')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', id)
        .eq('status', 'pendente')

      let totalNaFila = jaNaFila || 0

      if (totalNaFila === 0) {
        console.log(`📋 Populando fila: ${clientes.length} clientes...`)
        totalNaFila = await popularFila(campanha, clientes)
      }

      await supabase
        .from('campanhas')
        .update({
          status: 'enviando',
          total_destinatarios: clientes.length
        })
        .eq('id', id)

      // Inicia em background
      processarFila(id).then(async () => {
        const { count: pendentes } = await supabase
          .from('fila_envio')
          .select('id', { count: 'exact', head: true })
          .eq('campanha_id', id)
          .eq('status', 'pendente')

        if (pendentes === 0) {
          await supabase
            .from('campanhas')
            .update({ status: 'concluida' })
            .eq('id', id)
          console.log(`🎉 Campanha "${campanha.nome}" concluída!`)
        }
      }).catch(console.error).finally(() => {
        campanhasEmProcessamento.delete(id)
      })

      return reply.send({
        ok: true,
        mensagem: `Campanha "${campanha.nome}" iniciada`,
        total_destinatarios: clientes.length,
        na_fila: totalNaFila
      })

    } catch (erro) {
      campanhasEmProcessamento.delete(id)
      console.error('Erro ao disparar campanha:', erro)
      return reply.code(500).send({ erro: erro.message })
    }
  })

  // Pausa campanha
  fastify.post('/campanhas/:id/pausar', async (request, reply) => {
    const { id } = request.params
    await supabase
      .from('campanhas')
      .update({ status: 'pausada' })
      .eq('id', id)
    return reply.send({ ok: true, mensagem: 'Campanha pausada' })
  })

  // Cancela campanha e limpa fila
  fastify.post('/campanhas/:id/cancelar', async (request, reply) => {
    const { id } = request.params
    await supabase
      .from('campanhas')
      .update({ status: 'cancelada' })
      .eq('id', id)
    await supabase
      .from('fila_envio')
      .update({ status: 'cancelado' })
      .eq('campanha_id', id)
      .eq('status', 'pendente')
    campanhasEmProcessamento.delete(id)
    return reply.send({ ok: true, mensagem: 'Campanha cancelada' })
  })

  // Progresso em tempo real
  fastify.get('/campanhas/:id/progresso', async (request, reply) => {
    const { id } = request.params

    const { data: campanha } = await supabase
      .from('campanhas')
      .select('*')
      .eq('id', id)
      .single()

    const { data: stats } = await supabase
      .from('fila_envio')
      .select('status')
      .eq('campanha_id', id)

    const contagem = { pendente: 0, enviando: 0, enviado: 0, erro: 0, cancelado: 0 }
    stats?.forEach(s => { contagem[s.status] = (contagem[s.status] || 0) + 1 })

    const pct = campanha?.total_destinatarios > 0
      ? Math.round((contagem.enviado / campanha.total_destinatarios) * 100)
      : 0

    return reply.send({
      campanha,
      fila: contagem,
      percentual_concluido: pct,
      em_processamento: campanhasEmProcessamento.has(id)
    })
  })
}

async function buscarClientesElegiveis(campanha) {
  let query = supabase
    .from('clientes')
    .select('*')
    .eq('numero_valido', true)
    .eq('ativo', true)

  if (campanha.tipo === 'optin') {
    query = query.is('optin_marketing', null)
  } else {
    query = query.eq('optin_marketing', true)
  }

  if (campanha.filtro_pais) {
    query = query.eq('pais', campanha.filtro_pais)
  }

  const { data } = await query
  return data || []
}

async function popularFila(campanha, clientes) {
  const agora = new Date()
  const itens = []

  for (const cliente of clientes) {
    const variacao = await sortearVariacao(campanha.tipo, cliente.id)
    if (!variacao) continue

    const conteudo = preencherTemplate(variacao.conteudo, cliente)

    itens.push({
      campanha_id: campanha.id,
      cliente_id: cliente.id,
      instancia_id: campanha.instancia_id,
      conteudo,
      versao_msg: variacao.versao,
      status: 'pendente',
      tentativas: 0,
      max_tentativas: 3,
      agendado_para: agora.toISOString()
    })
  }

  const LOTE = 100
  for (let i = 0; i < itens.length; i += LOTE) {
    await supabase.from('fila_envio').insert(itens.slice(i, i + LOTE))
  }

  console.log(`✅ ${itens.length} itens na fila`)
  return itens.length
}
