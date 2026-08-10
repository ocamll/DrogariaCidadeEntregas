// PostgREST corta toda resposta num teto de linhas por request (o
// `max-rows` do projeto Supabase, que ninguém conferiu e que pode mudar
// no dashboard sem o código saber). Um `select` sem `range()` nem
// `limit()` volta truncado nesse teto SEM erro nenhum.
//
// A regra aqui é: nenhuma query do app depende desse número. Ou ela
// pagina até o fim (`buscarPaginado`), ou tem um teto escolhido por nós
// e sabe avisar quando bateu nele (`buscarComTeto`).

type Resposta<T> = { data: T[] | null; error: { message: string } | null }

// --- lista com teto nosso, que sabe dizer quando bateu nele -----------
//
// Truque do "+1": pede uma linha a mais do que vai mostrar. Se ela vier,
// é porque existe mais coisa lá atrás — dá pra avisar na tela em vez de
// mentir. Funciona sem saber o `max-rows` do servidor, contanto que o
// teto escolhido seja bem menor que ele (centenas contra o default de
// mil).
export type ListaComTeto<T> = { itens: T[]; temMais: boolean }

export async function buscarComTeto<T>(
  teto: number,
  consulta: (limite: number) => PromiseLike<Resposta<T>>
): Promise<ListaComTeto<T>> {
  const { data, error } = await consulta(teto + 1)
  if (error) throw error
  const linhas = data ?? []
  return { itens: linhas.slice(0, teto), temMais: linhas.length > teto }
}

// --- varredura completa, sem teto -------------------------------------
//
// Pagina por `range()` até a página vir vazia, avançando pelo tamanho do
// lote REALMENTE recebido (não pelo pedido) — por isso funciona igual se
// o teto do servidor for menor que TAMANHO_PAGINA, só gastando mais
// requests. Custa um request a mais no fim (o que volta vazio), em troca
// de nunca truncar em silêncio. Usado onde o resultado vira soma de
// dinheiro (relatório), onde truncar daria total errado.
const TAMANHO_PAGINA = 1000

// Trava de segurança: se algo do outro lado devolver sempre a mesma
// página, o loop para em vez de rodar pra sempre no navegador do caixa.
const MAX_PAGINAS = 100

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
