// Gera um cartão de TESTE, com token fictício, pro teste de impressão.
//
// Roda com:  npx tsx scripts/cartao-de-teste.mts [destino]
//
// Existe por um motivo prático: testar impressora, papel e leitor não
// deveria custar uma credencial de verdade. Emitir pelo app revoga o
// cartão anterior do motoboy e o token só aparece uma vez — usar isso
// como cobaia de impressora é caro e irreversível.
//
// O token daqui tem public_id 000000 e um segredo fixo. Ele passa no
// parser (é v3 bem formado, então o leitor lê e o formato se prova), mas
// NÃO EXISTE no banco: bipá-lo na Nova Corrida devolve "credencial não
// reconhecida". É exatamente o que se quer de um cartão de teste.
//
// Escreve os DOIS formatos, porque eles respondem perguntas diferentes:
//   .pdf  o que vai pra gráfica, e o que imprime certo em casa
//   .svg  o mesmo desenho, pra abrir em editor vetorial
//
// COMO TESTAR EM PAPEL, que é o ponto:
//   1. imprima o .pdf em TAMANHO REAL / 100% — nunca "ajustar à página"
//   2. meça com régua: o código tem que ter 75mm de ponta a ponta
//   3. bipe com o LEITOR DA FARMÁCIA, não com app de celular (app é bem
//      mais tolerante e daria um falso positivo)
//   4. o leitor tem que devolver os 22 dígitos exatos impressos embaixo
//
// Se a medida der diferente de 75mm, a impressão escalou e o teste não
// vale — resolva isso antes de concluir qualquer coisa sobre o código.
import bwipjs from 'bwip-js'
import fs from 'node:fs'
import { montarCartaoPdf, type GeometriaCartao } from '../src/lib/cartaoPdf.ts'
import { publicIdDoToken } from '../src/lib/tokenCartao.ts'

// Os mesmos números do componente de emissão.
const LARGURA_MM = 75
const ALTURA_BARRA_MM = 16
const ESPACO_TEXTO_UNIDADES = 16
const FONTE_TOKEN_UNIDADES = 8
const BASE_TEXTO_UNIDADES = 12

// v3: 3 + public_id(6) + segredo(15). Todos zeros no public_id pra ficar
// óbvio, olhando o número, que não é cartão de ninguém.
const TOKEN = '3' + '000000' + '000000000000000'
if (publicIdDoToken(TOKEN) !== '000000') {
  throw new Error('o token de teste não passa no parser — o formato mudou?')
}

const destino = process.argv[2] ?? 'cartao-de-teste'

const base = {
  bcid: 'code128',
  text: TOKEN,
  includetext: false,
  paddingwidth: 10,
  paddingheight: 0,
  backgroundcolor: 'FFFFFF',
  scale: 1,
} as const

const primeira = bwipjs.toSVG({ ...base, height: ALTURA_BARRA_MM })
const vb = primeira.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
const unidadesLargura = Number(vb[1])
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
const tokenLegivel = TOKEN.replace(/(.{6})/g, '$1 ').trim()

// O SVG composto, igual ao do componente.
const svg = segunda
  .replace(
    `viewBox="0 0 ${g.unidadesLargura} ${g.unidadesAltura}"`,
    `viewBox="0 0 ${g.unidadesLargura} ${g.unidadesAltura + ESPACO_TEXTO_UNIDADES}" width="${LARGURA_MM}mm" height="${alturaMm.toFixed(2)}mm"`
  )
  .replace(
    '</svg>',
    `<text x="${g.unidadesLargura / 2}" y="${g.unidadesAltura + BASE_TEXTO_UNIDADES}" ` +
      `text-anchor="middle" font-family="Courier New, monospace" ` +
      `font-size="${FONTE_TOKEN_UNIDADES}" fill="#000000">${tokenLegivel}</text>\n</svg>`
  )

fs.writeFileSync(`${destino}.svg`, svg, 'utf8')
fs.writeFileSync(`${destino}.pdf`, Buffer.from(await montarCartaoPdf(segunda, tokenLegivel, g)))

console.log(`
  token de teste .... ${tokenLegivel}
  cartão ............ ${LARGURA_MM} × ${alturaMm.toFixed(2)}mm
  barras ............ ${(g.unidadesAltura * moduloMm).toFixed(2)}mm de altura
  módulo ............ ${moduloMm.toFixed(4)}mm  (${(moduloMm / 0.19).toFixed(2)}x o piso do leitor)
  na impressora ..... ${((moduloMm * 300) / 25.4).toFixed(1)} pontos/módulo a 300dpi, ${((moduloMm * 600) / 25.4).toFixed(1)} a 600dpi

  ${destino}.pdf   <- imprima ESTE, em tamanho real / 100%
  ${destino}.svg

  Depois de imprimir, meça: o código tem que ter ${LARGURA_MM}mm de ponta a ponta.
  Se der outra medida, a impressão escalou e o teste não vale.
`)
