import type { Relatorio, RelatorioAgencia, FiltroPeriodo } from '@/data/relatorios'
import type { Workbook, Worksheet, Row } from 'exceljs'

// Exportação do acerto com a agência em .xlsx de verdade (ExcelJS), não
// CSV renomeado: formato de moeda, filtro automático, painel congelado.
//
// UMA página, sempre. Já foram duas abas ("acerto por agência" e "vales")
// e o usuário achou desconexo: quem está conferindo o pagamento pula do
// subtotal pro vale que o compõe o tempo todo, e ficar trocando de aba
// quebra esse vaivém. Com uma folha só, o resumo e o detalhe se leem
// juntos, e o que muda entre uma agência e várias é só a existência da
// coluna "Agência".
//
// O import do ExcelJS é DINÂMICO de propósito. A biblioteca passa de 900
// kB e nada disso interessa ao caixa, que é quem abre o app o dia inteiro
// — ela só desce quando alguém clica em exportar.

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
  // vermelho da marca, o mesmo `--primary` do app (#ed1d24)
  titulo: 'FFED1D24',
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

function moeda(linha: Row, ...colunas: number[]) {
  for (const coluna of colunas) linha.getCell(coluna).numFmt = FORMATO_MOEDA
}

// --- dados -------------------------------------------------------------

type LinhaVale = {
  celulas: (string | number)[]
  statusCru: string
}

function achatarVales(agencias: RelatorioAgencia[], comAgencia: boolean): LinhaVale[] {
  const linhas: LinhaVale[] = []
  for (const agencia of agencias) {
    for (const motoboy of agencia.porMototaxista) {
      for (const vale of motoboy.vales) {
        const base: (string | number)[] = [
          vale.numeroVale,
          vale.clienteNome,
          vale.tipo === 'transferencia' ? 'Transferência' : 'Cliente',
          STATUS_LABEL[vale.statusEntrega] ?? vale.statusEntrega,
          formatarDataHora(vale.ocorridoEmLocal),
          motoboy.nome,
          reais(vale.valorEntregaCents),
          // mesma conta do relatório e da tela: o que a farmácia deve é o
          // valor da entrega menos o que o cliente pagou em mãos.
          reais(vale.valorEntregaCents - vale.entregaPagaClienteCents),
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

// --- montagem ----------------------------------------------------------

function montarPagina(workbook: Workbook, relatorio: Relatorio, filtro: FiltroPeriodo) {
  const variasAgencias = relatorio.porAgencia.length > 1
  const planilha = workbook.addWorksheet('Acerto')

  // com várias agências entra uma coluna a mais nas duas tabelas
  const colunasResumo = variasAgencias ? 7 : 6
  const colunasVales = variasAgencias ? 9 : 8
  const largura = Math.max(colunasResumo, colunasVales)

  const titulo = variasAgencias
    ? `Acerto de tele — ${relatorio.porAgencia.length} agências`
    : `Acerto de tele — ${relatorio.porAgencia[0]?.nome ?? 'sem corridas no período'}`

  faixaDeTitulo(
    planilha,
    titulo,
    `Período de ${formatarDataBr(filtro.dataInicio)} a ${formatarDataBr(filtro.dataFim)}`,
    largura
  )
  planilha.addRow([])

  // ---- resumo: é o que se confere na hora de pagar
  const cabecalhoResumo = variasAgencias
    ? ['Agência', 'Motoboy', 'Vales', 'Entregues', 'Insucessos', 'Valor de entrega', 'A pagar']
    : ['Motoboy', 'Vales', 'Entregues', 'Insucessos', 'Valor de entrega', 'A pagar']

  const cabResumo = planilha.addRow(cabecalhoResumo)
  estilizarCabecalho(cabResumo, colunasResumo)

  const colMoedaResumo = variasAgencias ? [6, 7] : [5, 6]

  if (variasAgencias) {
    for (const agencia of relatorio.porAgencia) {
      // a linha da agência é o subtotal que se confere com ela
      const linhaAgencia = planilha.addRow([
        agencia.nome,
        '— total da agência —',
        agencia.totalVales,
        agencia.entregues,
        agencia.insucessos,
        reais(agencia.valorEntregaCents),
        reais(agencia.valorFarmaciaDeveCents),
      ])
      linhaAgencia.font = { bold: true }
      moeda(linhaAgencia, ...colMoedaResumo)

      for (const motoboy of agencia.porMototaxista) {
        // a agência se repete na linha do motoboy de propósito: assim a
        // planilha continua filtrável e "pivotável", em vez de depender
        // da leitura visual do agrupamento.
        const linha = planilha.addRow([
          agencia.nome,
          motoboy.nome,
          motoboy.totalVales,
          motoboy.entregues,
          motoboy.insucessos,
          reais(motoboy.valorEntregaCents),
          reais(motoboy.valorFarmaciaDeveCents),
        ])
        linha.outlineLevel = 1
        moeda(linha, ...colMoedaResumo)
      }
    }
  } else {
    const agencia = relatorio.porAgencia[0]
    for (const [i, motoboy] of (agencia?.porMototaxista ?? []).entries()) {
      const linha = planilha.addRow([
        motoboy.nome,
        motoboy.totalVales,
        motoboy.entregues,
        motoboy.insucessos,
        reais(motoboy.valorEntregaCents),
        reais(motoboy.valorFarmaciaDeveCents),
      ])
      zebrar(linha, i, colunasResumo)
      moeda(linha, ...colMoedaResumo)
    }
  }

  const totalVales = relatorio.porAgencia.reduce((s, a) => s + a.totalVales, 0)
  const totalEntregues = relatorio.porAgencia.reduce((s, a) => s + a.entregues, 0)
  const totalInsucessos = relatorio.porAgencia.reduce((s, a) => s + a.insucessos, 0)
  const totalEntrega = relatorio.porAgencia.reduce((s, a) => s + a.valorEntregaCents, 0)
  const totalPagar = relatorio.porAgencia.reduce((s, a) => s + a.valorFarmaciaDeveCents, 0)

  const linhaTotal = planilha.addRow(
    variasAgencias
      ? [
          'TOTAL A PAGAR',
          '',
          totalVales,
          totalEntregues,
          totalInsucessos,
          reais(totalEntrega),
          reais(totalPagar),
        ]
      : [
          'TOTAL A PAGAR',
          totalVales,
          totalEntregues,
          totalInsucessos,
          reais(totalEntrega),
          reais(totalPagar),
        ]
  )
  estilizarTotal(linhaTotal, colunasResumo)
  moeda(linhaTotal, ...colMoedaResumo)

  // ---- vales: o que sustenta cada número do resumo
  planilha.addRow([])
  const tituloVales = planilha.addRow(['Vales do período'])
  tituloVales.getCell(1).font = { bold: true, size: 12 }
  planilha.addRow([])

  const cabecalhoVales = variasAgencias
    ? ['Agência', 'Vale', 'Cliente', 'Tipo', 'Status', 'Data', 'Motoboy', 'Valor de entrega', 'A pagar']
    : ['Vale', 'Cliente', 'Tipo', 'Status', 'Data', 'Motoboy', 'Valor de entrega', 'A pagar']

  const cabVales = planilha.addRow(cabecalhoVales)
  estilizarCabecalho(cabVales, colunasVales)
  // o filtro cobre só a tabela de vales, não o bloco de resumo acima
  planilha.autoFilter = {
    from: { row: cabVales.number, column: 1 },
    to: { row: cabVales.number, column: colunasVales },
  }
  planilha.views = [{ state: 'frozen', ySplit: cabVales.number }]

  const colStatus = variasAgencias ? 5 : 4
  const colMoedaVales = variasAgencias ? [8, 9] : [7, 8]

  for (const [i, vale] of achatarVales(relatorio.porAgencia, variasAgencias).entries()) {
    const linha = planilha.addRow(vale.celulas)
    zebrar(linha, i, colunasVales)
    pintarStatus(linha, colStatus, vale.statusCru)
    moeda(linha, ...colMoedaVales)
  }

  const larguras = variasAgencias
    ? [22, 14, 28, 15, 13, 12, 22, 17, 14]
    : [14, 28, 15, 13, 12, 22, 17, 14]
  larguras.forEach((w, i) => {
    planilha.getColumn(i + 1).width = w
  })
}

// Montagem separada do download de propósito: assim dá pra gerar o
// workbook e conferir o conteúdo (inclusive lendo o arquivo de volta) sem
// depender de um efeito colateral de navegador.
export async function montarWorkbook(relatorio: Relatorio, filtro: FiltroPeriodo) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Drogaria Cidade — Tele-entrega'
  workbook.created = new Date()
  // o período fica gravado no arquivo: aberto meses depois, o acerto diz
  // sozinho a que período se refere, sem depender do nome do arquivo.
  workbook.description = `Acerto com a agência — período de ${filtro.dataInicio} a ${filtro.dataFim}`

  montarPagina(workbook, relatorio, filtro)
  return workbook
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// O arquivo em memória, com o nome. Quem baixa e quem manda pro Drive
// usam esta mesma função — o que vai pra nuvem é byte a byte o que o
// usuário baixaria, sem uma segunda geração que pudesse divergir.
export async function gerarXlsx(relatorio: Relatorio, filtro: FiltroPeriodo) {
  const workbook = await montarWorkbook(relatorio, filtro)
  const buffer = await workbook.xlsx.writeBuffer()
  return { nome: nomeDoArquivo(filtro), blob: new Blob([buffer], { type: TIPO_XLSX }) }
}

export async function exportarAcertoXlsx(relatorio: Relatorio, filtro: FiltroPeriodo) {
  const { nome, blob } = await gerarXlsx(relatorio, filtro)
  baixar(blob, nome)
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
