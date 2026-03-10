// src/jobs/perfilAvancar.js
// Job que roda periodicamente e avança perfil de número automaticamente
// quando avancar_perfil_automatico = true e os dias foram atingidos

import { supabase } from '../lib/supabase.js'

export async function verificarAvancoPerfil() {
  console.log('🔄 Verificando avanço automático de perfis...')

  try {
    // Busca instâncias com avanço automático ativo
    const { data: instancias } = await supabase
      .from('instancias_whatsapp')
      .select(`
        *,
        perfis_numero (*)
      `)
      .eq('avancar_perfil_automatico', true)
      .eq('status', 'ativo')

    if (!instancias || instancias.length === 0) return

    // Ordem dos perfis
    const ORDEM_PERFIS = ['Número Novo', 'Aquecendo', 'Estabelecido', 'Veterano']

    for (const instancia of instancias) {
      const perfil = instancia.perfis_numero

      // Sem dias configurados = não avança
      if (!perfil.dias_para_proximo_perfil) continue

      const dataInicio = new Date(instancia.data_inicio_uso)
      const hoje = new Date()
      const diasUso = Math.floor((hoje - dataInicio) / (1000 * 60 * 60 * 24))

      if (diasUso < perfil.dias_para_proximo_perfil) continue

      // Determina próximo perfil
      const indexAtual = ORDEM_PERFIS.findIndex(n =>
        perfil.nome.toLowerCase().includes(n.toLowerCase().split(' ')[1] || n.toLowerCase())
      )

      if (indexAtual === -1 || indexAtual >= ORDEM_PERFIS.length - 1) continue

      const nomePróximo = ORDEM_PERFIS[indexAtual + 1]

      // Busca próximo perfil no banco
      const { data: proximoPerfil } = await supabase
        .from('perfis_numero')
        .select('id, nome')
        .ilike('nome', `%${nomePróximo.split(' ').pop()}%`)
        .single()

      if (!proximoPerfil) continue

      // Avança o perfil
      await supabase
        .from('instancias_whatsapp')
        .update({ perfil_id: proximoPerfil.id })
        .eq('id', instancia.id)

      console.log(`🚀 Instância "${instancia.nome}" avançou: ${perfil.nome} → ${proximoPerfil.nome}`)
    }

  } catch (erro) {
    console.error('Erro ao verificar avanço de perfil:', erro)
  }
}
