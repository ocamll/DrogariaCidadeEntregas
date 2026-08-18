// Cartão do motoboy em PDF vetorial, no tamanho físico.
//
// Existe pelo mesmo motivo do .svg — o cartão é impresso numa gráfica, e
// imprimir pelo navegador não dá controle de escala pra um CR80 — mas
// fecha dois furos que o .svg deixa abertos no caminho até lá. Nenhum dos
// dois é defeito do desenho; os dois são do trajeto:
//
// 1. FONTE. No .svg o token é `<text font-family="Courier New">`, texto
//    vivo. Máquina sem essa fonte substitui por outra, a largura muda, e
//    um texto que hoje mede 60,4mm dentro de 75mm pode escapar pra fora
//    do cartão — a gráfica imprimiria assim sem ter como desconfiar. No
//    PDF a fonte é a Courier padrão (base-14): as métricas fazem parte do
//    formato, não da máquina de quem abre. Mesmo avanço de 600/1000 em da
//    Courier New, então o texto sai com a mesma largura de propósito, não
//    por coincidência.
// 2. PRETO. `rgb(0,0,0)` convertido pra CMYK por um RIP vira preto
//    COMPOSTO das quatro cores, e aí qualquer erro de registro — décimos
//    de milímetro, a mesma escala do módulo — borra a borda das barras.
//    Aqui o preto é gravado como CMYK 0/0/0/100 no próprio arquivo, que é
//    o que se pediria à gráfica por escrito.
//
// **As barras não são recodificadas.** São lidas do MESMO SVG que está na
// tela e que sai no .svg. Uma segunda chamada ao bwip-js seriam duas
// verdades capazes de divergir sem ninguém notar — é o problema das duas
// implementações do canônico, e aqui dá pra evitá-lo em vez de
// administrá-lo. Se o PDF e o .svg discordarem, é bug de leitura deste
// arquivo, nunca dois códigos diferentes.
//
// Nada de nome de motoboy ou filial entra aqui, nem no desenho nem nos
// metadados do PDF — mesma regra do .svg: cartão perdido não diz de quem
// é nem de onde veio.

// A geometria vive no componente que desenha o cartão (é lá que ela
// também vira texto na tela), e chega aqui inteira pra este módulo não
// ter uma segunda opinião sobre o tamanho de nada.
export type GeometriaCartao = {
  larguraMm: number
  /** Largura do código em módulos, zonas de silêncio incluídas. */
  unidadesLargura: number
  /** Altura só das barras, sem a faixa do texto. */
  unidadesAltura: number
  /** Faixa reservada abaixo das barras, em módulos. */
  espacoTextoUnidades: number
  /** Distância do topo da faixa até a linha de base do texto. */
  baseTextoUnidades: number
  fonteTokenUnidades: number
}

export type BarraDoCodigo = { xUnidades: number; larguraUnidades: number }

// O bwip-js não emite um retângulo por barra: emite um `<path>` por
// LARGURA de barra, e dentro dele uma linha vertical no CENTRO de cada
// barra daquela largura, com `stroke-width` = a largura em módulos.
// Então a barra ocupa de `cx - w/2` a `cx + w/2`.
//
// Conferido contra a saída real: com `paddingwidth: 10` a primeira barra
// sai em `cx = 11` com `stroke-width = 2`, ou seja começando exatamente
// no módulo 10 — o fim da zona de silêncio. Se essa conta estivesse
// errada por meio módulo, o código sairia deslocado e ninguém veria a
// olho.
export function barrasDoSvg(svg: string): BarraDoCodigo[] {
  const barras: BarraDoCodigo[] = []
  const paths = svg.matchAll(/<path\b[^>]*?stroke-width="([\d.]+)"[^>]*?\bd="([^"]*)"/g)

  for (const path of paths) {
    const larguraUnidades = Number(path[1])
    if (!Number.isFinite(larguraUnidades) || larguraUnidades <= 0) continue

    for (const seg of path[2].matchAll(/M([\d.]+)\s/g)) {
      const centro = Number(seg[1])
      if (!Number.isFinite(centro)) continue
      barras.push({ xUnidades: centro - larguraUnidades / 2, larguraUnidades })
    }
  }

  return barras
}

/**
 * Devolve os bytes do PDF. Separado de quem baixa de propósito: é o que
 * permite gerar o arquivo e ler de volta pra conferir, sem depender do
 * efeito colateral de download do navegador — mesma disciplina do
 * `montarWorkbook`/`montarPdf` do acerto.
 */
export async function montarCartaoPdf(
  svgDoCodigo: string,
  tokenTexto: string,
  g: GeometriaCartao
): Promise<ArrayBuffer> {
  const barras = barrasDoSvg(svgDoCodigo)
  if (barras.length === 0) {
    throw new Error('não encontrei nenhuma barra no código gerado')
  }

  // Import dinâmico + `optimizeDeps.include` no vite.config, sempre as
  // duas coisas — o jspdf já está nos dois desde a exportação do acerto.
  const { jsPDF } = await import('jspdf')

  const moduloMm = g.larguraMm / g.unidadesLargura
  const alturaMm = (g.unidadesAltura + g.espacoTextoUnidades) * moduloMm

  // `orientation: 'landscape'` não é decoração: com 'portrait' o jsPDF
  // ordena o `format` pelo menor lado e a página sairia em pé, 20 × 75.
  const doc = new jsPDF({
    unit: 'mm',
    format: [g.larguraMm, alturaMm],
    orientation: 'landscape',
    compress: true,
  })

  // Fundo branco em CMYK 0/0/0/0, espelhando o `<rect>` que o bwip-js já
  // põe no SVG. Não gasta tinta, e como knockout ele protege a zona de
  // silêncio caso a gráfica assente o cartão sobre arte colorida.
  doc.setFillColor(0, 0, 0, 0)
  doc.rect(0, 0, g.larguraMm, alturaMm, 'F')

  // 100% K. Ver a nota 2 no topo do arquivo.
  doc.setFillColor(0, 0, 0, 1)
  const alturaBarraMm = g.unidadesAltura * moduloMm
  for (const barra of barras) {
    doc.rect(barra.xUnidades * moduloMm, 0, barra.larguraUnidades * moduloMm, alturaBarraMm, 'F')
  }

  doc.setTextColor(0, 0, 0, 1)
  doc.setFont('courier', 'normal')
  // A unidade do documento é mm e a do corpo de texto é ponto — a fonte
  // é medida em módulos como no SVG, então a conversão acontece aqui e em
  // nenhum outro lugar.
  doc.setFontSize(g.fonteTokenUnidades * moduloMm * (72 / 25.4))
  doc.text(tokenTexto, g.larguraMm / 2, (g.unidadesAltura + g.baseTextoUnidades) * moduloMm, {
    align: 'center',
  })

  return doc.output('arraybuffer')
}
