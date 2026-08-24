// Qual corrida NÃO deve ser oferecida para um Romaneio de Retorno novo.
//
// Mora em `lib/` e não importa nada — nem Dexie, nem o cliente Supabase.
// Mesma disciplina de `dependenciaDaFila.ts`: uma regra que decide o que
// aparece na tela tem que caber num teste sem navegador.
//
// ---------------------------------------------------------------------
// ISTO NÃO PROTEGE INTEGRIDADE. QUEM PROTEGE É O TRIGGER DA 2C.2.
//
// Se um `fechamento_corrida` legado chegar depois de um DCRR1 selado, o
// banco recusa a escrita, venha ela de onde vier. Esta função não é a
// última linha de defesa e não deve ser tratada como tal.
//
// O que ela evita é o CUSTO: sem ela, o caixa escolheria uma corrida que
// tem um fechamento antigo esperando na fila, colheria as duas
// assinaturas, e só então descobriria — se o fechamento drenasse
// primeiro — que o retorno virou conflito. É o mesmo princípio do
// `vales-para-saida`: não oferecer o impossível, porque descobrir custa
// duas assinaturas e um romaneio de conflito.
//
//     2C.2  servidor impede o dano
//     2C.3  a fila respeita a dependência
//     2C.7  a tela evita a operação sabidamente ruim
//
// ---------------------------------------------------------------------
// ELA SÓ OBSERVA. Não apaga item, não marca terminal, não mexe em
// `chave`, não chama sync, não "limpa" nada.
// ---------------------------------------------------------------------

export type ItemDeFilaObservado = {
  tipo: string
  status: string
  userId: string
  payload?: unknown
}

/**
 * O item ainda pode escrever nesta sessão?
 *
 * **"Não terminal" é a regra**, e ela cobre um caso que uma lista de
 * status "ativos" perderia: `bloqueado` NÃO é fim de linha. O laço de
 * `processarFilaOperacoes` **ressuscita** item bloqueado assim que o dono
 * dele entra —
 *
 *     if (item.status === 'bloqueado') update({ status: 'pendente' })
 *
 * — então, para o dono atual, `bloqueado` é tão retentável quanto
 * `pendente`. Só `terminal` é definitivo.
 */
function aindaPodeEscrever(item: ItemDeFilaObservado): boolean {
  return item.status !== 'terminal'
}

/**
 * O item vai rodar sob a sessão atual?
 *
 * **Espelha o gate de `processarFilaOperacoes`, e só ele:**
 *
 *     if (item.userId && item.userId !== usuario) → bloqueia
 *
 * Ou seja, `userId` vazio (item herdado da v2 do banco local, de antes de
 * existir dono) **roda sob qualquer sessão** — e por isso bloqueia.
 * Deixá-lo de fora seria oferecer uma corrida que um item sem dono vai
 * fechar na próxima rodada.
 *
 * `tenantId` e `lojaId` DELIBERADAMENTE não entram, e é uma decisão
 * contra a intuição:
 *
 *  - eles nunca são comparados pelo laço da fila, então incluí-los aqui
 *    só poderia SUB-bloquear — um item de perfil movido de filial rodaria
 *    e esta função não teria avisado;
 *  - e não há o que sobre-bloquear: a lista de corridas já vem escopada
 *    por filial pela RLS, então um item de outra filial não tem como
 *    apontar para uma corrida que está sendo oferecida aqui.
 *
 * A pergunta certa não é "de quem é este item", é **"ele vai rodar e
 * escrever nesta corrida?"**.
 */
function rodaNestaSessao(item: ItemDeFilaObservado, userId: string): boolean {
  return !item.userId || item.userId === userId
}

/**
 * Os ids de corrida com um `fechamento_corrida` legado ainda vivo na fila
 * local desta sessão.
 *
 * `romaneio_saida` **não** entra: ele também carrega `chave = corridaId`,
 * mas quem trata a ordem entre saída e retorno é o `dependeDeChave` da
 * 2C.3. Esta etapa é especificamente sobre o fechamento LEGADO, que é o
 * único que escreve desfecho por fora de um documento.
 */
export function corridasComFechamentoLegadoPendente(
  itens: readonly ItemDeFilaObservado[],
  userId: string
): Set<string> {
  const bloqueadas = new Set<string>()

  for (const item of itens) {
    if (item.tipo !== 'fechamento_corrida') continue
    if (!aindaPodeEscrever(item)) continue
    if (!rodaNestaSessao(item, userId)) continue

    const corridaId = (item.payload as { corridaId?: unknown } | undefined)?.corridaId
    if (typeof corridaId === 'string' && corridaId.length > 0) bloqueadas.add(corridaId)
  }

  return bloqueadas
}

/**
 * A lista que a tela pode oferecer.
 *
 * Devolve um array NOVO e não toca em nenhum objeto de entrada — nem das
 * corridas, nem da fila.
 */
export function filtrarCorridasRetornaveis<T extends { id: string }>(
  corridas: readonly T[],
  itens: readonly ItemDeFilaObservado[],
  userId: string
): T[] {
  const bloqueadas = corridasComFechamentoLegadoPendente(itens, userId)
  if (bloqueadas.size === 0) return [...corridas]
  return corridas.filter((c) => !bloqueadas.has(c.id))
}
