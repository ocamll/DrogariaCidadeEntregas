import type { Relatorio, FiltroPeriodo } from '@/data/relatorios'

// Exportação do acerto com a agência em .xlsx de verdade (ExcelJS), não
// CSV renomeado: são duas planilhas, com formato de moeda, filtro,
// congelamento de painel e agrupamento recolhível por agência.
//
// O import do ExcelJS é DINÂMICO de propósito. A biblioteca passa de 1 MB
// e nada disso interessa ao caixa, que é quem abre o app o dia inteiro —
// ela só desce quando alguém clica em exportar. O teste dos 25 segundos
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

function nomeDoArquivo(filtro: FiltroPeriodo): string {
  return `acerto-agencia-${filtro.dataInicio}-a-${filtro.dataFim}.xlsx`
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
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
  // sozinho a que mês se refere, sem depender do nome do arquivo.
  workbook.description = `Acerto com a agência — período de ${filtro.dataInicio} a ${filtro.dataFim}`

  // ---------------------------------------------------------------- resumo
  const resumo = workbook.addWorksheet('Acerto por agência')
  resumo.columns = [
    { header: 'Agência', key: 'agencia', width: 26 },
    { header: 'Motoboy', key: 'motoboy', width: 26 },
    { header: 'Vales', key: 'vales', width: 10 },
    { header: 'Entregues', key: 'entregues', width: 12 },
    { header: 'Insucessos', key: 'insucessos', width: 12 },
    { header: 'Valor de entrega', key: 'entrega', width: 18 },
    { header: 'A pagar', key: 'aPagar', width: 16 },
  ]
  resumo.getRow(1).font = { bold: true }
  resumo.views = [{ state: 'frozen', ySplit: 1 }]

  for (const agencia of relatorio.porAgencia) {
    const linhaAgencia = resumo.addRow({
      agencia: agencia.nome,
      motoboy: '— total da agência —',
      vales: agencia.totalVales,
      entregues: agencia.entregues,
      insucessos: agencia.insucessos,
      entrega: reais(agencia.valorEntregaCents),
      aPagar: reais(agencia.valorFarmaciaDeveCents),
    })
    linhaAgencia.font = { bold: true }

    for (const motoboy of agencia.porMototaxista) {
      // a agência se repete na linha do motoboy de propósito: assim a
      // planilha continua filtrável e "pivotável" pelo usuário, em vez de
      // depender da leitura visual do agrupamento.
      const linha = resumo.addRow({
        agencia: agencia.nome,
        motoboy: motoboy.nome,
        vales: motoboy.totalVales,
        entregues: motoboy.entregues,
        insucessos: motoboy.insucessos,
        entrega: reais(motoboy.valorEntregaCents),
        aPagar: reais(motoboy.valorFarmaciaDeveCents),
      })
      // recolhível debaixo da agência, como no Excel nativo
      linha.outlineLevel = 1
    }
  }

  const totalGeral = resumo.addRow({
    agencia: 'TOTAL',
    motoboy: '',
    vales: relatorio.porAgencia.reduce((s, a) => s + a.totalVales, 0),
    entregues: relatorio.porAgencia.reduce((s, a) => s + a.entregues, 0),
    insucessos: relatorio.porAgencia.reduce((s, a) => s + a.insucessos, 0),
    entrega: reais(relatorio.porAgencia.reduce((s, a) => s + a.valorEntregaCents, 0)),
    aPagar: reais(relatorio.porAgencia.reduce((s, a) => s + a.valorFarmaciaDeveCents, 0)),
  })
  totalGeral.font = { bold: true }
  totalGeral.border = { top: { style: 'thin' } }

  for (const coluna of ['entrega', 'aPagar']) {
    resumo.getColumn(coluna).numFmt = FORMATO_MOEDA
  }

  // ----------------------------------------------------------------- vales
  const detalhe = workbook.addWorksheet('Vales')
  detalhe.columns = [
    { header: 'Agência', key: 'agencia', width: 24 },
    { header: 'Motoboy', key: 'motoboy', width: 24 },
    { header: 'Vale', key: 'vale', width: 14 },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Tipo', key: 'tipo', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Valor de entrega', key: 'entrega', width: 18 },
    { header: 'A pagar', key: 'aPagar', width: 14 },
  ]
  detalhe.getRow(1).font = { bold: true }
  detalhe.views = [{ state: 'frozen', ySplit: 1 }]

  for (const agencia of relatorio.porAgencia) {
    for (const motoboy of agencia.porMototaxista) {
      for (const vale of motoboy.vales) {
        detalhe.addRow({
          agencia: agencia.nome,
          motoboy: motoboy.nome,
          vale: vale.numeroVale,
          cliente: vale.clienteNome,
          tipo: vale.tipo === 'transferencia' ? 'Transferência' : 'Cliente',
          status: STATUS_LABEL[vale.statusEntrega] ?? vale.statusEntrega,
          data: formatarData(vale.ocorridoEmLocal),
          entrega: reais(vale.valorEntregaCents),
          // mesma conta do relatório e da tela: o que a farmácia deve é o
          // valor da entrega menos o que o cliente pagou em mãos.
          aPagar: reais(vale.valorEntregaCents - vale.entregaPagaClienteCents),
        })
      }
    }
  }

  for (const coluna of ['entrega', 'aPagar']) {
    detalhe.getColumn(coluna).numFmt = FORMATO_MOEDA
  }
  detalhe.autoFilter = { from: 'A1', to: 'I1' }

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
