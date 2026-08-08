import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { uuidv7 } from '@/lib/uuid'

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
  // id determinístico (default: mesmo uuid da entrega, relação é 1:1) —
  // permite reenviar com upsert sem duplicar linha quando a fila offline
  // tenta de novo depois de uma falha parcial.
  id?: string
}) {
  const { error } = await supabase.from('pagamentos').upsert({
    id: input.id ?? uuidv7(),
    tenant_id: input.tenantId,
    entrega_id: input.entregaId,
    momento: 'previsto',
    forma: input.forma,
    valor_cents: input.valorCents,
    registrado_por: input.registradoPor,
  })
  if (error) throw error
}

export type PagamentoRealizado = { forma: FormaPagamento; valorCents: number }

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
}

// Cliente pode fechar a conta em mais de uma forma na porta (ex: metade
// pix, metade dinheiro) — por isso pagamentosRealizados é uma lista, não
// um valor só. Uma linha em `pagamentos` por forma.
export async function marcarDivergencia(input: MarcarDivergenciaInput) {
  if (input.criarPrevisto) {
    await criarPagamentoPrevisto({
      tenantId: input.tenantId,
      entregaId: input.entregaId,
      forma: input.formaAnterior,
      valorCents: input.valorCentsPrevisto,
      registradoPor: input.registradoPor,
    })
  }

  for (const pagamento of input.pagamentosRealizados) {
    const { error } = await supabase.from('pagamentos').insert({
      id: uuidv7(),
      tenant_id: input.tenantId,
      entrega_id: input.entregaId,
      momento: 'realizado',
      forma: pagamento.forma,
      valor_cents: pagamento.valorCents,
      observacao: input.justificativa,
      registrado_por: input.registradoPor,
    })
    if (error) throw error
  }

  const { error: eventoError } = await supabase.from('eventos').insert({
    tenant_id: input.tenantId,
    entrega_id: input.entregaId,
    tipo: 'pagamento_alterado',
    payload: {
      de: input.formaAnterior,
      para: input.pagamentosRealizados.map((p) => ({ forma: p.forma, valor_cents: p.valorCents })),
      justificativa: input.justificativa,
      autor_nome: input.autorNome,
    },
    user_id: input.registradoPor,
  })
  if (eventoError) throw eventoError
}

export function useMarcarDivergencia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: marcarDivergencia,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-historico'] })
      queryClient.invalidateQueries({ queryKey: ['alteracoes-pagamento-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['alteracoes-pagamento-todas'] })
    },
  })
}

export type AlteracaoPagamento = {
  id: number
  entregaId: string | null
  numeroVale: string | null
  clienteNome: string | null
  de: FormaPagamento
  para: Array<{ forma: FormaPagamento; valorCents: number }>
  justificativa: string
  autorNome: string
  ocorridoEm: string
}

type EventoPagamentoAlteradoRow = {
  id: number
  entrega_id: string | null
  payload: {
    de: FormaPagamento
    para: FormaPagamento | Array<{ forma: FormaPagamento; valor_cents: number }>
    justificativa: string
    autor_nome: string
  }
  ocorrido_em: string
  entregas: { numero_vale: string; cliente_nome: string } | null
}

function mapAlteracaoPagamento(row: EventoPagamentoAlteradoRow): AlteracaoPagamento {
  return {
    id: row.id,
    entregaId: row.entrega_id,
    numeroVale: row.entregas?.numero_vale ?? null,
    clienteNome: row.entregas?.cliente_nome ?? null,
    de: row.payload.de,
    // eventos antigos (de antes da divisão em várias formas) gravaram
    // `para` como string única — normaliza pra sempre tratar como lista.
    para: Array.isArray(row.payload.para)
      ? row.payload.para.map((p) => ({ forma: p.forma, valorCents: p.valor_cents }))
      : [{ forma: row.payload.para, valorCents: 0 }],
    justificativa: row.payload.justificativa,
    autorNome: row.payload.autor_nome,
    ocorridoEm: row.ocorrido_em,
  }
}

async function buscarAlteracoesPagamentoHoje(): Promise<AlteracaoPagamento[]> {
  const inicioDoDia = new Date()
  inicioDoDia.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('eventos')
    .select('id, entrega_id, payload, ocorrido_em, entregas(numero_vale, cliente_nome)')
    .eq('tipo', 'pagamento_alterado')
    .gte('ocorrido_em', inicioDoDia.toISOString())
    .order('ocorrido_em', { ascending: false })

  if (error) throw error
  return (data as unknown as EventoPagamentoAlteradoRow[]).map(mapAlteracaoPagamento)
}

export function useAlteracoesPagamentoHoje() {
  return useQuery({
    queryKey: ['alteracoes-pagamento-hoje'],
    queryFn: buscarAlteracoesPagamentoHoje,
  })
}

const LIMITE_ALTERACOES_PAGAMENTO = 200

// Sem filtro de data — é justamente o registro permanente do "porquê" de
// cada divergência, pra gestão poder consultar depois. A notificação do
// cabeçalho é só o aviso do dia; essa é a fonte de verdade.
async function buscarTodasAlteracoesPagamento(): Promise<AlteracaoPagamento[]> {
  const { data, error } = await supabase
    .from('eventos')
    .select('id, entrega_id, payload, ocorrido_em, entregas(numero_vale, cliente_nome)')
    .eq('tipo', 'pagamento_alterado')
    .order('ocorrido_em', { ascending: false })
    .limit(LIMITE_ALTERACOES_PAGAMENTO)

  if (error) throw error
  return (data as unknown as EventoPagamentoAlteradoRow[]).map(mapAlteracaoPagamento)
}

export function useTodasAlteracoesPagamento() {
  return useQuery({
    queryKey: ['alteracoes-pagamento-todas'],
    queryFn: buscarTodasAlteracoesPagamento,
  })
}
