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
  resolverValoresDasFormas,
  digitosDoValor,
  type FormaComValor,
} from '../src/lib/formasDePagamento.ts'
import { centsFromDigits, formatBRL } from '../src/lib/money.ts'
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
console.log('\n--- (8) a linha nao digitada absorve o resto ---')
// ---------------------------------------------------------------------
{
  // O caixa dividia R$ 137,43 e calculava a segunda parcela de cabeça.
  // Esta é a conta que a tela passou a fazer — e ela é a MESMA expressão
  // que monta o payload, então errar aqui é gravar errado, não só exibir
  // errado.
  const resolve = (digitos: string[], total: number) => resolverValoresDasFormas(digitos, total)

  {
    const r = resolve(['10000', ''], 13743)
    igual('a segunda recebe o resto', r.valoresCents[1], 3743)
    igual('e ela e a derivada', r.indiceDerivado, 1)
    igual('a digitada nao e tocada', r.valoresCents[0], 10000)
  }

  // SIMÉTRICO — o caixa pode digitar a segunda e deixar a primeira
  // derivar ("o cliente vai pagar R$ 37,43 em dinheiro"). Sem isso ele
  // teria que se lembrar de qual campo é o "livre", que é justamente o
  // tipo de regra que não cabe na cabeça de quem está com fila.
  {
    const r = resolve(['', '3743'], 13743)
    igual('a PRIMEIRA tambem deriva', r.valoresCents[0], 10000)
    igual('e o indice acompanha', r.indiceDerivado, 0)
  }

  // UMA LINHA SÓ é o caso do E4, e a derivação o cobre sem caso
  // especial: ela é a única vazia, então absorve a compra inteira. É o
  // que sustenta o caminho de 29 em cada 30 entregas, onde o campo de
  // valor nem chega a ser renderizado.
  {
    const r = resolve([''], 13743)
    igual('linha unica vale a compra inteira', r.valoresCents[0], 13743)
    igual('e ela e a derivada', r.indiceDerivado, 0)
  }

  // TRÊS LINHAS: só deriva quando sobra exatamente uma vazia.
  {
    const duasVazias = resolve(['10000', '', ''], 13743)
    igual('com DUAS vazias ninguem deriva', duasVazias.indiceDerivado, null)
    // Repartir o resto entre as duas seria a tela inventando uma divisão
    // que ninguém pediu — e num campo de dinheiro.
    igual('e o resto nao e distribuido', duasVazias.valoresCents[1], 0)

    const umaVazia = resolve(['10000', '3000', ''], 13743)
    igual('preenchida a segunda, a terceira deriva', umaVazia.valoresCents[2], 743)
    igual('no indice certo', umaVazia.indiceDerivado, 2)
  }

  // NENHUMA VAZIA — o caixa determinou tudo, e conferir a soma volta a
  // ser de `validarFormasPrevistas`. A derivação não corrige nada aqui:
  // ajustar em silêncio um valor que ele digitou seria pior que recusar.
  {
    const r = resolve(['10000', '3000'], 13743)
    igual('nada e derivado', r.indiceDerivado, null)
    igual('e os valores sao os digitados', r.valoresCents.join('|'), '10000|3000')
    checa(
      'e a validacao continua recusando a soma errada',
      validarFormasPrevistas([f('pix', 10000), f('dinheiro', 3000)], 13743) !== null
    )
  }

  // RESTO ZERO E NEGATIVO não derivam, e os dois casos existem de
  // verdade: a primeira forma cobrindo tudo, e o caixa digitando um
  // valor maior que a compra. Preencher R$ 0,00 daria uma linha que a
  // validação recusa logo em seguida; negativo é irrepresentável num
  // campo de dígitos.
  {
    const exato = resolve(['13743', ''], 13743)
    igual('resto zero nao deriva', exato.indiceDerivado, null)
    igual('e a linha fica vazia, nao zerada a forca', exato.valoresCents[1], 0)

    const demais = resolve(['20000', ''], 13743)
    igual('resto negativo nao deriva', demais.indiceDerivado, null)
    igual('e o digitado e preservado pra tela poder explicar', demais.valoresCents[0], 20000)
  }

  // O PAR DE INVERSAS que leva o valor calculado de volta ao campo. Se
  // `digitosDoValor` e `centsFromDigits` discordarem, a tela exibe um
  // número e grava outro — e o campo derivado é justamente aquele que o
  // caixa não tem como conferir digitando.
  for (const cents of [1, 5, 743, 3743, 13743, 99999999]) {
    igual(`ida e volta preserva ${cents}`, centsFromDigits(digitosDoValor(cents)), cents)
  }
  igual('valor nao positivo vira campo vazio', digitosDoValor(0), '')

  // A DERIVAÇÃO SATISFAZ A VALIDAÇÃO — as duas regras têm que concordar,
  // senão a tela preenche sozinha um valor que ela mesma recusa no
  // submit. É o mesmo defeito do §88 noutra roupa: dois escritores do
  // mesmo fato.
  {
    const r = resolve(['10000', ''], 13743)
    igual(
      'o que a derivacao produz passa na validacao',
      validarFormasPrevistas(
        [
          { forma: 'pix', valor_cents: r.valoresCents[0] },
          { forma: 'dinheiro', valor_cents: r.valoresCents[1] },
        ],
        13743
      ),
      null
    )
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (9) fiacao: as regras nao tem segunda copia ---')
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

  // A DERIVAÇÃO É UMA SÓ, e as duas telas a chamam. Uma cópia local em
  // qualquer uma delas poderia calcular o resto de um jeito e gravar de
  // outro — o defeito que este arquivo inteiro existe pra impedir.
  checa('o cadastro deriva pela lib', /resolverValoresDasFormas\(/.test(semComentarios(cadastro)))
  checa('o dialog deriva pela lib', /resolverValoresDasFormas\(/.test(semComentarios(dialog)))

  // O PAYLOAD SAI DA DERIVAÇÃO, nunca dos dígitos crus. A linha derivada
  // não TEM dígitos — é justamente ela que valeria zero se alguém
  // voltasse a ler `linha.digitos`/`linha.valor` aqui, e o vale sairia
  // com a forma que a tela mostrava preenchida valendo nada.
  checa(
    'o cadastro grava `valoresCents`, nao os digitos crus',
    /valorCents: valoresCents\[i\]/.test(semComentarios(cadastro)) &&
      !/valorCents: umaFormaSo \?/.test(semComentarios(cadastro))
  )
  checa(
    'o dialog grava `valoresCents`, nao os digitos crus',
    /valor_cents: valoresCents\[i\]/.test(semComentarios(dialog)) &&
      !/valor_cents: centsFromDigits\(linha\.valor\)/.test(semComentarios(dialog))
  )

  // A LINHA INICIAL DO DIALOG NASCE VAZIA — se voltasse a nascer com o
  // valor cheio, ela contaria como digitada, e ao adicionar a segunda
  // forma o resto seria zero: a derivação existiria e nunca dispararia,
  // que é a pior forma de uma regra falhar (sem erro nenhum).
  checa(
    'a linha inicial do dialog nasce vazia',
    !/valor: String\(valorCents\)/.test(semComentarios(dialog))
  )

  // O CAMPO DERIVADO SELECIONA AO FOCAR. Sem isso a máscara continua a
  // partir do que já está lá: clicar num campo que mostra "37,43" e
  // digitar "5" daria "374,35" em vez de "0,05".
  checa('o cadastro seleciona ao focar a derivada', /selecionaAoFocar=/.test(cadastro))
  checa('o dialog seleciona ao focar a derivada', /selecionaAoFocar=/.test(dialog))

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
