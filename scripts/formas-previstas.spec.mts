// npx tsx scripts/formas-previstas.spec.mts
//
// O GATE DO E4.A — as duas regras puras do pagamento previsto 1:N.
//
//     validarFormasPrevistas   o que o cadastro aceita prever
//     divergiuDoPrevisto       previsto × realizado, GÊMEO do SQL
//
// A segunda é a que importa mais, e ela nasceu de uma DISCORDÂNCIA
// medida entre os dois escritores do mesmo fato:
//
//     servidor   array_agg(forma || '|' || valor_cents) — conjunto
//     cliente    linhas.length > 1 || linhas[0].forma !== esperada
//
// Enquanto existia um previsto só, os dois concordavam por acidente.
// Com dois, um vale previsto `pix + dinheiro` e pago exatamente
// `pix + dinheiro` é FIEL para o servidor e DIVERGENTE para a tela.
// Quem cria o segundo previsto é o E4 — por isso ele conserta aqui.
//
// Como todo `lib/` deste projeto, o módulo não importa nada além de
// `money.ts`: é o que permite exercitá-lo sob `tsx`, sem navegador e
// sem `import.meta.env`.

import {
  MAX_FORMAS_PREVISTAS,
  validarFormasPrevistas,
  divergiuDoPrevisto,
  type FormaComValor,
} from '../src/lib/formasDePagamento.ts'
import { formatBRL } from '../src/lib/money.ts'
import { readFileSync } from 'node:fs'

// Dinheiro formatado pelo MESMO `formatBRL` do app, nunca digitado à
// mão: `toLocaleString('pt-BR')` põe U+00A0 depois do "R$", e a
// expectativa escrita com espaço comum falha exibindo duas strings
// visualmente idênticas. É o §84, e ele já pegou o spec do E3.
const brl = (cents: number) => formatBRL(cents)

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

// ---------------------------------------------------------------------
console.log('\n--- (1) o caminho de HOJE continua valido ---')
// ---------------------------------------------------------------------
{
  // Uma forma só, valendo a compra inteira. É o que o cadastro grava
  // desde que existe, e o E4 não pode ter mudado isso: é o caso do
  // teste dos 25 segundos.
  igual(
    'uma forma valendo a compra inteira passa',
    validarFormasPrevistas([f('dinheiro', 12390)], 12390),
    null
  )
  igual(
    'e uma forma que NAO vale a compra e recusada',
    typeof validarFormasPrevistas([f('dinheiro', 12000)], 12390),
    'string'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (2) a soma tem que bater com o valor da compra ---')
// ---------------------------------------------------------------------
{
  igual(
    'duas formas somando certo passam',
    validarFormasPrevistas([f('pix', 5000), f('dinheiro', 7390)], 12390),
    null
  )

  const faltando = validarFormasPrevistas([f('pix', 5000), f('dinheiro', 7000)], 12390)
  checa('faltando, recusa', faltando !== null)
  checa(
    'e a mensagem traz a soma obtida',
    !!faltando?.includes(brl(12000)),
    JSON.stringify(faltando)
  )
  checa('e o valor da compra', !!faltando?.includes(brl(12390)))

  checa(
    'passando do valor, recusa tambem',
    validarFormasPrevistas([f('pix', 9000), f('dinheiro', 9000)], 12390) !== null
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (3) forma REPETIDA e recusada ---')
// ---------------------------------------------------------------------
{
  // O caso real é banal: o caixa clica "+ outra forma" e não troca o
  // select, então o padrão fica valendo duas vezes. Sem esta regra o
  // DCR1 sairia com duas linhas `p` dizendo a mesma coisa com ids
  // diferentes, dentro de um documento assinado.
  const repetida = validarFormasPrevistas([f('dinheiro', 5000), f('dinheiro', 7390)], 12390)
  checa('dinheiro duas vezes recusa', repetida !== null)
  checa(
    'e a mensagem NOMEIA a forma repetida',
    !!repetida?.includes('Dinheiro'),
    JSON.stringify(repetida)
  )

  // Convênio é o caso que MOTIVA a regra: `entregas.convenio_id` é uma
  // coluna só, e dois convênios seriam dois acordos disputando o mesmo
  // campo — sem o sistema ter como dizer qual vale.
  checa(
    'convenio duas vezes recusa',
    validarFormasPrevistas([f('convenio', 5000), f('convenio', 7390)], 12390) !== null
  )

  // E o que a regra NÃO proíbe: formas diferentes, que é o ponto do E4.
  igual(
    'formas diferentes passam',
    validarFormasPrevistas([f('convenio', 5000), f('dinheiro', 7390)], 12390),
    null
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (4) os limites: nenhuma linha, e mais que o teto ---')
// ---------------------------------------------------------------------
{
  checa('lista vazia recusa', validarFormasPrevistas([], 12390) !== null)

  igual('o teto do cadastro e 3', MAX_FORMAS_PREVISTAS, 3)
  igual(
    'tres formas passam',
    validarFormasPrevistas([f('pix', 4000), f('dinheiro', 4000), f('debito', 4390)], 12390),
    null
  )
  checa(
    'quatro recusam',
    validarFormasPrevistas(
      [f('pix', 3000), f('dinheiro', 3000), f('debito', 3000), f('credito', 3390)],
      12390
    ) !== null
  )

  // Valor zero é recusado ANTES da soma: uma linha em branco somando
  // zero passaria na soma se as outras cobrissem o total, e gravaria um
  // previsto que não afirma nada.
  checa(
    'valor zero recusa',
    validarFormasPrevistas([f('pix', 0), f('dinheiro', 12390)], 12390) !== null
  )
  checa(
    'valor negativo recusa',
    validarFormasPrevistas([f('pix', -100), f('dinheiro', 12490)], 12390) !== null
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (5) divergiuDoPrevisto: O CASO QUE O CLIENTE ERRAVA ---')
// ---------------------------------------------------------------------
{
  const previsto = [f('pix', 5000), f('dinheiro', 7390)]

  // ESTE é o caso. Pela regra antiga (`linhas.length > 1`) ele seria
  // divergência; pelo servidor ele é fiel. Duas telas afirmando coisas
  // diferentes sobre o mesmo fato.
  checa(
    'pagou EXATAMENTE o previsto em duas formas -> NAO divergiu',
    !divergiuDoPrevisto(previsto, [f('pix', 5000), f('dinheiro', 7390)])
  )

  checa(
    'e a ORDEM nao importa — e conjunto, nao sequencia',
    !divergiuDoPrevisto(previsto, [f('dinheiro', 7390), f('pix', 5000)])
  )

  checa(
    'valor diferente diverge',
    divergiuDoPrevisto(previsto, [f('pix', 5001), f('dinheiro', 7389)])
  )
  checa(
    'forma diferente diverge',
    divergiuDoPrevisto(previsto, [f('debito', 5000), f('dinheiro', 7390)])
  )
  checa('pagou tudo numa forma so diverge', divergiuDoPrevisto(previsto, [f('dinheiro', 12390)]))
}

// ---------------------------------------------------------------------
console.log('\n--- (6) e MULTICONJUNTO, nao conjunto ---')
// ---------------------------------------------------------------------
{
  // O gêmeo SQL usa `array_agg`, que preserva duplicata. Implementar
  // este lado com `Set` daria a resposta errada aqui, e o erro só
  // apareceria num vale onde a mesma forma aparece duas vezes — que o
  // cadastro recusa, mas o REALIZADO (dialog, 4 linhas) não.
  checa(
    'duas linhas iguais != uma linha',
    divergiuDoPrevisto([f('pix', 1000), f('pix', 1000)], [f('pix', 1000)])
  )
  checa(
    'e duas iguais == duas iguais',
    !divergiuDoPrevisto([f('pix', 1000), f('pix', 1000)], [f('pix', 1000), f('pix', 1000)])
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (7) o caso de UMA forma continua se comportando ---')
// ---------------------------------------------------------------------
{
  // A regra antiga acertava aqui, e a nova precisa continuar acertando:
  // é o caso de 29 em cada 30 entregas.
  checa(
    'mesma forma, mesmo valor -> fiel',
    !divergiuDoPrevisto([f('dinheiro', 12390)], [f('dinheiro', 12390)])
  )
  checa(
    'forma trocada -> divergiu',
    divergiuDoPrevisto([f('dinheiro', 12390)], [f('pix', 12390)])
  )
  checa(
    'dividiu o que era uma forma so -> divergiu',
    divergiuDoPrevisto([f('dinheiro', 12390)], [f('pix', 5000), f('dinheiro', 7390)])
  )

  // Vale sem previsto (legado) contra qualquer realizado: divergiu.
  // Não é "não sei" — é que o realizado afirma algo que o previsto não
  // afirmava.
  checa('sem previsto, qualquer realizado diverge', divergiuDoPrevisto([], [f('dinheiro', 12390)]))
}

// ---------------------------------------------------------------------
console.log('\n--- (8) fiacao: as regras nao tem segunda copia ---')
// ---------------------------------------------------------------------
{
  // "Não é decidido em outro lugar" é afirmação sobre o CÓDIGO, e o
  // jeito de prová-la é lendo o fonte — mesmo método de
  // `fiacao-texto.spec.mts`.
  const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

  /**
   * Toda asserção "isto NÃO aparece mais" tem que ler o CÓDIGO, nunca a
   * prosa — senão o comentário que explica a regra removida derruba o
   * teste que existe pra impedir que ela volte.
   *
   * Aconteceu na primeira execução, e é uma armadilha desta família
   * inteira de spec: quanto melhor documentada a remoção, mais provável
   * o falso positivo. O incentivo tem que ficar do lado certo.
   */
  const semComentarios = (fonte: string) =>
    fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  const dialog = ler('src/components/NotificarOcorrenciaDialog.tsx')

  checa('o dialog usa `divergiuDoPrevisto`', /divergiuDoPrevisto\(/.test(dialog))
  // A regra antiga, que não pode voltar: ela decidia por CONTAGEM.
  checa(
    'e nao decide mais por contagem de linhas',
    !/linhas\.length > 1 \|\|/.test(semComentarios(dialog))
  )
  // E o escalar do `de`, que era o outro achado: um vale com dois
  // previstos gravaria auditoria dizendo que a divergência foi de UMA
  // das formas.
  checa(
    'e nao manda mais `formaAnterior` escalar no payload',
    !/formaAnterior: /.test(semComentarios(dialog))
  )

  const entregas = ler('src/data/entregas.ts')
  // `.some()`, nunca `.includes()` de uma forma só: basta UMA das
  // previstas gerar papel pra o vale nascer com pendência documental.
  // O servidor faz igual (`romaneio_documentos_esperados` varre TODAS as
  // linhas `p`), e divergirem faria o retorno recusar
  // `documentos_nao_conferem` depois de colhidas duas assinaturas.
  checa(
    'status_documental olha TODAS as formas previstas',
    /status_documental: formas\.some\(/.test(semComentarios(entregas))
  )
  checa(
    'e nao decide por uma forma escalar',
    !/GERAM_DOCUMENTO_FISICO\.includes\(input\.formaPagamento\)/.test(semComentarios(entregas))
  )

  const cadastro = ler('src/pages/CadastroEntrega.tsx')
  // Valida ANTES de enfileirar. Revalidar na sincronização recusaria uma
  // operação já aceita no balcão, e o item iria pra `erro` e pro backoff
  // pra sempre — o pior sintoma conhecido do projeto.
  checa('a tela valida antes de enfileirar', /validarFormasPrevistas\(/.test(cadastro))
  checa(
    'e `criarEntrega` NAO revalida na sincronizacao',
    !/validarFormasPrevistas\(/.test(semComentarios(entregas))
  )
  // O gatilho fora da cadeia de Enter é o que protege os 25 segundos.
  checa('o convenio olha todas as linhas', /formas\.some\(\(linha\) => linha\.forma === 'convenio'\)/.test(cadastro))

  const lib = ler('src/lib/formasDePagamento.ts')
  // O `.*` precisa alcançar o CAMINHO do módulo, senão a linha casada
  // termina no `from` e a asserção nunca acha o que procura — ela
  // passaria a "provar" que nenhum import é de `money`, que é o oposto
  // do que se quer. Defeito meu, achado na primeira execução.
  const imports = lib.match(/^import[\s\S]*?from\s+'[^']+'/gm) ?? []
  checa(
    'a lib segue sem importar nada alem de money',
    imports.length > 0 && imports.every((l) => l.endsWith("from '@/lib/money'")),
    JSON.stringify(imports)
  )
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
