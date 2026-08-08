import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ItemFilaEntrega } from '@/lib/db'
import { queryClient } from '@/lib/queryClient'
import { criarEntrega, type NovaEntrega } from '@/data/entregas'

// Grava local primeiro (sempre funciona, mesmo sem rede), tenta enviar em
// seguida. UUID v7 já vem gerado no cliente (regra 5) — reenvio é upsert,
// nunca duplicata, então retry é seguro mesmo em falha parcial.
export async function enfileirarEntrega(payload: NovaEntrega) {
  await db.filaEntregas.put({
    id: payload.id,
    payload,
    status: 'pendente',
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  })
  void processarFilaEntregas()
}

let processando = false

export async function processarFilaEntregas() {
  if (processando) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  processando = true
  try {
    const pendentes = await db.filaEntregas.toArray()
    for (const item of pendentes) {
      try {
        await criarEntrega(item.payload)
        await db.filaEntregas.delete(item.id)
        queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      } catch (error) {
        await db.filaEntregas.update(item.id, {
          status: 'erro',
          tentativas: item.tentativas + 1,
          erro: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    processando = false
  }
}

export function useFilaEntregasPendentes(): ItemFilaEntrega[] {
  return useLiveQuery(() => db.filaEntregas.toArray(), [], [])
}

// Dispara sync ao voltar internet e uma vez ao abrir o app — sem isso a
// fila só esvazia na próxima vez que alguém cadastrar uma entrega nova.
export function useSincronizarFilaOffline() {
  useEffect(() => {
    void processarFilaEntregas()
    window.addEventListener('online', processarFilaEntregas)
    return () => window.removeEventListener('online', processarFilaEntregas)
  }, [])
}
