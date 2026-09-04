import { supabase, isDuplicateKeyError } from '@/lib/supabase'
import { inserirEventoIdempotente } from '@/data/eventos'

// O VOCABULÁRIO DAS FORMAS mora em `lib/formasDePagamento.ts`, e é
// reexportado aqui pra nenhum importador ter mudado.
//
// Ele saiu daqui no E3.A por um motivo concreto: este arquivo importa o
// cliente Supabase, que lê `import.meta.env`, e isso não existe sob
// `tsx`. Enquanto a leitura do evento `pagamento_alterado` morava neste
// módulo, ela não tinha como ser exercitada fora do navegador — e é
// justamente uma regra que decide o que a tela AFIRMA.
export {
  FORMA_PAGAMENTO_LABEL,
  FORMA_PAGAMENTO_OPTIONS,
  formasDoEvento,
  textoDoPagamentoAlterado,
  // E4 — as duas regras do previsto 1:N. Moram em `lib/` pelo mesmo
  // motivo das de cima, e são reexportadas aqui pra as telas
  // continuarem com um import só.
  MAX_FORMAS_PREVISTAS,
  validarFormasPrevistas,
  divergiuDoPrevisto,
  // A linha que o caixa não digitou absorve o resto da divisão. Pura
  // como as de cima, e usada pelas DUAS telas que dividem pagamento —
  // cadastro de entrega e o dialog de divergência.
  resolverValoresDasFormas,
  digitosDoValor,
  ORIGEM_INFORMADA,
  referenciaInformadaDoEvento,
  textoDaReferenciaInformada,
} from '@/lib/formasDePagamento'
export type {
  FormaPagamento,
  FormaComValor,
  LadoDoPagamentoAlterado,
} from '@/lib/formasDePagamento'

import type { FormaPagamento, FormaComValor } from '@/lib/formasDePagamento'
import { ORIGEM_INFORMADA } from '@/lib/formasDePagamento'

export async function criarPagamentoPrevisto(input: {
  tenantId: string
  entregaId: string
  forma: FormaPagamento
  valorCents: number
  registradoPor: string
  // relógio do dispositivo, capturado por quem chama antes de enfileirar —
  // mesmo instante de ocorrido_em_local da entrega/divergência que gerou
  // este pagamento (dois relógios, regra 8).
  registradoEmLocal: string
  /**
   * IDENTIDADE PRÓPRIA — E3.C. Era `id?`, com default = uuid da entrega,
   * porque "a relação é 1:1".
   *
   * Ela não é. `pagamentos` nunca teve unique em `(entrega_id, momento)`
   * — o banco sempre aceitou N. O 1:1 vivia só neste default, e ele
   * fazia duas formas previstas colidirem na PK: a segunda batia no
   * `23505`, era tratada como sucesso, e sumia em silêncio.
   *
   * OBRIGATÓRIO de propósito — mas o `?` não enumerou nada, e vale
   * registrar: os dois chamadores JÁ passavam `id` explicitamente, com
   * o valor errado. Quem os achou foi o levantamento, não o compilador.
   * O que a obrigatoriedade compra é o FUTURO: um chamador novo não
   * consegue mais omitir o id e herdar a premissa 1:1 sem perceber.
   *
   * Continua vindo de QUEM CHAMA, nunca daqui: `pagamentos` não tem
   * policy de UPDATE (correção é registro novo, não alteração do
   * previsto), então o reenvio da fila offline não pode contar com
   * upsert. Ele insere e trata `23505` como sucesso — e isso só é
   * idempotente se o id for o MESMO a cada tentativa. Cunhar aqui
   * dentro geraria um id novo por reenvio e duplicaria o previsto.
   */
  id: string
}) {
  const { error } = await supabase.from('pagamentos').insert({
    id: input.id,
    tenant_id: input.tenantId,
    entrega_id: input.entregaId,
    momento: 'previsto',
    forma: input.forma,
    valor_cents: input.valorCents,
    registrado_por: input.registradoPor,
    registrado_em_local: input.registradoEmLocal,
  })
  if (error && !isDuplicateKeyError(error)) throw error
}

export type PagamentoRealizado = { id: string; forma: FormaPagamento; valorCents: number }

export type MarcarDivergenciaInput = {
  tenantId: string
  entregaId: string
  /**
   * TODOS os pagamentos previstos do vale — E4. Era
   * `formaAnterior: FormaPagamento` mais `valorCentsPrevisto: number`,
   * e os dois juntos só sabiam descrever UM previsto.
   *
   * Vira o `de` do evento `pagamento_alterado`. O E3.B corrigiu esse
   * mesmo campo do lado do servidor (`limit 1` → agrega todos); aqui
   * está o OUTRO escritor do mesmo tipo de evento, que ficou escalar.
   *
   * VAZIO quando o vale não tem previsto — e aí `de` vai `null`. O que o
   * operador informou NÃO entra aqui: vai em `referenciaInformada`, que
   * é fato de outra natureza (E4.1).
   */
  previstos: FormaComValor[]
  pagamentosRealizados: PagamentoRealizado[]
  justificativa: string
  registradoPor: string
  autorNome: string
  /**
   * O que o operador INFORMOU como forma esperada, num vale que não tem
   * previsto gravado. `null` quando o vale tem previsto — aí a verdade
   * está em `previstos` e não há o que declarar.
   *
   * **Isto NÃO vira linha em `pagamentos`** — E4.1. Ver `marcarDivergencia`.
   */
  referenciaInformada: FormaComValor[] | null
  // chave gerada uma única vez por quem monta o payload (antes de
  // enfileirar) — é isso que torna o insert do evento seguro pra reenviar
  // depois de uma falha parcial, sem duplicar log.
  eventoIdempotencyKey: string
  // relógio do dispositivo, capturado no dialog antes de enfileirar —
  // usado nos pagamentos.realizado e no evento pagamento_alterado, que
  // são a mesma ação.
  registradoEmLocal: string
}

// Cliente pode fechar a conta em mais de uma forma na porta (ex: metade
// pix, metade dinheiro) — por isso pagamentosRealizados é uma lista, não
// um valor só. Uma linha em `pagamentos` por forma.
export async function marcarDivergencia(input: MarcarDivergenciaInput) {
  // A JANELA DA FILA — E4, e ela é só de desenvolvimento.
  //
  // Um item enfileirado ANTES do E4 traz `formaAnterior` +
  // `valorCentsPrevisto` e não traz `previstos`. O tipo governa o que se
  // escreve de agora em diante; o `??` tolera o que já está no
  // IndexedDB de alguém. Mesma forma da janela do `pagamentoPrevistoId`
  // (E3.C) e da do `tipo` no envelope (2C.5).
  //
  // Sem ela, esse item gravaria `de: undefined` num evento append-only —
  // e perderia o previsto retroativo junto, porque é dali que sai o
  // valor dele.
  //
  // Morre no corte pré-V1, que apaga a fila.
  const legado = input as unknown as {
    formaAnterior?: FormaPagamento
    valorCentsPrevisto?: number
  }
  const previstos: FormaComValor[] =
    input.previstos ??
    (legado.formaAnterior
      ? [{ forma: legado.formaAnterior, valor_cents: legado.valorCentsPrevisto ?? 0 }]
      : [])

  // ================================================================
  // O PREVISTO RETROATIVO DEIXOU DE EXISTIR — E4.1 (2026-08-30)
  // ================================================================
  //
  // Havia aqui um `criarPagamentoPrevisto` para vale antigo sem previsto.
  // Ele saiu por dois motivos, e o segundo é o que decide.
  //
  // 1. A CORRIDA, aberta pelo E3.C. O `criarPrevisto` é decidido no
  //    CLIENTE, a partir de uma query que pode estar velha. Antes do E3
  //    isso não fazia estrago por acidente: o retroativo usava
  //    `id: entregaId`, o mesmo id do `criarEntrega`, então um duplicado
  //    batia em `23505` e era engolido. O E3.C tirou o id derivado —
  //    corretamente — e levou junto uma guarda que ninguém sabia que
  //    existia.
  //
  //    O caminho real não é exótico: `criarEntrega` faz duas escritas em
  //    sequência, e se a rede cair entre elas o vale fica no banco SEM
  //    previsto até a fila reenviar. Nessa janela o fallback dispara.
  //
  // 2. E COORDENAR OS DOIS ESCRITORES NÃO RESOLVE. Com o retroativo
  //    entrando ANTES do replay, o replay é o escritor LEGÍTIMO e traz o
  //    fato real — se ele inserir são duas linhas, se ele pular perde-se
  //    a verdade. Não há terceira saída: `pagamentos` não tem policy de
  //    DELETE nem de UPDATE (regra 4), então a linha retroativa é
  //    IRREMOVÍVEL. Lock, RPC ou `select`-antes-de-inserir não fecham
  //    esse caso — só escolhem qual dano.
  //
  // Daí a correção ser por ELIMINAÇÃO: sem segundo escritor, não há
  // concorrência a serializar. `criarEntrega` (e o replay dela) passa a
  // ser o ÚNICO escritor de pagamento previsto.
  //
  // ---------------------------------------------------------------
  // E ISSO JÁ ERA SEMANTICAMENTE FRÁGIL, antes da corrida
  // ---------------------------------------------------------------
  //     previsto     fato conhecido NO CADASTRO, pelo sistema
  //     referência   declarada DEPOIS, por uma pessoa
  //
  // O fallback transformava a segunda coisa na primeira. O `V-000006`
  // ficou como prova: previsto gravado às 03:23, e às 03:26 uma
  // ocorrência afirmando "vale antigo sem pagamento registrado".
  //
  // O que o operador informa continua sendo evidência — com autor,
  // horário e justificativa — no evento append-only, em campo PRÓPRIO
  // (`referencia_informada`). Nunca em `de`, que o servidor define como
  // estado persistido e mais nada.
  //
  // **Ausência de histórico não se corrige inventando histórico.**

  for (const pagamento of input.pagamentosRealizados) {
    const { error } = await supabase.from('pagamentos').insert({
      id: pagamento.id,
      tenant_id: input.tenantId,
      entrega_id: input.entregaId,
      momento: 'realizado',
      forma: pagamento.forma,
      valor_cents: pagamento.valorCents,
      observacao: input.justificativa,
      registrado_por: input.registradoPor,
      registrado_em_local: input.registradoEmLocal,
    })
    if (error && !isDuplicateKeyError(error)) throw error
  }

  // Acende o eixo financeiro. Ele existe no schema desde o início (os três
  // eixos de status são independentes de propósito — ver CLAUDE.md) mas
  // nada no app nunca escrevia nele: todo vale ficava em 'na_ordem' pra
  // sempre, inclusive os que tinham divergência registrada.
  //
  // Idempotente no reenvio da fila offline: gravar 'divergente' de novo
  // não muda nada, e o trigger fn_log_entrega só registra evento quando o
  // status muda de fato — então reenviar não polui o log.
  const { error: statusError } = await supabase
    .from('entregas')
    .update({ status_financeiro: 'divergente' })
    .eq('id', input.entregaId)
  if (statusError) throw statusError

  await inserirEventoIdempotente({
    tenantId: input.tenantId,
    entregaId: input.entregaId,
    tipo: 'pagamento_alterado',
    idempotencyKey: input.eventoIdempotencyKey,
    payload: {
      // E4 — LISTA, não escalar. Ver `previstos` em
      // `MarcarDivergenciaInput`: é o mesmo campo que o E3.B corrigiu do
      // lado do servidor, e este é o outro escritor do evento.
      //
      // O leitor já sabia ler as duas formas desde o E3.A
      // (`formasDoEvento`), então nenhum evento antigo deixa de ser
      // legível — `eventos` é append-only, e os que já existem com `de`
      // escalar ficam assim para sempre.
      de: previstos.length > 0 ? previstos : null,
      para: input.pagamentosRealizados.map((p) => ({ forma: p.forma, valor_cents: p.valorCents })),
      // E4.1 — campo PRÓPRIO, porque `de` significa estado persistido.
      // Só aparece quando há o que declarar; ausente é o normal.
      ...(input.referenciaInformada
        ? {
            referencia_informada: input.referenciaInformada,
            origem_referencia: ORIGEM_INFORMADA,
          }
        : {}),
      justificativa: input.justificativa,
      autor_nome: input.autorNome,
    },
    registradoPor: input.registradoPor,
    ocorridoEmLocal: input.registradoEmLocal,
  })
}

// Leitura das alterações de pagamento (eventos tipo 'pagamento_alterado')
// mora em src/data/notificacoes.ts junto com os outros tipos de
// notificação — agregação cross-tipo, não faz sentido ficar por tipo.
