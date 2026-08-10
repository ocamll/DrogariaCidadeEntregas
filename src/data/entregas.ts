import { useEffect } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { criarPagamentoPrevisto, type FormaPagamento } from '@/data/pagamentos'
import { centsFromDigits } from '@/lib/money'

export type NovaEntrega = {
  id: string
  tenantId: string
  lojaId: string
  criadoPor: string
  clienteNome: string
  clienteEndereco: string
  valorCompraCents: number
  valorEntregaCents: number
  formaPagamento: FormaPagamento
  ocorridoEmLocal: string
  convenioId: string | null
  temReceita: boolean
}

// numero_vale não vem do caixa — o banco gera (ver migration
// numero_vale_automatico). O insert devolve o valor gerado pra mostrar
// na confirmação.
//
// upsert (não insert): a fila offline pode chamar isso de novo pro mesmo
// id depois de uma falha parcial (ex: entrega gravou, pagamento não) —
// reenvio tem que virar no-op na entrega, não erro de chave duplicada.
// numero_vale só é gerado pelo default na PRIMEIRA vez; num upsert que já
// existe, o valor antigo é preservado (não regenera).
export async function criarEntrega(input: NovaEntrega): Promise<{ numeroVale: string }> {
  const { data, error } = await supabase
    .from('entregas')
    .upsert({
      id: input.id,
      tenant_id: input.tenantId,
      loja_id: input.lojaId,
      criado_por: input.criadoPor,
      cliente_nome: input.clienteNome,
      cliente_endereco: input.clienteEndereco,
      valor_compra_cents: input.valorCompraCents,
      valor_entrega_cents: input.valorEntregaCents,
      ocorrido_em_local: input.ocorridoEmLocal,
      convenio_id: input.convenioId,
      status_documental: input.convenioId ? 'pendente' : 'nao_aplica',
      tem_receita: input.temReceita,
    })
    .select('numero_vale')
    .single()

  if (error) throw error
  const row = data as unknown as { numero_vale: string }

  await criarPagamentoPrevisto({
    id: input.id,
    tenantId: input.tenantId,
    entregaId: input.id,
    forma: input.formaPagamento,
    valorCents: input.valorCompraCents,
    registradoPor: input.criadoPor,
    registradoEmLocal: input.ocorridoEmLocal,
  })

  return { numeroVale: row.numero_vale }
}

export type NovaTransferencia = {
  id: string
  tenantId: string
  lojaId: string
  lojaOrigemNome: string
  lojaDestinoId: string
  lojaDestinoNome: string
  criadoPor: string
  ocorridoEmLocal: string
}

// Mesmo vale/sequência da entrega de cliente, só que sem cliente nem
// valor — ver migration transferencia_entre_filiais. Não cria pagamento
// nenhum (não é venda).
//
// upsert (não insert): mesmo motivo do criarEntrega — a fila offline pode
// reenviar pelo mesmo id depois de uma falha parcial, e isso precisa virar
// no-op, não erro de chave duplicada.
export async function criarTransferencia(input: NovaTransferencia): Promise<{ numeroVale: string }> {
  const { data, error } = await supabase
    .from('entregas')
    .upsert({
      id: input.id,
      tenant_id: input.tenantId,
      loja_id: input.lojaId,
      loja_destino_id: input.lojaDestinoId,
      tipo: 'transferencia',
      criado_por: input.criadoPor,
      cliente_nome: input.lojaDestinoNome,
      cliente_endereco: `${input.lojaOrigemNome} para ${input.lojaDestinoNome}`,
      ocorrido_em_local: input.ocorridoEmLocal,
    })
    .select('numero_vale')
    .single()

  if (error) throw error
  const row = data as unknown as { numero_vale: string }
  return { numeroVale: row.numero_vale }
}

export type EntregaRecente = {
  id: string
  numeroVale: string
  tipo: 'cliente' | 'transferencia'
  clienteNome: string
  clienteEndereco: string
  valorCompraCents: number
  valorEntregaCents: number
  statusEntrega: string
  ocorridoEmLocal: string
  formaPrevista: FormaPagamento | null
  formasRealizadas: FormaPagamento[]
  temReceita: boolean
  receitaRecebidaEm: string | null
}

const ENTREGA_RECENTE_SELECT =
  'id, numero_vale, tipo, cliente_nome, cliente_endereco, valor_compra_cents, valor_entrega_cents, status_entrega, ocorrido_em_local, tem_receita, receita_recebida_em, pagamentos(forma, momento)'

type EntregaRecenteRow = {
  id: string
  numero_vale: string
  tipo: 'cliente' | 'transferencia'
  cliente_nome: string
  cliente_endereco: string
  valor_compra_cents: number
  valor_entrega_cents: number
  status_entrega: string
  ocorrido_em_local: string
  tem_receita: boolean
  receita_recebida_em: string | null
  pagamentos: Array<{ forma: FormaPagamento; momento: 'previsto' | 'realizado' }>
}

function mapEntregaRecente(row: EntregaRecenteRow): EntregaRecente {
  return {
    id: row.id,
    numeroVale: row.numero_vale,
    tipo: row.tipo,
    clienteNome: row.cliente_nome,
    clienteEndereco: row.cliente_endereco,
    valorCompraCents: row.valor_compra_cents,
    valorEntregaCents: row.valor_entrega_cents,
    statusEntrega: row.status_entrega,
    ocorridoEmLocal: row.ocorrido_em_local,
    formaPrevista: row.pagamentos.find((p) => p.momento === 'previsto')?.forma ?? null,
    formasRealizadas: row.pagamentos.filter((p) => p.momento === 'realizado').map((p) => p.forma),
    temReceita: row.tem_receita,
    receitaRecebidaEm: row.receita_recebida_em,
  }
}

// Paginada pelo mesmo motivo do histórico: a ordenação é descendente, e
// pro caixa isso nunca chega perto de teto nenhum (um dia, uma loja) —
// mas admin/gerente enxergam as 17 filiais juntas, e num dia movimentado
// o corte silencioso do max-rows derrubaria justamente os vales da
// manhã. Página maior que a do histórico porque aqui é a tela de
// trabalho: o caixa quer ver o dia inteiro sem clicar.
export const TAMANHO_PAGINA_HOJE = 100

async function buscarEntregasDeHoje(pagina: number): Promise<PaginaEntregas> {
  const inicioDoDia = new Date()
  inicioDoDia.setHours(0, 0, 0, 0)
  const de = (pagina - 1) * TAMANHO_PAGINA_HOJE

  const { data, error, count } = await supabase
    .from('entregas')
    .select(ENTREGA_RECENTE_SELECT, { count: 'exact' })
    .gte('ocorrido_em_local', inicioDoDia.toISOString())
    .order('registrado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_HOJE - 1)

  if (error) throw error

  const total = count ?? 0
  return {
    entregas: (data as unknown as EntregaRecenteRow[]).map(mapEntregaRecente),
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_HOJE)),
  }
}

export function useEntregasDeHoje(pagina: number) {
  return useQuery({
    queryKey: ['entregas-hoje', pagina],
    queryFn: () => buscarEntregasDeHoje(pagina),
    placeholderData: keepPreviousData,
  })
}

export type FiltrosHistorico = {
  numeroVale: string
  clienteNome: string
  clienteEndereco: string
  valorCompra: string
  dataInicio: string
  dataFim: string
  // '' = todas as filiais. Só admin/gerente escolhe: pra caixa a RLS já
  // restringe à própria loja, então um select aqui não mudaria nada.
  // Filtra por loja_id (origem), mesma semântica do Registro de
  // Auditoria — vale de transferência aparece na filial que o criou,
  // não na de destino.
  lojaId: string
}

export const FILTROS_HISTORICO_VAZIOS: FiltrosHistorico = {
  numeroVale: '',
  clienteNome: '',
  clienteEndereco: '',
  valorCompra: '',
  dataInicio: '',
  dataFim: '',
  lojaId: '',
}

// Uma página por vez, com o total real vindo do banco. Antes isso era um
// `limit` (200 sem filtro, 5000 com filtro) e o resultado vinha truncado
// em silêncio: a farmácia precisa achar um vale de 3 meses atrás, e o
// corte por `registrado_em desc` derrubava justamente os mais antigos —
// exatamente os procurados. Paginando não há teto nenhum, e ainda carrega
// menos por vez (a tabela não virtualiza e monta um dropdown por linha).
export const TAMANHO_PAGINA_HISTORICO = 50

// Mesma forma pras duas listas paginadas (Hoje e Histórico).
export type PaginaEntregas = {
  entregas: EntregaRecente[]
  total: number
  totalPaginas: number
}

async function buscarHistoricoEntregas(
  filtros: FiltrosHistorico,
  pagina: number
): Promise<PaginaEntregas> {
  const de = (pagina - 1) * TAMANHO_PAGINA_HISTORICO

  // count: 'exact' junto do range — é o total que alimenta "X vales" e o
  // número de páginas. Sem ele não dá pra saber se existe página seguinte.
  let query = supabase
    .from('entregas')
    .select(ENTREGA_RECENTE_SELECT, { count: 'exact' })
    .order('registrado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_HISTORICO - 1)

  if (filtros.numeroVale.trim()) query = query.ilike('numero_vale', `%${filtros.numeroVale.trim()}%`)
  if (filtros.clienteNome.trim()) query = query.ilike('cliente_nome', `%${filtros.clienteNome.trim()}%`)
  if (filtros.clienteEndereco.trim())
    query = query.ilike('cliente_endereco', `%${filtros.clienteEndereco.trim()}%`)
  if (filtros.valorCompra) query = query.eq('valor_compra_cents', centsFromDigits(filtros.valorCompra))
  if (filtros.lojaId) query = query.eq('loja_id', filtros.lojaId)
  // intervalo — "De" sozinho é "a partir de", "Até" sozinho é "até", os dois
  // juntos fecham o período (ex: mês inteiro).
  if (filtros.dataInicio) {
    query = query.gte('ocorrido_em_local', new Date(`${filtros.dataInicio}T00:00:00`).toISOString())
  }
  if (filtros.dataFim) {
    const fim = new Date(`${filtros.dataFim}T00:00:00`)
    fim.setDate(fim.getDate() + 1)
    query = query.lt('ocorrido_em_local', fim.toISOString())
  }

  const { data, error, count } = await query
  if (error) throw error

  const total = count ?? 0
  return {
    entregas: (data as unknown as EntregaRecenteRow[]).map(mapEntregaRecente),
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_HISTORICO)),
  }
}

export function useHistoricoEntregas(filtros: FiltrosHistorico, pagina: number) {
  return useQuery({
    queryKey: ['entregas-historico', filtros, pagina],
    queryFn: () => buscarHistoricoEntregas(filtros, pagina),
    // mantém a página anterior na tela enquanto a próxima carrega — sem
    // isso a tabela pisca vazia a cada clique de página.
    placeholderData: keepPreviousData,
  })
}

// PC ↔ tablet: qualquer INSERT/UPDATE em entregas (RLS já filtra por
// tenant/loja) invalida a lista, que refaz o fetch. Publication já
// habilitada no schema inicial (alter publication supabase_realtime add
// table entregas) — só faltava assinar do lado do cliente.
export function useEntregasRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('entregas-hoje-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entregas' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
