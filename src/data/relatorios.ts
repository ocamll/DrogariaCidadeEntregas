import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { buscarPaginado } from '@/lib/paginacao'

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
  // parte do valor que a farmácia de fato deve à agência: o resto o
  // cliente pagou em mãos ao motoboy (vale extra de endereço distante).
  valorFarmaciaDeveCents: number
  vales: RelatorioVale[]
}

// Agência é o nível de cima; motoboy mora dentro dela agora (uma agência
// tem N motoboys, cada motoboy tem N vales) — não faz mais sentido mostrar
// as duas listas soltas lado a lado. Um motoboy que fez corridas pra mais
// de uma agência no período aparece uma vez em cada uma, só com os vales
// daquela agência (não duplica o total geral, cada vale conta uma vez só).
export type RelatorioAgencia = {
  chave: string
  nome: string
  totalVales: number
  entregues: number
  insucessos: number
  valorEntregaCents: number
  valorFarmaciaDeveCents: number
  porMototaxista: RelatorioGrupo[]
}

export type Relatorio = {
  totalVales: number
  totalClientes: number
  totalTransferencias: number
  // conta separada porque virou bloco próprio no topo do relatório: é
  // número que a gerência acompanha, não só mais um status na lista.
  totalCancelados: number
  valorCompraCents: number
  valorEntregaCents: number
  valorFarmaciaDeveCents: number
  porStatus: Record<string, number>
  porAgencia: RelatorioAgencia[]
}

type EntregaRelatorioRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  tipo: 'cliente' | 'transferencia'
  valor_compra_cents: number
  valor_entrega_cents: number
  entrega_paga_cliente_cents: number
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
    mapa.get(id) ??
    {
      chave: id,
      nome,
      totalVales: 0,
      entregues: 0,
      insucessos: 0,
      valorEntregaCents: 0,
      valorFarmaciaDeveCents: 0,
      vales: [],
    }
  atual.totalVales += 1
  if (row.status_entrega === 'entregue') atual.entregues += 1
  if (row.status_entrega === 'insucesso') atual.insucessos += 1
  atual.valorEntregaCents += row.valor_entrega_cents
  atual.valorFarmaciaDeveCents += row.valor_entrega_cents - row.entrega_paga_cliente_cents
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

// corrida sem agência ainda existe no dado real (corrida antiga, de antes
// do formulário exigir escolher a agência primeiro) — em vez de sumir da
// contagem, ganha um grupo "(sem agência)" próprio, pra continuar dando
// pra investigar esse tipo de caso na tela em vez de só no banco.
const SEM_AGENCIA_CHAVE = 'sem-agencia'
const SEM_AGENCIA_NOME = '(sem agência)'

type AgenciaAcumulador = RelatorioAgencia & { motoboys: Map<string, RelatorioGrupo> }

function acumularAgencia(
  mapa: Map<string, AgenciaAcumulador>,
  agenciaId: string,
  agenciaNome: string,
  mototaxistaId: string,
  mototaxistaNome: string,
  row: EntregaRelatorioRow
) {
  const atual =
    mapa.get(agenciaId) ??
    {
      chave: agenciaId,
      nome: agenciaNome,
      totalVales: 0,
      entregues: 0,
      insucessos: 0,
      valorEntregaCents: 0,
      valorFarmaciaDeveCents: 0,
      porMototaxista: [],
      motoboys: new Map<string, RelatorioGrupo>(),
    }
  atual.totalVales += 1
  if (row.status_entrega === 'entregue') atual.entregues += 1
  if (row.status_entrega === 'insucesso') atual.insucessos += 1
  atual.valorEntregaCents += row.valor_entrega_cents
  atual.valorFarmaciaDeveCents += row.valor_entrega_cents - row.entrega_paga_cliente_cents
  acumularGrupo(atual.motoboys, mototaxistaId, mototaxistaNome, row)
  mapa.set(agenciaId, atual)
}

// Agregação client-side (sem view/RPC nova) — volume do MVP não justifica
// isso ainda. Entregas sem corrida (ainda pendentes) não entram nos
// agrupamentos por motoboy/agência, só no resumo geral.
async function buscarRelatorio(filtro: FiltroPeriodo): Promise<Relatorio> {
  const inicio = new Date(`${filtro.dataInicio}T00:00:00`)
  const fim = new Date(`${filtro.dataFim}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  // Paginado, não um select solto: aqui o resultado vira soma de dinheiro,
  // e um truncamento silencioso no teto do PostgREST daria total menor que
  // a realidade sem nenhum aviso. `id` entra na ordenação como desempate
  // pra paginação ser estável (vales com o mesmo ocorrido_em_local não
  // podem trocar de página entre um request e outro).
  const rows = (await buscarPaginado((de, ate) =>
    supabase
      .from('entregas')
      .select(
        'id, numero_vale, cliente_nome, tipo, valor_compra_cents, valor_entrega_cents, entrega_paga_cliente_cents, status_entrega, ocorrido_em_local, corridas(mototaxista_id, agencia_id, mototaxistas(nome), agencias(nome))'
      )
      .gte('ocorrido_em_local', inicio.toISOString())
      .lt('ocorrido_em_local', fim.toISOString())
      .order('ocorrido_em_local', { ascending: false })
      .order('id', { ascending: false })
      .range(de, ate)
  )) as unknown as EntregaRelatorioRow[]

  const porStatus: Record<string, number> = {}
  const porAgencia = new Map<string, AgenciaAcumulador>()
  let valorCompraCents = 0
  let valorEntregaCents = 0
  let valorFarmaciaDeveCents = 0
  let totalClientes = 0
  let totalTransferencias = 0
  let totalCancelados = 0

  for (const row of rows) {
    porStatus[row.status_entrega] = (porStatus[row.status_entrega] ?? 0) + 1

    // Vale cancelado continua CONTADO — aparece em "por status", tem bloco
    // próprio no topo, e a soma dos status precisa fechar com o total de
    // vales. Mas não entra no DINHEIRO: a compra não aconteceu e a agência
    // não recebe por ele. Sem essa separação, cancelar um vale inflaria os
    // totais em vez de limpá-los, que é o oposto do motivo de existir o
    // cancelamento.
    if (row.status_entrega === 'cancelada') {
      totalCancelados += 1
    } else {
      valorCompraCents += row.valor_compra_cents
      valorEntregaCents += row.valor_entrega_cents
      valorFarmaciaDeveCents += row.valor_entrega_cents - row.entrega_paga_cliente_cents
    }
    if (row.tipo === 'cliente') totalClientes += 1
    else totalTransferencias += 1

    if (row.corridas?.mototaxista_id) {
      const agenciaId = row.corridas.agencia_id ?? SEM_AGENCIA_CHAVE
      const agenciaNome = row.corridas.agencia_id ? (row.corridas.agencias?.nome ?? '—') : SEM_AGENCIA_NOME
      acumularAgencia(
        porAgencia,
        agenciaId,
        agenciaNome,
        row.corridas.mototaxista_id,
        row.corridas.mototaxistas?.nome ?? '—',
        row
      )
    }
  }

  return {
    totalVales: rows.length,
    totalClientes,
    totalTransferencias,
    totalCancelados,
    valorCompraCents,
    valorEntregaCents,
    valorFarmaciaDeveCents,
    porStatus,
    porAgencia: [...porAgencia.values()]
      .map((agencia) => ({
        chave: agencia.chave,
        nome: agencia.nome,
        totalVales: agencia.totalVales,
        entregues: agencia.entregues,
        insucessos: agencia.insucessos,
        valorEntregaCents: agencia.valorEntregaCents,
        valorFarmaciaDeveCents: agencia.valorFarmaciaDeveCents,
        porMototaxista: [...agencia.motoboys.values()].sort((a, b) => b.totalVales - a.totalVales),
      }))
      .sort((a, b) => b.totalVales - a.totalVales),
  }
}

export function useRelatorio(filtro: FiltroPeriodo) {
  return useQuery({
    queryKey: ['relatorio', filtro],
    queryFn: () => buscarRelatorio(filtro),
  })
}
