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
} from '@/lib/formasDePagamento'
export type {
  FormaPagamento,
  FormaComValor,
  LadoDoPagamentoAlterado,
} from '@/lib/formasDePagamento'

import type { FormaPagamento } from '@/lib/formasDePagamento'

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
  formaAnterior: FormaPagamento
  pagamentosRealizados: PagamentoRealizado[]
  justificativa: string
  registradoPor: string
  autorNome: string
  // true quando a entrega nunca teve pagamento.previsto gravado (vale
  // antigo, de antes dessa feature existir) — nesse caso cria o previsto
  // retroativo com a forma "esperada" que o caixa informou, antes de
  // gravar o(s) realizado(s).
  criarPrevisto: boolean
  valorCentsPrevisto: number
  /**
   * O id do previsto retroativo — E3.C. Só é usado quando
   * `criarPrevisto`, mas vem SEMPRE no payload: cunhá-lo condicionalmente
   * deixaria a forma do item da fila depender de um booleano, e um
   * reenvio que reavaliasse a condição cunharia outro id.
   *
   * Era `input.entregaId`, o mesmo default de `criarEntrega`.
   */
  pagamentoPrevistoId: string
  // chave gerada uma única vez por quem monta o payload (antes de
  // enfileirar) — é isso que torna o insert do evento seguro pra reenviar
  // depois de uma falha parcial, sem duplicar log.
  eventoIdempotencyKey: string
  // relógio do dispositivo, capturado no dialog antes de enfileirar —
  // usado nos pagamentos.realizado, no previsto retroativo (quando
  // criarPrevisto) e no evento pagamento_alterado, todos a mesma ação.
  registradoEmLocal: string
}

// Cliente pode fechar a conta em mais de uma forma na porta (ex: metade
// pix, metade dinheiro) — por isso pagamentosRealizados é uma lista, não
// um valor só. Uma linha em `pagamentos` por forma.
export async function marcarDivergencia(input: MarcarDivergenciaInput) {
  if (input.criarPrevisto) {
    // Previsto RETROATIVO, pra vale antigo que nunca teve um gravado.
    //
    // Era `id: input.entregaId`, o mesmo default do `criarEntrega` — e o
    // mesmo motivo de ele sair: a relação não é 1:1, e o id derivado
    // fazia a segunda forma colidir na PK.
    //
    // Mesma janela do `criarEntrega`: item enfileirado antes do E3.C não
    // traz o campo, e aí o comportamento antigo vale.
    await criarPagamentoPrevisto({
      id:
        (input as { pagamentoPrevistoId?: string }).pagamentoPrevistoId ?? input.entregaId,
      tenantId: input.tenantId,
      entregaId: input.entregaId,
      forma: input.formaAnterior,
      valorCents: input.valorCentsPrevisto,
      registradoPor: input.registradoPor,
      registradoEmLocal: input.registradoEmLocal,
    })
  }

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
      de: input.formaAnterior,
      para: input.pagamentosRealizados.map((p) => ({ forma: p.forma, valor_cents: p.valorCents })),
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
