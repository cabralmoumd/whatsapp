// src/services/parser.js
// Interpreta a resposta do cliente e retorna a intenção

const INTENCOES = {
  optin_sim: [
    'sim', 's', 'yes', 'y', 'quero', 'pode', 'claro', 'ok',
    'okay', 'top', 'manda', 'mande', 'quero sim', 'com certeza',
    'claro que sim', 'pode mandar', '1', 'aceito', 'concordo'
  ],
  optin_nao: [
    'nao', 'não', 'no', 'n', 'nope', 'nao quero', 'não quero',
    'nao obrigado', 'não obrigado', 'obrigado nao', '2', 'negativo'
  ],
  sair: [
    'sair', 'parar', 'stop', 'cancelar', 'remover', 'descadastrar',
    'nao quero mais', 'não quero mais', 'para', 'chega', 'cancela',
    'me remove', 'me tire', 'bloquear', 'sai', 'desinscrever'
  ]
}

export function interpretarResposta(texto) {
  if (!texto || typeof texto !== 'string') return 'outro'

  const normalizado = texto
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')

  for (const [intencao, palavras] of Object.entries(INTENCOES)) {
    for (const palavra of palavras) {
      const palavraNorm = palavra
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
      if (normalizado === palavraNorm || normalizado.startsWith(palavraNorm + ' ')) {
        return intencao
      }
    }
  }

  return 'outro'
}

// Extrai telefone do payload da Evolution API
// A Evolution API envia no formato: 5511999999999@s.whatsapp.net (sem o +)
// Retornamos com o + para manter consistência com o banco
export function extrairTelefone(payload) {
  try {
    const jid = payload?.data?.key?.remoteJid
      || payload?.key?.remoteJid
      || ''

    // Ignora grupos
    if (jid.includes('@g.us')) return null

    // Remove o sufixo @s.whatsapp.net
    const numero = jid
      .replace('@s.whatsapp.net', '')
      .replace('@c.us', '')
      .replace(/\D/g, '')

    if (!numero) return null

    // Retorna com + para bater com o formato do banco
    return '+' + numero
  } catch {
    return null
  }
}

export function extrairTexto(payload) {
  try {
    const msg = payload?.data?.message || payload?.message || {}
    return (
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.buttonsResponseMessage?.selectedDisplayText ||
      msg.listResponseMessage?.title ||
      ''
    ).trim()
  } catch {
    return ''
  }
}
