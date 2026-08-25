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

// =====================================================================
// `[object Object]` — o erro que apaga o erro
//
// O padrão `e instanceof Error ? e.message : String(e)` está espalhado
// pelo app e funciona pra tudo, MENOS pra o que mais aparece aqui: o
// erro do PostgREST. Ele é um objeto simples (`{ message, details, hint,
// code }`), não uma instância de `Error` — então cai no `String(e)` e
// vira literalmente **"[object Object]"**.
//
// Isso apareceu em uso real em 2026-08-25, na tela do retorno: a RPC do
// contexto falhou e a tela disse "Não consegui carregar: [object
// Object]". O defeito não é a RPC ter falhado — é a tela ter destruído a
// única informação que diria por quê, e o custo é uma sessão inteira de
// adivinhação.
//
// O `code` entra na mensagem de propósito, e não é ruído: é ele que
// distingue "a função não existe no cache do PostgREST" (`PGRST202`, que
// se resolve recarregando o schema) de "a RLS recusou" ou de um SQLSTATE
// do Postgres. Sem ele, os três se parecem.
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error && erro.message) return erro.message

  if (typeof erro === 'object' && erro !== null) {
    const e = erro as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const partes = [e.message, e.details, e.hint]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (partes.length > 0) {
      const codigo = typeof e.code === 'string' && e.code ? ` (${e.code})` : ''
      return partes.join(' — ') + codigo
    }
    // Sem nenhum campo conhecido, o JSON ainda diz mais que
    // "[object Object]" — que é o piso que esta função existe pra tirar.
    try {
      const json = JSON.stringify(erro)
      if (json && json !== '{}') return json
    } catch {
      // objeto circular: cai no genérico abaixo
    }
  }

  const texto = String(erro)
  return texto === '[object Object]' ? 'erro sem mensagem (veja o console)' : texto
}
