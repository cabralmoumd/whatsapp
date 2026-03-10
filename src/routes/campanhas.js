// src/routes/campanhas.js
// Endpoints para criar e gerenciar campanhas

import { supabase } from '../lib/supabase.js'
import { processarFila, sortearVariacao, preencherTemplate } from '../services/queue.js'

export async function campanhaRoutes(fastify) {

  // Dispara campanha existente (popula fila_envio e inicia processamento)
  fastify.post('/campanhas/:id/disparar', async (request, reply) => {
    const { id } = request.params

    try {
      // Busca campanha
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

      // Verifica instância
      const instancia = campanha.instancias_whatsapp
      if (!instancia || instancia.status !== 'ativo') {
        return reply.code(400).send({ erro: 'Instância WhatsApp não está ativa' })
      }

      // Busca clientes elegíveis
      const clientes = await buscarClientesElegiveis(campanha)

      if (clientes.length === 0) {
        return reply.code(400).send({ erro: 'Nenhum cliente elegível encontrado para esta campanha' })
      }

      // Verifica se já tem itens na fila (retomada de campanha pausada)
      const { count: jaNaFila } = await supabase
        .from('fila_envio')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', id)
        .eq('status', 'pendente')

      let totalNaFila = jaNaFila || 0

      // Popula fila apenas com clientes que ainda não foram processados
      if (totalNaFila === 0) {
        console.log(`📋 Populando fila com ${clientes.length} clientes...`)
        totalNaFila = await popularFila(campanha, clientes)
      }

      // Atualiza campanha para "enviando"
      await supabase
        .from('campanhas')
        .update({
          status: 'enviando',
          total_destinatarios: clientes.length
        })
        .eq('id', id)

      // Inicia processamento em background (sem await)
      processarFila(id).then(async () => {
        // Verifica se campanha foi concluída
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
      }).catch(console.error)

      return reply.send({
        ok: true,
        mensagem: `Campanha "${campanha.nome}" iniciada`,
        total_destinatarios: clientes.length,
        na_fila: totalNaFila
      })

    } catch (erro) {
      console.error('Erro ao disparar campanha:', erro)
      return reply.code(500).send({ erro: erro.message })
    }
  })

  // Pausa campanha em andamento
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

    return reply.send({ ok: true, mensagem: 'Campanha cancelada e fila limpa' })
  })

  // Retorna progresso em tempo real da campanha
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

    const contagem = {
      pendente: 0, enviando: 0, enviado: 0, erro: 0, cancelado: 0
    }
    stats?.forEach(s => { contagem[s.status] = (contagem[s.status] || 0) + 1 })

    const pct = campanha?.total_destinatarios > 0
      ? Math.round((contagem.enviado / campanha.total_destinatarios) * 100)
      : 0

    return reply.send({
      campanha,
      fila: contagem,
      percentual_concluido: pct
    })
  })
}

// Busca clientes elegíveis conforme regras da campanha
async function buscarClientesElegiveis(campanha) {
  let query = supabase
    .from('clientes')
    .select('*')
    .eq('numero_valido', true)
    .eq('ativo', true)

  // Campanhas de opt-in: apenas quem ainda não respondeu
  if (campanha.tipo === 'optin') {
    query = query.is('optin_marketing', null)
  } else {
    // Qualquer outro tipo: apenas opt-in confirmado
    query = query.eq('optin_marketing', true)
  }

  // Filtro de país se configurado
  if (campanha.filtro_pais) {
    query = query.eq('pais', campanha.filtro_pais)
  }

  const { data: clientes } = await query
  return clientes || []
}

// Popula a fila de envio para todos os clientes elegíveis
async function popularFila(campanha, clientes) {
  const agora = new Date()
  const itens = []

  for (const cliente of clientes) {
    // Sorteia variação de mensagem
    const variacao = await sortearVariacao(campanha.tipo, cliente.id)
    if (!variacao) continue

    // Preenche template com dados do cliente
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

  // Insere em lotes de 100 para não sobrecarregar o Supabase
  const LOTE = 100
  for (let i = 0; i < itens.length; i += LOTE) {
    await supabase.from('fila_envio').insert(itens.slice(i, i + LOTE))
  }

  console.log(`✅ ${itens.length} itens inseridos na fila`)
  return itens.length
}
