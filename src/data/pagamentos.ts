import { supabase, isDuplicateKeyError } from '@/lib/supabase'
import { inserirEventoIdempotente } from '@/data/eventos'

export type FormaPagamento =
  | 'dinheiro'
  | 'credito'
  | 'debito'
  | 'pix'
  | 'convenio'
  | 'convcard'
  | 'crediario'
  | 'outro'

export const FORMA_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  credito: 'Crédito',
  debito: 'Débito',
  pix: 'Pix',
  convenio: 'Convênio',
  convcard: 'ConvCard',
  crediario: 'Crediário',
  outro: 'Outro',
}

export const FORMA_PAGAMENTO_OPTIONS = Object.entries(FORMA_PAGAMENTO_LABEL) as Array<
  [FormaPagamento, string]
>

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
  // id determinístico (default: mesmo uuid da entrega, relação é 1:1),
  // gerado por quem chama — nunca aqui dentro. pagamentos não tem policy de
  // UPDATE (correção é registro novo, não alteração do previsto), então um
  // reenvio da fila offline não pode contar com upsert: insere, e se a
  // linha já existir (23505) trata como sucesso, não como erro.
  id?: string
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
    // mesmo id da entrega, mesmo padrão do criarEntrega — a relação
    // pagamento-previsto:entrega é 1:1, e isso só roda quando ainda não
    // existe previsto nenhum pra essa entrega (ver comentário do campo).
    await criarPagamentoPrevisto({
      id: input.entregaId,
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
