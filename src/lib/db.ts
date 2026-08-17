import Dexie, { type EntityTable } from 'dexie'
import type { NovaEntrega, NovaTransferencia } from '@/data/entregas'
import type { NovaCorridaComAssinatura, FecharCorridaInput } from '@/data/corridas'
import type { MarcarDivergenciaInput } from '@/data/pagamentos'
import type { NotificarFaltaReceitaInput } from '@/data/documentos'
import type { SaidaOfflineInput } from '@/data/romaneios'

export type TipoOperacaoFila =
  | 'entrega'
  | 'transferencia'
  | 'corrida'
  | 'romaneio_saida'
  | 'divergencia'
  | 'fechamento_corrida'
  | 'falta_receita'

export type PayloadPorTipo = {
  entrega: NovaEntrega
  transferencia: NovaTransferencia
  // Fluxo antigo de corrida. NADA MAIS PRODUZ ITENS DESTE TIPO desde que
  // a Nova Corrida virou romaneio — mas o handler continua aqui de
  // propósito: pode haver item deste tipo parado na fila de alguém, e
  // remover o tipo faria essa saída (que já aconteceu de verdade)
  // desaparecer sem sincronizar nunca. Some quando não houver mais
  // nenhum na base instalada.
  corrida: NovaCorridaComAssinatura
  romaneio_saida: SaidaOfflineInput
  divergencia: MarcarDivergenciaInput
  fechamento_corrida: FecharCorridaInput
  falta_receita: NotificarFaltaReceitaInput
}

// `pendente` e `erro` voltam a ser tentados; `bloqueado` e `terminal` não.
//
//   bloqueado → é de outro usuário. Espera aquela conta entrar.
//   terminal  → conflito, ou recusa definitiva do servidor. Retentar só
//               repetiria o mesmo resultado; isto aqui precisa de gente.
export type StatusItemFila = 'pendente' | 'erro' | 'bloqueado' | 'terminal'

export type ItemFilaOperacao = {
  [K in TipoOperacaoFila]: {
    // Chave da fila, própria e sem significado de negócio.
    //
    // Antes disto o id era o do negócio (corridaId, entregaId), e havia
    // um bug esperando: `corrida` e `fechamento_corrida` usavam AMBAS o
    // corridaId, então fechar uma corrida ainda não sincronizada
    // SUBSTITUÍA a criação dela no `put`. A corrida nunca era criada, e o
    // fechamento seguinte batia em 0 linhas — que no PostgREST não é
    // erro. Perda silenciosa.
    id: string
    tipo: K
    payload: PayloadPorTipo[K]

    // Identificador de negócio, pra outra operação poder declarar
    // dependência sem conhecer a chave da fila.
    chave?: string
    // Só roda quando nenhuma operação com esta chave estiver mais na
    // fila. É o que impede o retorno de sincronizar antes da saída.
    dependeDeChave?: string

    // Dono. A fila é por usuário: quem registrou é quem sincroniza.
    userId: string
    tenantId: string
    lojaId: string | null

    status: StatusItemFila
    criadoEm: string
    tentativas: number
    // ISO. Backoff com jitter — ver calcularProximaTentativa.
    proximaTentativaEm: string
    erro?: string
    // Resultado de conflito, pra tela poder mostrar o que houve.
    detalhe?: unknown
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

type ItemFilaOperacaoV2 = {
  id: string
  tipo: TipoOperacaoFila
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
  status: 'pendente' | 'erro'
  criadoEm: string
  tentativas: number
  erro?: string
}

// Espelho local de quais cartões existem, pra bipar funcionar sem rede.
//
// Só o que aparece na tela: nada de token, nada de hash — esses nem
// chegam ao navegador, porque o GRANT por coluna não os inclui. Aqui
// dentro há um `public_id`, que sozinho não autentica nada (quem
// autentica é o PIN, e ele nunca sai do envelope selado).
export type CredencialEmCache = {
  publicId: string
  motoboyId: string
  motoboyNome: string
  agenciaId: string | null
  agenciaNome: string | null
  temPin: boolean
  atualizadoEm: string
}

const db = new Dexie('tele-entregas') as Dexie & {
  filaOperacoes: EntityTable<ItemFilaOperacao, 'id'>
  credenciaisCache: EntityTable<CredencialEmCache, 'publicId'>
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

db.version(3)
  .stores({
    filaOperacoes: 'id, status, tipo, userId, chave, proximaTentativaEm',
  })
  .upgrade(async (tx) => {
    const tabela = tx.table('filaOperacoes')
    const antigos = (await tabela.toArray()) as ItemFilaOperacaoV2[]

    for (const item of antigos) {
      // Item da v2 não sabe de quem é — o campo não existia. Marcar com
      // userId vazio e DEIXAR SINCRONIZAR é decisão consciente: são
      // operações reais já registradas (uma entrega lançada, uma corrida
      // que saiu), e travá-las aqui perderia trabalho de verdade pra
      // fechar uma janela que só existe no instante desta migração.
      // Daqui pra frente todo item nasce com dono.
      await tabela.put({
        ...item,
        userId: item.payload?.criadoPor ?? item.payload?.registradoPor ?? '',
        tenantId: item.payload?.tenantId ?? '',
        lojaId: item.payload?.lojaId ?? null,
        proximaTentativaEm: new Date(0).toISOString(),
      })
    }
  })


// v4 acrescenta só o cache de credenciais. A fila não muda de forma, e
// por isso esta versão não tem upgrade: tabela nova nasce vazia e é
// preenchida na primeira vez que o app abrir com rede.
db.version(4).stores({
  filaOperacoes: 'id, status, tipo, userId, chave, proximaTentativaEm',
  credenciaisCache: 'publicId, motoboyId',
})

export { db }
