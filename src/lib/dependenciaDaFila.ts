// Quando um item da fila offline tem que esperar outro.
//
// Mora em `lib/` e **não importa nada** — nem Dexie, nem o cliente
// Supabase. É a mesma disciplina de `canonico.ts`, `tokenCartao.ts` e
// `caminhosNoDrive.ts`, e existe pelo mesmo motivo: uma regra que decide
// se uma operação roda tem que caber num teste sem rede e sem navegador.
//
// Ela vivia dentro do laço de `processarFilaOperacoes`, em uma linha, e
// era intestável ali — medir o comportamento exigiria semear a fila de
// verdade e deixar `processarFilaOperacoes` rodar, ou seja, mandar
// operações reais pro servidor só pra observar qual delas foi pulada.
//
// ---------------------------------------------------------------------
// A ARMADILHA QUE ESTA FUNÇÃO FECHA
//
// A versão anterior era:
//
//     todos.some((outro) => outro.chave === item.dependeDeChave)
//
// e ela **não excluía o próprio item**. Uma operação que declarasse
// `chave` e `dependeDeChave` com o MESMO valor dependeria de si mesma e
// nunca rodaria: ficaria `pendente`, com `tentativas` em 0, sem mensagem
// nenhuma, para sempre.
//
// Esse sintoma exato — item parado, sem erro escrito nele, que o botão
// "Tentar agora" nem alcançava — já custou uma sessão inteira ao projeto
// (§50.4). Hoje nenhum tipo de fila declara as duas com o mesmo valor, e
// `romaneio_retorno` nasce declarando só `dependeDeChave` justamente por
// isto. O `outro.id !== item.id` existe pra a armadilha não ficar armada
// esperando o próximo tipo.
// ---------------------------------------------------------------------

export type ItemComDependencia = {
  /** Chave da FILA, própria e sem significado de negócio. */
  id: string
  /** Identificador de negócio, pra outro item poder depender deste. */
  chave?: string
  /** Este item só roda quando nada com esta chave estiver mais na fila. */
  dependeDeChave?: string
}

/**
 * `true` enquanto existir OUTRO item na fila carregando a chave de que
 * este depende.
 *
 * Repare no OUTRO: um item nunca bloqueia a si mesmo, mesmo declarando
 * `chave` e `dependeDeChave` iguais.
 */
export function bloqueadoPorDependencia<T extends ItemComDependencia>(
  item: T,
  todos: readonly T[]
): boolean {
  if (!item.dependeDeChave) return false

  return todos.some(
    (outro) => outro.id !== item.id && outro.chave === item.dependeDeChave
  )
}
