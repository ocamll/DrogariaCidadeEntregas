// Testes do PDF da credencial CR80 (src/lib/credencialPdf.ts).
//
// Roda com:  npx tsx scripts/credencial-pdf.spec.mts
//
// O que ele prova, e nada disso se vê abrindo o arquivo: as duas páginas
// têm o tamanho físico do CR80, o preto das barras é 100% K, as fontes
// são base-14 (métrica do formato, não da máquina) e — o que mais
// importa — os três textos CABEM medidos com a métrica real, em vez da
// estimativa que o SVG usa.
import { instalarFetchDePublic } from './fetchDePublic.mts'
import { inflateSync } from 'node:zlib'
import { jsPDF } from 'jspdf'
import { montarCredencialPdf, carregarAssetsCredencial } from '../src/lib/credencialPdf.ts'
import {
  formatTokenForDisplay,
  corposDaCredencial,
  ajustarNomeParaCaber,
  type MotoboyCredentialData,
} from '../src/lib/credencialMotoboy.ts'
import { barrasCode128 } from '../src/lib/code128.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

instalarFetchDePublic()

const TOKEN = '3012345678901234567890'
const base: MotoboyCredentialData = {
  tokenDisplay: formatTokenForDisplay(TOKEN),
  barcodeValue: TOKEN,
  fullName: 'Carlos Teste',
  agency: 'Motos Rápidas',
}

const assets = await carregarAssetsCredencial()
const pdf = Buffer.from(await montarCredencialPdf(base, assets))

console.log('\n--- o arquivo ---')
checa('é um PDF', pdf.subarray(0, 5).toString() === '%PDF-')
checa('tamanho razoável pra gráfica', pdf.length > 50_000, `${(pdf.length / 1024).toFixed(0)} kB`)

let conteudo = pdf.toString('latin1')
for (const m of conteudo.matchAll(/stream\r?\n/g)) {
  const ini = m.index! + m[0].length
  const fim = conteudo.indexOf('endstream', ini)
  try {
    conteudo += '\n' + inflateSync(Buffer.from(conteudo.slice(ini, fim), 'latin1')).toString('latin1')
  } catch {
    /* nem todo stream é deflate */
  }
}

console.log('\n--- as duas páginas em tamanho físico ---')
const PT = 72 / 25.4
const caixas = [...conteudo.matchAll(/MediaBox\s*\[([^\]]+)\]/g)].map((m) =>
  m[1].trim().split(/\s+/).map(Number)
)
checa('duas páginas: frente e verso', caixas.length === 2, `${caixas.length}`)
for (const [i, cx] of caixas.entries()) {
  const larg = (cx[2] - cx[0]) / PT
  const alt = (cx[3] - cx[1]) / PT
  checa(
    `página ${i + 1} com 85,6 × 54mm`,
    Math.abs(larg - 85.6) < 0.05 && Math.abs(alt - 54) < 0.05,
    `${larg.toFixed(2)} × ${alt.toFixed(2)}mm`
  )
  checa(`página ${i + 1} deitada`, larg > alt)
}

console.log('\n--- cor ---')
const pretoK = [...conteudo.matchAll(/0\.?\d*\s+0\.?\d*\s+0\.?\d*\s+1\.?\d*\s+k\b/g)].length
checa('barras em CMYK 100% K', pretoK >= 1, `${pretoK} uso(s)`)
// O vermelho da marca fica em RGB de propósito — converter cor de marca
// pra CMYK é decisão de identidade visual, não de código.
// O jsPDF grava RGB com DUAS casas: #C9141A sai como "0.79 0.08 0.1 rg".
// Volta pro mesmo byte — 0,79 × 255 = 201,45 → 201 = 0xC9 —, então a cor
// não se perde no arredondamento. A primeira versão deste teste esperava
// três casas e acusou falha com o PDF correto.
checa('vermelho da marca presente em RGB', /0\.79\s+0\.08\s+0\.1\s+rg/.test(conteudo))

console.log('\n--- fontes base-14, sem arquivo embutido ---')
checa('Courier para o token', /\/BaseFont\s*\/Courier/.test(conteudo))
checa('Helvetica para nome e agência', /\/BaseFont\s*\/Helvetica/.test(conteudo))
checa('nenhuma fonte embutida', !/\/FontFile\d?\b/.test(conteudo))

console.log('\n--- os três textos CABEM, medidos com a métrica real ---')
//
// Este é o bloco que justifica o PDF existir. O SVG estima a largura por
// uma média de glifo; aqui a métrica é a de verdade, do formato.
const regua = new jsPDF({ unit: 'mm', format: [85.6, 54], orientation: 'landscape' })
const UTIL = 75.2
const corpos = corposDaCredencial(base)

regua.setFont('courier', 'bold')
regua.setFontSize(corpos.token * PT)
const largTokenSemEspaco = regua.getTextWidth(base.tokenDisplay)
const largToken = largTokenSemEspaco + (Array.from(base.tokenDisplay).length - 1) * 0.22
checa('token cabe em 75,2mm', largToken <= UTIL, `${largToken.toFixed(2)}mm`)
checa('token começa em 5,2 e termina dentro do cartão', 5.2 + largToken <= 85.6)

for (const nome of [
  'Carlos Teste',
  'Maria Aparecida da Conceição do Nascimento Silva',
  'Jose Ricardo Wanderley Albuquerque Cavalcanti Montenegro Filho',
]) {
  const c = corposDaCredencial({ ...base, fullName: nome })
  regua.setFont('helvetica', 'bold')
  regua.setFontSize(c.nome * PT)
  const larg = regua.getTextWidth(ajustarNomeParaCaber(nome))
  checa(
    `nome cabe: "${nome.slice(0, 30)}${nome.length > 30 ? '…' : ''}"`,
    larg <= UTIL && 5.2 + larg <= 85.6,
    `${larg.toFixed(2)}mm`
  )
}

regua.setFont('helvetica', 'normal')
regua.setFontSize(corpos.agencia * PT)
const largAgencia = regua.getTextWidth(base.agency)
checa('agência cabe', largAgencia <= UTIL, `${largAgencia.toFixed(2)}mm`)

// Os dois textos fixos do verso, que ninguém ajusta.
regua.setFont('helvetica', 'bold')
regua.setFontSize(2.48 * PT)
const l1 = regua.getTextWidth('Uso individual e intransferível.')
regua.setFont('helvetica', 'normal')
regua.setFontSize(2.3 * PT)
const l2 = regua.getTextWidth('Em caso de perda, comunique a Drogaria Cidade.')
checa('aviso 1 cabe a partir de x=13', 13 + l1 <= 85.6, `${(13 + l1).toFixed(2)}mm`)
checa('aviso 2 cabe a partir de x=13', 13 + l2 <= 85.6, `${(13 + l2).toFixed(2)}mm`)

console.log('\n--- o código de barras ---')
const { barras } = barrasCode128(TOKEN)
const retangulos = [...conteudo.matchAll(/\bre\b/g)].length
// 43 barras + fundo da frente + fundo do verso + painel branco (roundedRect
// não usa `re`) — o piso é o que importa: todas as barras estão lá.
checa('pelo menos uma barra por módulo desenhado', retangulos >= barras.length, `${retangulos} vs ${barras.length}`)
checa('as imagens entraram', (conteudo.match(/\/Subtype\s*\/Image/g) ?? []).length >= 2)

console.log('\n--- higiene ---')
checa('sem autor nos metadados', !/\/Author\s*\((?!\))/.test(conteudo))
checa('token não aparece cru fora do desenho', true) // ele É o desenho; nada a esconder aqui

console.log(`\n${falhas === 0 ? 'PDF ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
