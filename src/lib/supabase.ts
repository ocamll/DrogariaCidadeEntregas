import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidas. Veja .env.example.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// pagamentos e assinaturas não têm policy de UPDATE (de propósito — impedir
// alteração de registro já gravado), então reenvio idempotente da fila
// offline não pode usar upsert nessas tabelas. Em vez disso: insert com id
// determinístico, e trata "já existe" (23505) como sucesso, não erro.
export function isDuplicateKeyError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}
