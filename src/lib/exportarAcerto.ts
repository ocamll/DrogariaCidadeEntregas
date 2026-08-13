import type { Relatorio, RelatorioAgencia, FiltroPeriodo } from '@/data/relatorios'
import type { Workbook, Worksheet, Row } from 'exceljs'

// Exportação do acerto com a agência em .xlsx de verdade (ExcelJS), não
// CSV renomeado: formato de moeda, filtro automático, painel congelado.
//
// O import do ExcelJS é DINÂMICO de propósito. A biblioteca passa de 900
// kB e nada disso interessa ao caixa, que é quem abre o app o dia inteiro
// — ela só desce quando alguém clica em exportar. O teste dos 25 segundos
// não paga por esta tela.

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}

// Regra 1: dinheiro é inteiro em centavos em todo o sistema. A divisão por
// 100 acontece aqui, na fronteira de exibição — a célula precisa de um
// NÚMERO em reais pra planilha conseguir somar, filtrar e formatar. Se
// fosse texto ("R$ 9,00"), o arquivo viraria uma imagem de tabela: bonito
// e inútil pra conferir com a agência.
function reais(cents: number): number {
  return cents / 100
}

const FORMATO_MOEDA = 'R$ #,##0.00'

const COR = {
  titulo: 'FF9F1239',
  cabecalho: 'FFF1F5F9',
  total: 'FFFEF3C7',
  zebra: 'FFFAFAFA',
  alerta: 'FFB91C1C',
  textoClaro: 'FFFFFFFF',
} as const

function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function nomeDoArquivo(filtro: FiltroPeriodo): string {
  return `acerto-agencia-${filtro.dataInicio}-a-${filtro.dataFim}.xlsx`
}

// --- estilos -----------------------------------------------------------

function faixaDeTitulo(planilha: Worksheet, texto: string, subtitulo: string, colunas: number) {
  const titulo = planilha.addRow([texto])
  planilha.mergeCells(titulo.number, 1, titulo.number, colunas)
  titulo.height = 24
  const celula = titulo.getCell(1)
  celula.font = { bold: true, size: 14, color: { argb: COR.textoClaro } }
  celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.titulo } }
  celula.alignment = { vertical: 'middle' }

  const sub = planilha.addRow([subtitulo])
  planilha.mergeCells(sub.number, 1, sub.number, colunas)
  sub.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } }
}

function estilizarCabecalho(linha: Row, colunas: number) {
  linha.font = { bold: true }
  for (let i = 1; i <= colunas; i += 1) {
    const celula = linha.getCell(i)
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.cabecalho } }
    celula.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
  }
}

function estilizarTotal(linha: Row, colunas: number) {
  linha.font = { bold: true }
  for (let i = 1; i <= colunas; i += 1) {
    const celula = linha.getCell(i)
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.total } }
    celula.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } }
  }
}

// zebra discreta: ajuda a seguir a linha até a coluna do dinheiro sem
// transformar a planilha num tabuleiro.
function zebrar(linha: Row, indice: number, colunas: number) {
  if (indice % 2 === 0) return
  for (let i = 1; i <= colunas; i += 1) {
    linha.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.zebra } }
  }
}

function pintarStatus(linha: Row, coluna: number, status: string) {
  if (status === 'insucesso' || status === 'cancelada') {
    linha.getCell(coluna).font = { color: { argb: COR.alerta }, bold: true }
  }
}

// --- blocos reaproveitados --------------------------------------------

const COLUNAS_VALES = [
  { header: 'Vale', key: 'vale', width: 14 },
  { header: 'Cliente', key: 'cliente', width: 30 },
  { header: 'Tipo', key: 'tipo', width: 15 },
  { header: 'Status', key: 'status', width: 13 },
  { header: 'Data', key: 'data', width: 12 },
  { header: 'Motoboy', key: 'motoboy', width: 24 },
  { header: 'Valor de entrega', key: 'entrega', width: 17 },
  { header: 'A pagar', key: 'aPagar', width: 14 },
]

type LinhaVale = {
  vale: string
  cliente: string
  tipo: string
  status: string
  statusCru: string
  data: string
  agencia: string
  motoboy: string
  entrega: number
  aPagar: number
}

function achatarVales(agencias: RelatorioAgencia[]): LinhaVale[] {
  const linhas: LinhaVale[] = []
  for (const agencia of agencias) {
    for (const motoboy of agencia.porMototaxista) {
      for (const vale of motoboy.vales) {
        linhas.push({
          vale: vale.numeroVale,
          cliente: vale.clienteNome,
          tipo: vale.tipo === 'transferencia' ? 'Transferência' : 'Cliente',
          status: STATUS_LABEL[vale.statusEntrega] ?? vale.statusEntrega,
          statusCru: vale.statusEntrega,
          data: formatarDataHora(vale.ocorridoEmLocal),
          agencia: agencia.nome,
          motoboy: motoboy.nome,
          entrega: reais(vale.valorEntregaCents),
          // mesma conta do relatório e da tela: o que a farmácia deve é o
          // valor da entrega menos o que o cliente pagou em mãos.
          aPagar: reais(vale.valorEntregaCents - vale.entregaPagaClienteCents),
        })
      }
    }
  }
  return linhas
}

// --- página única: uma agência só --------------------------------------
//
// É o caso das filiais de uma cidade só: lá uma única agência faz todas as
// corridas, então "por agência" não separa nada — o arquivo inteiro já é
// daquela agência. Separar em duas abas só obrigaria a ir e voltar.
function montarPaginaUnica(workbook: Workbook, relatorio: Relatorio, filtro: FiltroPeriodo) {
  const agencia = relatorio.porAgencia[0]
  const planilha = workbook.addWorksheet('Acerto')
  const COLUNAS = 8

  faixaDeTitulo(
    planilha,
    `Acerto de tele — ${agencia?.nome ?? 'sem corridas no período'}`,
    `Período de ${formatarDataBr(filtro.dataInicio)} a ${formatarDataBr(filtro.dataFim)}`,
    COLUNAS
  )
  planilha.addRow([])

  // resumo por motoboy — é o que se confere na hora de pagar
  const cabResumo = planilha.addRow([
    'Motoboy',
    'Vales',
    'Entregues',
    'Insucessos',
    'Valor de entrega',
    'A pagar',
  ])
  estilizarCabecalho(cabResumo, 6)

  for (const [i, motoboy] of (agencia?.porMototaxista ?? []).entries()) {
    const linha = planilha.addRow([
      motoboy.nome,
      motoboy.totalVales,
      motoboy.entregues,
      motoboy.insucessos,
      reais(motoboy.valorEntregaCents),
      reais(motoboy.valorFarmaciaDeveCents),
    ])
    zebrar(linha, i, 6)
    linha.getCell(5).numFmt = FORMATO_MOEDA
    linha.getCell(6).numFmt = FORMATO_MOEDA
  }

  const total = planilha.addRow([
    'TOTAL A PAGAR',
    agencia?.totalVales ?? 0,
    agencia?.entregues ?? 0,
    agencia?.insucessos ?? 0,
    reais(agencia?.valorEntregaCents ?? 0),
    reais(agencia?.valorFarmaciaDeveCents ?? 0),
  ])
  estilizarTotal(total, 6)
  total.getCell(5).numFmt = FORMATO_MOEDA
  total.getCell(6).numFmt = FORMATO_MOEDA

  planilha.addRow([])
  const tituloVales = planilha.addRow(['Vales do período'])
  tituloVales.getCell(1).font = { bold: true, size: 12 }
  planilha.addRow([])

  const cabVales = planilha.addRow(COLUNAS_VALES.map((c) => c.header))
  estilizarCabecalho(cabVales, COLUNAS)
  // o filtro cobre só a tabela de vales, não o bloco de resumo acima
  planilha.autoFilter = {
    from: { row: cabVales.number, column: 1 },
    to: { row: cabVales.number, column: COLUNAS },
  }
  planilha.views = [{ state: 'frozen', ySplit: cabVales.number }]

  for (const [i, vale] of achatarVales(relatorio.porAgencia).entries()) {
    const linha = planilha.addRow([
      vale.vale,
      vale.cliente,
      vale.tipo,
      vale.status,
      vale.data,
      vale.motoboy,
      vale.entrega,
      vale.aPagar,
    ])
    zebrar(linha, i, COLUNAS)
    pintarStatus(linha, 4, vale.statusCru)
    linha.getCell(7).numFmt = FORMATO_MOEDA
    linha.getCell(8).numFmt = FORMATO_MOEDA
  }

  COLUNAS_VALES.forEach((coluna, i) => {
    planilha.getColumn(i + 1).width = coluna.width
  })
}

// --- duas páginas: várias agências -------------------------------------
//
// É o caso do fechamento das 18 filiais juntas, que o admin faz de 15 em
// 15 dias pra pagar as teles: aí existe mais de uma agência no arquivo e
// separar o total (o que se confere com cada uma) da lista de vales (o que
// sustenta cada número) é justamente o que dá pra contestar uma linha.
function montarDuasPaginas(workbook: Workbook, relatorio: Relatorio, filtro: FiltroPeriodo) {
  const resumo = workbook.addWorksheet('Acerto por agência')
  const COLUNAS_RESUMO = 7

  faixaDeTitulo(
    resumo,
    'Acerto de tele por agência',
    `Período de ${formatarDataBr(filtro.dataInicio)} a ${formatarDataBr(filtro.dataFim)}`,
    COLUNAS_RESUMO
  )
  resumo.addRow([])

  const cabResumo = resumo.addRow([
    'Agência',
    'Motoboy',
    'Vales',
    'Entregues',
    'Insucessos',
    'Valor de entrega',
    'A pagar',
  ])
  estilizarCabecalho(cabResumo, COLUNAS_RESUMO)
  resumo.views = [{ state: 'frozen', ySplit: cabResumo.number }]

  for (const agencia of relatorio.porAgencia) {
    const linhaAgencia = resumo.addRow([
      agencia.nome,
      '— total da agência —',
      agencia.totalVales,
      agencia.entregues,
      agencia.insucessos,
      reais(agencia.valorEntregaCents),
      reais(agencia.valorFarmaciaDeveCents),
    ])
    linhaAgencia.font = { bold: true }
    linhaAgencia.getCell(6).numFmt = FORMATO_MOEDA
    linhaAgencia.getCell(7).numFmt = FORMATO_MOEDA

    for (const motoboy of agencia.porMototaxista) {
      // a agência se repete na linha do motoboy de propósito: assim a
      // planilha continua filtrável e "pivotável", em vez de depender da
      // leitura visual do agrupamento.
      const linha = resumo.addRow([
        agencia.nome,
        motoboy.nome,
        motoboy.totalVales,
        motoboy.entregues,
        motoboy.insucessos,
        reais(motoboy.valorEntregaCents),
        reais(motoboy.valorFarmaciaDeveCents),
      ])
      linha.outlineLevel = 1
      linha.getCell(6).numFmt = FORMATO_MOEDA
      linha.getCell(7).numFmt = FORMATO_MOEDA
    }
  }

  const total = resumo.addRow([
    'TOTAL',
    '',
    relatorio.porAgencia.reduce((s, a) => s + a.totalVales, 0),
    relatorio.porAgencia.reduce((s, a) => s + a.entregues, 0),
    relatorio.porAgencia.reduce((s, a) => s + a.insucessos, 0),
    reais(relatorio.porAgencia.reduce((s, a) => s + a.valorEntregaCents, 0)),
    reais(relatorio.porAgencia.reduce((s, a) => s + a.valorFarmaciaDeveCents, 0)),
  ])
  estilizarTotal(total, COLUNAS_RESUMO)
  total.getCell(6).numFmt = FORMATO_MOEDA
  total.getCell(7).numFmt = FORMATO_MOEDA

  const larguras = [26, 26, 10, 12, 12, 17, 14]
  larguras.forEach((w, i) => {
    resumo.getColumn(i + 1).width = w
  })

  // ---- aba de vales
  const detalhe = workbook.addWorksheet('Vales')
  const COLUNAS_DETALHE = 9

  faixaDeTitulo(
    detalhe,
    'Vales do período',
    `Período de ${formatarDataBr(filtro.dataInicio)} a ${formatarDataBr(filtro.dataFim)}`,
    COLUNAS_DETALHE
  )
  detalhe.addRow([])

  const cabDetalhe = detalhe.addRow(['Agência', ...COLUNAS_VALES.map((c) => c.header)])
  estilizarCabecalho(cabDetalhe, COLUNAS_DETALHE)
  detalhe.autoFilter = {
    from: { row: cabDetalhe.number, column: 1 },
    to: { row: cabDetalhe.number, column: COLUNAS_DETALHE },
  }
  detalhe.views = [{ state: 'frozen', ySplit: cabDetalhe.number }]

  for (const [i, vale] of achatarVales(relatorio.porAgencia).entries()) {
    const linha = detalhe.addRow([
      vale.agencia,
      vale.vale,
      vale.cliente,
      vale.tipo,
      vale.status,
      vale.data,
      vale.motoboy,
      vale.entrega,
      vale.aPagar,
    ])
    zebrar(linha, i, COLUNAS_DETALHE)
    pintarStatus(linha, 5, vale.statusCru)
    linha.getCell(8).numFmt = FORMATO_MOEDA
    linha.getCell(9).numFmt = FORMATO_MOEDA
  }

  detalhe.getColumn(1).width = 24
  COLUNAS_VALES.forEach((coluna, i) => {
    detalhe.getColumn(i + 2).width = coluna.width
  })
}

// Montagem separada do download de propósito: assim dá pra gerar o
// workbook e conferir o conteúdo (inclusive lendo o arquivo de volta) sem
// depender de um efeito colateral de navegador.
//
// UMA agência no resultado → uma página só. É a mesma regra do chevron na
// tela: com uma agência só, o nível "por agência" não separa nada.
export async function montarWorkbook(relatorio: Relatorio, filtro: FiltroPeriodo) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Drogaria Cidade — Tele-entrega'
  workbook.created = new Date()
  // o período fica gravado no arquivo: aberto meses depois, o acerto diz
  // sozinho a que período se refere, sem depender do nome do arquivo.
  workbook.description = `Acerto com a agência — período de ${filtro.dataInicio} a ${filtro.dataFim}`

  if (relatorio.porAgencia.length > 1) montarDuasPaginas(workbook, relatorio, filtro)
  else montarPaginaUnica(workbook, relatorio, filtro)

  return workbook
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function exportarAcertoXlsx(relatorio: Relatorio, filtro: FiltroPeriodo) {
  const workbook = await montarWorkbook(relatorio, filtro)
  const buffer = await workbook.xlsx.writeBuffer()
  baixar(new Blob([buffer], { type: TIPO_XLSX }), nomeDoArquivo(filtro))
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  link.remove()
  // libera o blob no próximo tick — revogar antes do clique ser processado
  // cancela o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
