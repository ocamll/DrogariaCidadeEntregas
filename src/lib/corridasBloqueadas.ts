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
 * O QUE SAIU DAQUI EM 2026-08-25.
 *
 * `rodaNestaSessao` e `corridasComFechamentoLegadoPendente` — a metade
 * da 2C.7 que escondia corrida com `fechamento_corrida` legado na fila.
 * O tipo não existe mais (ver `TipoOperacaoFila`), então a função não
 * tinha mais o que encontrar.
 *
 * **O que sobrou é a metade que importa daqui pra frente**, e ela nunca
 * foi sobre compatibilidade: uma corrida com Romaneio de Retorno
 * pendente na fila não pode ser oferecida de novo, porque
 * `UNIQUE (corrida_id, tipo)` garante que só um dos dois documentos
 * pode ser selado — e o outro custa duas assinaturas pra virar
 * conflito.
 *
 * Com a outra metade foi junto o gate por dono, e vale registrar por
 * quê: ele existia porque `fechamento_corrida` NÃO é documento, então
 * espelhar o gate do laço da fila bastava. O retorno é documento, e por
 * isso bloqueia independentemente de quem vai fazê-lo subir.
 */
export function corridasComRetornoPendente(
  itens: readonly ItemDeFilaObservado[]
): Set<string> {
  const bloqueadas = new Set<string>()

  for (const item of itens) {
    if (item.tipo !== 'romaneio_retorno') continue
    if (!aindaPodeEscrever(item)) continue

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
  itens: readonly ItemDeFilaObservado[]
): T[] {
  const bloqueadas = corridasComRetornoPendente(itens)
  if (bloqueadas.size === 0) return [...corridas]
  return corridas.filter((c) => !bloqueadas.has(c.id))
}
