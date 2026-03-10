// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('❌ ERRO: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios')
  console.error('Configure as variáveis de ambiente no Railway: Settings > Variables')
  process.exit(1)
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false }
})

console.log('✅ Supabase conectado:', url.split('.')[0].replace('https://', ''))
