// Confere o Code 128 escrito à mão (src/lib/code128.ts) contra o bwip-js.
//
// Roda com:  npx tsx scripts/code128.spec.mts
//
// POR QUE ESTE TESTE É O QUE AUTORIZA AQUELE ARQUIVO A EXISTIR
//
// O projeto tem regra explícita contra duas codificações do mesmo dado —
// foi ela que decidiu, no cartão em PDF, LER as barras do SVG em vez de
// chamar o bwip-js de novo. A credencial CR80 precisa das barras como
// <rect> dentro de um SVG maior, então a segunda implementação passou a
// ser necessária. O que a torna aceitável não é o cuidado ao escrevê-la:
// é ser conferida barra a barra contra o padrão-ouro.
//
// O bwip-js é o padrão-ouro aqui, não o contrário. Divergiu, quem está
// errado é o src/lib/code128.ts.
import bwipjs from 'bwip-js'
import {
  barrasCode128,
  encodeCode128Values,
  generateCode128Svg,
  MODULOS_ZONA_SILENCIO,
  MODULOS_ALTURA_BARRA,
  MODULO_MINIMO_MM,
} from '../src/lib/code128.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// Reconstrói as barras a partir do `sbs` do bwip-js: larguras alternando
// barra, espaço, barra… começando por barra.
function barrasDoBwip(valor: string) {
  const sbs: number[] = bwipjs.raw({ bcid: 'code128', text: valor } as never)[0].sbs
  const barras: { x: number; largura: number }[] = []
  let cursor = MODULOS_ZONA_SILENCIO
  for (let i = 0; i < sbs.length; i++) {
    if (i % 2 === 0) barras.push({ x: cursor, largura: sbs[i] })
    cursor += sbs[i]
  }
  return { barras, modulosCodigo: sbs.reduce((a, b) => a + b, 0) }
}

console.log('\n--- Set C: dígitos em quantidade par (o caso real do token) ---')

// Do menor ao maior que o projeto já usou: v3 tem 22, v2 tem 42.
const casosNumericos: string[] = []
for (let n = 2; n <= 44; n += 2) {
  // Conteúdo variado, não só repetição: repetição esconderia erro de
  // índice na tabela de padrões.
  casosNumericos.push(
    Array.from({ length: n }, (_, i) => String((i * 7 + n) % 10)).join('')
  )
}
casosNumericos.push('3' + '012345' + '678901234567890') // token v3 de verdade
casosNumericos.push('2' + '0102030405' + '1234567890123456789012345678901') // v2

for (const valor of casosNumericos) {
  const meu = barrasCode128(valor)
  const ouro = barrasDoBwip(valor)

  const mesmoTotal = meu.totalModulos === ouro.modulosCodigo + 2 * MODULOS_ZONA_SILENCIO
  const mesmaContagem = meu.barras.length === ouro.barras.length
  const divergente = ouro.barras.findIndex(
    (b, i) => !meu.barras[i] || meu.barras[i].x !== b.x || meu.barras[i].largura !== b.largura
  )

  checa(
    `${String(valor.length).padStart(2)} dígitos`,
    mesmoTotal && mesmaContagem && divergente === -1,
    divergente === -1
      ? `${meu.totalModulos} módulos, ${meu.barras.length} barras`
      : `diverge na barra ${divergente}`
  )
}

console.log('\n--- o token v3 no desenho da credencial ---')
const TOKEN_V3 = '3' + '012345' + '678901234567890'
const { totalModulos } = barrasCode128(TOKEN_V3)
const LARGURA_MM = 75
const moduloMm = LARGURA_MM / totalModulos
const alturaMm = MODULOS_ALTURA_BARRA * moduloMm

checa('22 dígitos dão 176 módulos com as zonas', totalModulos === 176, `${totalModulos}`)
checa('módulo acima do piso do leitor', moduloMm >= MODULO_MINIMO_MM, `${moduloMm.toFixed(4)}mm`)
checa('margem folgada sobre o piso', moduloMm / MODULO_MINIMO_MM > 2, `${(moduloMm / MODULO_MINIMO_MM).toFixed(2)}x`)
// O desenho fixa a caixa em 15.767mm. Se isto deixar de bater, a escala
// do símbolo deixa de ser uniforme — não quebra a leitura, mas convém
// saber, porque o número do desenho passa a ser arbitrário.
checa(
  'altura natural bate com os 15,767mm do desenho',
  Math.abs(alturaMm - 15.767) < 0.005,
  `${alturaMm.toFixed(4)}mm`
)

console.log('\n--- zonas de silêncio ---')
const { barras } = barrasCode128(TOKEN_V3)
const inicio = Math.min(...barras.map((b) => b.x))
const fim = Math.max(...barras.map((b) => b.x + b.largura))
checa('10 módulos à esquerda', inicio === MODULOS_ZONA_SILENCIO, `começa em ${inicio}`)
checa('10 módulos à direita', totalModulos - fim === MODULOS_ZONA_SILENCIO, `termina em ${fim}`)
checa(
  'nenhuma barra sobrepondo outra',
  barras.every((b, i) => i === 0 || b.x >= barras[i - 1].x + barras[i - 1].largura)
)
checa('larguras entre 1 e 4 módulos', barras.every((b) => b.largura >= 1 && b.largura <= 4))

console.log('\n--- estrutura da codificação ---')
const codes = encodeCode128Values(TOKEN_V3)
checa('começa com Start C', codes[0] === 105)
checa('termina com Stop', codes[codes.length - 1] === 106)
checa('11 pares de dígitos', codes.length === 1 + 11 + 1 + 1, `${codes.length} símbolos`)
// Checksum recalculado de forma independente da implementação.
const dados = codes.slice(1, -2)
const somaEsperada = (105 + dados.reduce((t, c, i) => t + c * (i + 1), 0)) % 103
checa('checksum confere', codes[codes.length - 2] === somaEsperada, `${codes[codes.length - 2]}`)

console.log('\n--- Set B e recusas ---')
checa('texto alfanumérico usa Start B', encodeCode128Values('ABC-123')[0] === 104)
checa('quantidade ÍMPAR de dígitos cai pro Set B', encodeCode128Values('12345')[0] === 104)
let recusou = false
try {
  encodeCode128Values('café')
} catch {
  recusou = true
}
checa('caractere fora do ASCII imprimível é recusado', recusou)
recusou = false
try {
  encodeCode128Values('')
} catch {
  recusou = true
}
checa('valor vazio é recusado', recusou)

// O símbolo tem que caber em 75mm. Um token absurdamente longo precisa
// falhar AQUI, com mensagem clara, e não sair um cartão ilegível.
recusou = false
let mensagem = ''
try {
  generateCode128Svg('1'.repeat(120), { larguraMm: 75, x: 5.3, y: 16.791477, alturaMm: 15.767 })
} catch (e) {
  recusou = true
  mensagem = e instanceof Error ? e.message : String(e)
}
checa('token longo demais é recusado com mensagem explícita', recusou && mensagem.includes('0.19'))

console.log('\n--- o SVG gerado ---')
const svg = generateCode128Svg(TOKEN_V3, { larguraMm: 75, x: 5.3, y: 16.791477, alturaMm: 15.767 })
checa('posicionado no desenho', svg.includes('x="5.3"') && svg.includes('y="16.791477"'))
checa('largura e altura do desenho', svg.includes('width="75"') && svg.includes('height="15.767"'))
checa('viewBox em módulos', svg.includes(`viewBox="0 0 ${totalModulos} ${MODULOS_ALTURA_BARRA}"`))
checa('barras são <rect>, não bitmap', (svg.match(/<rect /g) ?? []).length === barras.length)
checa('sem <image> e sem base64', !svg.includes('<image') && !svg.includes('base64'))
checa('preto chapado', svg.includes('fill="#000000"'))

console.log(`\n${falhas === 0 ? 'confere com o bwip-js' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
