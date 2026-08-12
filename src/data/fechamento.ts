import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { buscarComTeto } from '@/lib/paginacao'
import type { FormaPagamento } from '@/data/pagamentos'

// Apoio ao fechamento de caixa — o lado TELE da história, e só ele.
//
// LIMITE IMPORTANTE, e o motivo de esta tela não calcular sobra nem
// falta: o sistema não conhece venda de balcão, que é a maior parte do
// caixa e vive no Trier. Somar os vales e chamar de "esperado na gaveta"
// daria número errado. O que ele faz é responder "o que, do lado da
// tele, explica uma diferença hoje?" — que é a pergunta que hoje depende
// da memória do caixa na hora de justificar ao financeiro.
//
// Quatro coisas explicam diferença, e as quatro já estão no banco:
//   - divergência de pagamento (ia ser dinheiro, virou pix)
//   - vale extra pago em mãos ao motoboy (nunca entra na gaveta)
//   - vale cancelado (a venda não aconteceu)
//   - insucesso (o produto voltou)

export type ValeFechamento = {
  id: string
  numeroVale: string
  clienteNome: string
  statusEntrega: string
  statusFinanceiro: string
  valorCompraCents: number
  valorEntregaCents: number
  entregaPagaClienteCents: number
  formaPrevista: FormaPagamento | null
  formasRealizadas: Array<{ forma: FormaPagamento; valorCents: number }>
  justificativa: string | null
  motivoCancelamento: string | null
  // quem cancelou. Gestão precisa dos dois lados — o motivo diz o quê, o
  // autor diz com quem falar. Vem por join, não de snapshot no payload.
  canceladoPorNome: string | null
  observacoes: string | null
}

export type Fechamento = {
  totalVales: number
  conferidos: number
  divergentes: number
  pendentes: number
  valorCompraCents: number
  valorEntregaCents: number
  valorFarmaciaDeveCents: number
  // soma do que o cliente pagou direto ao motoboy — dinheiro que a
  // farmácia nunca viu, e a causa mais fácil de confundir com falta
  pagoEmMaosCents: number
  // os vales que o gestor tem em mãos pra conferir agora. Antes a tela só
  // mostrava a CONTAGEM de pendentes e um botão de marcar o dia inteiro —
  // dava pra "conferir" sem ter olhado vale nenhum, que é o oposto do que
  // conferência quer dizer.
  aConferir: ValeFechamento[]
  divergencias: ValeFechamento[]
  pagosEmMaos: ValeFechamento[]
  cancelados: ValeFechamento[]
  insucessos: ValeFechamento[]
  truncado: boolean
}

// Um dia de uma filial não passa disso nem de longe; o teto existe só pra
// nenhuma query depender do max-rows do servidor.
const LIMITE_FECHAMENTO = 1000

type PagamentoRow = {
  forma: FormaPagamento
  momento: 'previsto' | 'realizado'
  valor_cents: number
  observacao: string | null
}

type ValeRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  status_entrega: string
  status_financeiro: string
  valor_compra_cents: number
  valor_entrega_cents: number
  entrega_paga_cliente_cents: number
  motivo_cancelamento: string | null
  profiles: { nome: string } | null
  observacoes: string | null
  pagamentos: PagamentoRow[]
}

function mapVale(row: ValeRow): ValeFechamento {
  const realizados = row.pagamentos.filter((p) => p.momento === 'realizado')
  return {
    id: row.id,
    numeroVale: row.numero_vale,
    clienteNome: row.cliente_nome,
    statusEntrega: row.status_entrega,
    statusFinanceiro: row.status_financeiro,
    valorCompraCents: row.valor_compra_cents,
    valorEntregaCents: row.valor_entrega_cents,
    entregaPagaClienteCents: row.entrega_paga_cliente_cents,
    formaPrevista: row.pagamentos.find((p) => p.momento === 'previsto')?.forma ?? null,
    formasRealizadas: realizados.map((p) => ({ forma: p.forma, valorCents: p.valor_cents })),
    // a justificativa é a mesma em todas as linhas realizadas (foi
    // gravada uma vez por forma) — a primeira basta
    justificativa: realizados[0]?.observacao ?? null,
    motivoCancelamento: row.motivo_cancelamento,
    canceladoPorNome: row.profiles?.nome ?? null,
    observacoes: row.observacoes,
  }
}

export type FiltroFechamento = { data: string; lojaId: string }

async function buscarFechamento(filtro: FiltroFechamento): Promise<Fechamento> {
  const inicio = new Date(`${filtro.data}T00:00:00`)
  const fim = new Date(`${filtro.data}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  // sem anotar o tipo aqui: o inferidor do supabase-js trata o embed
  // to-one como array, e quem sabe a forma real é o cast de ValeRow[]
  // logo abaixo (mesmo padrão dos outros arquivos em src/data).
  const { itens, temMais } = await buscarComTeto(
    LIMITE_FECHAMENTO,
    (limite) => {
      let q = supabase
        .from('entregas')
        .select(
          // hint de FK obrigatório: entregas tem 4 colunas apontando pra
          // profiles, e o embed sem hint devolve PGRST201 por ambiguidade.
          'id, numero_vale, cliente_nome, status_entrega, status_financeiro, valor_compra_cents, valor_entrega_cents, entrega_paga_cliente_cents, motivo_cancelamento, profiles!entregas_cancelado_por_fkey(nome), observacoes, pagamentos(forma, momento, valor_cents, observacao)'
        )
        .eq('tipo', 'cliente')
        .gte('ocorrido_em_local', inicio.toISOString())
        .lt('ocorrido_em_local', fim.toISOString())
        .order('numero_vale')
        .limit(limite)
      if (filtro.lojaId) q = q.eq('loja_id', filtro.lojaId)
      return q
    }
  )

  const vales = (itens as unknown as ValeRow[]).map(mapVale)

  let valorCompraCents = 0
  let valorEntregaCents = 0
  let valorFarmaciaDeveCents = 0
  let pagoEmMaosCents = 0
  let conferidos = 0
  let divergentes = 0
  let pendentes = 0

  for (const vale of vales) {
    const cancelado = vale.statusEntrega === 'cancelada'

    // Cancelado não entra em dinheiro nenhum nem na contagem de
    // pendências de conferência: não há o que conferir num vale que
    // não virou venda.
    if (!cancelado) {
      valorCompraCents += vale.valorCompraCents
      valorEntregaCents += vale.valorEntregaCents
      valorFarmaciaDeveCents += vale.valorEntregaCents - vale.entregaPagaClienteCents
      pagoEmMaosCents += vale.entregaPagaClienteCents

      if (vale.statusFinanceiro === 'conferido') conferidos += 1
      else if (vale.statusFinanceiro === 'divergente') divergentes += 1
      else pendentes += 1
    }
  }

  return {
    totalVales: vales.length,
    conferidos,
    divergentes,
    pendentes,
    valorCompraCents,
    valorEntregaCents,
    valorFarmaciaDeveCents,
    pagoEmMaosCents,
    // mesma regra do marcarDiaConferido abaixo, pra a lista mostrar
    // exatamente o que o botão vai alcançar: nem cancelado (não virou
    // venda) nem divergente (a marca fica de propósito).
    aConferir: vales.filter(
      (v) => v.statusEntrega !== 'cancelada' && v.statusFinanceiro === 'na_ordem'
    ),
    divergencias: vales.filter((v) => v.formasRealizadas.length > 0),
    pagosEmMaos: vales.filter((v) => v.entregaPagaClienteCents > 0 && v.statusEntrega !== 'cancelada'),
    cancelados: vales.filter((v) => v.statusEntrega === 'cancelada'),
    insucessos: vales.filter((v) => v.statusEntrega === 'insucesso'),
    truncado: temMais,
  }
}

export function useFechamento(filtro: FiltroFechamento) {
  return useQuery({ queryKey: ['fechamento', filtro], queryFn: () => buscarFechamento(filtro) })
}

// Marca em bloco os vales do dia como conferidos. Só mexe nos que estão
// em 'na_ordem': divergente NÃO vira conferido — ele continua marcado
// justamente porque precisa subir pra administração, e apagar essa marca
// no fechamento faria o problema desaparecer da vista.
//
// Cancelado também fica de fora: não virou venda, não há o que conferir.
//
// A trigger fn_entrega_protege_conferencia barra quem não é gerente/admin
// no banco — a tela esconder o botão não é garantia.
async function marcarDiaConferido(input: {
  data: string
  lojaId: string
}): Promise<{ conferidos: number }> {
  const inicio = new Date(`${input.data}T00:00:00`)
  const fim = new Date(`${input.data}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  let q = supabase
    .from('entregas')
    .update({ status_financeiro: 'conferido' })
    .eq('tipo', 'cliente')
    .eq('status_financeiro', 'na_ordem')
    .neq('status_entrega', 'cancelada')
    .gte('ocorrido_em_local', inicio.toISOString())
    .lt('ocorrido_em_local', fim.toISOString())
  if (input.lojaId) q = q.eq('loja_id', input.lojaId)

  const { data, error } = await q.select('id')
  if (error) throw error
  return { conferidos: data?.length ?? 0 }
}

export function useMarcarDiaConferido() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: marcarDiaConferido,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-historico'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}
