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
import { bloqueadoPorDependencia } from '@/lib/dependenciaDaFila'
import { supabase } from '@/lib/supabase'
import { criarEntrega, criarTransferencia } from '@/data/entregas'
import { marcarDivergencia } from '@/data/pagamentos'
import { notificarFaltaReceita, receberDocumento } from '@/data/documentos'
import {
  sincronizarSaidaOffline,
  sincronizarRetornoOffline,
  ErroTerminalDeSaida,
} from '@/data/romaneios'

// Query keys invalidadas por tipo de operação, depois de sincronizar com
// sucesso — mesmas listas que cada tela já invalidava quando escrevia
// direto.
//
// `eventos-auditoria` entra em TODAS: o Registro de Auditoria mostra os
// eventos crus, e toda operação daqui gera pelo menos um. Ele fica sempre
// montado (é quem desenha o botão do cabeçalho), então sem invalidar aqui
// o registro fica velho até alguém dar refresh.
const QUERY_KEYS_POR_TIPO: Record<TipoOperacaoFila, string[]> = {
  // 'vales-para-saida' entra em tudo que muda QUAIS VALES estão pendentes
  // sem corrida — que é a lista de onde o caixa escolhe o que vai sair.
  // Faltava, e a Nova Corrida seguia oferecendo vale que já tinha saído.
  entrega: ['entregas-hoje', 'vales-para-saida', 'eventos-auditoria'],
  transferencia: ['transferencias', 'vales-para-saida', 'eventos-auditoria'],
  romaneio_saida: [
    'entregas-hoje',
    'transferencias',
    'entregas-pendentes-sem-corrida',
    'vales-para-saida',
    'entregas-historico',
    'romaneios',
    'eventos-auditoria',
  ],
  // O retorno é a operação que mais mexe em coisa de uma vez: fecha a
  // corrida, grava o desfecho de cada vale, cria os pagamentos
  // realizados, deriva a divergência, recomputa `status_documental` e
  // gera um romaneio novo.
  //
  // ATENÇÃO ao `'romaneios'` da linha do `romaneio_saida` acima: NENHUMA
  // query usa essa chave. As reais são `'romaneio'` e
  // `'romaneios-do-dia'`, e o TanStack casa por elemento do array, não
  // por prefixo de string — então aquela invalidação não alcança nada
  // hoje. Não corrigi junto porque é fora do escopo da 2C.4 e mexe no
  // caminho da saída, que está em uso; fica anotado.
  romaneio_retorno: [
    'entregas-hoje',
    'transferencias',
    'entregas-historico',
    'corridas-abertas',
    'romaneios-do-dia',
    'documentos-convenio-pendentes',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  divergencia: [
    'entregas-hoje',
    'entregas-historico',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  falta_receita: ['notificacoes-hoje', 'notificacoes-todas', 'eventos-auditoria'],
  // Muda `status_documental`/`receita_recebida_*` do vale (as listas) e a
  // leitura do próprio vale no diálogo.
  receber_documento: [
    'documentos-do-vale',
    'entregas-hoje',
    'entregas-historico',
    'documentos-convenio-pendentes',
    'receitas-pendentes',
    'eventos-auditoria',
  ],
}

async function executarOperacao(item: ItemFilaOperacao): Promise<void> {
  switch (item.tipo) {
    case 'entrega':
      await criarEntrega(item.payload)
      return
    case 'transferencia':
      await criarTransferencia(item.payload)
      return
    case 'romaneio_saida':
      await sincronizarSaidaOffline(item.payload)
      return
    case 'divergencia':
      await marcarDivergencia(item.payload)
      return
    case 'romaneio_retorno':
      await sincronizarRetornoOffline(item.payload)
      return
    case 'falta_receita':
      await notificarFaltaReceita(item.payload)
      return
    case 'receber_documento':
      await receberDocumento(item.payload)
      return
    default: {
      // A MESMA ARMADILHA, FECHADA PRA O PRÓXIMO TIPO.
      //
      // `noFallthroughCasesInSwitch` pega fallthrough ENTRE cases; não
      // pega case FALTANDO. Sem esta cláusula, acrescentar um tipo à
      // `TipoOperacaoFila` e esquecer o `case` faz a operação ser tratada
      // como sucesso e apagada da fila — perda silenciosa, a classe de
      // defeito que este arquivo já pagou duas vezes.
      //
      // Com o `never`, esquecer passa a ser erro de compilação.
      const naoTratado: never = item
      throw new Error(
        `Tipo de operação sem handler na fila: ${(naoTratado as ItemFilaOperacao).tipo}`
      )
    }
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
): Promise<string> {
  const idFila = uuidv7()
  await db.filaOperacoes.put({
    id: idFila,
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

  // Devolve a chave da FILA (não a do negócio) pra quem chamou poder
  // acompanhar esta operação específica — é o que permite o aviso da tela
  // dizer "sincronizando" só enquanto ela está mesmo na fila, e parar de
  // dizer quando ela sai. Quem não se importa continua ignorando o
  // retorno. Repare que a resolução acontece DEPOIS do `put`: quando o
  // chamador tem o id em mãos, a linha já existe no IndexedDB, então
  // "não está mais na fila" passa a significar mesmo "já sincronizou", e
  // não "ainda não chegou".
  return idFila
}

let processando = false
// Quando a rodada em curso começou. Sem isto, `processando` é uma trava
// sem saída: basta UM `await` que nunca resolve pra fila inteira parar
// pra sempre, e o sintoma é o pior possível — o item fica "Na fila",
// sem erro, com `tentativas` em 0, e nada mais é tentado nem depois de
// reconectar. Só um F5 destravava.
//
// Não há timeout em nenhum ponto da cadeia (`functions.invoke` não tem, e
// `fetch` sem `signal` espera indefinidamente), então a possibilidade é
// real, não teórica. O relógio aqui é a rede de segurança geral: vale pra
// qualquer operação que pendure, não só a que motivou a descoberta.
let processandoDesde = 0
const LIMITE_RODADA_MS = 90_000
let relogio: ReturnType<typeof setTimeout> | null = null

async function usuarioDaSessao(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export async function processarFilaOperacoes(): Promise<void> {
  // A rodada anterior pode ter pendurado num `await` que nunca resolve.
  // Passado o limite, a nova rodada segue mesmo assim: no pior caso duas
  // rodadas se sobrepõem, e isso é seguro porque toda operação da fila é
  // idempotente por construção (ids determinísticos, upsert, 23505 tratado
  // como sucesso). Fila parada pra sempre não é seguro.
  if (processando && Date.now() - processandoDesde < LIMITE_RODADA_MS) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    agendarProximaRodada()
    return
  }

  processando = true
  processandoDesde = Date.now()
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
      //
      // O predicado saiu daqui pra `lib/dependenciaDaFila.ts` na 2C.3,
      // por duas razões. A primeira é que ele ganhou uma exclusão que
      // precisa de teste (`outro.id !== item.id`, contra a
      // self-dependency que deixava um item `pendente` pra sempre sem
      // erro nenhum). A segunda é que medir isto aqui dentro exigiria
      // deixar `processarFilaOperacoes` rodar de verdade — ou seja,
      // mandar operações reais pro servidor só pra observar qual delas
      // foi pulada.
      if (bloqueadoPorDependencia(item, todos)) {
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
//
// Alcança 'pendente' TAMBÉM, e não só 'erro'. O caso que motivou isso: um
// item que nunca chegou a ser executado fica 'pendente' com `tentativas`
// em 0 e sem mensagem — e era justamente ele que o botão não alcançava,
// porque a tela só o habilitava havendo item em 'erro'. Quem está olhando
// uma operação parada precisa de um jeito de cutucá-la, e "nunca foi
// tentada" é mais aflitivo que "falhou e vai tentar de novo".
export async function tentarAgora() {
  const itens = await db.filaOperacoes.toArray()
  await Promise.all(
    itens
      .filter((i) => i.status === 'erro' || i.status === 'pendente')
      .map((i) => db.filaOperacoes.update(i.id, { proximaTentativaEm: new Date(0).toISOString() }))
  )
  // Destrava uma rodada pendurada antes de tentar: sem isto o clique cairia
  // no guard `processando` e não faria nada — que é exatamente a sensação
  // de botão quebrado que o usuário relatou.
  processando = false
  await processarFilaOperacoes()
}

export function useFilaOperacoesPendentes(): ItemFilaOperacao[] {
  return useLiveQuery(() => db.filaOperacoes.toArray(), [], [])
}

/**
 * Uma operação recém-enfileirada, do jeito que a TELA precisa acompanhar
 * — o fato já consumado mais a promessa que entrega a chave da fila.
 *
 * Mora aqui, e não no componente que a desenha, por dois motivos: ela
 * descreve uma operação da fila (o assunto deste arquivo), e deixar o
 * construtor junto do componente fazia o arquivo dele exportar coisa que
 * não é componente — o que desliga o Fast Refresh dele, justamente o
 * arquivo que mais se mexe quando se ajusta texto de tela. Numa máquina
 * onde módulo velho em memória já custou um diagnóstico (§41), não vale.
 */
export type Gravacao = {
  /** O fato, sem cláusula de sincronização: "Entrega de José salva". */
  texto: string
  /** O que `enfileirarOperacao` devolve. A promessa resolve depois do
   *  `put`, então até lá a resposta honesta é "sincronizando". */
  enfileirando: Promise<string>
}

/**
 * Monta a `Gravacao`. Use SEMPRE isto, nunca o objeto literal.
 *
 * O `catch` vazio parece decorativo e não é. Quem trata a rejeição de
 * verdade é o efeito dentro do `StatusDeGravacao` — mas efeito roda num
 * tick posterior, e até lá o navegador já decidiu que a promessa é uma
 * `Uncaught (in promise)` e despejou o erro no console. Anexar uma
 * reação AQUI, no mesmo tick em que a promessa nasce, marca-a como
 * tratada sem tirar nada de quem trata depois: `.catch()` registra uma
 * reação sobre a original, não a consome.
 *
 * Medido: sem esta linha, cada falha de gravação suja o console com um
 * erro não tratado, ao lado da mensagem correta na tela.
 */
export function gravacaoEnfileirada(texto: string, enfileirando: Promise<string>): Gravacao {
  void enfileirando.catch(() => {})
  return { texto, enfileirando }
}

/**
 * O que aconteceu com UMA operação, pela chave de fila que
 * `enfileirarOperacao` devolveu.
 *
 * Existe porque as telas de lançamento afirmavam "sincronizando…" num
 * texto parado, que nunca era apagado: a frase continuava lá depois de a
 * operação ter subido, e continuaria lá se ela tivesse falhado. Duas
 * situações opostas com a mesma aparência — o defeito que este projeto
 * persegue desde o §39, a tela afirmando o que não sabe.
 *
 * `sincronizada` vem da AUSÊNCIA na fila, e isso só é confiável porque
 * `processarFilaOperacoes` deleta o item ao ter sucesso e o marca (nunca
 * remove) quando falha. Item que sumiu, subiu.
 */
export type SituacaoDaOperacao =
  /** ainda na fila; sai sozinha */
  | 'sincronizando'
  /** saiu da fila com sucesso */
  | 'sincronizada'
  /** falhou; o backoff vai tentar de novo */
  | 'erro'
  /** recusa definitiva; não resolve sozinha */
  | 'atencao'
  /** é de outro usuário; espera aquela conta entrar */
  | 'bloqueada'

const SITUACAO_POR_STATUS: Record<ItemFilaOperacao['status'], SituacaoDaOperacao> = {
  pendente: 'sincronizando',
  erro: 'erro',
  terminal: 'atencao',
  bloqueado: 'bloqueada',
}

export function useSituacaoDaOperacao(idFila: string | null): SituacaoDaOperacao | null {
  // Consulta PELO ID, e o resultado carrega de qual id ele é.
  //
  // A primeira versão lia a fila inteira e procurava o item na lista. Dá
  // no mesmo em regime, mas abre uma corrida na largada: entre `idFila`
  // aparecer e a liveQuery reconsultar, o array em mãos ainda é o de
  // antes do `put` — o item "não está lá", e o aviso concluía
  // **sincronizada** por um instante. Pior que o piscar: o timer de
  // sumiço já partia, e a mensagem podia se apagar antes de a operação
  // ter subido.
  //
  // Carimbar o id consultado dentro do resultado resolve sem timer nem
  // heurística: enquanto o carimbo não for o id atual, a resposta honesta
  // é "ainda não sei", e "ainda não sei" aqui se diz **sincronizando** —
  // que é o que de fato está acontecendo.
  const resultado = useLiveQuery(
    async () => ({
      para: idFila,
      item: idFila ? ((await db.filaOperacoes.get(idFila)) ?? null) : null,
    }),
    [idFila],
    undefined
  )

  if (!idFila) return null
  if (!resultado || resultado.para !== idFila) return 'sincronizando'
  return resultado.item ? SITUACAO_POR_STATUS[resultado.item.status] : 'sincronizada'
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
