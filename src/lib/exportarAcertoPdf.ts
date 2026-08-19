import type { Relatorio, RelatorioAgencia, FiltroPeriodo } from '@/data/relatorios'
import { formatBRL } from '@/lib/money'
import { carregarImagemDaMarca, LOGO_DOCUMENTO_URL, LOGO_PROPORCAO, COR_MARCA } from '@/lib/marca'

// PDF do acerto com a agência — o documento que acompanha o pagamento da
// quinzena. Diferente da planilha, ele é feito pra ser impresso, assinado
// e arquivado, então carrega o que um papel solto precisa pra se explicar
// sozinho meses depois: logo, período, quando foi emitido, por quem, e
// quais filtros estavam valendo.
//
// Mesma regra da planilha e da tela: com uma agência só no resultado o
// nível "por agência" não separa nada e o documento vai direto ao resumo
// por motoboy; com mais de uma, a coluna de agência volta.
//
// Import dinâmico do jsPDF: são centenas de kB que só descem quando
// alguém clica em exportar. O caixa não paga por esta tela.

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}

// o vermelho da marca vem de `lib/marca.ts`, junto com as logos
const COR_CABECALHO: [number, number, number] = [243, 244, 246]
const COR_TOTAL: [number, number, number] = [254, 243, 199]
const COR_ALERTA: [number, number, number] = [185, 28, 28]
const COR_SUAVE: [number, number, number] = [107, 114, 128]
const COR_TEXTO: [number, number, number] = [17, 24, 39]

// Contexto que o papel precisa pra se explicar sozinho. Sem isso, uma
// folha impressa não diz de qual filial é nem quem a emitiu — e é
// justamente isso que alguém pergunta quando o valor não bate.
export type ContextoAcerto = {
  emitidoPor: string
  filialNome?: string | null
  agenciaNome?: string | null
}

function formatarPeriodo(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function nomeDoArquivo(filtro: FiltroPeriodo): string {
  return `acerto-agencia-${filtro.dataInicio}-a-${filtro.dataFim}.pdf`
}

// A logo vem do módulo da marca, que já entrega o PNG como data URL — é a
// forma que o jsPDF aceita. Some junto o `<img>` que existia só pra medir
// dimensão: a proporção é constante e conhecida.
//
// É a versão de DOCUMENTO (502 × 80). Nos 82mm desta faixa a de tela
// daria ~625 dpi, quatro vezes o que qualquer impressora aproveita, e
// engordava o arquivo à toa.
//
// Documento sem logo ainda é um documento, então uma falha aqui não
// derruba a exportação inteira.
async function carregarLogo(): Promise<string | null> {
  try {
    return await carregarImagemDaMarca(LOGO_DOCUMENTO_URL)
  } catch {
    return null
  }
}

type LinhaVale = { celulas: string[]; statusCru: string }

function achatarVales(agencias: RelatorioAgencia[], comAgencia: boolean): LinhaVale[] {
  const linhas: LinhaVale[] = []
  for (const agencia of agencias) {
    for (const motoboy of agencia.porMototaxista) {
      for (const vale of motoboy.vales) {
        const base = [
          vale.numeroVale,
          vale.clienteNome,
          vale.tipo === 'transferencia' ? 'Transferência' : 'Cliente',
          STATUS_LABEL[vale.statusEntrega] ?? vale.statusEntrega,
          formatarData(vale.ocorridoEmLocal),
          motoboy.nome,
          formatBRL(vale.valorEntregaCents),
          formatBRL(vale.valorEntregaCents - vale.entregaPagaClienteCents),
        ]
        linhas.push({
          celulas: comAgencia ? [agencia.nome, ...base] : base,
          statusCru: vale.statusEntrega,
        })
      }
    }
  }
  return linhas
}

export async function montarPdf(
  relatorio: Relatorio,
  filtro: FiltroPeriodo,
  contexto: ContextoAcerto
) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const largura = doc.internal.pageSize.getWidth()
  const altura = doc.internal.pageSize.getHeight()
  const margem = 14
  const variasAgencias = relatorio.porAgencia.length > 1
  const logo = await carregarLogo()

  // ---------------------------------------------------------- cabeçalho
  const alturaFaixa = 26
  doc.setFillColor(COR_MARCA[0], COR_MARCA[1], COR_MARCA[2])
  doc.rect(0, 0, largura, alturaFaixa, 'F')

  let x = margem
  if (logo) {
    const alturaLogo = 13
    // A proporção é constante e conhecida (2008 × 320), então não precisa
    // ser medida com um `<img>` a cada exportação.
    const larguraLogo = LOGO_PROPORCAO * alturaLogo
    // o 'FAST' no fim liga a compressão da imagem: sem ele o jsPDF grava
    // o bitmap cru e a logo vira centenas de kB dentro do PDF, que depois
    // sobem pro Drive a cada envio.
    doc.addImage(logo, 'PNG', x, (alturaFaixa - alturaLogo) / 2, larguraLogo, alturaLogo, undefined, 'FAST')
    x += larguraLogo + 6
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('ACERTO DE TELE-ENTREGA', x, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const subtitulo = variasAgencias
    ? `${relatorio.porAgencia.length} agências no período`
    : (relatorio.porAgencia[0]?.nome ?? 'Sem corridas no período')
  doc.text(subtitulo, x, 18.5)

  // ------------------------------------------------- dados de emissão
  const emitidoEm = new Date()
  const linhasContexto: string[] = [
    `Período: ${formatarPeriodo(filtro.dataInicio)} a ${formatarPeriodo(filtro.dataFim)}`,
    `Emitido em ${emitidoEm.toLocaleDateString('pt-BR')} às ${emitidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por ${contexto.emitidoPor}`,
    // Os filtros são explícitos de propósito: uma folha que diz só
    // "acerto de agosto" não deixa saber se é de uma filial ou de todas,
    // e é isso que alguém pergunta quando o valor não bate.
    `Filial: ${contexto.filialNome ?? 'todas'}   ·   Agência: ${contexto.agenciaNome ?? 'todas'}`,
  ]
  doc.setTextColor(COR_SUAVE[0], COR_SUAVE[1], COR_SUAVE[2])
  doc.setFontSize(8.5)
  linhasContexto.forEach((linha, i) => {
    doc.text(linha, margem, alturaFaixa + 7 + i * 4.4)
  })

  // ----------------------------------------------- destaque do total
  const totalVales = relatorio.porAgencia.reduce((s, a) => s + a.totalVales, 0)
  const totalEntregues = relatorio.porAgencia.reduce((s, a) => s + a.entregues, 0)
  const totalInsucessos = relatorio.porAgencia.reduce((s, a) => s + a.insucessos, 0)
  const totalEntrega = relatorio.porAgencia.reduce((s, a) => s + a.valorEntregaCents, 0)
  const totalPagar = relatorio.porAgencia.reduce((s, a) => s + a.valorFarmaciaDeveCents, 0)

  const yCaixa = alturaFaixa + 7 + linhasContexto.length * 4.4 + 2
  const alturaCaixa = 16
  doc.setDrawColor(229, 231, 235)
  doc.setFillColor(249, 250, 251)
  doc.roundedRect(margem, yCaixa, largura - margem * 2, alturaCaixa, 1.5, 1.5, 'FD')

  const indicadores: Array<[string, string]> = [
    ['Vales', String(totalVales)],
    ['Entregues', String(totalEntregues)],
    ['Insucessos', String(totalInsucessos)],
    ['Valor de entrega', formatBRL(totalEntrega)],
    ['A PAGAR', formatBRL(totalPagar)],
  ]
  const passo = (largura - margem * 2) / indicadores.length
  indicadores.forEach(([rotulo, valor], i) => {
    const cx = margem + passo * i + 4
    doc.setFontSize(7)
    doc.setTextColor(COR_SUAVE[0], COR_SUAVE[1], COR_SUAVE[2])
    doc.setFont('helvetica', 'normal')
    doc.text(rotulo.toUpperCase(), cx, yCaixa + 6)
    doc.setFontSize(11)
    const ultimo = i === indicadores.length - 1
    if (ultimo) doc.setTextColor(COR_MARCA[0], COR_MARCA[1], COR_MARCA[2])
    else doc.setTextColor(COR_TEXTO[0], COR_TEXTO[1], COR_TEXTO[2])
    doc.setFont('helvetica', 'bold')
    doc.text(valor, cx, yCaixa + 12.5)
  })

  // --------------------------------------------------------- resumo
  const corpoResumo: string[][] = []
  const linhasDeAgencia: number[] = []

  if (variasAgencias) {
    for (const agencia of relatorio.porAgencia) {
      linhasDeAgencia.push(corpoResumo.length)
      corpoResumo.push([
        agencia.nome,
        'total da agência',
        String(agencia.totalVales),
        String(agencia.entregues),
        String(agencia.insucessos),
        formatBRL(agencia.valorEntregaCents),
        formatBRL(agencia.valorFarmaciaDeveCents),
      ])
      for (const motoboy of agencia.porMototaxista) {
        corpoResumo.push([
          agencia.nome,
          motoboy.nome,
          String(motoboy.totalVales),
          String(motoboy.entregues),
          String(motoboy.insucessos),
          formatBRL(motoboy.valorEntregaCents),
          formatBRL(motoboy.valorFarmaciaDeveCents),
        ])
      }
    }
  } else {
    for (const motoboy of relatorio.porAgencia[0]?.porMototaxista ?? []) {
      corpoResumo.push([
        motoboy.nome,
        String(motoboy.totalVales),
        String(motoboy.entregues),
        String(motoboy.insucessos),
        formatBRL(motoboy.valorEntregaCents),
        formatBRL(motoboy.valorFarmaciaDeveCents),
      ])
    }
  }

  const cabecalhoResumo = variasAgencias
    ? [['Agência', 'Motoboy', 'Vales', 'Entregues', 'Insucessos', 'Valor de entrega', 'A pagar']]
    : [['Motoboy', 'Vales', 'Entregues', 'Insucessos', 'Valor de entrega', 'A pagar']]

  const rodapeResumo = variasAgencias
    ? [['TOTAL', '', String(totalVales), '', '', formatBRL(totalEntrega), formatBRL(totalPagar)]]
    : [['TOTAL A PAGAR', String(totalVales), '', '', formatBRL(totalEntrega), formatBRL(totalPagar)]]

  const yTituloResumo = yCaixa + alturaCaixa + 9
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(COR_TEXTO[0], COR_TEXTO[1], COR_TEXTO[2])
  doc.text(variasAgencias ? 'Resumo por agência' : 'Resumo por motoboy', margem, yTituloResumo)

  autoTable(doc, {
    startY: yTituloResumo + 3,
    head: cabecalhoResumo,
    body: corpoResumo,
    foot: rodapeResumo,
    theme: 'grid',
    margin: { left: margem, right: margem },
    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: [229, 231, 235] },
    headStyles: { fillColor: COR_CABECALHO, textColor: COR_TEXTO, fontStyle: 'bold' },
    footStyles: { fillColor: COR_TOTAL, textColor: COR_TEXTO, fontStyle: 'bold' },
    didParseCell: (dados) => {
      if (dados.section === 'body' && linhasDeAgencia.includes(dados.row.index)) {
        dados.cell.styles.fontStyle = 'bold'
      }
    },
  })

  // ---------------------------------------------------------- vales
  const linhasVales = achatarVales(relatorio.porAgencia, variasAgencias)
  const cabecalhoVales = variasAgencias
    ? [['Agência', 'Vale', 'Cliente', 'Tipo', 'Status', 'Data', 'Motoboy', 'Entrega', 'A pagar']]
    : [['Vale', 'Cliente', 'Tipo', 'Status', 'Data', 'Motoboy', 'Entrega', 'A pagar']]

  const finalDoResumo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Vales do período', margem, finalDoResumo + 9)

  const colunaStatus = variasAgencias ? 4 : 3
  autoTable(doc, {
    startY: finalDoResumo + 12,
    head: cabecalhoVales,
    body: linhasVales.map((linha) => linha.celulas),
    theme: 'striped',
    margin: { left: margem, right: margem, bottom: 18 },
    styles: { fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak' },
    headStyles: { fillColor: COR_CABECALHO, textColor: COR_TEXTO, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    // insucesso e cancelada em vermelho: são as linhas que alguém procura
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== colunaStatus) return
      const status = linhasVales[dados.row.index]?.statusCru
      if (status === 'insucesso' || status === 'cancelada') {
        dados.cell.styles.textColor = COR_ALERTA
        dados.cell.styles.fontStyle = 'bold'
      }
    },
  })

  // ---------------------------------------------------------- rodapé
  // "Página X de Y" só depois de tudo montado: o total de páginas não
  // existe enquanto as tabelas ainda estão sendo desenhadas. Documento de
  // pagamento circula impresso, e folha solta sem numeração não deixa
  // conferir se o maço está completo.
  const totalPaginas = doc.getNumberOfPages()
  for (let pagina = 1; pagina <= totalPaginas; pagina += 1) {
    doc.setPage(pagina)
    doc.setDrawColor(229, 231, 235)
    doc.line(margem, altura - 12, largura - margem, altura - 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(COR_SUAVE[0], COR_SUAVE[1], COR_SUAVE[2])
    doc.text('Drogaria Cidade · Sistema de tele-entrega', margem, altura - 7.5)
    doc.text(`Página ${pagina} de ${totalPaginas}`, largura - margem, altura - 7.5, {
      align: 'right',
    })
  }

  return doc
}

// Mesma ideia do .xlsx: o arquivo em memória, pra quem baixa e quem manda
// pro Drive partirem do mesmo byte.
export async function gerarPdf(
  relatorio: Relatorio,
  filtro: FiltroPeriodo,
  contexto: ContextoAcerto
) {
  const doc = await montarPdf(relatorio, filtro, contexto)
  return { nome: nomeDoArquivo(filtro), blob: doc.output('blob') as Blob }
}

export async function exportarAcertoPdf(
  relatorio: Relatorio,
  filtro: FiltroPeriodo,
  contexto: ContextoAcerto
) {
  const doc = await montarPdf(relatorio, filtro, contexto)
  doc.save(nomeDoArquivo(filtro))
}
