// A credencial CR80 em PDF, para a gráfica.
//
// O `.svg` continua sendo o desenho de origem. Este PDF existe pelo mesmo
// motivo do PDF do cartão antigo, e o motivo ficou MAIOR com o desenho
// novo: onde antes havia um campo de texto vivo, agora há três (token,
// nome, agência).
//
//   FONTE — no SVG o token é `Consolas, 'Courier New', monospace` e os
//   demais são `Arial, Helvetica, sans-serif`. Medido no navegador: o
//   mesmo token mede 66,45mm em Consolas e 72,04mm em Courier New. São
//   5,6mm de diferença conforme a máquina que abrir o arquivo, num campo
//   com 75,2mm de largura útil. Aqui as fontes são Courier e Helvetica
//   **base-14**: as métricas fazem parte do formato PDF, não da máquina
//   de quem abre.
//
//   PRETO DAS BARRAS — CMYK 0/0/0/100. Preto composto das quatro cores
//   borra a borda da barra a qualquer erro de registro, e erro de
//   registro é da ordem de décimos de milímetro, a mesma escala do
//   módulo.
//
// O VERMELHO CONTINUA EM RGB, DE PROPÓSITO
//
// O desenho especifica `#C9141A`. Converter uma cor de marca pra CMYK é
// decisão de identidade visual, não de código: um chute aqui sairia
// impresso num tom que ninguém aprovou. O elemento que a conversão
// poderia estragar — o código de barras — já está travado em 100% K, e
// ele é preto sobre o painel branco, sem depender do fundo.
//
// **Diga à gráfica qual vermelho vocês querem** (Pantone ou CMYK); é uma
// linha no e-mail e evita que o RIP decida sozinho.

import { generateCode128Svg, barrasCode128, MODULOS_ALTURA_BARRA } from './code128'
import {
  corposDaCredencial,
  ajustarNomeParaCaber,
  type MotoboyCredentialData,
} from './credencialMotoboy'

const LARGURA_MM = 85.6
const ALTURA_MM = 54
const VERMELHO: [number, number, number] = [0xc9, 0x14, 0x1a]

// Do desenho. Nenhum destes números é escolha deste arquivo.
const BARCODE = { x: 5.3, y: 16.791477, larguraMm: 75, alturaMm: 15.767 } as const
const PAINEL = { x: 3.6, y: 13.25, w: 78.4, h: 22.85, r: 1.8 } as const

export type AssetsCredencial = { logo: string; cruz: string }

/**
 * Busca os assets uma vez. Separado do desenho pra permitir gerar SVG e
 * PDF a partir das MESMAS imagens, sem duas idas à rede.
 */
export async function carregarAssetsCredencial(
  assetsBaseUrl = '/credencial'
): Promise<AssetsCredencial> {
  const pegar = async (arquivo: string) => {
    const r = await fetch(`${assetsBaseUrl}/${arquivo}`)
    if (!r.ok) throw new Error(`Não consegui carregar ${arquivo} (${r.status}).`)
    const m = (await r.text()).match(/href="(data:image\/png;base64,[^"]+)"/)
    if (!m) throw new Error(`Imagem incorporada não encontrada em ${arquivo}`)
    return m[1]
  }
  const [logo, cruz] = await Promise.all([
    pegar('logo-drogaria-cidade-generativa.svg'),
    pegar('cruz-drogaria-cidade-generativa.svg'),
  ])
  return { logo, cruz }
}

export async function montarCredencialPdf(
  data: MotoboyCredentialData,
  assets: AssetsCredencial
): Promise<ArrayBuffer> {
  // Import dinâmico + optimizeDeps, como manda a convenção do projeto.
  const { jsPDF, GState } = await import('jspdf')

  const corpos = corposDaCredencial(data)
  const nome = ajustarNomeParaCaber(data.fullName)

  // `landscape` não é decoração: com 'portrait' o jsPDF ordena o formato
  // pelo menor lado e a página sairia em pé. Mesma armadilha do cartão
  // antigo.
  const doc = new jsPDF({
    unit: 'mm',
    format: [LARGURA_MM, ALTURA_MM],
    orientation: 'landscape',
    compress: true,
  })

  const fundoVermelho = () => {
    doc.setFillColor(...VERMELHO)
    doc.rect(0, 0, LARGURA_MM, ALTURA_MM, 'F')
  }

  // Recorta na borda do cartão. A cruz da frente é desenhada em x=49 com
  // 48mm de largura, ou seja, ela ULTRAPASSA os 85,6mm — no SVG quem corta
  // é o viewport; aqui é preciso dizer.
  const recortarNoCartao = () => {
    doc.rect(0, 0, LARGURA_MM, ALTURA_MM)
    doc.clip()
    doc.discardPath()
  }

  // ---------------- FRENTE ----------------
  fundoVermelho()

  doc.saveGraphicsState()
  recortarNoCartao()
  doc.setGState(new GState({ opacity: 0.085 }))
  doc.addImage(assets.cruz, 'PNG', 49, 5, 48, 48, 'cruz-frente', 'FAST')
  doc.restoreGraphicsState()

  doc.addImage(assets.logo, 'PNG', 5.2, 4.35, 47.5, 7.5697, 'logo', 'FAST')

  // O texto branco é ausência de tinta sobre o vermelho — knockout.
  doc.setTextColor(255, 255, 255)

  doc.setFont('courier', 'bold')
  doc.setFontSize(mmParaPt(corpos.token))
  doc.setCharSpace(0.22)
  doc.text(data.tokenDisplay, 5.2, 30.4)
  doc.setCharSpace(0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(mmParaPt(corpos.nome))
  doc.text(nome, 5.2, 40)

  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity: 0.84 }))
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(mmParaPt(corpos.agencia))
  doc.text(data.agency, 5.2, 45.15)
  doc.restoreGraphicsState()

  // ---------------- VERSO ----------------
  doc.addPage([LARGURA_MM, ALTURA_MM], 'landscape')
  fundoVermelho()

  // Textura: linhas paralelas a 28°, espaçadas 7mm — o mesmo `<pattern>`
  // do SVG. A opacidade final é o produto das duas do desenho
  // (0,16 do traço × 0,38 do retângulo).
  doc.saveGraphicsState()
  recortarNoCartao()
  doc.setGState(new GState({ opacity: 0.16 * 0.38 }))
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(0.32)
  const rad = (28 * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = Math.cos(rad)
  const alcance = LARGURA_MM + ALTURA_MM
  for (let d = -alcance; d <= alcance; d += 7) {
    // Reta perpendicular ao espaçamento, atravessando o cartão inteiro.
    doc.line(d * dy - alcance * dx, -d * dx - alcance * dy, d * dy + alcance * dx, -d * dx + alcance * dy)
  }
  doc.restoreGraphicsState()

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(PAINEL.x, PAINEL.y, PAINEL.w, PAINEL.h, PAINEL.r, PAINEL.r, 'F')

  // As barras vêm do MESMO módulo que gera o SVG — uma codificação só.
  const { barras, totalModulos } = barrasCode128(data.barcodeValue)
  const moduloMm = BARCODE.larguraMm / totalModulos
  const escalaY = BARCODE.alturaMm / MODULOS_ALTURA_BARRA
  doc.setFillColor(0, 0, 0, 1) // CMYK 100% K
  for (const b of barras) {
    doc.rect(
      BARCODE.x + b.x * moduloMm,
      BARCODE.y,
      b.largura * moduloMm,
      MODULOS_ALTURA_BARRA * escalaY,
      'F'
    )
  }

  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity: 0.96 }))
  doc.addImage(assets.cruz, 'PNG', 5, 40.85, 6, 6, 'cruz-verso', 'FAST')
  doc.restoreGraphicsState()

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(mmParaPt(2.48))
  doc.text('Uso individual e intransferível.', 13, 42.65)

  doc.saveGraphicsState()
  doc.setGState(new GState({ opacity: 0.84 }))
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(mmParaPt(2.3))
  doc.text('Em caso de perda, comunique a Drogaria Cidade.', 13, 46.8)
  doc.restoreGraphicsState()

  return doc.output('arraybuffer')
}

// O documento está em mm e o corpo de texto em ponto. A conversão
// acontece aqui e em nenhum outro lugar.
function mmParaPt(mm: number): number {
  return mm * (72 / 25.4)
}

// Reexportado pra quem quiser o SVG do símbolo com a mesma geometria.
export { generateCode128Svg }
