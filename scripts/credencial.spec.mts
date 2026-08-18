// Testes de aceitação da credencial CR80 (src/lib/credencialMotoboy.ts).
//
// Roda com:  npx tsx scripts/credencial.spec.mts
//
// O módulo busca os assets por `fetch`, porque no app ele roda no
// navegador. Aqui o `fetch` é trocado por leitura de disco — é o mesmo
// arquivo de `public/`, então o que o teste exercita é o mesmo byte que o
// app serve.
import { readFile } from 'node:fs/promises'
import bwipjs from 'bwip-js'
import {
  generateMotoboyCredential,
  formatTokenForDisplay,
  corposDaCredencial,
  ajustarNomeParaCaber,
  type MotoboyCredentialData,
} from '../src/lib/credencialMotoboy.ts'
import { MODULOS_ZONA_SILENCIO } from '../src/lib/code128.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// `fetch` lendo de public/, que é de onde o app serve.
globalThis.fetch = (async (url: string) => {
  const caminho = 'public' + String(url)
  const texto = await readFile(caminho, 'utf8')
  return { ok: true, status: 200, text: async () => texto }
}) as unknown as typeof fetch

const TOKEN = '3012345678901234567890'
const base: MotoboyCredentialData = {
  tokenDisplay: formatTokenForDisplay(TOKEN),
  barcodeValue: TOKEN,
  fullName: 'Carlos Teste',
  agency: 'Motos Rápidas',
}

const { frontSvg, backSvg } = await generateMotoboyCredential(base)

console.log('\n--- tamanho físico ---')
checa('frente tem width="85.6mm"', frontSvg.includes('width="85.6mm"'))
checa('frente tem height="54mm"', frontSvg.includes('height="54mm"'))
checa('verso tem width="85.6mm"', backSvg.includes('width="85.6mm"'))
checa('verso tem height="54mm"', backSvg.includes('height="54mm"'))
checa('frente com viewBox do CR80', frontSvg.includes('viewBox="0 0 85.6 54"'))
checa('verso com viewBox do CR80', backSvg.includes('viewBox="0 0 85.6 54"'))

console.log('\n--- painel branco e caixa do código (do desenho) ---')
checa(
  'painel branco 78,4 × 22,85 em 3,6 / 13,25',
  backSvg.includes('x="3.6"') &&
    backSvg.includes('y="13.25"') &&
    backSvg.includes('width="78.4"') &&
    backSvg.includes('height="22.85"')
)
checa(
  'código de barras 75 × 15,767 em 5,3 / 16,791477',
  backSvg.includes('x="5.3"') &&
    backSvg.includes('y="16.791477"') &&
    backSvg.includes('width="75"') &&
    backSvg.includes('height="15.767"')
)

console.log('\n--- o código de barras ---')
// As barras do SVG contra o codificador de referência, uma a uma.
const rects = [...backSvg.matchAll(/<rect x="([\d.]+)" y="0" width="(\d+)" height="37"\/>/g)].map(
  (m) => ({ x: Number(m[1]), largura: Number(m[2]) })
)
const sbs: number[] = bwipjs.raw({ bcid: 'code128', text: TOKEN } as never)[0].sbs
const esperadas: { x: number; largura: number }[] = []
let cursor = MODULOS_ZONA_SILENCIO
for (let i = 0; i < sbs.length; i++) {
  if (i % 2 === 0) esperadas.push({ x: cursor, largura: sbs[i] })
  cursor += sbs[i]
}
checa('mesma contagem de barras do bwip-js', rects.length === esperadas.length, `${rects.length}`)
checa(
  'cada barra na posição e largura do bwip-js',
  esperadas.every((e, i) => rects[i] && rects[i].x === e.x && rects[i].largura === e.largura)
)
checa('zona de silêncio à esquerda', Math.min(...rects.map((r) => r.x)) === MODULOS_ZONA_SILENCIO)
const fim = Math.max(...rects.map((r) => r.x + r.largura))
const totalModulos = cursor + MODULOS_ZONA_SILENCIO
checa('zona de silêncio à direita', totalModulos - fim === MODULOS_ZONA_SILENCIO)
checa('barras permanecem vetoriais', rects.length > 0 && !/<image[^>]*aria-label="Código/.test(backSvg))
checa('o símbolo não virou bitmap', !backSvg.includes('shape-rendering="auto"'))

console.log('\n--- escape de XML ---')
const perigoso: MotoboyCredentialData = {
  ...base,
  fullName: 'Ana <script>alert("x")</script> & Cia',
  agency: "Agência 'Aspas' & <b>",
}
const { frontSvg: frenteEscapada } = await generateMotoboyCredential(perigoso)
checa('nome escapado', !frenteEscapada.includes('<script>') && frenteEscapada.includes('&lt;script&gt;'))
checa('e comercial escapado', frenteEscapada.includes('&amp;'))
checa('aspas simples escapadas', frenteEscapada.includes('&apos;'))
checa('aspas duplas escapadas', frenteEscapada.includes('&quot;'))
// O XML tem que continuar bem formado depois do escape.
checa(
  'nenhuma tag injetada sobreviveu',
  (frenteEscapada.match(/<script/g) ?? []).length === 0
)

console.log('\n--- fundo e logo não mudam entre credenciais ---')
const outra = await generateMotoboyCredential({
  tokenDisplay: formatTokenForDisplay('3999888777666555444333'),
  barcodeValue: '3999888777666555444333',
  fullName: 'Outro Motoboy',
  agency: 'Outra Agência',
})
// Tira o que DEVE variar; o resto tem que ser idêntico byte a byte.
const semVariaveis = (svg: string) =>
  svg
    .replace(/<text[\s\S]*?<\/text>/g, '<text/>')
    .replace(/<rect x="[\d.]+" y="0"[^/]*\/>/g, '<bar/>')
    .replace(/<title[\s\S]*?<\/title>/, '<title/>')
checa('frente: tudo menos os textos é idêntico', semVariaveis(frontSvg) === semVariaveis(outra.frontSvg))
checa('verso: tudo menos as barras é idêntico', semVariaveis(backSvg) === semVariaveis(outra.backSvg))
checa('fundo vermelho intacto', frontSvg.includes('fill="#C9141A"') && outra.frontSvg.includes('fill="#C9141A"'))
checa('opacidade da cruz intacta', frontSvg.includes('opacity=".085"'))
checa('logo embutida nas duas', frontSvg.includes('data:image/png;base64,') && outra.frontSvg.includes('data:image/png;base64,'))

console.log('\n--- nome longo não ultrapassa o cartão ---')
//
// Só encolher o corpo NÃO basta: fitSansFontSize para no piso de 2,9, e a
// partir de ~46 caracteres o nome transbordava a borda do cartão. Quem
// resolve é ajustarNomeParaCaber, abreviando os nomes do meio — nenhuma
// coordenada, cor ou corpo do desenho muda.
const nomes = [
  'Carlos Teste',
  'Maria Aparecida da Conceição do Nascimento Silva',
  'Jose Ricardo Wanderley Albuquerque Cavalcanti Montenegro Filho',
  'A'.repeat(120),
]
for (const nome of nomes) {
  const ajustado = ajustarNomeParaCaber(nome)
  const corpo = corposDaCredencial({ ...base, fullName: nome }).nome
  const largura = Array.from(ajustado).length * 0.56 * corpo
  checa(
    `cabe: "${nome.length > 32 ? nome.slice(0, 32) + '…' : nome}"`,
    largura <= 75.25 && 5.2 + largura <= 85.6,
    `${largura.toFixed(2)}mm → "${ajustado}"`
  )
}
checa('nome curto passa intacto', ajustarNomeParaCaber('Carlos Teste') === 'Carlos Teste')
checa(
  'nome longo mantém primeiro e último por extenso',
  (() => {
    const a = ajustarNomeParaCaber('Maria Aparecida da Conceição do Nascimento Silva')
    return a.startsWith('Maria ') && a.endsWith(' Silva')
  })()
)
checa(
  'corpo nunca abaixo do piso legível',
  nomes.every((n) => corposDaCredencial({ ...base, fullName: n }).nome >= 2.9)
)

console.log('\n--- recusas ---')
async function recusa(dados: Partial<MotoboyCredentialData>, esperado: string) {
  try {
    await generateMotoboyCredential({ ...base, ...dados })
    return { recusou: false, msg: '' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { recusou: true, msg, bate: msg.includes(esperado) }
  }
}
const semNome = await recusa({ fullName: '   ' }, 'Nome do motoboy')
checa('nome vazio é recusado', semNome.recusou && semNome.bate === true, semNome.msg)
const semAgencia = await recusa({ agency: '' }, 'Agência')
checa('agência vazia é recusada', semAgencia.recusou && semAgencia.bate === true, semAgencia.msg)
const tokenCurto = await recusa({ barcodeValue: '30123', tokenDisplay: '30123' }, '22 dígitos')
checa('token fora do v3 é recusado com mensagem explícita', tokenCurto.recusou && tokenCurto.bate === true, tokenCurto.msg)
const tokenV2 = await recusa(
  { barcodeValue: '2' + '0'.repeat(41), tokenDisplay: '2' + '0'.repeat(41) },
  '22 dígitos'
)
checa('token v2 (descontinuado) é recusado', tokenV2.recusou && tokenV2.bate === true)

console.log('\n--- formatação visual do token ---')
checa('agrupa de 6 em 6', formatTokenForDisplay(TOKEN) === '301234 567890 123456 7890')
checa('não altera o valor do código', formatTokenForDisplay(TOKEN).replace(/ /g, '') === TOKEN)
checa('espaços prévios são removidos', formatTokenForDisplay(' 3012 3456 ') === formatTokenForDisplay(TOKEN).slice(0, 9).trim() ? true : formatTokenForDisplay('  ' + TOKEN + ' ') === formatTokenForDisplay(TOKEN))

console.log('\n--- higiene ---')
checa('nenhum PIN ou senha no arquivo', !/pin|senha|password/i.test(frontSvg.replace(/base64,[^"]+/g, '')))
checa('XML declarado', frontSvg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
checa('verso XML declarado', backSvg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))

console.log(`\n${falhas === 0 ? 'credencial ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
