// Teste do cartão do motoboy: o parser do token e o PDF.
//
// Roda com:  npx tsx scripts/cartao-pdf.spec.mts
//
// Mesma disciplina do canonico.spec.mts: fora de src/, sem runner de
// teste, porque a stack é lista fechada e o projeto não tem um.
//
// O que ele prova, e é o que não dá pra ver abrindo o arquivo:
//
//  - o parser do token reconhece os TRÊS formatos e recusa o resto (ele é
//    gêmeo de `public.public_id_do_token`, e divergir dele quebra o
//    reconhecimento OFFLINE, onde só o cliente responde);
//  - o PDF sai com o TAMANHO FÍSICO certo, com as barras nas MESMAS
//    posições que o codificador manda, e com o preto em CMYK 100% K.
//
// Um PDF com a página errada ou com preto composto parece perfeito na
// tela e só falha depois de impresso, que é tarde.
import bwipjs from 'bwip-js'
import { inflateSync } from 'node:zlib'
import {
  montarCartaoPdf,
  barrasDoSvg,
  type GeometriaCartao,
  type BarraDoCodigo,
} from '../src/lib/cartaoPdf.ts'
import { publicIdDoToken } from '../src/lib/tokenCartao.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// Os mesmos números do componente.
const LARGURA_MM = 75
const ALTURA_BARRA_MM = 16
const ESPACO_TEXTO_UNIDADES = 16
const FONTE_TOKEN_UNIDADES = 8
const BASE_TEXTO_UNIDADES = 12
const MODULO_MINIMO_MM = 0.19

// Token v3: versão 3 + public_id de 6 dígitos + segredo de 15.
const PUBLIC_ID = '012345'
const TOKEN = '3' + PUBLIC_ID + '678901234567890'
const TOKEN_LEGIVEL = TOKEN.replace(/(.{6})/g, '$1 ').trim()

console.log('\n--- o token e o parser ---')
checa('token v3 tem 22 dígitos', TOKEN.length === 22 && /^[0-9]+$/.test(TOKEN), `${TOKEN.length}`)
// Total ÍMPAR jogaria um dígito pra fora do Set C, custando 11 módulos
// por 1 dígito em vez de por 2. Não é detalhe: é metade do motivo de o
// formato ser como é.
checa('total par, pro Set C empacotar tudo', TOKEN.length % 2 === 0)

// Estes casos são baratos e cobrem a única coisa que quebra em silêncio:
// um cartão que o banco reconhece e o cliente não, ou o contrário.
checa('v3 devolve o public_id', publicIdDoToken(TOKEN) === PUBLIC_ID, String(publicIdDoToken(TOKEN)))
checa('v2 já impresso continua valendo', publicIdDoToken('2' + '0102030405' + '7'.repeat(31)) === '0102030405')
checa('v1 já impresso continua valendo', publicIdDoToken('DCM1.0102030405.' + 'A'.repeat(20)) === '0102030405')
checa('v3 com um dígito a menos é recusado', publicIdDoToken('3' + '0'.repeat(20)) === null)
checa('v3 com um dígito a mais é recusado', publicIdDoToken('3' + '0'.repeat(22)) === null)
checa('versão desconhecida é recusada', publicIdDoToken('4' + '0'.repeat(21)) === null)
checa('letra no meio é recusada', publicIdDoToken('3' + '0'.repeat(19) + 'A0') === null)
// O leitor age como teclado e costuma mandar Enter no fim.
checa('espaço em volta não atrapalha', publicIdDoToken('  ' + TOKEN + '\n') === PUBLIC_ID)
checa('vazio é recusado', publicIdDoToken('') === null)

// ---- a geometria ----
const base = {
  bcid: 'code128',
  text: TOKEN,
  includetext: false,
  paddingwidth: 10,
  paddingheight: 0,
  backgroundcolor: 'FFFFFF',
  scale: 1,
} as const

// As duas passadas do componente, reproduzidas.
const primeira = bwipjs.toSVG({ ...base, height: ALTURA_BARRA_MM })
const vb = primeira.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
const unidadesLargura = Number(vb[1])
// Alvo em módulos INTEIROS, arredondado pra baixo — ver o comentário no
// componente. Sem isso a barra estoura os 16mm da especificação.
const alvoUnidades = Math.floor((ALTURA_BARRA_MM * unidadesLargura) / LARGURA_MM)
const alturaNatural = (ALTURA_BARRA_MM * alvoUnidades) / Number(vb[2])
const segunda = bwipjs.toSVG({ ...base, height: alturaNatural })
const vb2 = segunda.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!

const g: GeometriaCartao = {
  larguraMm: LARGURA_MM,
  unidadesLargura: Number(vb2[1]),
  unidadesAltura: Number(vb2[2]),
  espacoTextoUnidades: ESPACO_TEXTO_UNIDADES,
  baseTextoUnidades: BASE_TEXTO_UNIDADES,
  fonteTokenUnidades: FONTE_TOKEN_UNIDADES,
}

const moduloMm = LARGURA_MM / g.unidadesLargura
const alturaMm = (g.unidadesAltura + ESPACO_TEXTO_UNIDADES) * moduloMm

console.log('\n--- a geometria ---')
console.log(`  ${g.unidadesLargura} módulos de largura, ${moduloMm.toFixed(4)}mm cada`)
console.log(
  `  cartão ${LARGURA_MM} × ${alturaMm.toFixed(2)}mm, barras de ${(g.unidadesAltura * moduloMm).toFixed(2)}mm`
)
console.log(
  `  ${((moduloMm * 300) / 25.4).toFixed(1)} pontos por módulo a 300dpi, ${((moduloMm * 600) / 25.4).toFixed(1)} a 600dpi\n`
)

checa('módulo acima do piso do leitor', moduloMm >= MODULO_MINIMO_MM, `${moduloMm.toFixed(4)}mm`)
// O ponto de ter encurtado o token: dobrar a margem sobre o piso. O v2
// dava 1,38x; abaixo de 2x aqui é sinal de que alguém mexeu no formato.
checa(
  'margem sobre o piso mais que dobrou',
  moduloMm / MODULO_MINIMO_MM > 2,
  `${(moduloMm / MODULO_MINIMO_MM).toFixed(2)}x o piso`
)
// As barras têm que caber DENTRO dos 16mm da especificação, nunca
// estourar: a altura sai em número inteiro de módulos, e um módulo do v3
// vale 0,43mm. Então o certo é ficar até um módulo abaixo, jamais acima.
const alturaBarraMm = g.unidadesAltura * moduloMm
checa('barras dentro dos 16mm', alturaBarraMm <= ALTURA_BARRA_MM, `${alturaBarraMm.toFixed(2)}mm`)
checa(
  'e não desperdiçam mais que um módulo',
  ALTURA_BARRA_MM - alturaBarraMm < moduloMm,
  `${(ALTURA_BARRA_MM - alturaBarraMm).toFixed(2)}mm de sobra`
)

// Code 128 com 22 dígitos: start + 11 pares (Set C) + checksum + stop.
// O stop tem 13 módulos em vez de 11, daí 156 e não 154.
const modulosDeCodigo = g.unidadesLargura - 20
checa('156 módulos de código, fora as zonas de silêncio', modulosDeCodigo === 156, `${modulosDeCodigo}`)

// ---- as barras lidas do SVG ----
const barras = barrasDoSvg(segunda)
checa('achou barras no SVG', barras.length > 0, `${barras.length} barras`)

// A primeira barra tem que começar exatamente no fim da zona de silêncio,
// e a última terminar 10 módulos antes da borda. Meio módulo de erro aqui
// deslocaria o código inteiro sem dar nenhum sinal na tela.
const inicio = Math.min(...barras.map((b) => b.xUnidades))
const fim = Math.max(...barras.map((b) => b.xUnidades + b.larguraUnidades))
checa('zona de silêncio de 10 módulos à esquerda', inicio === 10, `começa em ${inicio}`)
checa('zona de silêncio de 10 módulos à direita', g.unidadesLargura - fim === 10, `termina em ${fim}`)
checa(
  'nenhuma barra com largura inválida',
  barras.every((b) => b.larguraUnidades >= 1 && b.larguraUnidades <= 4)
)
checa(
  'nenhuma barra sobrepondo outra',
  (() => {
    const ord = [...barras].sort((a, b) => a.xUnidades - b.xUnidades)
    return ord.every(
      (b, i) => i === 0 || b.xUnidades >= ord[i - 1].xUnidades + ord[i - 1].larguraUnidades - 1e-9
    )
  })()
)

// A prova que vale mais que todas as acima: as barras que eu leio do SVG
// batem, uma a uma, com o que o CODIFICADOR do bwip-js diz que elas são.
//
// Tudo o mais aqui confere o SVG contra ele mesmo — se a minha leitura do
// path estivesse errada de um jeito consistente (meio módulo pra
// esquerda, por exemplo), passaria em tudo e o cartão sairia deslocado.
// raw() devolve sbs: larguras alternando barra, espaço, barra… começando
// por barra. É outra saída do bwip-js, ou seja, uma segunda opinião de
// verdade.
const sbs: number[] = bwipjs.raw({ bcid: 'code128', text: TOKEN } as never)[0].sbs
checa('o codificador confirma os 156 módulos', sbs.reduce((a, b) => a + b, 0) === 156)

const esperadas: BarraDoCodigo[] = []
let cursor = 10 // fim da zona de silêncio
for (let i = 0; i < sbs.length; i++) {
  if (i % 2 === 0) esperadas.push({ xUnidades: cursor, larguraUnidades: sbs[i] })
  cursor += sbs[i]
}

const lidas = [...barras].sort((a, b) => a.xUnidades - b.xUnidades)
checa('mesmo número de barras', lidas.length === esperadas.length, `${lidas.length} vs ${esperadas.length}`)
const divergente = esperadas.findIndex(
  (e, i) =>
    !lidas[i] ||
    Math.abs(lidas[i].xUnidades - e.xUnidades) > 1e-9 ||
    Math.abs(lidas[i].larguraUnidades - e.larguraUnidades) > 1e-9
)
checa(
  'cada barra na posição e na largura que o codificador manda',
  divergente === -1,
  divergente === -1 ? '' : `barra ${divergente}`
)

// ---- o PDF ----
console.log('\n--- o PDF ---')
const bytes = await montarCartaoPdf(segunda, TOKEN_LEGIVEL, g)
const pdf = Buffer.from(bytes)
checa('é um PDF', pdf.subarray(0, 5).toString() === '%PDF-')

// Com compress: true o content stream vem deflatado, então descomprimo
// pra poder conferir os operadores. É o equivalente a ler
// xl/worksheets/sheetN.xml de dentro do .xlsx.
let conteudo = pdf.toString('latin1')
for (const m of conteudo.matchAll(/stream\r?\n/g)) {
  const ini = m.index! + m[0].length
  const fimStream = conteudo.indexOf('endstream', ini)
  try {
    conteudo +=
      '\n' + inflateSync(Buffer.from(conteudo.slice(ini, fimStream), 'latin1')).toString('latin1')
  } catch {
    /* nem todo stream é deflate — fontes, xref */
  }
}

const PT_POR_MM = 72 / 25.4
const mediaBox = conteudo.match(/MediaBox\s*\[([^\]]+)\]/)
const cx = mediaBox ? mediaBox[1].trim().split(/\s+/).map(Number) : []
const larguraPt = cx[2] - cx[0]
const alturaPt = cx[3] - cx[1]
checa(
  'página com a largura física exata',
  Math.abs(larguraPt - LARGURA_MM * PT_POR_MM) < 0.2,
  `${larguraPt?.toFixed(2)}pt = ${(larguraPt / PT_POR_MM).toFixed(2)}mm`
)
checa(
  'página com a altura física exata',
  Math.abs(alturaPt - alturaMm * PT_POR_MM) < 0.2,
  `${alturaPt?.toFixed(2)}pt = ${(alturaPt / PT_POR_MM).toFixed(2)}mm`
)
// Com orientation portrait o jsPDF ordena o format pelo menor lado e a
// página sairia em pé. Some sem avisar e só aparece na gráfica.
checa('página deitada, não em pé', larguraPt > alturaPt)

// O ponto do arquivo inteiro: preto de UMA cor, não das quatro.
//
// O jsPDF escreve o número com o ponto e sem casa decimal (0. e 1.), e a
// primeira versão deste teste não previa isso — acusou falha com o PDF
// correto. Vale a regra de sempre neste projeto: conferir o instrumento
// antes de concluir que o resultado está errado.
const usosDoPretoK = [...conteudo.matchAll(/0\.?\d*\s+0\.?\d*\s+0\.?\d*\s+1\.?\d*\s+k\b/g)].length
checa('preto 100% K em CMYK', usosDoPretoK >= 1)
// Duas vezes: uma pras barras, outra pro token. Se o texto saísse em
// cinza ou em RGB, ele e as barras seriam pretos diferentes no papel.
checa('barras e token no mesmo preto', usosDoPretoK >= 2, `${usosDoPretoK} usos`)
checa('nenhum preto em RGB', !/\b0\.?\d*\s+0\.?\d*\s+0\.?\d*\s+rg\b/.test(conteudo))
// Fundo branco por AUSÊNCIA de tinta (CMYK zerado), não tinta branca.
checa('fundo sem tinta', /0\.?\d*\s+0\.?\d*\s+0\.?\d*\s+0\.?\d*\s+k\b/.test(conteudo))

// Um retângulo por barra, mais o fundo.
const retangulos = [...conteudo.matchAll(/\bre\b/g)].length
checa(
  'um retângulo por barra, mais o fundo',
  retangulos === barras.length + 1,
  `${retangulos} vs ${barras.length + 1}`
)

// Courier é base-14: o PDF referencia a fonte sem embutir arquivo nenhum,
// e é por isso que ela não depende da máquina de quem abre.
checa('usa a Courier padrão do PDF', /\/BaseFont\s*\/Courier\b/.test(conteudo))
checa('o token está no arquivo', conteudo.includes(TOKEN.slice(0, 6)))
// Nada que identifique quem carrega o cartão.
checa('sem autor nos metadados', !/\/Author\s*\((?!\))/.test(conteudo))

// A largura do texto, numa fonte de avanço 600/1000 em. É a conta que a
// primeira versão do .svg errou, pondo 81,8mm num cartão de 75mm — e ela
// sai da string FORMATADA, não de um número fixo, senão o teste para de
// acompanhar quando o formato do token mudar de novo.
const larguraTexto = TOKEN_LEGIVEL.length * 0.6 * FONTE_TOKEN_UNIDADES * moduloMm
checa('o token cabe dentro dos 75mm', larguraTexto < LARGURA_MM, `${larguraTexto.toFixed(1)}mm`)
checa(
  'e sobra margem dos dois lados',
  (LARGURA_MM - larguraTexto) / 2 > 3,
  `${((LARGURA_MM - larguraTexto) / 2).toFixed(1)}mm de cada lado`
)

console.log(`\n${falhas === 0 ? 'tudo ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
