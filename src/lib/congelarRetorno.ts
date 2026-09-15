// O CONGELAMENTO do Romaneio de Retorno.
//
// Mora em `lib/` e importa só outros módulos de `lib/` — nada de Supabase,
// React ou Dexie. É o que permite testá-lo isolado, e é onde a regra de
// UI mais importante da 2D vira código em vez de intenção.
//
// ---------------------------------------------------------------------
// O QUE O CONGELAMENTO É
//
// Enquanto o caixa preenche, tudo é editável. Ao confirmar, um conjunto
// de coisas nasce JUNTO e passa a valer só para AQUELA tentativa:
//
//     romaneioId       a operação
//     retornoJsonb     o que vai ser enviado
//     canonico         os bytes
//     documentHash     o que as duas partes assinam
//
// Se o caixa voltar e editar qualquer fato, tudo isso morre — junto com
// a autorização, o envelope e as duas assinaturas, que dependem do hash.
// Reaproveitar qualquer um deles seria assinar um documento e mandar
// outro.
//
// Esta função devolve o pacote inteiro de uma vez, e é isso que torna a
// invariante mecânica: não há como ficar com metade dele.
//
// ---------------------------------------------------------------------
// A COLISÃO DE `pagamento_id`, E POR QUE ELA MERECE CÓDIGO PRÓPRIO
//
// O `pagamento_id` do pagamento PREVISTO é o mesmo uuid da entrega —
// desenho de `criarPagamentoPrevisto`, porque a relação é 1:1 e isso dá
// idempotência ao reenvio da fila sem upsert.
//
// A tela vai querer pré-preencher o realizado com o previsto, pro caixa
// só confirmar. Copiando o objeto inteiro, o `pagamentoId` vai junto — e
// aí o DCRR1 afirma um pagamento cujo id já existe. No servidor isso
// bate em `on conflict (id) do nothing`: nada é gravado, nada é
// levantado, e o documento sela mentindo.
//
// **A camada de banco já fecha isso** (migration `20260820200000`, que
// conta as linhas `pr` assinadas contra as gravadas e aborta). Este guard
// existe pelo outro motivo: pra ninguém chegar até cartão, PIN e DUAS
// ASSINATURAS pra só então descobrir. O banco impede o dano; a tela evita
// o custo. Mesma divisão da 2C.2.
//
// **Pré-preencher COPIA forma, valor e troco. NUNCA o `pagamentoId`.**
// ---------------------------------------------------------------------

import {
  montarCanonicoRetorno,
  paraJsonbRetorno,
  type EntradaRetorno,
} from '@/lib/canonicoRetorno'
import { paraJsonbRelatos, type RelatoRetorno } from '@/lib/relatoDoRetorno'
import { sha256Hex } from '@/lib/hash'

export type ColisaoDePagamento = {
  entregaId: string
  pagamentoId: string
  motivo: 'colide_com_previsto' | 'repetido_no_documento'
}

/**
 * Os `pagamentoId` do realizado podem virar documento?
 *
 * Devolve a LISTA de problemas, não um booleano: a tela precisa apontar
 * qual linha está errada, e "algo está errado" é a forma de mensagem que
 * este projeto passa o tempo todo consertando.
 *
 * `repetido_no_documento` também é checado por `validarRetorno`, que
 * recusa `pagamento_duplicado`. A duplicação aqui é deliberada: o
 * canônico é PURO e não conhece o contexto, então ele nunca poderia ver
 * a colisão com o previsto. Pegar as duas no mesmo lugar é o que permite
 * a tela mostrar os dois problemas de uma vez, em vez de o caixa
 * corrigir um e descobrir o outro.
 */
export function conferirIdsDePagamento(
  vales: ReadonlyArray<{
    entregaId: string
    pagamentosRealizados?: ReadonlyArray<{ pagamentoId: string }>
  }>,
  idsPrevistos: Iterable<string>
): ColisaoDePagamento[] {
  const previstos = new Set(idsPrevistos)
  const jaVistos = new Set<string>()
  const problemas: ColisaoDePagamento[] = []

  for (const vale of vales) {
    for (const pagamento of vale.pagamentosRealizados ?? []) {
      const id = pagamento.pagamentoId

      if (previstos.has(id)) {
        problemas.push({
          entregaId: vale.entregaId,
          pagamentoId: id,
          motivo: 'colide_com_previsto',
        })
      } else if (jaVistos.has(id)) {
        // `else if` de propósito: um id que colide com o previsto E se
        // repete é UM problema, não dois. O caixa conserta gerando outro,
        // e as duas queixas apontariam pro mesmo campo.
        problemas.push({
          entregaId: vale.entregaId,
          pagamentoId: id,
          motivo: 'repetido_no_documento',
        })
      }

      jaVistos.add(id)
    }
  }

  return problemas
}

/**
 * Recusa de congelamento. Não é erro de programação — é o caixa (ou um
 * pré-preenchimento mal feito) tendo produzido algo que não pode virar
 * documento, e a tela precisa dizer o quê.
 */
export class RetornoNaoCongelavel extends Error {
  readonly colisoes: ColisaoDePagamento[]

  constructor(colisoes: ColisaoDePagamento[]) {
    super(
      `Não dá pra congelar: ${colisoes.length} pagamento(s) com id inválido. ` +
        'Um id de pagamento realizado não pode ser o mesmo do previsto.'
    )
    this.name = 'RetornoNaoCongelavel'
    this.colisoes = colisoes
  }
}

export type RetornoCongelado = {
  /** A operação. Novo a cada congelamento. */
  romaneioId: string
  /** Já convertido. É isto que a fila guarda e o servidor recebe. */
  retornoJsonb: unknown[]
  /** Os bytes, guardados pra depuração — não viajam. */
  canonico: string
  /** O que as duas partes assinam. */
  documentHash: string
  /**
   * "O que aconteceu?" — 2026-09-15. FORA do canônico e fora do hash: não
   * entra em `montarCanonicoRetorno`, é declaração do balcão sobre uma
   * diferença, não fato que o motoboy confirma. Ainda assim nasce e morre
   * junto com o resto do pacote — id novo a cada congelamento, como
   * `pagamentoId` — porque "editar destrói tudo" vale pro pacote inteiro,
   * não só pro que está no hash.
   */
  relatosJsonb: unknown[]
}

/**
 * Valida, congela e devolve o pacote inteiro.
 *
 * `novoId` entra por parâmetro em vez de `uuidv7()` ser chamado aqui
 * dentro: é o que torna a função determinística num teste. Em produção
 * quem chama passa `uuidv7`.
 *
 * A ORDEM importa e é contrato: os ids são conferidos ANTES de qualquer
 * conversão. Congelar primeiro e validar depois deixaria um
 * `documentHash` existir por um instante para um documento que não pode
 * ser assinado — e é exatamente esse tipo de "por um instante" que vira
 * bug quando alguém acrescenta um `await` no meio.
 */
export async function congelarRetorno(
  entrada: EntradaRetorno,
  idsPrevistos: Iterable<string>,
  novoId: () => string,
  /**
   * Os relatos ATUAIS — já filtrados pra só os itens que ainda divergem
   * (é isso que impede um relato sobreviver depois que a diferença que o
   * motivou sumiu). Vazio por padrão: retorno sem item divergente não
   * tem o que relatar.
   */
  relatos: ReadonlyArray<RelatoRetorno> = []
): Promise<RetornoCongelado> {
  const colisoes = conferirIdsDePagamento(entrada.vales, idsPrevistos)
  if (colisoes.length > 0) throw new RetornoNaoCongelavel(colisoes)

  // `montarCanonicoRetorno` valida de novo, pelo contrato do DCRR1, e
  // levanta `RetornoInvalido` com o motivo. Não é redundância: ele checa
  // o que o documento pode AFIRMAR; o guard acima checa o que os ids
  // podem SER neste contexto.
  const canonico = montarCanonicoRetorno(entrada)

  return {
    romaneioId: novoId(),
    retornoJsonb: paraJsonbRetorno(entrada),
    canonico,
    documentHash: await sha256Hex(canonico),
    relatosJsonb: paraJsonbRelatos(relatos, novoId),
  }
}
