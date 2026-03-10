// src/lib/evolution.js
import axios from 'axios'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'encantakids'

// Cria cliente axios — tolerante à ausência de variáveis no boot
const getApi = () => {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    throw new Error('EVOLUTION_API_URL e EVOLUTION_API_KEY não configurados. Verifique as variáveis de ambiente no Railway.')
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

// Formata telefone para o padrão Evolution API: 5511999999999
export function formatarTelefone(telefone) {
  let numero = telefone.replace(/\D/g, '')
  if (!numero.startsWith('55')) {
    numero = '55' + numero
  }
  return numero
}
