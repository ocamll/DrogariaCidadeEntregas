// npx tsx scripts/previsto-escritor-unico.spec.mts
//
// O GATE DO E4.1 — pagamento previsto tem UM escritor só.
//
// Achado pelo primeiro E2E do E4, e por uma propriedade que nenhum gate
// estático conseguia demonstrar: o `V-000006` no banco tem DOIS previstos
// `pix 5000` num vale de R$ 50,00, e o evento de 03:26 afirma "vale
// antigo sem pagamento registrado" sobre um vale que tinha previsto desde
// 03:23.
//
// ---------------------------------------------------------------------
// A CORRIDA, E POR QUE COORDENAR NÃO RESOLVIA
// ---------------------------------------------------------------------
// `criarPrevisto` era decidido no CLIENTE, a partir de uma query que pode
// estar velha. Antes do E3 isso não fazia estrago por acidente: o
// retroativo usava `id: entregaId`, o mesmo do `criarEntrega`, então
// duplicado batia em `23505` e era engolido. **O E3.C tirou o id derivado
// e levou junto uma guarda que ninguém sabia que existia.**
//
// O interleaving que decide o desenho:
//
//     ocorrência retroativa entra PRIMEIRO   → 1 linha
//     replay do cadastro entra DEPOIS        → o escritor LEGÍTIMO
//
// Se o replay insere, são duas linhas; se ele pula, perde-se a verdade.
// Não há terceira saída, porque `pagamentos` não tem policy de DELETE nem
// de UPDATE (regra 4): a linha retroativa é IRREMOVÍVEL. `select`-antes-
// de-inserir, lock ou RPC não fecham esse caso — só escolhem qual dano.
//
// Daí a correção ser por ELIMINAÇÃO. Sem segundo escritor não há
// concorrência a serializar, e os casos 1 a 4 deixam de ser
// comportamento a testar: viram propriedade ESTRUTURAL do código, que é
// mais forte.
//
// ---------------------------------------------------------------------
// E ISSO JÁ ERA SEMANTICAMENTE FRÁGIL
// ---------------------------------------------------------------------
//     previsto     fato conhecido NO CADASTRO, pelo sistema
//     referência   declarada DEPOIS, por uma pessoa
//
// **Ausência de histórico não se corrige inventando histórico.**

import {
  referenciaInformadaDoEvento,
  textoDaReferenciaInformada,
  textoDoPagamentoAlterado,
  validarFormasPrevistas,
  ORIGEM_INFORMADA,
  type FormaComValor,
} from '../src/lib/formasDePagamento.ts'
import { formatBRL } from '../src/lib/money.ts'
import { readFileSync } from 'node:fs'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  checa(nome, ok, ok ? '' : `veio ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`)
}
const f = (forma: string, valor: number) => ({ forma, valor_cents: valor }) as FormaComValor

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Asserção de fiação lê CÓDIGO, nunca prosa — a lição do E4.
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const pagamentos = semComentarios(ler('src/data/pagamentos.ts'))
const entregas = semComentarios(ler('src/data/entregas.ts'))
const dialog = semComentarios(ler('src/components/NotificarOcorrenciaDialog.tsx'))

// ---------------------------------------------------------------------
console.log('\n--- (1-4) OS QUATRO CASOS, provados por ESTRUTURA ---')
// ---------------------------------------------------------------------
{
  // Os quatro interleavings que o usuário especificou:
  //
  //   1. previsto já existe        → ocorrência não escreve
  //   2. ocorrência repetida       → não duplica
  //   3. ocorrência antes do replay→ replay cria só o original
  //   4. replay antes da ocorrência→ só o original
  //
  // Todos decorrem de UMA propriedade: `marcarDivergencia` não escreve
  // pagamento previsto. Provar a propriedade prova os quatro, e é mais
  // forte que exercitá-los um a um — teste de interleaving passa por
  // sorte de escalonamento; ausência de escritor não.

  const corpoDaDivergencia = pagamentos.slice(
    pagamentos.indexOf('export async function marcarDivergencia')
  )

  checa(
    'marcarDivergencia NAO chama criarPagamentoPrevisto',
    !/criarPagamentoPrevisto\s*\(/.test(corpoDaDivergencia)
  )
  checa(
    'e nao insere previsto por outro caminho',
    !/momento:\s*'previsto'/.test(corpoDaDivergencia),
    'qualquer insert com momento previsto aqui reabre a corrida'
  )
  checa(
    'o UNICO chamador de criarPagamentoPrevisto e o cadastro',
    /criarPagamentoPrevisto\s*\(/.test(entregas) &&
      (pagamentos.match(/await criarPagamentoPrevisto\s*\(/g) ?? []).length === 0
  )

  // E o replay: o cadastro continua idempotente por id determinístico.
  checa(
    'o cadastro insere com id vindo do payload (idempotente no replay)',
    /id:\s*forma\.pagamentoId/.test(entregas)
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (5) OBRIGATORIO: dois previstos legitimos do E4 ---')
// ---------------------------------------------------------------------
{
  // A guarda não pode ter reintroduzido, escondida, o velho 1:1. A regra
  // tem que distinguir "duplicação de fallback/replay" de "segundo
  // previsto intencional do cadastro".
  igual(
    'duas formas distintas somando a compra continuam validas',
    validarFormasPrevistas([f('pix', 5000), f('dinheiro', 7390)], 12390),
    null
  )
  igual(
    'tres tambem',
    validarFormasPrevistas([f('pix', 4000), f('dinheiro', 4000), f('debito', 4390)], 12390),
    null
  )

  // E o cadastro continua inserindo N — em laço, não uma vez.
  checa('o cadastro insere em LACO sobre as formas', /for \(const forma of formas\)/.test(entregas))
  checa(
    'e nao voltou a insercao unica',
    !/await criarPagamentoPrevisto\(\{\s*id:\s*previstoId/.test(entregas)
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (6) vale antigo: NAO cria linha, e declara no evento ---')
// ---------------------------------------------------------------------
{
  // O caso 6 MUDOU de significado, e por decisão explícita: é mais
  // honesto o vale continuar sem previsto do que fabricar história.
  //
  //     Era: —                        não há previsto registrado
  //     Era: Pix                      MENTIRA, se o Pix foi informado
  //                                   28 minutos depois numa ocorrência

  checa(
    'o dialog manda os previstos DO BANCO, nao o palpite',
    /previstos,\s*$/m.test(dialog) || /^\s*previstos,\s*$/m.test(dialog)
  )
  checa(
    'e a declaracao vai em campo proprio, so quando nao ha previsto',
    /referenciaInformada:\s*semPrevisto\s*\?\s*previstosParaComparar\s*:\s*null/.test(dialog)
  )
  checa(
    'o evento grava `de` NULL quando nao havia previsto',
    /de:\s*previstos\.length\s*>\s*0\s*\?\s*previstos\s*:\s*null/.test(pagamentos),
    'de = estado PERSISTIDO. Um palpite ali se passaria por dado do banco.'
  )
  checa(
    'e a referencia carrega carimbo de origem',
    /origem_referencia:\s*ORIGEM_INFORMADA/.test(pagamentos)
  )
  igual('o carimbo diz de quem veio', ORIGEM_INFORMADA, 'informada_pelo_operador')
}

// ---------------------------------------------------------------------
console.log('\n--- (7) o LEITOR distingue as duas naturezas ---')
// ---------------------------------------------------------------------
{
  // Reader-first, a disciplina do E3.A: os leitores aprenderam o campo
  // novo ANTES de o escritor produzi-lo.
  const comReferencia = {
    de: null,
    para: [f('dinheiro', 5000)],
    referencia_informada: [f('pix', 5000)],
    origem_referencia: ORIGEM_INFORMADA,
  }

  igual('extrai a referencia', referenciaInformadaDoEvento(comReferencia)?.length, 1)
  igual('evento sem o campo devolve null', referenciaInformadaDoEvento({ de: null }), null)
  igual('lista vazia tambem devolve null', referenciaInformadaDoEvento({ referencia_informada: [] }), null)
  igual('payload nulo nao quebra', referenciaInformadaDoEvento(null), null)

  // O RÓTULO É PARTE DO VALOR. Sem ele a tela mostraria "Pix" do lado de
  // "era", e o leitor concluiria que o sistema sabia.
  const texto = textoDaReferenciaInformada(comReferencia)
  checa('o texto vem rotulado', !!texto?.includes('informado pelo operador'), JSON.stringify(texto))
  checa('e traz a forma com valor', !!texto?.includes(formatBRL(5000)))
  igual('sem referencia, sem texto', textoDaReferenciaInformada({ de: null }), null)

  // E o `de` vazio continua sendo "—", que é a afirmação certa.
  igual('de null vira travessao', textoDoPagamentoAlterado(null), '—')
}

// ---------------------------------------------------------------------
console.log('\n--- (8) fiacao: `criarPrevisto` nao autoriza mais nada ---')
// ---------------------------------------------------------------------
{
  // O pedido do usuário: nenhum chamador pode tratar `criarPrevisto:
  // true` como autorização suficiente pra inserir. Depois do E4.1 isso é
  // provável da forma mais forte — o campo não existe mais.
  checa('o campo saiu do tipo de entrada', !/criarPrevisto/.test(pagamentos))
  checa('e nenhum chamador o envia', !/criarPrevisto/.test(dialog))
  checa(
    'o id do previsto retroativo tambem saiu',
    !/pagamentoPrevistoId/.test(dialog),
    'sem escritor, nao ha id a cunhar'
  )

  // O que NÃO pode voltar: o previsto derivado do uuid da entrega, que
  // era a guarda acidental — e a causa da colisão que o E3 removeu.
  // `\bid:` e não `id:` — sem a borda de palavra, o padrão casa com o
  // FINAL de `entrega_id: input.entregaId`, que é a linha correta e
  // obrigatória do insert. Foi falso positivo na primeira execução: a
  // asserção acusava o código certo.
  //
  // (`_` conta como `\w`, então `\b` não abre dentro de `entrega_id` —
  // é exatamente essa propriedade que faz a borda funcionar aqui.)
  checa(
    'e o id derivado da entrega nao voltou',
    !/\bid:\s*input\.entregaId/.test(pagamentos),
    'era a guarda acidental que o E3 removeu — nao pode voltar como conserto'
  )
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
