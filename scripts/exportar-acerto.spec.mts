// npx tsx scripts/exportar-acerto.spec.mts
//
// A planilha e o PDF do acerto saem do relatório FILTRADO que está na
// tela, e têm que dizer isso sozinhos: qual filial, qual agência, qual
// período, e os mesmos nove números do topo da tela. Este spec gera os dois
// arquivos de verdade e lê o conteúdo de volta.

import { montarWorkbook, gerarXlsx } from '../src/lib/exportarAcerto.ts'
import { montarPdf, gerarPdf } from '../src/lib/exportarAcertoPdf.ts'
import type { Relatorio } from '../src/data/relatorios.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const relatorio: Relatorio = {
  totalVales: 5,
  totalClientes: 4,
  totalTransferencias: 1,
  totalCancelados: 1,
  totalPendentes: 1,
  totalRealizados: 3,
  valorCompraCents: 45678,
  valorEntregaCents: 3600,
  valorFarmaciaDeveCents: 2700,
  porStatus: { entregue: 2, insucesso: 1, pendente: 1, cancelada: 1 },
  porStatusFinanceiro: {},
  porAgencia: [
    {
      chave: 'a1',
      nome: 'Gabrielense',
      totalVales: 3,
      entregues: 2,
      insucessos: 1,
      valorEntregaCents: 2700,
      valorFarmaciaDeveCents: 2700,
      porMototaxista: [
        {
          chave: 'm1',
          nome: 'Marcos',
          totalVales: 3,
          entregues: 2,
          insucessos: 1,
          valorEntregaCents: 2700,
          valorFarmaciaDeveCents: 2700,
          vales: [
            {
              id: 'e1',
              numeroVale: 'V-000101',
              clienteNome: 'Ana',
              tipo: 'cliente',
              statusEntrega: 'entregue',
              valorEntregaCents: 900,
              entregaPagaClienteCents: 0,
              ocorridoEmLocal: '2026-09-02T12:00:00Z',
            },
          ],
        },
      ],
    },
  ],
}
const filtro = { dataInicio: '2026-09-01', dataFim: '2026-09-18' }
const contexto = { emitidoPor: 'Teste', filialNome: 'Filial 02', agenciaNome: null }

// ------------------------------------------------------------ planilha
console.log('\n--- planilha ---')
const workbook = await montarWorkbook(relatorio, filtro, contexto)
const planilha = workbook.getWorksheet('Acerto')!
const textos: string[] = []
planilha.eachRow((linha) => {
  textos.push(
    (linha.values as unknown[])
      .slice(1)
      .map((v) => (v === null || v === undefined ? '' : String(v)))
      .join(' | ')
  )
})
const tudo = textos.join('\n')
checa('diz a filial filtrada', tudo.includes('Filial: Filial 02'))
checa('diz o período', tudo.includes('01/09/2026 a 18/09/2026'))
checa('tem o bloco de resumo do período', tudo.includes('Resumo do período'))
for (const rotulo of [
  'Vales no período | 5',
  'Vales de entrega | 4',
  'Vales de transferência | 1',
  'Vales pendentes | 1',
  'Vales cancelados | 1',
  'Valor em compras | 456.78',
  'Valor de entrega | 36',
  'Vales realizados | 3',
  'A pagar à agência | 27',
]) {
  checa(`linha "${rotulo}"`, textos.includes(rotulo))
}
const linhaCompras = textos.indexOf('Valor em compras | 456.78')
checa('dinheiro é NÚMERO na célula, com formato de moeda', (() => {
  let achou = false
  planilha.eachRow((linha) => {
    if (linha.getCell(1).value === 'Valor em compras') {
      achou = typeof linha.getCell(2).value === 'number' && String(linha.getCell(2).numFmt).includes('R$')
    }
  })
  return achou && linhaCompras >= 0
})())
const xlsx = await gerarXlsx(relatorio, filtro, contexto)
checa('nome do .xlsx traz a filial', xlsx.nome === 'acerto-agencia-filial-02-2026-09-01-a-2026-09-18.xlsx', xlsx.nome)

// ---------------------------------------------------------------- PDF
console.log('\n--- PDF ---')
const doc = await montarPdf(relatorio, filtro, contexto)
const bruto = doc.output()
checa('diz a filial filtrada', bruto.includes('Filial: Filial 02'))
for (const rotulo of ['VALES PENDENTES', 'VALES CANCELADOS', 'VALES REALIZADOS', 'VALOR EM COMPRAS']) {
  checa(`mostra ${rotulo}`, bruto.includes(rotulo))
}
const pdf = await gerarPdf(relatorio, filtro, contexto)
checa('nome do PDF traz a filial', pdf.nome === 'acerto-agencia-filial-02-2026-09-01-a-2026-09-18.pdf', pdf.nome)
const semFiltro = await gerarPdf(relatorio, filtro, { emitidoPor: 'Teste' })
checa('sem filial no filtro: "todas-as-filiais"', semFiltro.nome.includes('todas-as-filiais'), semFiltro.nome)

console.log(falhas === 0 ? '\nexportação do acerto ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
