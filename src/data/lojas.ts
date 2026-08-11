import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Loja = {
  id: string
  nome: string
  // tarifa de UM vale de tele nessa filial (R$ 9,00 = 900 hoje). Fica no
  // banco e não no código porque muda com o tempo e não deve exigir
  // deploy — ver migration 20260810180000.
  tarifaEntregaCents: number
}

// A farmácia real tem 17 filiais — o teto é folga, não expectativa. Mas
// query sem limite depende do `max-rows` do servidor, que ninguém
// escolheu; aqui o número é nosso e está à vista.
const LIMITE_LOJAS = 200

type LojaRow = { id: string; nome: string; tarifa_entrega_cents: number }

async function buscarLojas(): Promise<Loja[]> {
  const { data, error } = await supabase
    .from('lojas')
    .select('id, nome, tarifa_entrega_cents')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_LOJAS)

  if (error) throw error
  return (data as unknown as LojaRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    tarifaEntregaCents: row.tarifa_entrega_cents,
  }))
}

export function useLojas() {
  return useQuery({
    queryKey: ['lojas'],
    queryFn: buscarLojas,
  })
}

// A tela de cadastro precisa da tarifa da própria filial pra montar o
// valor a partir da quantidade de vales. Deriva de useLojas pra não
// abrir uma segunda query só por isso.
export function useTarifaDaLoja(lojaId: string | null): number | null {
  const { data } = useLojas()
  if (!lojaId || !data) return null
  return data.find((loja) => loja.id === lojaId)?.tarifaEntregaCents ?? null
}
