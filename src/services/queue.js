// src/services/queue.js
// Motor principal da fila de envio
// Processa mensagens pendentes respeitando todos os limites

import { supabase } from '../lib/supabase.js'
import { enviarMensagem } from '../lib/evolution.js'
import {
  podeEnviar,
  registrarEnvio,
  precisaPausarLote,
  calcularDelay,
  calcularPausaLote,
  aguardar
} from './rateLimiter.js'

let processandoFila = false

// Processa a fila de uma campanha específica ou todas pendentes
export async function processarFila(campanhaId = null) {
  if (processandoFila) {
    console.log('⚠️  Fila já está sendo processada. Ignorando novo trigger.')
    return
  }

  processandoFila = true
  console.log('🚀 Iniciando processamento da fila...')

  try {
    let enviados = 0

    // Loop principal — continua enquanto houver mensagens pendentes
    while (true) {
      // Busca próximo item pendente da fila
      let query = supabase
        .from('fila_envio')
        .select(`
          *,
          clientes (id, nome, telefone, nome_crianca, numero_valido, optin_marketing),
          campanhas (id, nome, tipo, status, instancia_id),
          instancias_whatsapp (id, status, perfil_id)
        `)
        .eq('status', 'pendente')
        .lte('agendado_para', new Date().toISOString())
        .order('agendado_para', { ascending: true })
        .limit(1)

      if (campanhaId) {
        query = query.eq('campanha_id', campanhaId)
      }

      const { data: itens } = await query

      if (!itens || itens.length === 0) {
        console.log('✅ Fila vazia. Processamento concluído.')
        break
      }

      const item = itens[0]
      const cliente = item.clientes
      const campanha = item.campanhas
      const instancia = item.instancias_whatsapp

      // Verifica se campanha ainda está ativa
      if (campanha.status === 'pausada' || campanha.status === 'cancelada') {
        console.log(`⏸️  Campanha "${campanha.nome}" ${campanha.status}. Parando.`)
        break
      }

      // Verifica se instância pode enviar agora
      const verificacao = await podeEnviar(instancia.id)
      if (!verificacao.pode) {
        console.log(`🚫 Não pode enviar: ${verificacao.motivo}`)

        if (verificacao.retomadaAmanha) {
          console.log('🌙 Limite diário. Retomando amanhã.')
          break
        }

        if (verificacao.aguardarMinutos) {
          const espera = verificacao.aguardarMinutos * 60 * 1000
          console.log(`⏳ Limite/hora. Aguardando ${verificacao.aguardarMinutos} minutos...`)
          await aguardar(espera)
          continue
        }

        if (verificacao.proximoEnvio) {
          console.log(`🕐 Fora do horário. Agendando para ${verificacao.proximoEnvio}`)
          // Reagenda todos os pendentes para o próximo horário válido
          await supabase
            .from('fila_envio')
            .update({ agendado_para: verificacao.proximoEnvio.toISOString() })
            .eq('campanha_id', campanha.id)
            .eq('status', 'pendente')
          break
        }

        break
      }

      const perfil = verificacao.perfil

      // Valida número do cliente
      if (!cliente.numero_valido) {
        await marcarErro(item.id, 'Número marcado como inválido', cliente.id)
        continue
      }

      // Para campanhas de novidades: valida opt-in
      if (campanha.tipo !== 'optin' && cliente.optin_marketing !== true) {
        await supabase
          .from('fila_envio')
          .update({ status: 'cancelado' })
          .eq('id', item.id)
        console.log(`⛔ Cliente ${cliente.nome} sem opt-in. Cancelando item.`)
        continue
      }

      // Marca item como "enviando"
      await supabase
        .from('fila_envio')
        .update({ status: 'enviando' })
        .eq('id', item.id)

      // Tenta enviar a mensagem
      try {
        await enviarMensagem(cliente.telefone, item.conteudo, item.formato_envio || 'texto')

        // Sucesso — marca como enviado
        await supabase
          .from('fila_envio')
          .update({
            status: 'enviado',
            enviado_em: new Date().toISOString()
          })
          .eq('id', item.id)

        // Registra no log
        await supabase.from('mensagens_log').insert({
          cliente_id: cliente.id,
          campanha_id: campanha.id,
          instancia_id: instancia.id,
          direcao: 'enviada',
          conteudo: item.conteudo,
          versao_msg: item.versao_msg,
          status_whatsapp: 'sent'
        })

        // Incrementa contadores da instância
        await registrarEnvio(instancia.id)

        // Atualiza progresso da campanha
        await supabase.rpc('incrementar_enviados_campanha', {
          p_campanha_id: campanha.id
        })

        enviados++
        console.log(`📤 [${enviados}] Enviado para ${cliente.nome} (${cliente.telefone}) — Versão ${item.versao_msg}`)

        // Pausa longa entre lotes
        if (precisaPausarLote(enviados, perfil.lote_size)) {
          const pausaMs = calcularPausaLote(perfil)
          const pausaMin = Math.round(pausaMs / 60000)
          console.log(`⏸️  Lote de ${perfil.lote_size} completo. Pausa de ${pausaMin} minutos...`)
          await aguardar(pausaMs)
        } else {
          // Delay normal entre mensagens
          const delayMs = calcularDelay(perfil)
          await aguardar(delayMs)
        }

      } catch (erroEnvio) {
        console.error(`❌ Erro ao enviar para ${cliente.nome}:`, erroEnvio.message)
        await marcarErro(item.id, erroEnvio.message, cliente.id, item.tentativas)
        await aguardar(5000) // 5s de respiro após erro
      }
    }

    console.log(`🏁 Processamento finalizado. Total enviado nesta sessão: ${enviados}`)

  } finally {
    processandoFila = false
  }
}

// Marca item como erro e incrementa tentativas
async function marcarErro(itemId, mensagemErro, clienteId, tentativasAtuais = 0) {
  const novasTentativas = tentativasAtuais + 1
  const statusFinal = novasTentativas >= 3 ? 'erro' : 'pendente'
  const reagendadoPara = novasTentativas < 3
    ? new Date(Date.now() + 30 * 60 * 1000).toISOString() // +30 min
    : null

  await supabase
    .from('fila_envio')
    .update({
      status: statusFinal,
      tentativas: novasTentativas,
      erro_msg: mensagemErro,
      ...(reagendadoPara && { agendado_para: reagendadoPara })
    })
    .eq('id', itemId)

  // Após 3 erros: marca número como inválido
  if (novasTentativas >= 3) {
    await supabase
      .from('clientes')
      .update({
        numero_valido: false,
        ultimo_erro_envio: mensagemErro,
        tentativas_envio: novasTentativas
      })
      .eq('id', clienteId)
    console.log(`⛔ Número marcado como inválido após 3 erros.`)
  }
}

// Sorteia variação de mensagem para um cliente
export async function sortearVariacao(tipo, clienteId) {
  // Busca variações ativas
  const { data: variacoes } = await supabase
    .from('variacoes_mensagem')
    .select('*')
    .eq('tipo', tipo)
    .eq('ativo', true)

  if (!variacoes || variacoes.length === 0) return null

  // Busca última versão enviada para este cliente
  const { data: ultimaMsg } = await supabase
    .from('mensagens_log')
    .select('versao_msg')
    .eq('cliente_id', clienteId)
    .not('versao_msg', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .single()

  const ultimaVersao = ultimaMsg?.versao_msg

  // Filtra para não repetir a última versão
  const opcoes = ultimaVersao
    ? variacoes.filter(v => v.versao !== ultimaVersao)
    : variacoes

  // Se só tem 1 opção (ou todas filtradas), usa qualquer uma
  const pool = opcoes.length > 0 ? opcoes : variacoes

  // Sorteia aleatoriamente
  return pool[Math.floor(Math.random() * pool.length)]
}

// Substitui variáveis no template da mensagem
export function preencherTemplate(template, cliente) {
  const primeiroNome = (nome) => nome?.split(' ')[0] || nome || ''

  let texto = template
    .replace(/{nome}/g, primeiroNome(cliente.nome))
    .replace(/{nome_crianca}/g, primeiroNome(cliente.nome_crianca))

  // Remove frases que ainda tenham variáveis não preenchidas
  texto = texto.replace(/[^.!?]*\{[^}]+\}[^.!?]*/g, '').trim()

  return texto
}
