import Dexie, { type EntityTable } from 'dexie'
import type { NovaEntrega, NovaTransferencia } from '@/data/entregas'
import type { NovaCorridaComAssinatura, FecharCorridaInput } from '@/data/corridas'
import type { MarcarDivergenciaInput } from '@/data/pagamentos'
import type { NotificarFaltaReceitaInput } from '@/data/documentos'

export type TipoOperacaoFila =
  | 'entrega'
  | 'transferencia'
  | 'corrida'
  | 'divergencia'
  | 'fechamento_corrida'
  | 'falta_receita'

export type PayloadPorTipo = {
  entrega: NovaEntrega
  transferencia: NovaTransferencia
  corrida: NovaCorridaComAssinatura
  divergencia: MarcarDivergenciaInput
  fechamento_corrida: FecharCorridaInput
  falta_receita: NotificarFaltaReceitaInput
}

// União discriminada por `tipo` — cada item da fila carrega exatamente o
// payload que a função de escrita correspondente espera, ids determinísticos
// inclusos (é isso que torna reenvio seguro, ver src/data/*.ts).
export type ItemFilaOperacao = {
  [K in TipoOperacaoFila]: {
    id: string
    tipo: K
    payload: PayloadPorTipo[K]
    status: 'pendente' | 'erro'
    criadoEm: string
    tentativas: number
    erro?: string
  }
}[TipoOperacaoFila]

type ItemFilaEntregaV1 = {
  id: string
  payload: NovaEntrega
  status: 'pendente' | 'erro'
  criadoEm: string
  tentativas: number
  erro?: string
}

const db = new Dexie('tele-entregas') as Dexie & {
  filaOperacoes: EntityTable<ItemFilaOperacao, 'id'>
}

db.version(1).stores({
  filaEntregas: 'id, status',
})

db.version(2)
  .stores({
    filaEntregas: null,
    filaOperacoes: 'id, status, tipo',
  })
  .upgrade(async (tx) => {
    const antigos = (await tx.table('filaEntregas').toArray()) as ItemFilaEntregaV1[]
    await tx.table('filaOperacoes').bulkAdd(
      antigos.map((item) => ({ ...item, tipo: 'entrega' as const }))
    )
  })

export { db }
