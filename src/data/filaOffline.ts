import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  type ItemFilaOperacao,
  type PayloadPorTipo,
  type TipoOperacaoFila,
} from '@/lib/db'
import { queryClient } from '@/lib/queryClient'
import { uuidv7 } from '@/lib/uuid'
import { supabase } from '@/lib/supabase'
import { criarEntrega, criarTransferencia } from '@/data/entregas'
import { criarCorridaComAssinatura, fecharCorrida } from '@/data/corridas'
import { marcarDivergencia } from '@/data/pagamentos'
import { notificarFaltaReceita } from '@/data/documentos'
import { sincronizarSaidaOffline, ErroTerminalDeSaida } from '@/data/romaneios'

// Query keys invalidadas por tipo de operação, depois de sincronizar com
// sucesso — mesmas listas que cada tela já invalidava quando escrevia
// direto.
//
// `eventos-auditoria` entra em TODAS: o Registro de Auditoria mostra os
// eventos crus, e toda operação daqui gera pelo menos um. Ele fica sempre
// montado (é quem desenha o botão do cabeçalho), então sem invalidar aqui
// o registro fica velho até alguém dar refresh.
const QUERY_KEYS_POR_TIPO: Record<TipoOperacaoFila, string[]> = {
  entrega: ['entregas-hoje', 'eventos-auditoria'],
  transferencia: ['transferencias', 'eventos-auditoria'],
  corrida: [
    'entregas-hoje',
    'transferencias',
    'entregas-pendentes-sem-corrida',
    'entregas-historico',
    'eventos-auditoria',
  ],
  romaneio_saida: [
    'entregas-hoje',
    'transferencias',
    'entregas-pendentes-sem-corrida',
    'entregas-historico',
    'romaneios',
    'eventos-auditoria',
  ],
  divergencia: [
    'entregas-hoje',
    'entregas-historico',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  fechamento_corrida: [
    'entregas-hoje',
    'transferencias',
    'entregas-historico',
    'corridas-abertas',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  falta_receita: ['notificacoes-hoje', 'notificacoes-todas', 'eventos-auditoria'],
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
    case 'romaneio_saida':
      await sincronizarSaidaOffline(item.payload)
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

// Backoff com jitter. Sem o jitter, várias operações que falharam juntas
// (queda de rede) voltam todas no mesmo milissegundo quando a rede
// retorna, e a segunda onda derruba de novo o que acabou de subir.
const ESPERAS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000]

function calcularProximaTentativa(tentativas: number): string {
  const base = ESPERAS_MS[Math.min(tentativas, ESPERAS_MS.length - 1)]
  const jitter = Math.random() * base * 0.3
  return new Date(Date.now() + base + jitter).toISOString()
}

export type OpcoesEnfileiramento = {
  // Identificador de negócio (corridaId, entregaId). Não é a chave da
  // fila — serve pra outra operação declarar dependência.
  chave?: string
  // Esta operação só roda quando nada com esta chave estiver mais na
  // fila. É o que impede o fechamento de corrida de sincronizar antes da
  // criação dela.
  dependeDeChave?: string
}

// Grava local primeiro (sempre funciona, mesmo sem rede) e tenta enviar
// em seguida. Todo id de negócio já vem determinístico dentro do payload
// (gerado por quem chama, regra 5) — reenvio é sempre seguro.
//
// A chave da fila, ao contrário, é gerada AQUI e é só dela. Antes ela era
// o id do negócio, e `corrida` e `fechamento_corrida` colidiam no mesmo
// corridaId: fechar uma corrida ainda não sincronizada substituía a
// criação dela.
export async function enfileirarOperacao<T extends TipoOperacaoFila>(
  tipo: T,
  dono: { userId: string; tenantId: string; lojaId: string | null },
  payload: PayloadPorTipo[T],
  opcoes: OpcoesEnfileiramento = {}
) {
  await db.filaOperacoes.put({
    id: uuidv7(),
    tipo,
    payload,
    chave: opcoes.chave,
    dependeDeChave: opcoes.dependeDeChave,
    userId: dono.userId,
    tenantId: dono.tenantId,
    lojaId: dono.lojaId,
    status: 'pendente',
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    proximaTentativaEm: new Date(0).toISOString(),
  } as ItemFilaOperacao)

  void processarFilaOperacoes()
}

let processando = false
let relogio: ReturnType<typeof setTimeout> | null = null

async function usuarioDaSessao(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export async function processarFilaOperacoes(): Promise<void> {
  if (processando) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    agendarProximaRodada()
    return
  }

  processando = true
  try {
    const usuario = await usuarioDaSessao()
    if (!usuario) return

    const todos = await db.filaOperacoes.toArray()
    // Ordem de criação. `uuidv7` é ordenável por tempo, mas ordenar pelo
    // campo explícito não depende disso continuar verdade.
    todos.sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : 0))

    const agora = Date.now()

    for (const item of todos) {
      if (item.status === 'terminal') continue

      // A fila é de quem a criou. O gate de verdade está na Edge Function
      // e nas policies; aqui é pra o caso normal nem chegar lá.
      // `userId` vazio é item herdado da versão 2 do banco local, de antes
      // de existir dono — ver o upgrade em lib/db.ts.
      if (item.userId && item.userId !== usuario) {
        if (item.status !== 'bloqueado') {
          await db.filaOperacoes.update(item.id, { status: 'bloqueado' })
        }
        continue
      }
      if (item.status === 'bloqueado') {
        await db.filaOperacoes.update(item.id, { status: 'pendente' })
      }

      // Dependência: não adianta fechar uma corrida que ainda não subiu.
      if (item.dependeDeChave && todos.some((outro) => outro.chave === item.dependeDeChave)) {
        continue
      }

      if (new Date(item.proximaTentativaEm).getTime() > agora) continue

      try {
        await executarOperacao(item)
        await db.filaOperacoes.delete(item.id)
        for (const chave of QUERY_KEYS_POR_TIPO[item.tipo]) {
          queryClient.invalidateQueries({ queryKey: [chave] })
        }
      } catch (error) {
        // Recusa definitiva (conflito de vale, autenticação que falhou,
        // envelope de outra operação) não melhora com repetição — só
        // gastaria tentativa e, no caso do PIN, bloquearia o motoboy.
        const terminal = error instanceof ErroTerminalDeSaida
        await db.filaOperacoes.update(item.id, {
          status: terminal ? 'terminal' : 'erro',
          tentativas: item.tentativas + 1,
          proximaTentativaEm: terminal
            ? new Date(0).toISOString()
            : calcularProximaTentativa(item.tentativas),
          erro: error instanceof Error ? error.message : String(error),
          detalhe: terminal ? (error as ErroTerminalDeSaida).detalhe : undefined,
        })
        if (terminal) {
          queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
        }
      }
    }
  } finally {
    processando = false
    agendarProximaRodada()
  }
}

// Sem isto a fila só tentava no evento `online` e uma vez ao abrir o app
// — uma falha às 9h ficava parada até alguém recarregar a página.
function agendarProximaRodada() {
  if (relogio) clearTimeout(relogio)

  void db.filaOperacoes.toArray().then((itens) => {
    const retentaveis = itens.filter((i) => i.status === 'pendente' || i.status === 'erro')
    if (retentaveis.length === 0) return

    const proxima = Math.min(
      ...retentaveis.map((i) => new Date(i.proximaTentativaEm).getTime())
    )
    const espera = Math.max(1_000, proxima - Date.now())
    relogio = setTimeout(() => void processarFilaOperacoes(), espera)
  })
}

// Retry manual, pro caso de alguém não querer esperar o backoff.
export async function tentarAgora() {
  const itens = await db.filaOperacoes.toArray()
  await Promise.all(
    itens
      .filter((i) => i.status === 'erro')
      .map((i) => db.filaOperacoes.update(i.id, { proximaTentativaEm: new Date(0).toISOString() }))
  )
  await processarFilaOperacoes()
}

export function useFilaOperacoesPendentes(): ItemFilaOperacao[] {
  return useLiveQuery(() => db.filaOperacoes.toArray(), [], [])
}

// Quantas operações ficariam paradas se este usuário saísse agora. É o
// que a confirmação de logout precisa saber.
export function useOperacoesDoUsuario(userId: string | undefined): ItemFilaOperacao[] {
  return useLiveQuery(
    async () => {
      if (!userId) return []
      const itens = await db.filaOperacoes.toArray()
      return itens.filter((i) => i.userId === userId && i.status !== 'terminal')
    },
    [userId],
    []
  )
}

export function useSincronizarFilaOffline() {
  useEffect(() => {
    void processarFilaOperacoes()
    window.addEventListener('online', processarFilaOperacoes)
    return () => {
      window.removeEventListener('online', processarFilaOperacoes)
      if (relogio) clearTimeout(relogio)
    }
  }, [])
}

// Açúcar pra não repetir o mesmo objeto em seis telas — e pra que
// acrescentar um campo de dono no futuro seja uma mudança só.
export function donoDaFila(profile: {
  id: string
  tenantId: string
  lojaId: string | null
}): { userId: string; tenantId: string; lojaId: string | null } {
  return { userId: profile.id, tenantId: profile.tenantId, lojaId: profile.lojaId }
}

// Tira da fila LOCAL um item terminal, depois que alguém olhou.
//
// Não apaga nada do servidor, e é isso que torna a operação segura: um
// conflito já está gravado lá como `romaneios` com status 'conflito',
// guardando o snapshot e os traços das duas assinaturas, mais o evento
// de auditoria. O item da fila era só o mensageiro — depois que a
// mensagem chegou, mantê-lo piscando "precisa de atenção" pra sempre não
// acrescenta informação, só ruído em cima do próximo problema de verdade.
//
// Só terminal: item que ainda vai retentar não se descarta, senão a
// operação se perderia mesmo.
export async function descartarItemTerminal(id: string) {
  const item = await db.filaOperacoes.get(id)
  if (!item || item.status !== 'terminal') return
  await db.filaOperacoes.delete(id)
}
