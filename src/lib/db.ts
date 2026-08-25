import Dexie, { type EntityTable } from 'dexie'
import type { NovaEntrega, NovaTransferencia } from '@/data/entregas'
import type { MarcarDivergenciaInput } from '@/data/pagamentos'
import type { NotificarFaltaReceitaInput } from '@/data/documentos'
import type { SaidaOfflineInput, RetornoOfflineInput } from '@/data/romaneios'

// OS SEIS TIPOS DA V1.
//
// `corrida` e `fechamento_corrida` saíram em 2026-08-25. Eram os fluxos
// anteriores ao Romaneio de Saída e ao de Retorno, e desde 16/08 e 21/08
// nenhuma tela os enfileirava — o que os mantinha vivos era drenar filas
// antigas no IndexedDB das filiais. O corte para a V1 zera o Supabase e o
// estado local (v7, abaixo), então não há fila antiga para drenar.
//
// Tirá-los DAQUI é o que torna a regra estrutural em vez de combinada:
// `enfileirarOperacao('fechamento_corrida', …)` deixou de compilar. Uma
// regra que o compilador cobra não precisa de teste, nem de disciplina,
// nem de alguém lembrar dela daqui a seis meses.
export type TipoOperacaoFila =
  | 'entrega'
  | 'transferencia'
  | 'romaneio_saida'
  | 'romaneio_retorno'
  | 'divergencia'
  | 'falta_receita'

export type PayloadPorTipo = {
  entrega: NovaEntrega
  transferencia: NovaTransferencia
  romaneio_saida: SaidaOfflineInput
  // Tipo PRÓPRIO, não uma variação da saída — ver RetornoOfflineInput.
  // Nada o enfileira ainda: quem vai é a tela, na 2D.
  romaneio_retorno: RetornoOfflineInput
  divergencia: MarcarDivergenciaInput
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


// O contexto do retorno, guardado pra o retorno offline ter o que usar.
//
// Imutável por construção — sai de um romaneio de saída SELADO —, então
// ele não pode ficar velho: só pode não existir. É o que torna este
// cache diferente de todos os outros do projeto, e o que dispensa
// qualquer regra de invalidação.
//
// `versao` fica ao lado do objeto, e não só dentro dele, pra a leitura
// poder descartar um contexto de formato antigo SEM desserializar e
// adivinhar. Montar o DCRR1 a partir de um formato que esta versão não
// entende é a definição de assinar uma coisa e mandar outra.
export type ContextoRetornoEmCache = {
  corridaId: string
  versao: string
  contexto: unknown
  atualizadoEm: string
}

const db = new Dexie('tele-entregas') as Dexie & {
  filaOperacoes: EntityTable<ItemFilaOperacao, 'id'>
  credenciaisCache: EntityTable<CredencialEmCache, 'publicId'>
  contextosRetorno: EntityTable<ContextoRetornoEmCache, 'corridaId'>
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

// O BACKFILL DA v5 FOI REMOVIDO EM 2026-08-25.
//
// Ele existia pra dar `chave` a itens `fechamento_corrida` já gravados no
// IndexedDB de alguém — o tipo não existe mais, e a v7 abaixo apaga o
// conteúdo da fila de qualquer forma. Um upgrade que roda logo antes de
// um `clear()` é trabalho para ninguém.
//
// A VERSÃO 5 CONTINUA DECLARADA, e isso não é sobra: apagar uma versão
// do meio faz o Dexie de um navegador parado na v4 não achar caminho até
// a v7. A cadeia é o contrato; o `upgrade` dela é que ficou vazio.
db.version(5).stores({
  filaOperacoes: 'id, status, tipo, userId, chave, proximaTentativaEm',
  credenciaisCache: 'publicId, motoboyId',
})

// v6 acrescenta só o cache do contexto de retorno. Sem upgrade: tabela
// nova nasce vazia e é preenchida quando a lista de corridas abertas
// carregar com rede — mesmo arranjo da v4 com as credenciais.
db.version(6).stores({
  filaOperacoes: 'id, status, tipo, userId, chave, proximaTentativaEm',
  credenciaisCache: 'publicId, motoboyId',
  contextosRetorno: 'corridaId, atualizadoEm',
})

// =====================================================================
// v7 — O CORTE PRÉ-V1. ELA APAGA DADO LOCAL, DE PROPÓSITO.
//
// Todo conteúdo destas três tabelas referencia ids do Supabase:
//
//     filaOperacoes     operações apontando pra entregas e corridas
//     credenciaisCache  cartões, por public_id
//     contextosRetorno  documentos de saída selados
//
// O corte para a V1 zera o banco. Um artefato local que sobrevivesse a
// isso apontaria para linhas que não existem mais — e o pior caso não é
// falhar, é **sincronizar**: um item da fila reenviando uma operação
// contra um banco novo, ou um contexto cacheado montando um DCRR1 sobre
// uma saída que foi apagada.
//
// ---------------------------------------------------------------------
// ISTO SÓ PODE ESTAR CERTO UMA VEZ, E É AGORA
//
// Apagar `filaOperacoes` **descarta operação não sincronizada**. Hoje
// isso é seguro por três motivos que não se repetem: não existe deploy
// (o sistema nunca rodou fora de localhost), a fila foi medida vazia em
// 25/08, e o banco de destino vai ser zerado de qualquer forma.
//
// **Se um dia houver produção, uma v8 que faça isto perde trabalho real
// de gente que estava no balcão.** Uma limpeza de fila depois do go-live
// tem que ser cirúrgica — por tipo, por idade, por dono —, nunca um
// `clear()`. Esta versão é o último momento da vida do projeto em que a
// resposta grosseira é a resposta certa.
//
// Não há `.stores()` novo porque a FORMA não mudou: só o conteúdo sai.
// =====================================================================
db.version(7)
  .stores({
    filaOperacoes: 'id, status, tipo, userId, chave, proximaTentativaEm',
    credenciaisCache: 'publicId, motoboyId',
    contextosRetorno: 'corridaId, atualizadoEm',
  })
  .upgrade(async (tx) => {
    const antes = await tx.table('filaOperacoes').count()
    await tx.table('filaOperacoes').clear()
    await tx.table('credenciaisCache').clear()
    await tx.table('contextosRetorno').clear()
    // Contado e DITO. Um `clear()` silencioso seria indistinguível de
    // "a fila já estava vazia", e essas duas coisas não podem se
    // parecer num sistema que passou o projeto inteiro evitando perda
    // silenciosa.
    console.warn(
      `[fila offline] corte pré-V1: ${antes} operação(ões) local(is) descartada(s), ` +
        'mais os caches de credencial e de contexto. Ver a v7 em lib/db.ts.'
    )
  })

export { db }
