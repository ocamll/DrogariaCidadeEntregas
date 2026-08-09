import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ItemFilaOperacao, type PayloadPorTipo, type TipoOperacaoFila } from '@/lib/db'
import { queryClient } from '@/lib/queryClient'
import { criarEntrega, criarTransferencia } from '@/data/entregas'
import { criarCorridaComAssinatura, fecharCorrida } from '@/data/corridas'
import { marcarDivergencia } from '@/data/pagamentos'
import { notificarFaltaReceita } from '@/data/documentos'

// Query keys invalidadas por tipo de operação, depois de sincronizar com
// sucesso — mesmas listas que cada tela já invalidava quando escrevia direto
// (ver histórico de src/data/entregas.ts, corridas.ts, pagamentos.ts).
const QUERY_KEYS_POR_TIPO: Record<TipoOperacaoFila, string[]> = {
  entrega: ['entregas-hoje'],
  transferencia: ['entregas-hoje'],
  corrida: ['entregas-hoje', 'entregas-pendentes-sem-corrida', 'entregas-historico'],
  divergencia: ['entregas-hoje', 'entregas-historico', 'notificacoes-hoje', 'notificacoes-todas'],
  fechamento_corrida: [
    'entregas-hoje',
    'entregas-historico',
    'corridas-abertas',
    'notificacoes-hoje',
    'notificacoes-todas',
  ],
  falta_receita: ['notificacoes-hoje', 'notificacoes-todas'],
}

async function executarOperacao(item: ItemFilaOperacao): Promise<void> {
  switch (item.tipo) {
    case 'entrega':
      await criarEntrega(item.payload)
      return
    case 'transferencia':
      await criarTransferencia(item.payload)
      return
    case 'corrida':
      await criarCorridaComAssinatura(item.payload)
      return
    case 'divergencia':
      await marcarDivergencia(item.payload)
      return
    case 'fechamento_corrida':
      await fecharCorrida(item.payload)
      return
    case 'falta_receita':
      await notificarFaltaReceita(item.payload)
      return
  }
}

// Grava local primeiro (sempre funciona, mesmo sem rede), tenta enviar em
// seguida. Todo id relevante já vem determinístico dentro do payload (gerado
// por quem chama, regra 5 do CLAUDE.md) — reenvio é sempre seguro, nunca
// duplicata, mesmo depois de falha parcial.
export async function enfileirarOperacao<T extends TipoOperacaoFila>(
  tipo: T,
  id: string,
  payload: PayloadPorTipo[T]
) {
  await db.filaOperacoes.put({
    id,
    tipo,
    payload,
    status: 'pendente',
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  } as ItemFilaOperacao)
  void processarFilaOperacoes()
}

let processando = false

export async function processarFilaOperacoes() {
  if (processando) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  processando = true
  try {
    const pendentes = await db.filaOperacoes.toArray()
    for (const item of pendentes) {
      try {
        await executarOperacao(item)
        await db.filaOperacoes.delete(item.id)
        for (const chave of QUERY_KEYS_POR_TIPO[item.tipo]) {
          queryClient.invalidateQueries({ queryKey: [chave] })
        }
      } catch (error) {
        await db.filaOperacoes.update(item.id, {
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

export function useFilaOperacoesPendentes(): ItemFilaOperacao[] {
  return useLiveQuery(() => db.filaOperacoes.toArray(), [], [])
}

// Dispara sync ao voltar internet e uma vez ao abrir o app — sem isso a
// fila só esvazia na próxima vez que alguém enfileirar algo novo.
export function useSincronizarFilaOffline() {
  useEffect(() => {
    void processarFilaOperacoes()
    window.addEventListener('online', processarFilaOperacoes)
    return () => window.removeEventListener('online', processarFilaOperacoes)
  }, [])
}
