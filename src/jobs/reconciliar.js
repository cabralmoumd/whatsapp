// src/jobs/reconciliar.js
// CORREÇÃO 3: Reconcilia campanhas presas em "enviando" após restart do Railway
// Roda a cada 10 minutos e verifica se campanhas concluídas foram marcadas corretamente

import { supabase } from '../lib/supabase.js'
import { processarFila } from '../services/queue.js'

export async function reconciliarCampanhas() {
  try {
    // Busca campanhas com status "enviando"
    const { data: campanhas } = await supabase
      .from('campanhas')
      .select('id, nome, total_destinatarios, total_enviados')
      .eq('status', 'enviando')

    if (!campanhas || campanhas.length === 0) return

    for (const campanha of campanhas) {
      // Conta pendentes reais na fila
      const { count: pendentes } = await supabase
        .from('fila_envio')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campanha.id)
        .eq('status', 'pendente')

      // Conta enviados reais na fila
      const { count: enviados } = await supabase
        .from('fila_envio')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campanha.id)
        .eq('status', 'enviado')

      // Corrige total_enviados se estiver desatualizado
      if (enviados !== campanha.total_enviados) {
        await supabase
          .from('campanhas')
          .update({ total_enviados: enviados })
          .eq('id', campanha.id)
        console.log(`🔧 Reconciliado total_enviados da campanha "${campanha.nome}": ${enviados}`)
      }

      if (pendentes === 0) {
        // Sem pendentes = campanha concluída (Railway reiniciou durante envio)
        await supabase
          .from('campanhas')
          .update({ status: 'concluida' })
          .eq('id', campanha.id)
        console.log(`✅ Campanha "${campanha.nome}" marcada como concluída pela reconciliação`)

      } else {
        // Tem pendentes mas não está processando = Railway reiniciou no meio
        // Retoma o processamento automaticamente
        console.log(`🔄 Retomando campanha "${campanha.nome}" — ${pendentes} msgs pendentes`)
        processarFila(campanha.id).catch(console.error)
      }
    }

  } catch (erro) {
    console.error('❌ Erro na reconciliação:', erro.message)
  }
}
