// Gera uma credencial CR80 de TESTE, com token fictício.
//
// Roda com:  npx tsx scripts/credencial-de-teste.mts [destino]
//
// Mesmo motivo do cartao-de-teste.mts: testar impressora, papel e leitor
// não deveria custar uma credencial de verdade — emitir pelo app revoga o
// cartão anterior do motoboy e o token só aparece uma vez. O token daqui
// é v3 bem formado (o leitor lê, o formato se prova) mas NÃO existe no
// banco, então bipá-lo devolve "credencial não reconhecida".
import { readFile, writeFile } from 'node:fs/promises'
import { generateMotoboyCredential, formatTokenForDisplay } from '../src/lib/credencialMotoboy.ts'
import { montarCredencialPdf, carregarAssetsCredencial } from '../src/lib/credencialPdf.ts'

globalThis.fetch = (async (u: string) => ({
  ok: true, status: 200, text: async () => readFile('public' + String(u), 'utf8'),
})) as never

const TOKEN = '3000000000000000000000'
const dados = {
  tokenDisplay: formatTokenForDisplay(TOKEN),
  barcodeValue: TOKEN,
  fullName: 'Motoboy de Teste',
  agency: 'Agência de Teste',
}

const destino = process.argv[2] ?? 'credencial-de-teste'
const { frontSvg, backSvg } = await generateMotoboyCredential(dados)
await writeFile(`${destino}-frente.svg`, frontSvg, 'utf8')
await writeFile(`${destino}-verso.svg`, backSvg, 'utf8')
await writeFile(`${destino}.pdf`, Buffer.from(await montarCredencialPdf(dados, await carregarAssetsCredencial())))

console.log(`
  token de teste ... ${dados.tokenDisplay}
  cartão ........... 85,6 × 54mm (CR80), duas páginas no PDF
  código de barras . 75 × 15,767mm, 0,4261mm por módulo (2,24x o piso do leitor)

  ${destino}-frente.svg
  ${destino}-verso.svg
  ${destino}.pdf   <- este vai pra gráfica; imprima em tamanho real / 100%
`)
