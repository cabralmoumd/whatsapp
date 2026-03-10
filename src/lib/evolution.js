// src/lib/evolution.js
// Cliente para a Evolution API

import axios from 'axios'

const api = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: {
    'apikey': process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 15000
})

const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'encantakids'

// Envia mensagem de texto simples
export async function enviarMensagem(telefone, texto) {
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
    const numero = formatarTelefone(telefone)
    const response = await api.post(`/chat/whatsappNumbers/${INSTANCE}`, {
      numbers: [numero]
    })
    const resultado = response.data?.[0]
    return resultado?.exists === true
  } catch {
    return false
  }
}

// Formata telefone para o padrão da Evolution API
// Ex: (11) 99999-9999 → 5511999999999
function formatarTelefone(telefone) {
  let numero = telefone.replace(/\D/g, '')

  // Adiciona DDI 55 se não tiver
  if (!numero.startsWith('55')) {
    numero = '55' + numero
  }

  return numero
}

export { formatarTelefone }
