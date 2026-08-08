import Dexie, { type EntityTable } from 'dexie'
import type { NovaEntrega } from '@/data/entregas'

export type ItemFilaEntrega = {
  id: string // mesmo uuid v7 da entrega — idempotência (regra 5 do CLAUDE.md)
  payload: NovaEntrega
  status: 'pendente' | 'erro'
  criadoEm: string
  tentativas: number
  erro?: string
}

const db = new Dexie('tele-entregas') as Dexie & {
  filaEntregas: EntityTable<ItemFilaEntrega, 'id'>
}

db.version(1).stores({
  filaEntregas: 'id, status',
})

export { db }
