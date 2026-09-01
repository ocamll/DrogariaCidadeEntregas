// npx tsx scripts/estado-de-consulta.spec.mts
//
// O GATE DO E2.
//
// Roda sem navegador porque `src/lib/estadoDeConsulta.ts` não importa
// nada. Uma regra que decide o que TODA tela de consulta afirma precisa
// ser exercitável fora do app — senão a única forma de saber o que a
// tela diz sem rede é ficar sem rede.
//
// DOIS CASOS SÃO OBRIGATÓRIOS, e estão marcados como tal abaixo. Eles
// são a razão de o E2 existir; se algum dia um deles for afrouxado, o
// arquivo inteiro perdeu o motivo.

import {
  derivarEstado,
  vazioConfirmado,
  vereditoDe,
  aceito,
  recusado,
  apresentar,
  TEXTO_INDISPONIVEL,
  TEXTO_PROCEDENCIA,
  type LeituraDeConsulta,
  type ConsultaComVeredito,
  type EstadoDeConsulta,
} from '../src/lib/estadoDeConsulta.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  checa(nome, ok, ok ? '' : `veio ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`)
}

/**
 * Constrói uma leitura como o TanStack a entrega. Os campos derivados
 * (`isLoading`, `isPending`, `isError`) vão junto de propósito nos casos
 * obrigatórios, pra a asserção poder AFIRMAR o valor deles — é o
 * contraste com eles que dá sentido ao resultado.
 */
function leitura<T>(p: Partial<LeituraDeConsulta<T>>): LeituraDeConsulta<T> {
  return { data: undefined, status: 'pending', fetchStatus: 'idle', ...p }
}

// ---------------------------------------------------------------------
console.log('\n--- (1) OBRIGATÓRIO: paused + sem dado = unavailable, NUNCA vazio ---')
// ---------------------------------------------------------------------
{
  // O caso medido: offline, sem cache, `networkMode` padrão.
  const l = leitura<string[]>({ data: undefined, status: 'pending', fetchStatus: 'paused' })

  // Primeiro o contraste, porque é ele que justifica o resto. Estes são
  // os valores que as seis telas de hoje consultam.
  const isFetching = l.fetchStatus === 'fetching'
  const isPending = l.status === 'pending'
  const isLoading = isPending && isFetching
  const isError = l.status === 'error'
  igual('isLoading vem false (é o defeito)', isLoading, false)
  igual('isError vem false', isError, false)
  igual('data vem undefined', l.data, undefined)

  const e = derivarEstado(l)
  igual('o derivador diz unavailable', e.estado, 'unavailable')
  checa('NÃO diz ready', e.estado !== 'ready')
  checa('NÃO diz error — offline não é erro', e.estado !== 'error')
  checa('NÃO diz inactive — nós PERGUNTAMOS, só não houve a quem', e.estado !== 'inactive')

  // A afirmação que o E2 existe pra impedir.
  checa('vazioConfirmado é FALSO — não dá pra dizer "nenhum registro"', !vazioConfirmado(e))
}

// ---------------------------------------------------------------------
console.log('\n--- (2) OBRIGATÓRIO: paused + dado em cache = ready, e o dado fica ---')
// ---------------------------------------------------------------------
{
  // Não trocamos "offline parece vazio" por "offline esconde o que já
  // temos".
  const e = derivarEstado(leitura({ data: ['a', 'b'], status: 'success', fetchStatus: 'paused' }))
  igual('diz ready mesmo pausado', e.estado, 'ready')
  checa('NÃO diz unavailable', e.estado !== 'unavailable')
  if (e.estado === 'ready') {
    igual('os dados continuam visíveis', e.dados.length, 2)
    igual('e vêm marcados como cache sem rede', e.procedencia, 'cache_sem_rede')
    checa('com aviso de desatualização', TEXTO_PROCEDENCIA[e.procedencia] !== null)
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (3) os outros ramos do transporte ---')
// ---------------------------------------------------------------------
{
  igual(
    'pending + fetching = loading',
    derivarEstado(leitura({ status: 'pending', fetchStatus: 'fetching' })).estado,
    'loading'
  )
  igual(
    'error sem dado = error',
    derivarEstado(leitura({ status: 'error', fetchStatus: 'idle', error: new Error('x') })).estado,
    'error'
  )
  igual(
    'success com dado = ready',
    derivarEstado(leitura({ data: [1], status: 'success', fetchStatus: 'idle' })).estado,
    'ready'
  )
  // Query desligada por `enabled` (o Registro de Auditoria faz isso com
  // o diálogo fechado). Ninguém perguntou — e `inactive` é o único
  // estado que não afirma nada sobre o mundo.
  //
  // A asserção mostra a TRADUÇÃO, que é o motivo do nome: o
  // `fetchStatus` do TanStack entra 'idle' e sai 'inactive'. Se os dois
  // se chamassem igual, esta linha pareceria uma identidade.
  igual(
    "fetchStatus 'idle' + enabled:false vira o nosso 'inactive'",
    derivarEstado(leitura({ status: 'pending', fetchStatus: 'idle' })).estado,
    'inactive'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (4) a precedência: dado utilizável manda sobre TUDO ---')
// ---------------------------------------------------------------------
{
  // Refetch em background falhou, mas o cache anterior serve. Apagar a
  // tela seria tirar do operador o que ele já tinha.
  const e = derivarEstado(leitura({ data: [1, 2, 3], status: 'error', fetchStatus: 'idle' }))
  igual('erro no refetch com cache = ready', e.estado, 'ready')
  if (e.estado === 'ready') {
    igual('marcado como cache após falha', e.procedencia, 'cache_apos_falha')
    checa('e o aviso é DIFERENTE do de offline', TEXTO_PROCEDENCIA.cache_apos_falha !== TEXTO_PROCEDENCIA.cache_sem_rede)
  }

  // Refetch em andamento sobre cache: o dado continua na tela, sem
  // piscar pra `loading`.
  const f = derivarEstado(leitura({ data: [1], status: 'success', fetchStatus: 'fetching' }))
  igual('refetch sobre cache = ready', f.estado, 'ready')
  if (f.estado === 'ready') igual('e sem aviso, veio do servidor', f.procedencia, 'servidor')
}

// ---------------------------------------------------------------------
console.log('\n--- (5) desconhecido ≠ vazio: a polaridade, em todos os ramos ---')
// ---------------------------------------------------------------------
{
  // Só UM dos cinco estados pode afirmar vazio. Este bloco é a versão
  // executável da regra.
  const naoSabem: Array<[string, LeituraDeConsulta<number[]>]> = [
    ['inactive', leitura({ status: 'pending', fetchStatus: 'idle' })],
    ['loading', leitura({ status: 'pending', fetchStatus: 'fetching' })],
    ['unavailable', leitura({ status: 'pending', fetchStatus: 'paused' })],
    ['error', leitura({ status: 'error', fetchStatus: 'idle' })],
  ]
  for (const [nome, l] of naoSabem) {
    checa(`${nome} não afirma vazio`, !vazioConfirmado(derivarEstado(l)))
  }
  checa(
    'ready COM lista vazia afirma vazio — e é o único que pode',
    vazioConfirmado(derivarEstado(leitura({ data: [], status: 'success', fetchStatus: 'idle' })))
  )
  checa(
    'ready com lista cheia não afirma vazio',
    !vazioConfirmado(derivarEstado(leitura({ data: [1], status: 'success', fetchStatus: 'idle' })))
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (6) o veredito de domínio vive DENTRO de ready ---')
// ---------------------------------------------------------------------
{
  // É a composição que torna "não encontrado" inalcançável sem que
  // tenha havido resposta confiável.
  type MotivoDoCartao = 'formato_invalido' | 'nao_encontrado' | 'bloqueada' | 'fora_de_escopo'
  type Credencial = { motoboyNome: string }

  const recusa: ConsultaComVeredito<Credencial, MotivoDoCartao> = derivarEstado(
    leitura({
      data: recusado<Credencial, MotivoDoCartao>('nao_encontrado', 'Credencial não reconhecida.'),
      status: 'success',
      fetchStatus: 'idle',
    })
  )
  igual('uma RECUSA é transporte bem-sucedido', recusa.estado, 'ready')
  const v = vereditoDe(recusa)
  igual('e o veredito é recusado', v?.veredito, 'recusado')
  igual('com motivo legível pela máquina', v?.veredito === 'recusado' ? v.motivo : null, 'nao_encontrado')

  const ok: ConsultaComVeredito<Credencial, MotivoDoCartao> = derivarEstado(
    leitura({
      data: aceito<Credencial, MotivoDoCartao>({ motoboyNome: 'João Silva' }),
      status: 'success',
      fetchStatus: 'idle',
    })
  )
  igual('um ACEITE também é ready', ok.estado, 'ready')
  igual('e o veredito é aceito', vereditoDe(ok)?.veredito, 'aceito')

  // O ponto todo: sem resposta não há veredito nenhum pra ler.
  const semResposta: ConsultaComVeredito<Credencial, MotivoDoCartao> = derivarEstado(
    leitura({ status: 'pending', fetchStatus: 'paused' })
  )
  igual('sem resposta, o veredito é null', vereditoDe(semResposta), null)
  checa('e o estado é unavailable, não uma recusa', semResposta.estado === 'unavailable')
}

// ---------------------------------------------------------------------
console.log('\n--- (7) as seis telas de hoje, reproduzidas ---')
// ---------------------------------------------------------------------
{
  // A forma exata que cada uma usa, contra a leitura pausada. Prova que
  // o defeito é o mesmo nas seis, e que o derivador o resolve numa vez.
  const l = leitura<number[]>({ data: undefined, status: 'pending', fetchStatus: 'paused' })
  const isLoading = l.status === 'pending' && l.fetchStatus === 'fetching'
  const isError = l.status === 'error'

  // Ocorrencias.tsx:10 e DocumentosPendentes.tsx:238,283
  checa('hoje: `!data || data.length === 0` afirma vazio', !l.data || l.data.length === 0)
  // CredenciaisCadastro.tsx:86 — `motoboys?.filter() ?? []`
  checa('hoje: `(data ?? []).length === 0` afirma vazio', (l.data ?? []).length === 0)
  // RegistroAuditoria.tsx:132
  checa('hoje: `!isLoading && !isError && derivada.length === 0` afirma vazio',
    !isLoading && !isError && (l.data ?? []).length === 0)
  // MototaxistasCadastro.tsx:54 — e este falha até ONLINE, porque lê as
  // flags de uma query pra decidir sobre o `data` de outra.
  checa('hoje: `!agencias` afirma "cadastre uma agência primeiro"', !l.data)

  // E o derivador, uma vez:
  checa('com o derivador, nenhuma delas afirma vazio', !vazioConfirmado(derivarEstado(l)))
  igual('todas dizem a mesma coisa: unavailable', derivarEstado(l).estado, 'unavailable')
}

// ---------------------------------------------------------------------
console.log('\n--- (8) os textos ---')
// ---------------------------------------------------------------------
{
  checa('a variante de lista difere da de verificação',
    TEXTO_INDISPONIVEL.lista.titulo !== TEXTO_INDISPONIVEL.verificacao.titulo)
  checa('e as duas compartilham o mesmo detalhe',
    TEXTO_INDISPONIVEL.lista.detalhe === TEXTO_INDISPONIVEL.verificacao.detalhe)
  // Nenhum deles pode soar como recusa: "não consegui verificar" e
  // "credencial inválida" são fatos diferentes.
  for (const [onde, texto] of Object.entries(TEXTO_INDISPONIVEL)) {
    checa(
      `o texto de ${onde} não acusa o dado nem a pessoa`,
      !/inválid|incorret|não existe|não encontrad|recusad/i.test(texto.titulo + texto.detalhe),
      texto.titulo
    )
  }
  // `unavailable` não tem botão, então o texto dele não pode CONVIDAR a
  // apertar um. Foi o que a primeira versão fazia ("Tente novamente
  // quando houver conexão") — frase que só faz sentido com CTA.
  for (const [onde, texto] of Object.entries(TEXTO_INDISPONIVEL)) {
    checa(
      `o texto de ${onde} não convida a repetir a ação`,
      !/tente novamente|tentar novamente|clique|atualiz/i.test(texto.titulo + texto.detalhe),
      texto.titulo
    )
  }
  // O `error` também muda por contexto: "não consegui carregar os dados"
  // ao lado de um select rotulado não diz QUAL dependência falhou.
  const erroLista = apresentar<number[]>({ estado: 'error', erro: null }, 'lista')
  const erroVerif = apresentar<number[]>({ estado: 'error', erro: null }, 'verificacao')
  const erroCampo = apresentar<number[]>({ estado: 'error', erro: null }, { campo: 'Filiais' })
  checa('as três falam diferente no erro',
    new Set([erroLista.aviso?.titulo, erroVerif.aviso?.titulo, erroCampo.aviso?.titulo]).size === 3)
  checa('e as três oferecem tentar de novo',
    [erroLista, erroVerif, erroCampo].every((a) => a.acao?.rotulo === 'Tentar novamente'))
  // Sem artigo, de propósito: "as filiais"/"os convênios" exigiria
  // concordância de gênero sobre uma string livre.
  igual('o campo não usa artigo', erroCampo.aviso?.titulo, 'Filiais: não foi possível carregar.')
  // E o erro de uma variante não pode coincidir com o indisponível DELA
  // MESMA: "a tentativa falhou" e "não há a quem perguntar" são os dois
  // fatos que o E2 mais precisa manter separados.
  const indispVerif = apresentar<number[]>({ estado: 'unavailable' }, 'verificacao')
  const indispCampo = apresentar<number[]>({ estado: 'unavailable' }, { campo: 'Filiais' })
  checa('nenhum erro é confundido com o indisponível da mesma variante',
    erroCampo.aviso?.titulo !== indispCampo.aviso?.titulo &&
      erroVerif.aviso?.titulo !== indispVerif.aviso?.titulo)

  igual('dado do servidor não leva aviso', TEXTO_PROCEDENCIA.servidor, null)
  checa('e os dois avisos de cache são diferentes entre si',
    TEXTO_PROCEDENCIA.cache_sem_rede !== TEXTO_PROCEDENCIA.cache_apos_falha)
}

// ---------------------------------------------------------------------
console.log('\n--- (9) o derivador é total: nenhuma combinação fica sem estado ---')
// ---------------------------------------------------------------------
{
  const status = ['pending', 'success', 'error'] as const
  const fetchStatus = ['fetching', 'paused', 'idle'] as const
  const dados = [undefined, [] as number[], [1]] as const
  const validos = new Set(['inactive', 'loading', 'ready', 'unavailable', 'error'])
  let combinacoes = 0
  let todosValidos = true
  for (const s of status) {
    for (const f of fetchStatus) {
      for (const d of dados) {
        combinacoes++
        const e = derivarEstado({ data: d, status: s, fetchStatus: f })
        if (!validos.has(e.estado)) todosValidos = false
        // A invariante estrutural: só `ready` carrega dado.
        if (e.estado === 'ready' && d === undefined) todosValidos = false
        if (e.estado !== 'ready' && d !== undefined) todosValidos = false
      }
    }
  }
  igual('combinações exercitadas', combinacoes, 27)
  checa('todas caem num estado válido, e só ready carrega dado', todosValidos)

  // A ASSIMETRIA É DELIBERADA, e esta é a trava contra "arrumá-la".
  //
  // `fetchStatus: 'idle'` é do TanStack e entra; `estado: 'idle'` é
  // nosso e NÃO existe. Alguém vai achar, daqui a meses, que os dois
  // deviam se chamar igual — e igualá-los devolve exatamente a leitura
  // ambígua que o nome `inactive` veio desfazer.
  let algumIdle = false
  for (const s of status) {
    for (const f of fetchStatus) {
      for (const d of dados) {
        if (derivarEstado({ data: d, status: s, fetchStatus: f }).estado === 'idle') algumIdle = true
      }
    }
  }
  checa("o derivador NUNCA devolve 'idle' — esse nome é do TanStack", !algumIdle)
  checa(
    "e devolve 'inactive' no caso da query desligada",
    derivarEstado({ data: undefined, status: 'pending', fetchStatus: 'idle' }).estado === 'inactive'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (10) a APRESENTAÇÃO, linha por linha do contrato ---')
// ---------------------------------------------------------------------
{
  // A tabela congelada em 2026-08-26, executada. `Consulta.tsx` é casca
  // sobre isto — se uma linha aqui mudar, a tela muda junto, e não há
  // como as duas divergirem.
  const linhas: Array<{
    nome: string
    estado: EstadoDeConsulta<number[]>
    dados: boolean
    progresso: boolean
    tom: 'aviso' | 'falha' | null
    acao: string | null
  }> = [
    { nome: 'inactive', estado: { estado: 'inactive' },
      dados: false, progresso: false, tom: null, acao: null },
    { nome: 'loading', estado: { estado: 'loading' },
      dados: false, progresso: true, tom: null, acao: null },
    { nome: 'ready · servidor', estado: { estado: 'ready', dados: [1], procedencia: 'servidor' },
      dados: true, progresso: false, tom: null, acao: null },
    { nome: 'ready · cache_sem_rede', estado: { estado: 'ready', dados: [1], procedencia: 'cache_sem_rede' },
      dados: true, progresso: false, tom: 'aviso', acao: null },
    { nome: 'ready · cache_apos_falha', estado: { estado: 'ready', dados: [1], procedencia: 'cache_apos_falha' },
      dados: true, progresso: false, tom: 'aviso', acao: 'Atualizar' },
    { nome: 'unavailable', estado: { estado: 'unavailable' },
      dados: false, progresso: false, tom: 'aviso', acao: null },
    { nome: 'error', estado: { estado: 'error', erro: new Error('x') },
      dados: false, progresso: false, tom: 'falha', acao: 'Tentar novamente' },
  ]

  for (const linha of linhas) {
    const a = apresentar(linha.estado)
    igual(`${linha.nome} · mostra dados`, a.mostraDados, linha.dados)
    igual(`${linha.nome} · em andamento`, a.emAndamento, linha.progresso)
    igual(`${linha.nome} · tom`, a.aviso?.tom ?? null, linha.tom)
    igual(`${linha.nome} · ação`, a.acao?.rotulo ?? null, linha.acao)
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (11) o botão que NÃO existe: a decisão central do E2.2 ---')
// ---------------------------------------------------------------------
{
  // Insistir em `unavailable` não muda nada — não há a quem perguntar. Um
  // botão ali ensinaria o operador a martelar uma consulta que o próprio
  // sistema sabe que não pode executar, que é o comportamento que o E2
  // veio matar.
  igual('unavailable NÃO oferece ação', apresentar<number[]>({ estado: 'unavailable' }).acao, null)
  checa('mas DIZ o que houve', apresentar<number[]>({ estado: 'unavailable' }).aviso !== null)

  // E `error` oferece, porque houve tentativa e ela pode ter sido
  // transitória.
  checa('error oferece ação',
    apresentar<number[]>({ estado: 'error', erro: null }).acao?.rotulo === 'Tentar novamente')

  // A distinção visual é a outra metade: informar não é acusar.
  igual('unavailable é aviso', apresentar<number[]>({ estado: 'unavailable' }).aviso?.tom, 'aviso')
  igual('error é falha', apresentar<number[]>({ estado: 'error', erro: null }).aviso?.tom, 'falha')

  // A variante muda o texto, nunca a ausência do botão.
  const verif = apresentar<number[]>({ estado: 'unavailable' }, 'verificacao')
  const lista = apresentar<number[]>({ estado: 'unavailable' }, 'lista')
  const campo = apresentar<number[]>({ estado: 'unavailable' }, { campo: 'Filiais' })
  checa('as três variantes falam diferente',
    new Set([verif.aviso?.titulo, lista.aviso?.titulo, campo.aviso?.titulo]).size === 3)
  checa('e nenhuma das três ganha botão',
    verif.acao === null && lista.acao === null && campo.acao === null)

  // A variante de CAMPO nomeia a dependência: ao lado de um select já
  // rotulado, "Dados indisponíveis" não diz QUAL delas caiu.
  igual('o campo diz o substantivo', campo.aviso?.titulo, 'Filiais indisponíveis no momento.')
  checa('e o detalhe é o MESMO das listas — a causa não muda',
    campo.aviso?.detalhe === lista.aviso?.detalhe)
  // Só o NÚMERO varia em "indisponível/indisponíveis", nunca o gênero:
  // por isso a concatenação é segura, e por isso o rótulo é plural.
  for (const nome of ['Filiais', 'Cidades', 'Agências', 'Convênios']) {
    const a = apresentar<number[]>({ estado: 'unavailable' }, { campo: nome })
    checa(`"${nome}" concorda`, a.aviso?.titulo === `${nome} indisponíveis no momento.`)
  }

  // Nenhum estado SEM dado pode oferecer atualizar: não há o que
  // atualizar na tela, e o rótulo mentiria sobre o que o clique faz.
  for (const e of [
    { estado: 'inactive' } as const,
    { estado: 'loading' } as const,
    { estado: 'unavailable' } as const,
  ]) {
    checa(`${e.estado} não oferece "Atualizar"`,
      apresentar<number[]>(e).acao?.rotulo !== 'Atualizar')
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (12) DUAS CONSULTAS: nenhuma decide a semântica da outra ---')
// ---------------------------------------------------------------------
{
  // O caso de prova é o `MototaxistasCadastro`, que era o único defeito
  // do inventário a falhar ATÉ ONLINE: a frase sobre AGÊNCIAS era
  // guardada pelas flags da query de MOTOBOYS. Bastava a de motoboys
  // responder primeiro — duas requisições independentes, isso acontece
  // sempre — pra a tela mandar cadastrar uma agência que já existe.
  //
  // As duas afirmações da tela, e de qual estado cada uma pode sair:
  const podeDizerFaltaAgencia = (agencias: EstadoDeConsulta<string[]>) =>
    vazioConfirmado(agencias)
  const podeDizerFaltaMotoboy = (motoboys: EstadoDeConsulta<string[]>) =>
    vazioConfirmado(motoboys)

  const READY_VAZIO: EstadoDeConsulta<string[]> = {
    estado: 'ready', dados: [], procedencia: 'servidor',
  }
  const READY_COM: EstadoDeConsulta<string[]> = {
    estado: 'ready', dados: ['ag-1'], procedencia: 'servidor',
  }

  // Os três primeiros casos: agências SEM resposta, motoboys respondeu.
  // É a forma exata do defeito antigo.
  const semResposta: Array<[string, EstadoDeConsulta<string[]>]> = [
    ['loading', { estado: 'loading' }],
    ['unavailable', { estado: 'unavailable' }],
    ['error', { estado: 'error', erro: new Error('x') }],
  ]
  for (const [nome, agencias] of semResposta) {
    checa(
      `agências ${nome} + motoboys ready([]) → NÃO diz "cadastre uma agência"`,
      !podeDizerFaltaAgencia(agencias)
    )
    // E o defeito antigo, reproduzido: com as flags de MOTOBOYS ele diria.
    const isLoadingDosMotoboys = false // ready
    const isErrorDosMotoboys = false
    const agenciasData = agencias.estado === 'ready' ? agencias.dados : undefined
    checa(
      `   (o código antigo dizia, e é por isso que ele saiu)`,
      !isLoadingDosMotoboys && !isErrorDosMotoboys && (!agenciasData || agenciasData.length === 0)
    )
  }

  // O quarto: agências respondeu vazio — aí sim a afirmação é dela.
  checa(
    'agências ready([]) → PODE afirmar que não há agência',
    podeDizerFaltaAgencia(READY_VAZIO)
  )
  // A INDEPENDÊNCIA É ESTRUTURAL, e afirmá-la iterando seria teatro:
  // varrer os estados de motoboys daria verde porque o predicado NÃO
  // TEM COMO olhá-los — a asserção passaria mesmo se ele estivesse
  // errado por outro motivo. O que se prova é a assinatura.
  checa(
    '   e independe de motoboys por construção: o predicado só recebe agências',
    podeDizerFaltaAgencia.length === 1
  )

  // O quinto: a distinção semântica completa, que é o que prova o gate.
  checa(
    'agências ready([ag]) + motoboys ready([]) → afirma FALTA DE MOTOBOY',
    !podeDizerFaltaAgencia(READY_COM) && podeDizerFaltaMotoboy(READY_VAZIO)
  )
  checa(
    'e agências ready([]) NÃO é a mesma afirmação que motoboys ready([])',
    podeDizerFaltaAgencia(READY_VAZIO) && !podeDizerFaltaAgencia(READY_COM)
  )

  // A ignorância de uma consulta não vira afirmação de ausência na
  // OUTRA: um motoboy com agência não pode aparecer como "—" só porque
  // a lista de agências não chegou.
  const nomeAgencia = (agenciaId: string | null, agencias: string[] | undefined) => {
    if (agenciaId === null) return '—'
    if (!agencias) return '…'
    return agencias.includes(agenciaId) ? 'Ágil Motos' : '—'
  }
  igual('sem a lista, a célula diz "não sei"', nomeAgencia('ag-1', undefined), '…')
  igual('com a lista, resolve o nome', nomeAgencia('ag-1', ['ag-1']), 'Ágil Motos')
  igual('e "sem agência" continua sendo "—"', nomeAgencia(null, ['ag-1']), '—')
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
