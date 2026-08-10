import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Loja = {
  id: string
  nome: string
}

// A farmácia real tem 17 filiais — o teto é folga, não expectativa. Mas
// query sem limite depende do `max-rows` do servidor, que ninguém
// escolheu; aqui o número é nosso e está à vista.
const LIMITE_LOJAS = 200

async function buscarLojas(): Promise<Loja[]> {
  const { data, error } = await supabase
    .from('lojas')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_LOJAS)

  if (error) throw error
  return data as unknown as Loja[]
}

export function useLojas() {
  return useQuery({
    queryKey: ['lojas'],
    queryFn: buscarLojas,
  })
}
