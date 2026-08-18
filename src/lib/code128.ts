// Code 128 vetorial, para a credencial CR80.
//
// POR QUE EXISTE UMA SEGUNDA IMPLEMENTAÇÃO NESTE PROJETO
//
// O projeto já codifica Code 128 com o bwip-js, e tem uma regra explícita
// contra duas codificações do mesmo dado (ver "O arquivo do cartão" no
// CLAUDE.md: chamar o codificador duas vezes cria duas verdades capazes
// de divergir sem ninguém notar). Este arquivo é, por construção, essa
// segunda verdade.
//
// O que torna isso aceitável não é o cuidado ao escrevê-lo — é que ele é
// **conferido contra o bwip-js**, barra a barra, em
// `scripts/code128.spec.mts`. O bwip-js continua sendo o padrão-ouro; este
// módulo só é usado porque a credencial precisa das barras como
// `<rect>` dentro de um SVG maior, com coordenadas próprias, e não como
// um SVG independente.
//
// **Se um dia os dois divergirem, o certo é este arquivo, não o teste.**
// Rode o spec antes de tocar em qualquer coisa aqui.

// Os 107 padrões do Code 128. Cada dígito é a largura, em módulos, de uma
// barra ou espaço alternadamente, SEMPRE começando por barra.
const CODE128_PATTERNS = [
  /* 0–9 */
  '212222', '222122', '222221', '121223', '121322',
  '131222', '122213', '122312', '132212', '221213',
  /* 10–19 */
  '221312', '231212', '112232', '122132', '122231',
  '113222', '123122', '123221', '223211', '221132',
  /* 20–29 */
  '221231', '213212', '223112', '312131', '311222',
  '321122', '321221', '312212', '322112', '322211',
  /* 30–39 */
  '212123', '212321', '232121', '111323', '131123',
  '131321', '112313', '132113', '132311', '211313',
  /* 40–49 */
  '231113', '231311', '112133', '112331', '132131',
  '113123', '113321', '133121', '313121', '211331',
  /* 50–59 */
  '231131', '213113', '213311', '213131', '311123',
  '311321', '331121', '312113', '312311', '332111',
  /* 60–69 */
  '314111', '221411', '431111', '111224', '111422',
  '121124', '121421', '141122', '141221', '112214',
  /* 70–79 */
  '112412', '122114', '122411', '142112', '142211',
  '241211', '221114', '413111', '241112', '134111',
  /* 80–89 */
  '111242', '121142', '121241', '114212', '124112',
  '124211', '411212', '421112', '421211', '212141',
  /* 90–99 */
  '214121', '412121', '111143', '111341', '131141',
  '114113', '114311', '411113', '411311', '113141',
  /* 100–106 */
  '114131', '311141', '411131',
  '211412', // Start A
  '211214', // Start B
  '211232', // Start C
  '2331112', // Stop — 13 módulos, o único padrão com 7 elementos
] as const

// Zona de silêncio mínima da especificação: 10 módulos de cada lado. Ela
// mora DENTRO da largura física do símbolo, não além dela — esquecer isso
// já inflou uma conta em ~7% neste projeto (ver a tabela de formatos no
// CLAUDE.md).
export const MODULOS_ZONA_SILENCIO = 10

// Altura das barras em módulos. Com o token v3 (22 dígitos → 176 módulos
// com as zonas) isso dá exatamente 15,767mm dentro dos 75mm, que é a
// altura do desenho da credencial.
export const MODULOS_ALTURA_BARRA = 37

// Piso comum de leitor laser 1D.
export const MODULO_MINIMO_MM = 0.19

export type BarraCode128 = { x: number; largura: number }

export function encodeCode128Values(value: string): number[] {
  if (!value) throw new Error('O valor do código de barras está vazio.')

  let startCode: number
  let dataCodes: number[]

  // Set C empacota DOIS dígitos por símbolo de 11 módulos — é o que faz o
  // token numérico caber no cartão. Só vale para dígitos em quantidade
  // par; um dígito sobrando cairia fora do set e custaria 11 módulos
  // sozinho.
  if (/^\d+$/.test(value) && value.length % 2 === 0) {
    startCode = 105
    dataCodes = []
    for (let i = 0; i < value.length; i += 2) {
      dataCodes.push(Number(value.slice(i, i + 2)))
    }
  } else {
    startCode = 104
    dataCodes = Array.from(value).map((caractere) => {
      const ponto = caractere.charCodeAt(0)
      if (ponto < 32 || ponto > 126) {
        throw new Error(`Caractere não suportado pelo Code 128-B: ${caractere}`)
      }
      return ponto - 32
    })
  }

  const soma = dataCodes.reduce((total, code, i) => total + code * (i + 1), startCode)
  return [startCode, ...dataCodes, soma % 103, 106]
}

// As barras em coordenadas de MÓDULO, já deslocadas pela zona de silêncio
// esquerda. Separado de quem desenha pra poder ser conferido contra o
// bwip-js sem passar por SVG nenhum.
export function barrasCode128(value: string): { barras: BarraCode128[]; totalModulos: number } {
  const codes = encodeCode128Values(value)
  const barras: BarraCode128[] = []
  let cursor = MODULOS_ZONA_SILENCIO

  for (const code of codes) {
    const padrao = CODE128_PATTERNS[code]
    if (!padrao) throw new Error(`Padrão Code 128 inválido: ${code}`)

    Array.from(padrao).forEach((digito, i) => {
      const largura = Number(digito)
      // Índice par é barra; ímpar é espaço.
      if (i % 2 === 0) barras.push({ x: cursor, largura })
      cursor += largura
    })
  }

  return { barras, totalModulos: cursor + MODULOS_ZONA_SILENCIO }
}

export type OpcoesBarcodeSvg = {
  /** Largura física do símbolo, zonas de silêncio incluídas. */
  larguraMm: number
  /** Onde o símbolo se encaixa dentro do SVG do cartão. */
  x: number
  y: number
  alturaMm: number
}

/**
 * O símbolo como um `<svg>` aninhado, pronto pra ser colado dentro do
 * cartão. As barras são `<rect>` em unidades de módulo, e o `viewBox` faz
 * a conversão pra milímetro — nada é escalado por CSS, nada vira bitmap.
 */
export function generateCode128Svg(value: string, opcoes: OpcoesBarcodeSvg): string {
  const { barras, totalModulos } = barrasCode128(value)

  const moduloMm = opcoes.larguraMm / totalModulos
  if (moduloMm < MODULO_MINIMO_MM) {
    throw new Error(
      `O conteúdo do Code 128 é longo demais para ${opcoes.larguraMm}mm: ` +
        `${moduloMm.toFixed(3)}mm por módulo, abaixo do piso de ${MODULO_MINIMO_MM}mm ` +
        `que os leitores comuns leem.`
    )
  }

  const rects = barras
    .map((b) => `<rect x="${b.x}" y="0" width="${b.largura}" height="${MODULOS_ALTURA_BARRA}"/>`)
    .join('\n        ')

  // `preserveAspectRatio="none"` porque a caixa é fixa no desenho: com o
  // token de 22 dígitos a escala sai UNIFORME por coincidência aritmética
  // (37 módulos × 75/176mm = 15,767mm, que é exatamente a altura do
  // desenho). Com outro comprimento de token a altura é esticada — o que
  // não afeta leitura, porque altura de barra não carrega dado, mas
  // convém saber antes de estranhar.
  return `<svg x="${opcoes.x}" y="${opcoes.y}" width="${opcoes.larguraMm}" height="${opcoes.alturaMm}" viewBox="0 0 ${totalModulos} ${MODULOS_ALTURA_BARRA}" preserveAspectRatio="none" overflow="hidden" shape-rendering="crispEdges" aria-label="Código de barras Code 128">
      <g fill="#000000">
        ${rects}
      </g>
    </svg>`
}
