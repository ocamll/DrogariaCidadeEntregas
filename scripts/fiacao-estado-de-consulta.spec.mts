// npx tsx scripts/fiacao-estado-de-consulta.spec.mts
//
// O GATE DA FIAÇÃO DO E2.
//
// `estado-de-consulta.spec.mts` prova o que o derivador FAZ. Este prova
// ONDE ele é usado — e, principalmente, que ninguém escapou da lista.
//
// Mesmo método de `fiacao-texto.spec.mts` e `despacho-sync-romaneio.
// spec.mts`: lê o FONTE. "Nenhuma tela afirma vazio sem saber" é uma
// afirmação sobre o código, não sobre execução, e chamar função não a
// prova.
//
// ---------------------------------------------------------------------
// A LISTA É EXPLÍCITA, E É FECHADA
// ---------------------------------------------------------------------
//
// O inventário abaixo tem os 17 arquivos que hoje consultam o servidor.
// Eram 18 até o passo 1 (2026-09-08), quando ConveniosCadastro saiu.
// A checagem (4) varre `src/` e exige que TODO arquivo que use
// `isLoading` esteja aqui. Uma tela nova não passa despercebida: ou ela
// já nasce no vocabulário do E2, ou ela tem que ser inscrita aqui por
// alguém, que aí decide o que ela afirma quando não sabe.
//
// Isso é mais forte que um glob — o glob aceitaria a tela nova em
// silêncio — e mais forte que só a lista, que não veria a tela nova.
// ---------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const lerBruto = (caminho: string) => readFileSync(caminho, 'utf8')
const LIB = 'src/lib/estadoDeConsulta.ts'

/**
 * Sem comentários. Uma regra que contasse prosa acusaria justamente os
 * arquivos que EXPLICAM o defeito — foi o que aconteceu na primeira
 * rodada deste spec, com a própria biblioteca: ela cita `isLoading` no
 * cabeçalho pra dizer por que não o usa.
 */
const codigo = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * `ler` DEVOLVE CÓDIGO, e é essa a mudança do E4 (2026-08-27).
 *
 * O `codigo()` acima já existia — este spec aprendeu a lição na primeira
 * rodada dele. Só que ele era aplicado NO CALL SITE, e um call site
 * esquecido não dá erro: dá uma asserção que lê prosa sem ninguém notar.
 * Era o caso do bloco (1), que lia cru e afirmava coisas como
 * `/export type LeituraDeConsulta/` — um comentário citando o tipo faria
 * a asserção passar sem o tipo existir.
 *
 * A diferença entre as duas formas é o padrão: com `codigo()` no call
 * site, o seguro exige lembrar; com `ler` já limpo, o seguro é o que
 * acontece sozinho. Os `codigo(ler(...))` que sobraram continuam
 * corretos — a limpeza é idempotente — e valem como documentação.
 *
 * Motivada por duas mordidas no E4, e a pior foi um FALSO POSITIVO: uma
 * asserção do E3.C continuou passando depois de o campo que ela protegia
 * ter sido removido, casando com o comentário que explicava a remoção.
 *
 * Quem precisar da prosa de propósito usa `lerBruto` e diz por quê.
 */
const ler = (caminho: string) => codigo(lerBruto(caminho))
const usa = (caminho: string, agulha: RegExp) => agulha.test(codigo(ler(caminho)))

/**
 * A situação de HOJE. É descritiva, não uma lista de quem entra no E2.3:
 * **os 18 migram**, decidido em 2026-08-26.
 *
 * `defeituoso`  a tela AFIRMA algo falso quando a consulta não respondeu
 * `mudo`        a tela não afirma nada, e também não explica: fica em branco
 * `deliberado`  já trata o caso, à mão, com comentário
 * `acidental`   escapa por `data?.length === 0` dar `undefined === 0` → false
 * `migrado`     usa o derivador
 *
 * Os `deliberado` migram apesar de corretos: deixá-los de fora criaria
 * duas implementações concorrentes da mesma regra — a manual da Nova
 * Corrida e do Retorno, e o derivador no resto —, e a próxima correção
 * teria que ser feita duas vezes por quem lembrasse das duas. O
 * comentário histórico deles (o §50.2) continua valendo no NOTAS; o que
 * não precisa sobreviver é o código duplicado.
 *
 * Os `acidental` migram porque "correto por comportamento incidental do
 * JavaScript" não é uma propriedade em que dá pra confiar: basta alguém
 * trocar `data?.length === 0` por `(data ?? []).length === 0`, achando
 * que é a mesma coisa, pra a tela passar a mentir.
 */
type Situacao = 'defeituoso' | 'mudo' | 'deliberado' | 'acidental' | 'migrado'

type Alvo = { arquivo: string; situacao: Situacao; afirma: string }

// ---------------------------------------------------------------------
// FAMÍLIA B — as consultas (`UseQueryResult`)
//
// Medido em 2026-08-25, arquivo por arquivo. A coluna `afirma` é a
// frase LITERAL que a tela põe no ar quando a query pausa (offline sem
// cache): `isLoading` vem `false`, `isError` vem `false`, `data` vem
// `undefined`, e a cadeia cai no último ramo.
// ---------------------------------------------------------------------
const FAMILIA_B: Alvo[] = [
  // ---- afirmam o que não sabem -------------------------------------
  { arquivo: 'src/pages/Ocorrencias.tsx', situacao: 'migrado', afirma: 'era: "Nenhuma ocorrência registrada ainda." numa tela de auditoria' },
  { arquivo: 'src/pages/DocumentosPendentes.tsx', situacao: 'migrado', afirma: 'era: "Nenhum documento pendente" nas DUAS filas de papel' },
  { arquivo: 'src/components/CredenciaisCadastro.tsx', situacao: 'migrado', afirma: 'era: "Nenhum motoboy ativo." + "Sem cartão" em toda linha (3 consultas)' },
  { arquivo: 'src/components/RegistroAuditoria.tsx', situacao: 'migrado', afirma: 'era: "Nenhum evento no período." — a conclusão de que nada aconteceu' },
  { arquivo: 'src/components/MototaxistasCadastro.tsx', situacao: 'migrado', afirma: 'era: "Cadastra uma agência primeiro" — o único que falhava ATÉ ONLINE' },
  // Os três piores, e não estavam no levantamento inicial:
  { arquivo: 'src/pages/Romaneio.tsx', situacao: 'migrado', afirma: 'era: "Romaneio não encontrado." sobre um documento SELADO' },
  { arquivo: 'src/pages/ListaEntregas.tsx', situacao: 'migrado', afirma: 'era: "Nenhum vale encontrado." na tela pós-login do caixa' },
  { arquivo: 'src/pages/HistoricoEntregas.tsx', situacao: 'migrado', afirma: 'era: "Nenhum vale encontrado." reabrindo o defeito de busca do E1.1' },
  { arquivo: 'src/pages/ListaTransferencias.tsx', situacao: 'migrado', afirma: 'era: "Nenhum vale encontrado." — serviu de controle negativo em 26/08' },

  // ---- ficam em branco, sem explicar -------------------------------
  { arquivo: 'src/pages/Fechamento.tsx', situacao: 'migrado', afirma: 'era: tela EM BRANCO no fim do dia, sem uma palavra' },
  { arquivo: 'src/pages/Relatorios.tsx', situacao: 'migrado', afirma: 'era: em branco; o data continua saindo da TELA pros exportadores' },
  { arquivo: 'src/components/UsuariosCadastro.tsx', situacao: 'migrado', afirma: 'era: em branco, e sem nem frase de vazio' },
  { arquivo: 'src/components/SangriaRomaneios.tsx', situacao: 'migrado', afirma: 'era: a sangria inteira sumia sem resposta' },
  { arquivo: 'src/pages/CadastroTransferencia.tsx', situacao: 'migrado', afirma: 'CAMPO dependente: formulário fica, só o select trava' },

  // ---- já tratam o caso, à mão -------------------------------------
  { arquivo: 'src/pages/NovaCorrida.tsx', situacao: 'migrado', afirma: 'as duas consultas migradas; as duas escritas ficam com ' },
  { arquivo: 'src/pages/RetornoCorrida.tsx', situacao: 'migrado', afirma: 'a máquina já separava os estados; o MOTIVO é que vivia em canal paralelo' },

  // ---- escapam por acidente de sintaxe -----------------------------
  { arquivo: 'src/components/AgenciasCadastro.tsx', situacao: 'migrado', afirma: 'era: correta por ACIDENTE de sintaxe; e o dialog virou campo dependente' },
  // ConveniosCadastro saiu no passo 1 (2026-09-08) — ver a nota em
  // scripts/fiacao-texto.spec.mts.
]

// ---------------------------------------------------------------------
// FAMÍLIA A — as ações de custódia
//
// Não são queries: são operações imperativas com `try/finally`. O que
// elas precisam do E2 é o VOCABULÁRIO — `rejected` separado de `error`,
// e o ramo offline preservado como domínio, nunca rebatizado de
// `unavailable`.
//
// As 12 leituras de `ocupado`/`pinConferido` da Nova Corrida se
// resolvem em 4 operações, e é por operação que a migração acontece.
// ---------------------------------------------------------------------
type Operacao = { arquivo: string; nome: string; consulta: boolean; situacao: Situacao }

// O ALVO DO LOTE C NÃO É "sumir com `ocupado`". É que as duas CONSULTAS
// deixem de ter os estados implementados à mão. As duas ESCRITAS ficam
// com a mecânica delas: `EstadoDeConsulta` é vocabulário de pergunta e
// resposta, e esticá-lo pra qualquer async só pra zerar ocorrências
// apagaria a distinção que ele existe pra marcar.
const FAMILIA_A: Operacao[] = [
  { arquivo: 'src/pages/NovaCorrida.tsx', nome: 'bipar cartão', consulta: true, situacao: 'migrado' },
  { arquivo: 'src/pages/NovaCorrida.tsx', nome: 'conferir PIN', consulta: true, situacao: 'migrado' },
  // Escritas — fora do escopo do E2, e é decisão, não pendência.
  { arquivo: 'src/pages/NovaCorrida.tsx', nome: 'criar PIN', consulta: false, situacao: 'deliberado' },
  { arquivo: 'src/pages/NovaCorrida.tsx', nome: 'confirmar saída', consulta: false, situacao: 'deliberado' },
]

// =====================================================================
console.log('\n--- (1) a biblioteca é isolada ---')
// =====================================================================
{
  const fonte = ler(LIB)
  const imports = fonte.match(/^\s*import\s.+$/gm) ?? []
  checa('não importa NADA — nem o TanStack, nem o Supabase', imports.length === 0,
    imports.length ? imports.join(' | ') : '')

  // Se o derivador aceitasse `isLoading`, a tentação de usá-lo voltaria
  // no dia seguinte. Ele não está no tipo de entrada, e não está no
  // corpo — só no comentário que explica por quê.
  checa('e não lê `isLoading` em lugar nenhum', !usa(LIB, /isLoading/))
  checa('a entrada é estrutural, não `UseQueryResult`', /export type LeituraDeConsulta/.test(fonte))
  checa('`ready` é o único estado que carrega dado',
    /estado: 'ready'; dados:/.test(fonte) &&
    !/estado: '(inactive|loading|unavailable|error)'; dados:/.test(fonte))

  // A ASSIMETRIA DOS DOIS `idle`, congelada no texto do tipo.
  //
  // O `fetchStatus` do TanStack tem `'idle'` e continua tendo; o nosso
  // enum não tem, e tem `'inactive'` no lugar. As duas metades vão
  // juntas: só afirmar a ausência deixaria passar um enum sem nenhum
  // dos dois.
  const corpo = codigo(fonte)
  checa("`fetchStatus` mantém o 'idle' do TanStack", /fetchStatus: 'fetching' \| 'paused' \| 'idle'/.test(corpo))
  checa("e o nosso enum tem 'inactive'", /\{ estado: 'inactive' \}/.test(corpo))
  checa("e NÃO tem 'idle'", !/\{ estado: 'idle' \}/.test(corpo))
}

// =====================================================================
console.log('\n--- (1b) o componente é CASCA: a decisão não mora nele ---')
// =====================================================================
{
  const COMPONENTE = 'src/components/Consulta.tsx'
  const corpo = codigo(ler(COMPONENTE))

  checa('importa `apresentar` da biblioteca', /\bapresentar\b/.test(corpo))

  // Se o componente decidisse por conta própria, a tabela do spec
  // deixaria de governar a tela — e as duas divergiriam sem erro
  // nenhum. Ele só pode perguntar por `'ready'`, que é o estreitamento
  // de tipo necessário pra alcançar `estado.dados`.
  const comparacoes = corpo.match(/estado\.estado\s*===\s*'(\w+)'/g) ?? []
  const foraDoReady = comparacoes.filter((c) => !c.includes("'ready'"))
  checa('não compara com nenhum estado além de `ready`', foraDoReady.length === 0,
    foraDoReady.join(', '))

  // Texto duplicado é a mesma armadilha do rótulo do signatário, que o
  // `papeis.ts` resolveu: a segunda cópia é a que fica velha.
  const literais = [
    'Dados indisponíveis', 'Não foi possível verificar', 'Não foi possível carregar',
    'Tentar novamente', 'Atualizar', 'Exibindo dados disponíveis',
  ]
  const copiados = literais.filter((t) => corpo.includes(t))
  checa('não carrega cópia de nenhum texto congelado', copiados.length === 0, copiados.join(' | '))

  // A invariante estrutural do E2, afirmada sobre o código: o `children`
  // é função, então ele só pode ser chamado com dado em mãos.
  checa('o `children` é função de dado', /children:\s*\(dados: T\)/.test(corpo))
  checa('e o "vazio" só é consultado junto do dado', /estaVazio\(estado\.dados\)/.test(corpo))
}

// =====================================================================
console.log('\n--- (2) o derivador é o ÚNICO lugar que lê `fetchStatus` ---')
// =====================================================================
{
  // Sem isto, uma tela resolveria o caso pausado à mão, do jeito dela, e
  // o próximo defeito nasceria fora do alcance do spec.
  const fora = arquivosDeSrc()
    .map(normalizar)
    .filter((f) => f !== LIB && usa(f, /fetchStatus/))
  checa('ninguém além dele toca em `fetchStatus`', fora.length === 0, fora.join(', '))
}

// =====================================================================
console.log('\n--- (3) o inventário: todo alvo existe e está classificado ---')
// =====================================================================
{
  for (const alvo of FAMILIA_B) {
    let existe = true
    try { statSync(alvo.arquivo) } catch { existe = false }
    checa(`${alvo.arquivo}`, existe, `${alvo.situacao} · ${alvo.afirma}`)
  }
  // Um `migrado` tem que provar que migrou.
  for (const alvo of FAMILIA_B.filter((a) => a.situacao === 'migrado')) {
    checa(`${alvo.arquivo} importa o derivador`,
      usa(alvo.arquivo, /from '@\/lib\/estadoDeConsulta'/))
    // `usa()` e não o fonte cru: uma tela migrada costuma EXPLICAR no
    // comentário o `isLoading` que ela deixou de usar, e contar prosa
    // acusaria justamente quem documentou o conserto. Foi assim que a
    // própria biblioteca caiu no check (4) na primeira rodada.
    checa(`${alvo.arquivo} não lê mais \`isLoading\``, !usa(alvo.arquivo, /\bisLoading\b/))
  }

  // UMA TELA COM N CONSULTAS PRECISA DE N ESTADOS.
  //
  // O `MototaxistasCadastro` é o caso de prova do gate 5: ele lia as
  // flags da query de motoboys pra afirmar sobre o `data` da de
  // agências. Contar `derivarEstado` contra o número de `use*` que
  // devolvem consulta é grosseiro, mas pega exatamente a regressão que
  // importa — alguém derivar um estado só e reutilizá-lo pros dois.
  const DUAS_CONSULTAS = [
    { arquivo: 'src/components/MototaxistasCadastro.tsx', quantas: 2 },
  ]
  for (const { arquivo, quantas } of DUAS_CONSULTAS) {
    const derivacoes = (codigo(ler(arquivo)).match(/derivarEstado\(/g) ?? []).length
    checa(`${arquivo} deriva ${quantas} estados, um por consulta`,
      derivacoes === quantas, `achei ${derivacoes}`)
  }
  for (const op of FAMILIA_A.filter((o) => o.situacao === 'migrado')) {
    checa(`${op.nome} usa o vocabulário`, usa(op.arquivo, /from '@\/lib\/estadoDeConsulta'/))
  }

  // O GATE DO LOTE C, escrito como foi combinado: as duas CONSULTAS não
  // têm mais estado à mão. As duas ESCRITAS continuam com `ocupado`, e
  // isso é decisão — por isso ele não pode simplesmente sumir.
  if (FAMILIA_A.some((o) => o.consulta && o.situacao === 'migrado')) {
    const corpo = codigo(ler('src/pages/NovaCorrida.tsx'))
    checa('bipar cartão não tem mais estado à mão', !/'bipando'/.test(corpo))
    checa('conferir PIN não tem mais estado à mão', !/'conferindo'/.test(corpo))
    checa('e `pinConferido` deixou de existir', !/pinConferido\b/.test(corpo))
    // A outra metade, e é a que importa: `ocupado` FICA, servindo as
    // escritas. Sem esta linha alguém "terminaria o trabalho" removendo
    // o que foi mantido de propósito.
    checa('mas `ocupado` continua, servindo as escritas',
      /ocupado === 'pin'/.test(corpo) && /ocupado === 'confirmar'/.test(corpo))
    // E o ramo offline do PIN não virou vocabulário de consulta: ele é
    // custódia, e nenhum dos cinco estados o descreve.
    checa('o PIN offline continua sendo ramo próprio de custódia',
      /pinCapturadoOffline/.test(corpo))
    checa('a custódia libera por DOIS caminhos distintos, e só por eles',
      /custodiaPronta = pinConfirmado \|\| pinCapturadoOffline/.test(corpo))
  }

  // ---- LOTE D — RetornoCorrida --------------------------------------
  //
  // Aqui a máquina JÁ separava `cartao_recusado`, `pin_recusado`,
  // `erro_rede` e `conflito`. O que faltava era o motivo viajar COM ela:
  // ele vivia num `erro: string | null` paralelo, e o `catch` dos
  // handlers escrevia a string sem despachar nada — a máquina dizia
  // `aguardando_cartao` e a tela mostrava um erro.
  {
    const retorno = codigo(ler('src/pages/RetornoCorrida.tsx'))
    const maquina = codigo(ler('src/lib/custodiaDoRetorno.ts'))

    // A mensagem carrega o TEXTO e a NATUREZA juntos. Separá-los foi o
    // defeito original — a máquina dizendo o estado e uma string ao lado
    // dizendo o porquê, sem nada amarrando as duas.
    checa('a máquina carrega o motivo E a natureza da falha',
      /mensagem: \{ texto: string; tipo: 'recusa' \| 'falha' \} \| null/.test(maquina))
    checa('e os quatro eventos de falha exigem o texto',
      (maquina.match(/tipo: '(CARTAO_RECUSADO|PIN_RECUSADO|ERRO_REDE|FALHA_NA_CONSULTA)'; mensagem: string/g) ?? []).length === 4)
    // UMA CONSULTA QUE FALHA NÃO MOVE A MÁQUINA. Sem este evento, a
    // falha do cartão ia pra `ERRO_REDE` — que não aceita `CARTAO_LIDO`
    // — e o caixa ficava sem conseguir bipar de novo.
    checa('a falha de CONSULTA não muda o estado, só a mensagem',
      /case 'FALHA_NA_CONSULTA':\s*\n\s*return \{ \.\.\.estado, mensagem:/.test(maquina))

    // O `catch` de cada handler despacha — não basta escrever texto.
    checa('nenhum `catch` da custódia escreve só a string',
      !/catch \(e\) \{\s*setErro\(e instanceof Error/.test(retorno))
    checa('a tela lê a mensagem DA MÁQUINA', /custodia\?\.mensagem/.test(retorno))
    // E a cor sai do TIPO DA MENSAGEM, não do nome do estado. A
    // diferença importa: uma consulta que falha não move a máquina, e
    // pelo nome ela seria pintada como se nada tivesse acontecido.
    checa('e a cor sai do tipo da mensagem',
      /custodia\.mensagem\.tipo === 'falha'/.test(retorno))
    checa('e NÃO do nome do estado', !/custodia\.nome === 'erro_rede'/.test(retorno))

    // O `erro` paralelo SOBREVIVE, servindo validação local (formato do
    // PIN, assinatura faltando). Isso é decisão: são conferências
    // anteriores a qualquer transição, e a máquina nem é tocada.
    checa('o `erro` restante é só validação local', /Falta a sua assinatura/.test(retorno))
    // O que ele NÃO pode mais fazer é descrever recusa ou falha de rede.
    checa('e ele não descreve mais recusa de cartão',
      !/setErro\(\s*'Credencial não reconhecida/.test(retorno))
    checa('nem recusa de PIN', !/setErro\(\s*\n?\s*autorizacao\.motivo/.test(retorno))
  }
}

// =====================================================================
console.log('\n--- (4) A LISTA É FECHADA: ninguém consulta fora dela ---')
// =====================================================================
{
  const inscritos = new Set(FAMILIA_B.map((a) => a.arquivo))
  // A biblioteca fica de fora: ela é o derivador, não uma consumidora.
  const usam = arquivosDeSrc()
    .map(normalizar)
    .filter((f) => f !== LIB && usa(f, /\bisLoading\b/))
  const clandestinos = usam.filter((f) => !inscritos.has(f))
  checa(
    'todo arquivo que usa `isLoading` está inscrito no inventário',
    clandestinos.length === 0,
    clandestinos.length ? `INSCREVA: ${clandestinos.join(', ')}` : `${usam.length} inscritos`
  )
  // E o inverso: um alvo que deixou de usar `isLoading` sem ser marcado
  // `migrado` é um conserto que passou por fora do vocabulário — some o
  // sintoma, fica a divergência de padrão.
  const pendentes = FAMILIA_B.filter((a) => a.situacao !== 'migrado')
  const semSintoma = pendentes.filter((a) => !usa(a.arquivo, /\bisLoading\b/))
  checa(
    'nenhum alvo foi consertado por fora do E2',
    semSintoma.length === 0,
    semSintoma.length ? `marque como migrado: ${semSintoma.map((a) => a.arquivo).join(', ')}` : ''
  )
}

// =====================================================================
console.log('\n--- (5) o placar da migração ---')
// =====================================================================
{
  const conta = (s: Situacao) => FAMILIA_B.filter((a) => a.situacao === s).length
  console.log(`
     família B — consultas          ${FAMILIA_B.length} arquivos
       defeituoso  ${String(conta('defeituoso')).padStart(2)}   afirmam o que não sabem
       mudo        ${String(conta('mudo')).padStart(2)}   ficam em branco sem explicar
       deliberado  ${String(conta('deliberado')).padStart(2)}   já tratam à mão
       acidental   ${String(conta('acidental')).padStart(2)}   escapam por sintaxe
       migrado     ${String(conta('migrado')).padStart(2)}   de ${FAMILIA_B.length} — o alvo do E2.3 são TODOS
     família A — ações              ${FAMILIA_A.length} operações
       migradas    ${FAMILIA_A.filter((o) => o.situacao === 'migrado').length}
  `)
  // 17, e não 18: `ConveniosCadastro` saiu no passo 1 (2026-09-08).
  //
  // O NÚMERO CONTINUA CRAVADO DE PROPÓSITO. Ele não mede quantos
  // arquivos existem — mede que ninguém acrescentou consulta ao servidor
  // sem migrar o estado dela, nem tirou uma do inventário sem que a tela
  // tivesse de fato saído. Trocá-lo por `FAMILIA_B.length` desligaria a
  // asserção inteira.
  checa('o inventário cobre os 17 arquivos medidos', FAMILIA_B.length === 17)
  checa('e as 4 operações da Nova Corrida', FAMILIA_A.length === 4)
}

// ---------------------------------------------------------------------
function arquivosDeSrc(dir = 'src'): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDeSrc(caminho))
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(caminho)
  }
  return saida
}
function normalizar(caminho: string) {
  return caminho.replace(/\\/g, '/')
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
