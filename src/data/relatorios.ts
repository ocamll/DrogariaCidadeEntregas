import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type FiltroPeriodo = { dataInicio: string; dataFim: string }

export type RelatorioVale = {
  id: string
  numeroVale: string
  clienteNome: string
  tipo: 'cliente' | 'transferencia'
  statusEntrega: string
  valorEntregaCents: number
  ocorridoEmLocal: string
}

export type RelatorioGrupo = {
  chave: string
  nome: string
  totalVales: number
  entregues: number
  insucessos: number
  valorEntregaCents: number
  vales: RelatorioVale[]
}

export type Relatorio = {
  totalVales: number
  totalClientes: number
  totalTransferencias: number
  valorCompraCents: number
  valorEntregaCents: number
  porStatus: Record<string, number>
  porMototaxista: RelatorioGrupo[]
  porAgencia: RelatorioGrupo[]
}

type EntregaRelatorioRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  tipo: 'cliente' | 'transferencia'
  valor_compra_cents: number
  valor_entrega_cents: number
  status_entrega: string
  ocorrido_em_local: string
  corridas: {
    mototaxista_id: string
    agencia_id: string | null
    mototaxistas: { nome: string } | null
    agencias: { nome: string } | null
  } | null
}

function acumularGrupo(mapa: Map<string, RelatorioGrupo>, id: string, nome: string, row: EntregaRelatorioRow) {
  const atual =
    mapa.get(id) ?? { chave: id, nome, totalVales: 0, entregues: 0, insucessos: 0, valorEntregaCents: 0, vales: [] }
  atual.totalVales += 1
  if (row.status_entrega === 'entregue') atual.entregues += 1
  if (row.status_entrega === 'insucesso') atual.insucessos += 1
  atual.valorEntregaCents += row.valor_entrega_cents
  atual.vales.push({
    id: row.id,
    numeroVale: row.numero_vale,
    clienteNome: row.cliente_nome,
    tipo: row.tipo,
    statusEntrega: row.status_entrega,
    valorEntregaCents: row.valor_entrega_cents,
    ocorridoEmLocal: row.ocorrido_em_local,
  })
  mapa.set(id, atual)
}

// Agregação client-side (sem view/RPC nova) — volume do MVP não justifica
// isso ainda. Entregas sem corrida (ainda pendentes) não entram nos
// agrupamentos por motoboy/agência, só no resumo geral.
async function buscarRelatorio(filtro: FiltroPeriodo): Promise<Relatorio> {
  const inicio = new Date(`${filtro.dataInicio}T00:00:00`)
  const fim = new Date(`${filtro.dataFim}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  const { data, error } = await supabase
    .from('entregas')
    .select(
      'id, numero_vale, cliente_nome, tipo, valor_compra_cents, valor_entrega_cents, status_entrega, ocorrido_em_local, corridas(mototaxista_id, agencia_id, mototaxistas(nome), agencias(nome))'
    )
    .gte('ocorrido_em_local', inicio.toISOString())
    .lt('ocorrido_em_local', fim.toISOString())
    .order('ocorrido_em_local', { ascending: false })

  if (error) throw error
  const rows = data as unknown as EntregaRelatorioRow[]

  const porStatus: Record<string, number> = {}
  const porMototaxista = new Map<string, RelatorioGrupo>()
  const porAgencia = new Map<string, RelatorioGrupo>()
  let valorCompraCents = 0
  let valorEntregaCents = 0
  let totalClientes = 0
  let totalTransferencias = 0

  for (const row of rows) {
    porStatus[row.status_entrega] = (porStatus[row.status_entrega] ?? 0) + 1
    valorCompraCents += row.valor_compra_cents
    valorEntregaCents += row.valor_entrega_cents
    if (row.tipo === 'cliente') totalClientes += 1
    else totalTransferencias += 1

    if (row.corridas?.mototaxista_id) {
      acumularGrupo(porMototaxista, row.corridas.mototaxista_id, row.corridas.mototaxistas?.nome ?? '—', row)
    }
    if (row.corridas?.agencia_id) {
      acumularGrupo(porAgencia, row.corridas.agencia_id, row.corridas.agencias?.nome ?? '—', row)
    }
  }

  return {
    totalVales: rows.length,
    totalClientes,
    totalTransferencias,
    valorCompraCents,
    valorEntregaCents,
    porStatus,
    porMototaxista: [...porMototaxista.values()].sort((a, b) => b.totalVales - a.totalVales),
    porAgencia: [...porAgencia.values()].sort((a, b) => b.totalVales - a.totalVales),
  }
}

export function useRelatorio(filtro: FiltroPeriodo) {
  return useQuery({
    queryKey: ['relatorio', filtro],
    queryFn: () => buscarRelatorio(filtro),
  })
}
