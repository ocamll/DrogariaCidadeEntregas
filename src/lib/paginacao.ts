// PostgREST corta toda resposta num teto de linhas por request (o
// `max-rows` do projeto Supabase). Um `select` sem `range()` volta
// truncado nesse teto SEM erro nenhum — o que é inofensivo numa lista
// que já tem limite explícito, mas é grave onde o resultado vira soma de
// dinheiro (relatório): os totais ficariam silenciosamente menores que a
// realidade, que é exatamente o tipo de erro que a regra 1 do CLAUDE.md
// existe pra impedir.
//
// Este helper pagina por `range()` até a página vir vazia. Ele avança
// pelo tamanho do lote REALMENTE recebido, não pelo tamanho pedido — por
// isso funciona igual se o teto do servidor for menor que TAMANHO_PAGINA
// (nesse caso só gasta mais requests). Custa um request a mais no fim
// (o que volta vazio), em troca de nunca truncar em silêncio.

const TAMANHO_PAGINA = 1000

// Trava de segurança: se algo do outro lado devolver sempre a mesma
// página, o loop para em vez de rodar pra sempre no navegador do caixa.
const MAX_PAGINAS = 100

type Resposta<T> = { data: T[] | null; error: { message: string } | null }

export async function buscarPaginado<T>(
  pagina: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<T[]> {
  const todas: T[] = []
  let de = 0

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { data, error } = await pagina(de, de + TAMANHO_PAGINA - 1)
    if (error) throw error

    const lote = data ?? []
    todas.push(...lote)
    if (lote.length === 0) return todas
    de += lote.length
  }

  throw new Error(
    `Busca paginada passou de ${MAX_PAGINAS} páginas — filtra um período menor.`
  )
}
