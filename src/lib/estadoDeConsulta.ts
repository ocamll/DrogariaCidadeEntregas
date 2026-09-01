// O VOCABULÁRIO DO E2.
//
// Este arquivo NÃO IMPORTA NADA — nem o TanStack, nem o cliente Supabase.
// Mesma disciplina de `texto.ts`, `canonico.ts`, `tokenCartao.ts` e
// `caminhosNoDrive.ts`: regra que decide o que a tela AFIRMA tem que
// caber num teste sem rede e sem navegador. É por isso que a entrada é
// `LeituraDeConsulta`, um tipo estrutural nosso, e não `UseQueryResult`.
//
// ---------------------------------------------------------------------
// AS DUAS PERGUNTAS, QUE ATÉ AQUI ESTAVAM MISTURADAS
// ---------------------------------------------------------------------
//
//   1. TRANSPORTE   a consulta conseguiu responder?
//                   inactive · loading · ready · unavailable · error
//
//   2. DOMÍNIO      se respondeu, qual foi o veredito?
//                   aceito · recusado(motivo)
//
// A mistura de idiomas é deliberada, e diz de que camada cada palavra
// fala: `loading`/`ready`/`unavailable` são o estado técnico da OBTENÇÃO
// do dado; `aceito`/`recusado` são o significado da resposta PARA A
// FARMÁCIA. Traduzir um dos lados por uniformidade apagaria a fronteira
// que o arquivo inteiro existe pra marcar.
//
// `nao_encontrado` NÃO é falha de consulta. É uma consulta bem-sucedida
// cujo resultado de domínio foi negativo — e por isso ele só existe
// DENTRO de `ready`, nunca ao lado dele. O tipo é composto justamente
// pra isso:
//
//     EstadoDeConsulta<Veredito<Credencial, MotivoDoCartao>>
//
// Assim "cartão não existe" é inalcançável sem antes ter havido uma
// resposta confiável. Tornar o erro impossível de representar vale mais
// que rejeitá-lo — é a mesma razão de `pagamentosRealizados` ser
// aninhado no vale, e não uma lista plana ao lado.
//
// ---------------------------------------------------------------------
// A POLARIDADE, QUE É O DEFEITO QUE O E2 EXISTE PRA MATAR
// ---------------------------------------------------------------------
//
//     desconhecido  ≠  vazio
//
// Um vazio só pode ser afirmado depois de `ready` COM dado de fato
// vazio. Antes disso a tela não sabe, e dizer "nenhum registro" é
// afirmar sobre o mundo o que se sabe apenas sobre a própria consulta.
//
// O caso medido que justifica o arquivo inteiro: com `networkMode`
// padrão (`'online'`), uma query offline SEM cache pausa. Aí
// `fetchStatus === 'paused'` e `isFetching === false`, e como
// `isLoading = isPending && isFetching` (medido no fonte de
// `@tanstack/query-core`), **`isLoading` vem `false`**. `isError`
// também é `false`, e `data` é `undefined`. Toda cadeia escrita como
//
//     if (isLoading) …; if (isError) …; if (!data) → "nenhum registro"
//
// cai no último ramo e MENTE. É por isso que a derivação abaixo nunca
// olha `isLoading`.
// ---------------------------------------------------------------------

/**
 * O subconjunto de `UseQueryResult` de que a derivação precisa.
 *
 * Estrutural de propósito: `UseQueryResult` é atribuível a isto, então a
 * chamada continua sendo `derivarEstado(query)` — mas o dia em que o
 * TanStack mudar de forma, quem reclama é o TypeScript no ponto de uso,
 * e não uma tela que passa a mentir em silêncio.
 */
export type LeituraDeConsulta<T> = {
  data: T | undefined
  status: 'pending' | 'success' | 'error'
  fetchStatus: 'fetching' | 'paused' | 'idle'
  error?: unknown
}

/**
 * De onde veio o dado que está na tela. Só existe em `ready`, porque só
 * faz sentido quando há dado.
 *
 * Serve pra não trocarmos o defeito "offline parece vazio" pelo defeito
 * "offline esconde o que já temos": com cache utilizável a tela CONTINUA
 * mostrando os dados, e o aviso de desatualização vai ao lado.
 */
export type Procedencia =
  /** Resposta do servidor nesta sessão. Nada a avisar. */
  | 'servidor'
  /** Há cache, mas não há rede pra confirmar. */
  | 'cache_sem_rede'
  /** Há cache, e a última tentativa de atualizar falhou. */
  | 'cache_apos_falha'

export type EstadoDeConsulta<T> =
  /**
   * A consulta ainda não deve acontecer: desligada por `enabled`,
   * diálogo fechado, filtro não preenchido. Não há dado, e nem deveria.
   *
   * CHAMA-SE `inactive`, E NÃO `idle`, DE PROPÓSITO. O TanStack já usa
   * `fetchStatus: 'idle'` no mesmo ecossistema, com outro sentido — lá
   * quer dizer "não está buscando AGORA", o que inclui uma consulta que
   * já terminou e tem dado. Dois `'idle'` com significados diferentes,
   * a duas linhas um do outro, produziriam leitura errada num arquivo
   * que ninguém abre há meses:
   *
   *     if (query.fetchStatus === 'idle')   // já respondeu, ou nunca correu
   *     if (estado.estado === 'idle')       // nunca correu, e não há dado
   *
   * A tradução `TanStack: idle → nosso: inactive` é visível justamente
   * porque as palavras diferem; `idle → idle` pareceria equivalência.
   */
  | { estado: 'inactive' }
  /** Perguntamos e estamos esperando. */
  | { estado: 'loading' }
  /** Temos resposta utilizável. É o ÚNICO estado que carrega dado. */
  | { estado: 'ready'; dados: T; procedencia: Procedencia }
  /**
   * Não há resposta autoritativa E não há dado local suficiente pra
   * apresentar uma conclusão.
   *
   * NÃO é "o servidor deu erro" (isso é `error`), NÃO é "respondeu que
   * não existe" (isso é `ready` com veredito `recusado`), e NÃO é "temos
   * cache e a internet caiu" (isso continua `ready`, com `procedencia`).
   */
  | { estado: 'unavailable' }
  /** Houve tentativa e ela falhou. Sabemos que não sabemos, e por quê. */
  | { estado: 'error'; erro: unknown }

/**
 * O veredito de DOMÍNIO. Só existe dentro de `ready`.
 *
 * `M` é fechado por feature, e não global: o cartão pode recusar por
 * `formato_invalido`, o PIN não. Um enum único forçaria cada consulta a
 * carregar os motivos das outras.
 */
export type Veredito<T, M extends string> =
  | { veredito: 'aceito'; valor: T }
  | { veredito: 'recusado'; motivo: M; mensagem: string }

/** A composição que o E2 usa de verdade. Transporte por fora, domínio por dentro. */
export type ConsultaComVeredito<T, M extends string> = EstadoDeConsulta<Veredito<T, M>>

export function aceito<T, M extends string>(valor: T): Veredito<T, M> {
  return { veredito: 'aceito', valor }
}

export function recusado<T, M extends string>(motivo: M, mensagem: string): Veredito<T, M> {
  return { veredito: 'recusado', motivo, mensagem }
}

/**
 * A ÚNICA tradução de `UseQueryResult` para o vocabulário do E2.
 *
 * A ordem dos ramos é o contrato, não estilo — ver o comentário de cada
 * um. `scripts/estado-de-consulta.spec.mts` congela os dois casos que
 * motivaram o E2 inteiro.
 */
export function derivarEstado<T>(leitura: LeituraDeConsulta<T>): EstadoDeConsulta<T> {
  // (1) DADO UTILIZÁVEL MANDA — mesmo pausado, mesmo depois de um
  //     refetch que falhou. Apagar a tela porque a rede caiu seria
  //     trocar um defeito por outro: o operador tinha a informação e
  //     passou a não ter.
  if (leitura.data !== undefined) {
    return { estado: 'ready', dados: leitura.data, procedencia: procedenciaDe(leitura) }
  }

  // (2) Sem dado, e houve resposta: falhou.
  if (leitura.status === 'error') {
    return { estado: 'error', erro: leitura.error }
  }

  // (3) Sem dado e sem a quem perguntar. ESTE é o ramo que hoje vira
  //     "nenhum registro" em seis lugares.
  if (leitura.fetchStatus === 'paused') {
    return { estado: 'unavailable' }
  }

  // (4) Sem dado, perguntando agora.
  if (leitura.fetchStatus === 'fetching') {
    return { estado: 'loading' }
  }

  // (5) Sem dado e ninguém perguntou: query desligada por `enabled`, ou
  //     um `select` que devolveu `undefined`. Nos dois casos a tela não
  //     sabe de nada — e `inactive` é o único estado que não afirma
  //     nada. Repare que aqui `fetchStatus` do TanStack é `'idle'` e a
  //     nossa leitura dele é `'inactive'`: é a tradução, não um
  //     sinônimo.
  return { estado: 'inactive' }
}

function procedenciaDe<T>(leitura: LeituraDeConsulta<T>): Procedencia {
  if (leitura.fetchStatus === 'paused') return 'cache_sem_rede'
  if (leitura.status === 'error') return 'cache_apos_falha'
  return 'servidor'
}

/**
 * "Está vazio" só pode ser dito depois de `ready`.
 *
 * Existe pra nenhuma tela voltar a escrever `data?.length === 0` ou
 * `(data ?? []).length === 0`. Os dois passam despercebidos: o primeiro
 * escapa por acidente (`undefined === 0` é `false`), o segundo AFIRMA
 * vazio sobre uma consulta que nunca respondeu.
 */
export function vazioConfirmado<T>(estado: EstadoDeConsulta<readonly T[]>): boolean {
  return estado.estado === 'ready' && estado.dados.length === 0
}

/** O veredito, quando já houve resposta. `null` quer dizer "ainda não sabemos". */
export function vereditoDe<T, M extends string>(
  estado: ConsultaComVeredito<T, M>
): Veredito<T, M> | null {
  return estado.estado === 'ready' ? estado.dados : null
}

// =====================================================================
// A APRESENTAÇÃO — congelada em 2026-08-26
//
// O que cada estado tem PERMISSÃO de dizer e de oferecer. Mora aqui, em
// função pura, e não dentro do JSX, por dois motivos: o projeto testa
// decisão sem navegador, e uma regra escrita em `.tsx` teria que ser
// reconferida a cada tela que a copiasse.
// =====================================================================

/**
 * `aviso` informa; `falha` acusa uma tentativa que não deu certo.
 *
 * A separação é do contrato, não decorativa: `unavailable` é o sistema
 * dizendo que não tem como saber, e pintá-lo de vermelho de erro faria
 * "estou sem internet" parecer "alguma coisa quebrou".
 */
export type TomDaConsulta = 'aviso' | 'falha'

export type Apresentacao = {
  /** A feature pode renderizar o dado? Só em `ready`. */
  mostraDados: boolean
  /** Indicador de consulta em andamento. */
  emAndamento: boolean
  /** O bloco de mensagem, quando houver. */
  aviso: { titulo: string; detalhe: string | null; tom: TomDaConsulta } | null
  /**
   * O botão, quando fizer sentido — e ele é `null` em `unavailable`.
   *
   * ESSA AUSÊNCIA É A DECISÃO MAIS IMPORTANTE DO E2.2. Em `unavailable`
   * não há a quem perguntar, então um botão só produziria o mesmo
   * resultado — e ensinaria o operador a martelar uma consulta que o
   * próprio sistema sabe que não pode executar. A recuperação é
   * automática: quando a rede voltar, o TanStack retoma sozinho.
   *
   * Em `error` houve tentativa real, que pode ter sido transitória; aí
   * repetir é uma ação com sentido.
   */
  acao: { rotulo: string } | null
}

/** Onde a mensagem vai aparecer. Muda só o texto de `unavailable`. */
export type VarianteDeConsulta =
  /** Uma lista ou uma tela: ocorrências, pendências, auditoria. */
  | 'lista'
  /** Uma verificação pontual: bipar um cartão, conferir um PIN. */
  | 'verificacao'
  /**
   * Um CAMPO de formulário que depende da consulta. O rótulo é o
   * substantivo no PLURAL — "Filiais", "Cidades", "Agências" —, porque
   * ao lado de um campo já rotulado o genérico não diz QUAL dependência
   * caiu.
   *
   * Mora aqui, e não no componente, por causa do gate: `Consulta.tsx` é
   * casca e não pode escolher texto. A primeira versão disto escolhia,
   * e `fiacao-estado-de-consulta.spec.mts` reprovou.
   */
  | { campo: string }

const DETALHE_SEM_FONTE = 'Sem conexão e sem dados disponíveis neste dispositivo.'

export const TEXTO_INDISPONIVEL = {
  lista: { titulo: 'Dados indisponíveis no momento.', detalhe: DETALHE_SEM_FONTE },
  verificacao: { titulo: 'Não foi possível verificar agora.', detalhe: DETALHE_SEM_FONTE },
} as const

/**
 * O texto de `unavailable` para a variante pedida.
 *
 * Só o NÚMERO varia em "indisponível/indisponíveis", nunca o gênero,
 * então concatenar o substantivo plural é seguro para Filiais, Cidades,
 * Agências e Convênios. Um rótulo no singular sairia errado ("Filial
 * indisponíveis") — está escrito aqui em vez de ficar implícito.
 *
 * O `detalhe` é o MESMO nas três: a causa não muda por o dado estar
 * alimentando um select em vez de uma tabela.
 */
export function textoIndisponivelDe(variante: VarianteDeConsulta) {
  if (typeof variante === 'object') {
    return { titulo: `${variante.campo} indisponíveis no momento.`, detalhe: DETALHE_SEM_FONTE }
  }
  return TEXTO_INDISPONIVEL[variante]
}

export const TEXTO_ERRO = 'Não foi possível carregar os dados.'

/**
 * O texto de `error` para a variante pedida — a tentativa falhou.
 *
 * A forma do campo é `"Filiais: não foi possível carregar."` e NÃO
 * `"…carregar as filiais"`, que era o fraseado natural: o artigo exige
 * concordância de GÊNERO ("as filiais", "os convênios"), e o rótulo é
 * uma string livre. Sem artigo, só o número importa — a mesma razão de
 * o rótulo ser plural em `textoIndisponivelDe`. É um pouco mais seco, e
 * é sempre certo.
 */
export function textoErroDe(variante: VarianteDeConsulta): string {
  if (typeof variante === 'object') return `${variante.campo}: não foi possível carregar.`
  if (variante === 'verificacao') return 'Não foi possível concluir a verificação.'
  return TEXTO_ERRO
}


/** O aviso que acompanha `ready` quando o dado não veio do servidor agora. */
export const TEXTO_PROCEDENCIA: Record<Procedencia, string | null> = {
  servidor: null,
  cache_sem_rede: 'Exibindo dados disponíveis offline; podem estar desatualizados.',
  cache_apos_falha: 'Não foi possível atualizar. Exibindo os últimos dados disponíveis.',
}

export const ROTULO_ACAO = {
  /** `error` — houve tentativa, e ela pode ter sido transitória. */
  tentarDeNovo: 'Tentar novamente',
  /** `ready` sobre cache, depois de uma atualização que falhou. */
  atualizar: 'Atualizar',
} as const

/**
 * A tabela do contrato, executável.
 *
 *   estado                    dados  progresso  aviso   ação
 *   ------------------------  -----  ---------  ------  ----------------
 *   inactive                   não      não      —       —
 *   loading                    não      SIM      —       —
 *   ready · servidor           SIM      não      —       —
 *   ready · cache_sem_rede     SIM      não      aviso   —
 *   ready · cache_apos_falha   SIM      não      aviso   Atualizar
 *   unavailable                não      não      aviso   —      ← sem CTA
 *   error                      não      não      falha   Tentar novamente
 */
export function apresentar<T>(
  estado: EstadoDeConsulta<T>,
  variante: VarianteDeConsulta = 'lista'
): Apresentacao {
  switch (estado.estado) {
    // Ninguém perguntou, e não deveria. Sem mensagem de erro, sem CTA —
    // uma consulta desligada não é um problema a comunicar.
    case 'inactive':
      return { mostraDados: false, emAndamento: false, aviso: null, acao: null }

    case 'loading':
      return { mostraDados: false, emAndamento: true, aviso: null, acao: null }

    case 'ready': {
      const texto = TEXTO_PROCEDENCIA[estado.procedencia]
      return {
        mostraDados: true,
        emAndamento: false,
        aviso: texto ? { titulo: texto, detalhe: null, tom: 'aviso' } : null,
        // Só o cache DEPOIS DE FALHA oferece atualizar. Sem rede, o
        // botão teria o mesmo destino do de `unavailable`.
        acao: estado.procedencia === 'cache_apos_falha' ? { rotulo: ROTULO_ACAO.atualizar } : null,
      }
    }

    case 'unavailable':
      return {
        mostraDados: false,
        emAndamento: false,
        aviso: { ...textoIndisponivelDe(variante), tom: 'aviso' },
        acao: null,
      }

    case 'error':
      return {
        mostraDados: false,
        emAndamento: false,
        aviso: { titulo: textoErroDe(variante), detalhe: null, tom: 'falha' },
        acao: { rotulo: ROTULO_ACAO.tentarDeNovo },
      }
  }
}
