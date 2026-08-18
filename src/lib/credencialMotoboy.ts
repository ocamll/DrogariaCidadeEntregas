// Credencial CR80 do motoboy — frente e verso.
//
// O desenho é FIXO e veio pronto. Este módulo não desenha nada: ele
// substitui quatro valores (token, código de barras, nome, agência) num
// modelo cujas coordenadas, cores, tamanhos e opacidades não se mexem.
// Se algo aqui parecer arbitrário — o `y="16.791477"`, o `.085` da cruz,
// o `letter-spacing=".22"` — é porque veio do desenho e assim fica.
//
// DUAS COISAS QUE MUDARAM EM RELAÇÃO À ESPECIFICAÇÃO ORIGINAL, E POR QUÊ
//
// 1. O código original era Node (`node:fs`) e gravava os arquivos numa
//    pasta. Aqui não há backend: a emissão acontece no navegador do
//    admin. Mais importante que a adaptação técnica é a de segurança —
//    guardar credenciais em disco contraria a regra central deste
//    projeto ("o arquivo É o cartão", e a tela manda apagar depois de
//    imprimir). Um diretório com todas as credenciais é exatamente o que
//    o desenho evita. Por isso: gera e devolve, quem chama baixa. Nada
//    persiste.
//
// 2. Os assets são buscados de `/credencial/` em vez de lidos do disco.
//    A extração do PNG embutido é a mesma do spec.
//
// O TOKEN É SEMPRE O v3, DE 22 DÍGITOS
//
// Decidido em 2026-08-18: v1 e v2 são versões de teste descontinuadas. O
// desenho depende disso e não é coincidência — 37 módulos de altura com
// 22 dígitos dão EXATAMENTE os 15,767mm da caixa do desenho. Com outro
// comprimento a escala do símbolo deixa de ser uniforme, então o
// gerador exige o formato em vez de deixar passar torto.

import { generateCode128Svg } from './code128'

export type MotoboyCredentialData = {
  /** O token formatado para leitura humana (grupos de 6). */
  tokenDisplay: string
  /** O conteúdo EXATO a codificar. Nunca o formatado. */
  barcodeValue: string
  fullName: string
  agency: string
}

export type GeneratedCredential = {
  frontSvg: string
  backSvg: string
}

// Posição e tamanho do símbolo dentro do verso. Do desenho.
const BARCODE = { x: 5.3, y: 16.791477, larguraMm: 75, alturaMm: 15.767 } as const

function escapeXml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Os SVGs entregues trazem a imagem generativa embutida como PNG. Extrai
 * o data URI pra incorporá-lo direto na credencial, que é o que garante
 * que o arquivo final não dependa de nada externo pra abrir na gráfica.
 */
async function extractEmbeddedImage(url: string): Promise<string> {
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`Não consegui carregar ${url} (${resposta.status}).`)
  const source = await resposta.text()

  const match = source.match(/href="(data:image\/png;base64,[^"]+)"/)
  if (!match) throw new Error(`Imagem incorporada não encontrada em ${url}`)

  return match[1]
}

function validateData(data: MotoboyCredentialData): void {
  if (!data.tokenDisplay.trim()) throw new Error('Token visível não informado.')
  if (!data.barcodeValue) throw new Error('Conteúdo do código de barras não informado.')
  if (!data.fullName.trim()) throw new Error('Nome do motoboy não informado.')
  if (!data.agency.trim()) throw new Error('Agência não informada.')

  // O desenho é dimensionado para o token v3. Ver a nota no topo.
  if (!/^\d{22}$/.test(data.barcodeValue)) {
    throw new Error(
      'A credencial CR80 é dimensionada para o token de 22 dígitos (v3). ' +
        `Recebi ${data.barcodeValue.length} caractere(s).`
    )
  }
}

// Ajuste de corpo para caber na largura útil. É carga estrutural, não
// margem: um nome longo SÓ cabe porque esta conta o encolhe. A média de
// 0,56 em é de Arial; fonte mais larga na máquina de quem abrir o SVG
// pode estourar — é a razão de existir também a saída em PDF, onde a
// métrica é do formato e não da máquina.
function fitSansFontSize(
  text: string,
  baseSize: number,
  minimumSize: number,
  availableWidth: number,
  averageGlyphWidth = 0.56
): number {
  const characterCount = Math.max(1, Array.from(text).length)
  const calculatedSize = availableWidth / (characterCount * averageGlyphWidth)
  return Math.max(minimumSize, Math.min(baseSize, calculatedSize))
}

// Largura útil da faixa de texto na frente, do desenho.
const LARGURA_UTIL_MM = 75.2
const MEDIA_GLIFO_SANS = 0.56
const CORPO_MINIMO_NOME = 2.9

/**
 * Encurta o nome até ele CABER, porque só reduzir o corpo não basta.
 *
 * `fitSansFontSize` para de encolher no piso de 2,9 (abaixo disso não se
 * lê um cartão na mão), e a partir de ~46 caracteres o nome passa a
 * transbordar a borda do cartão. Nome brasileiro comprido não é exceção:
 * "Maria Aparecida da Conceição do Nascimento Silva" tem 47 e estoura em
 * 77,95mm numa área de 75,2mm — foi o teste de aceitação "nome longo não
 * ultrapassa o cartão" que pegou isso.
 *
 * A saída aqui **não mexe em nada do desenho**: coordenada, cor, corpo e
 * opacidade seguem intactos. O que muda é a string, como faria qualquer
 * documento de identificação — primeiro e último nome por extenso, os do
 * meio abreviados. Só se ainda assim não couber é que corta, com reticência.
 *
 * A alternativa seria recusar a emissão, que é o que o spec faz com o
 * token longo demais. Para o token isso é certo (é o dado que autentica,
 * e ele tem tamanho fixo); para o nome seria impedir de emitir cartão pra
 * quem tem nome comprido.
 */
export function ajustarNomeParaCaber(nome: string): string {
  const cabe = (texto: string) =>
    Array.from(texto).length * MEDIA_GLIFO_SANS * CORPO_MINIMO_NOME <= LARGURA_UTIL_MM

  const limpo = nome.trim().replace(/\s+/g, ' ')
  if (cabe(limpo)) return limpo

  const partes = limpo.split(' ')
  if (partes.length > 2) {
    // Abrevia do meio pra fora, uma de cada vez, parando assim que couber.
    // As partículas ("da", "do", "de") ficam por extenso: abreviá-las não
    // ganha largura e deixa o nome ilegível.
    const particula = /^(d[aeio]s?|e)$/i
    const ajustadas = [...partes]
    for (let i = 1; i < ajustadas.length - 1; i++) {
      if (particula.test(ajustadas[i])) continue
      ajustadas[i] = Array.from(ajustadas[i])[0] + '.'
      if (cabe(ajustadas.join(' '))) return ajustadas.join(' ')
    }
    // Ainda não coube: remove as partículas, que agora só ocupam espaço.
    const semParticulas = ajustadas.filter((p, i) => i === 0 || i === ajustadas.length - 1 || !particula.test(p))
    if (cabe(semParticulas.join(' '))) return semParticulas.join(' ')
  }

  // Último recurso.
  const maximo = Math.floor(LARGURA_UTIL_MM / (MEDIA_GLIFO_SANS * CORPO_MINIMO_NOME))
  return Array.from(limpo).slice(0, Math.max(1, maximo - 1)).join('').trimEnd() + '…'
}

function fitTokenFontSize(tokenDisplay: string): number {
  const characterCount = Math.max(1, Array.from(tokenDisplay).length)
  const availableWidth = 75.2
  const letterSpacing = 0.22
  const approximateGlyphWidth = 0.61

  const spacingWidth = Math.max(0, characterCount - 1) * letterSpacing
  const calculatedSize = (availableWidth - spacingWidth) / (characterCount * approximateGlyphWidth)
  const size = Math.min(4.45, calculatedSize)

  if (size < 3.2) {
    throw new Error('O token é longo demais para a área disponível na frente.')
  }

  return size
}

/** Só visual. Nunca aplicar ao `barcodeValue`. */
export function formatTokenForDisplay(value: string): string {
  const clean = value.replace(/\s+/g, '')
  return clean.match(/.{1,6}/g)?.join(' ') ?? clean
}

export type CorposDaCredencial = {
  token: number
  nome: number
  agencia: number
}

/** Exposto para o gerador de PDF usar EXATAMENTE os mesmos corpos. */
export function corposDaCredencial(data: MotoboyCredentialData): CorposDaCredencial {
  return {
    token: fitTokenFontSize(data.tokenDisplay),
    // Sobre o nome JÁ ajustado — medir o original daria um corpo pequeno
    // demais pro texto que de fato vai ser desenhado.
    nome: fitSansFontSize(ajustarNomeParaCaber(data.fullName), 3.75, CORPO_MINIMO_NOME, LARGURA_UTIL_MM),
    agencia: fitSansFontSize(data.agency, 2.65, 2.2, LARGURA_UTIL_MM),
  }
}

export async function generateMotoboyCredential(
  data: MotoboyCredentialData,
  assetsBaseUrl = '/credencial'
): Promise<GeneratedCredential> {
  validateData(data)

  const [logoImage, crossImage] = await Promise.all([
    extractEmbeddedImage(`${assetsBaseUrl}/logo-drogaria-cidade-generativa.svg`),
    extractEmbeddedImage(`${assetsBaseUrl}/cruz-drogaria-cidade-generativa.svg`),
  ])

  const tokenDisplay = escapeXml(data.tokenDisplay)
  const fullName = escapeXml(ajustarNomeParaCaber(data.fullName))
  const agency = escapeXml(data.agency)

  const corpos = corposDaCredencial(data)
  const barcodeSvg = generateCode128Svg(data.barcodeValue, BARCODE)

  const frontSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="85.6mm"
     height="54mm"
     viewBox="0 0 85.6 54"
     role="img"
     aria-labelledby="title description">

  <title id="title">
    Frente da credencial de motoboy — ${fullName}
  </title>

  <desc id="description">
    Credencial CR80 da Drogaria Cidade.
  </desc>

  <!-- Fundo em sangria total -->
  <rect
    width="85.6"
    height="54"
    fill="#C9141A"/>

  <!-- Cruz de fundo -->
  <image
    x="49"
    y="5"
    width="48"
    height="48"
    opacity=".085"
    preserveAspectRatio="xMidYMid meet"
    href="${crossImage}"/>

  <!-- Logo completa -->
  <image
    x="5.2"
    y="4.35"
    width="47.5"
    height="7.5697"
    preserveAspectRatio="xMinYMin meet"
    href="${logoImage}"/>

  <!-- Token -->
  <text
    x="5.2"
    y="30.4"
    fill="#FFFFFF"
    font-family="Consolas, 'Courier New', monospace"
    font-size="${corpos.token.toFixed(3)}"
    font-weight="700"
    letter-spacing=".22">${tokenDisplay}</text>

  <!-- Nome -->
  <text
    x="5.2"
    y="40"
    fill="#FFFFFF"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${corpos.nome.toFixed(3)}"
    font-weight="700">${fullName}</text>

  <!-- Agência -->
  <text
    x="5.2"
    y="45.15"
    fill="#FFFFFF"
    opacity=".84"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${corpos.agencia.toFixed(3)}"
    font-weight="500">${agency}</text>
</svg>`

  const backSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="85.6mm"
     height="54mm"
     viewBox="0 0 85.6 54"
     role="img"
     aria-labelledby="title description">

  <title id="title">
    Verso da credencial de motoboy — Code 128
  </title>

  <desc id="description">
    Verso CR80 com código de barras e orientações.
  </desc>

  <defs>
    <pattern
      id="backTexture"
      width="7"
      height="7"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(28)">

      <path
        d="M0 0V7"
        stroke="#FFFFFF"
        stroke-width=".32"
        opacity=".16"/>
    </pattern>
  </defs>

  <!-- Fundo -->
  <rect
    width="85.6"
    height="54"
    fill="#C9141A"/>

  <!-- Textura -->
  <rect
    width="85.6"
    height="54"
    fill="url(#backTexture)"
    opacity=".38"/>

  <!-- Painel branco -->
  <rect
    x="3.6"
    y="13.25"
    width="78.4"
    height="22.85"
    rx="1.8"
    fill="#FFFFFF"/>

  <!-- Code 128 gerado dinamicamente -->
  ${barcodeSvg}

  <!-- Cruz ao lado das orientações -->
  <image
    x="5"
    y="40.85"
    width="6"
    height="6"
    opacity=".96"
    preserveAspectRatio="xMidYMid meet"
    href="${crossImage}"/>

  <text
    x="13"
    y="42.65"
    fill="#FFFFFF"
    font-family="Arial, Helvetica, sans-serif"
    font-size="2.48"
    font-weight="700">Uso individual e intransferível.</text>

  <text
    x="13"
    y="46.8"
    fill="#FFFFFF"
    opacity=".84"
    font-family="Arial, Helvetica, sans-serif"
    font-size="2.30"
    font-weight="400">Em caso de perda, comunique a Drogaria Cidade.</text>
</svg>`

  return { frontSvg, backSvg }
}
