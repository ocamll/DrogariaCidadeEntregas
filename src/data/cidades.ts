import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Cidade é o que amarra filial e agência: em cada cidade uma agência de
// tele atende todas as filiais dali, e uma agência de outra cidade não
// pode aparecer pra elas. Ver "Cidade, filial e agência" no CLAUDE.md.
//
// Criar cidade é manual via SQL, como loja — é ainda mais raro que abrir
// filial, e a UI não tem (nem deveria ter) essa tela.

export type Cidade = {
  id: string
  nome: string
  uf: string
}

// A farmácia opera numa região, não no país inteiro; o teto é folga, e
// existe só pra nenhuma query depender do `max-rows` do servidor.
const LIMITE_CIDADES = 200

type CidadeRow = { id: string; nome: string; uf: string }

async function buscarCidades(): Promise<Cidade[]> {
  const { data, error } = await supabase
    .from('cidades')
    .select('id, nome, uf')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_CIDADES)

  if (error) throw error
  return (data as unknown as CidadeRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    uf: row.uf,
  }))
}

export function useCidades() {
  return useQuery({
    queryKey: ['cidades'],
    queryFn: buscarCidades,
    // muda com a mesma frequência de lojas (quase nunca) — ver useLojas
    staleTime: 5 * 60_000,
  })
}

export function rotuloCidade(cidade: Cidade | undefined): string {
  return cidade ? `${cidade.nome}/${cidade.uf}` : '—'
}
