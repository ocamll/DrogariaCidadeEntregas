import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Loja = {
  id: string
  nome: string
  // tarifa de UM vale de tele nessa filial (R$ 9,00 = 900 hoje). Fica no
  // banco e não no código porque muda com o tempo e não deve exigir
  // deploy — ver migration 20260810180000.
  tarifaEntregaCents: number
  // cidade da filial: é ela que decide quais agências de tele podem
  // atender esta loja (ver useAgenciasDaCidade).
  cidadeId: string | null
}

// A farmácia real tem 17 filiais — o teto é folga, não expectativa. Mas
// query sem limite depende do `max-rows` do servidor, que ninguém
// escolheu; aqui o número é nosso e está à vista.
const LIMITE_LOJAS = 200

type LojaRow = {
  id: string
  nome: string
  tarifa_entrega_cents: number
  cidade_id: string | null
}

async function buscarLojas(): Promise<Loja[]> {
  const { data, error } = await supabase
    .from('lojas')
    .select('id, nome, tarifa_entrega_cents, cidade_id')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_LOJAS)

  if (error) throw error
  return (data as unknown as LojaRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    tarifaEntregaCents: row.tarifa_entrega_cents,
    cidadeId: row.cidade_id,
  }))
}

export function useLojas() {
  return useQuery({
    queryKey: ['lojas'],
    queryFn: buscarLojas,
    // Filial não muda durante o expediente (criar loja nem existe na UI),
    // e vários componentes chamam este hook — cadastro de transferência,
    // fechamento, histórico, auditoria. Sem staleTime, cada um deles
    // disparava um refetch ao montar.
    staleTime: 5 * 60_000,
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

// Cidade da filial — quem decide quais agências podem atendê-la.
export function useCidadeDaLoja(lojaId: string | null): string | null {
  const { data } = useLojas()
  if (!lojaId || !data) return null
  return data.find((loja) => loja.id === lojaId)?.cidadeId ?? null
}
