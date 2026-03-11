// src/lib/evolution.js
import axios from 'axios'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'encantakids'

const getApi = () => {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    throw new Error('EVOLUTION_API_URL e EVOLUTION_API_KEY não configurados.')
  }
  return axios.create({
    baseURL: EVOLUTION_URL,
    headers: {
      'apikey': EVOLUTION_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  })
}

// Envia mensagem de texto simples
export async function enviarMensagem(telefone, texto) {
  const api = getApi()
  const numero = formatarTelefone(telefone)
  console.log(`📤 Enviando para: ${numero}`)
  const response = await api.post(`/message/sendText/${INSTANCE}`, {
    number: numero,
    text: texto
  })
  return response.data
}

// Verifica se o número existe no WhatsApp
export async function verificarNumero(telefone) {
  try {
    const api = getApi()
    const numero = formatarTelefone(telefone)
    const response = await api.post(`/chat/whatsappNumbers/${INSTANCE}`, {
      numbers: [numero]
    })
    return response.data?.[0]?.exists === true
  } catch {
    return false
  }
}

// ─── FORMATAÇÃO DE TELEFONE ──────────────────────────────────────────────────
// A Evolution API aceita o número COM o + na frente
// Exemplos de entrada aceitos:
//   +5511999999999   → já está correto
//   5511999999999    → adiciona o +
//   11999999999      → adiciona +55
//   (11) 99999-9999  → limpa e adiciona +55
//   +55 (11) 9 9999-9999 → limpa e mantém o +55
// Saída sempre: +5511999999999
export function formatarTelefone(telefone) {
  if (!telefone) throw new Error('Telefone não informado')

  // Remove tudo exceto números e o + inicial
  const temPlus = String(telefone).trim().startsWith('+')
  let numero = String(telefone).replace(/\D/g, '')

  // Remove zeros à esquerda espúrios
  numero = numero.replace(/^0+/, '')

  // Se já tem DDI 55 (com ou sem +)
  if (numero.startsWith('55') && numero.length >= 12) {
    return '+' + numero
  }

  // Se veio com + mas sem o 55 (ex: +11999999999 — raro mas possível)
  if (temPlus && !numero.startsWith('55')) {
    return '+55' + numero
  }

  // Número só com DDD + número (ex: 11999999999)
  return '+55' + numero
}

// Extrai só os dígitos do telefone (útil para buscar no banco)
// Ex: +5511999999999 → 5511999999999
export function telefoneParaBusca(telefone) {
  return String(telefone).replace(/\D/g, '')
}
