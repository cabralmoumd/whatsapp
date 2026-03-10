// src/services/rateLimiter.js
// Controla os limites de envio por hora e por dia
// baseado no perfil de número ativo

import { supabase } from '../lib/supabase.js'

// Verifica se a instância pode enviar agora
// Retorna { pode: true } ou { pode: false, motivo: '...' }
export async function podeEnviar(instanciaId) {
  const { data: instancia, error } = await supabase
    .from('instancias_whatsapp')
    .select(`
      *,
      perfis_numero (*)
    `)
    .eq('id', instanciaId)
    .single()

  if (error || !instancia) {
    return { pode: false, motivo: 'Instância não encontrada' }
  }

  const perfil = instancia.perfis_numero

  // 1. Verifica status da instância
  if (instancia.status !== 'ativo') {
    return { pode: false, motivo: `Instância ${instancia.status}` }
  }

  // 2. Verifica janela de horário
  const agora = new Date()
  const horaAtual = agora.getHours() * 60 + agora.getMinutes() // minutos do dia

  const [hIni, mIni] = (perfil.horario_inicio || '09:00').split(':').map(Number)
  const [hFim, mFim] = (perfil.horario_fim || '20:00').split(':').map(Number)
  const inicioMin = hIni * 60 + mIni
  const fimMin = hFim * 60 + mFim

  if (horaAtual < inicioMin || horaAtual > fimMin) {
    const proximoEnvio = new Date()
    proximoEnvio.setHours(hIni, mIni, 0, 0)
    if (horaAtual > fimMin) proximoEnvio.setDate(proximoEnvio.getDate() + 1)
    return {
      pode: false,
      motivo: `Fora da janela horária (${perfil.horario_inicio}–${perfil.horario_fim})`,
      proximoEnvio
    }
  }

  // 3. Reseta contador diário se mudou o dia
  const hoje = new Date().toISOString().split('T')[0]
  if (instancia.ultimo_reset_dia !== hoje) {
    await supabase
      .from('instancias_whatsapp')
      .update({
        msgs_enviadas_hoje: 0,
        ultimo_reset_dia: hoje
      })
      .eq('id', instanciaId)
    instancia.msgs_enviadas_hoje = 0
  }

  // 4. Reseta contador de hora se passou mais de 1h
  const ultimaHora = new Date(instancia.ultima_hora_reset)
  const diffMs = agora - ultimaHora
  if (diffMs > 3600000) { // 1 hora em ms
    await supabase
      .from('instancias_whatsapp')
      .update({
        msgs_enviadas_hora_atual: 0,
        ultima_hora_reset: agora.toISOString()
      })
      .eq('id', instanciaId)
    instancia.msgs_enviadas_hora_atual = 0
  }

  // 5. Verifica limite diário
  if (instancia.msgs_enviadas_hoje >= perfil.max_por_dia) {
    return {
      pode: false,
      motivo: `Limite diário atingido (${perfil.max_por_dia} msgs/dia)`,
      retomadaAmanha: true
    }
  }

  // 6. Verifica limite por hora
  if (instancia.msgs_enviadas_hora_atual >= perfil.max_por_hora) {
    return {
      pode: false,
      motivo: `Limite por hora atingido (${perfil.max_por_hora} msgs/hora)`,
      aguardarMinutos: 60 - agora.getMinutes()
    }
  }

  return { pode: true, perfil, instancia }
}

// Incrementa contadores após envio bem-sucedido
export async function registrarEnvio(instanciaId) {
  await supabase.rpc('incrementar_contadores_envio', {
    p_instancia_id: instanciaId
  })
}

// Verifica se é hora de pausar para o intervalo entre lotes
export function precisaPausarLote(enviados, loteSize) {
  return enviados > 0 && enviados % loteSize === 0
}

// Calcula delay aleatório entre delay_min e delay_max do perfil (em ms)
export function calcularDelay(perfil) {
  const min = (perfil.delay_min_segundos || 12) * 1000
  const max = (perfil.delay_max_segundos || 22) * 1000
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Calcula pausa entre lotes (em ms)
export function calcularPausaLote(perfil) {
  const minutos = perfil.pausa_entre_lotes_minutos || 5
  // Adiciona variação de ±30s para não ser previsível
  const variacao = (Math.random() * 60 - 30) * 1000
  return (minutos * 60 * 1000) + variacao
}

// Aguarda X milissegundos
export function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
