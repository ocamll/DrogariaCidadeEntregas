import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Loja = {
  id: string
  nome: string
}

async function buscarLojas(): Promise<Loja[]> {
  const { data, error } = await supabase
    .from('lojas')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')

  if (error) throw error
  return data as unknown as Loja[]
}

export function useLojas() {
  return useQuery({
    queryKey: ['lojas'],
    queryFn: buscarLojas,
  })
}
