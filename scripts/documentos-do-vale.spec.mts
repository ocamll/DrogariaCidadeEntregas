// npx tsx scripts/documentos-do-vale.spec.mts
//
// Receber documento — as decisões puras de `src/lib/documentosDoVale.ts`.
// O servidor (migration 20260915140000) é quem decide; isto prova que a
// tela lê o retorno sem transformar recebimento posterior em "voltou no
// retorno", que o menu não oferece nada antes do retorno, e que a fila
// classifica as respostas sem retentar recusa pra sempre.

import {
  documentosDoVale,
  tiposQuePodemEstarPendentes,
  cargoRecebeDocumento,
  classificarResultadoDoRecebimento,
  type ValeParaRecebimento,
} from '../src/lib/documentosDoVale.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
const json = (v: unknown) => JSON.stringify(v)

console.log('\n--- documentosDoVale ---')
{
  const r = documentosDoVale(
    [
      { tipo: 'receita', situacao: 'faltante' },
      { tipo: 'convenio', situacao: 'recebido' },
    ],
    []
  )
  checa('(1) ordena convênio antes de receita', json(r.map((d) => d.tipo)) === json(['convenio', 'receita']))
  checa('(1) recebido no retorno fica recebido_no_retorno', r[0].situacao === 'recebido_no_retorno')
  checa('(1) faltante sem recebimento fica pendente', r[1].situacao === 'pendente' && r[1].recebimento === null)
}
{
  const rec = { tipo: 'receita', recebidoPorNome: 'Ana', registradoEm: '2026-09-16T13:00:00Z' }
  const r = documentosDoVale([{ tipo: 'receita', situacao: 'faltante' }], [rec])
  checa('(2) faltante com recebimento fica recebido_depois', r[0].situacao === 'recebido_depois')
  checa('(2) carrega quem recebeu', r[0].recebimento?.recebidoPorNome === 'Ana')
}
{
  // Receber a receita não quita o convênio do mesmo vale.
  const rec = { tipo: 'receita', recebidoPorNome: 'Ana', registradoEm: '2026-09-16T13:00:00Z' }
  const r = documentosDoVale(
    [
      { tipo: 'convenio', situacao: 'faltante' },
      { tipo: 'receita', situacao: 'faltante' },
    ],
    [rec]
  )
  checa('(3) receita recebida não quita convênio', r[0].situacao === 'pendente' && r[1].situacao === 'recebido_depois')
}
{
  // Um recebimento de um tipo que o retorno declarou RECEBIDO não muda o rótulo.
  const rec = { tipo: 'convenio', recebidoPorNome: 'Ana', registradoEm: '2026-09-16T13:00:00Z' }
  const r = documentosDoVale([{ tipo: 'convenio', situacao: 'recebido' }], [rec])
  checa('(4) recebido no retorno nunca vira recebido_depois', r[0].situacao === 'recebido_no_retorno')
}
checa('(5) sem declaração, lista vazia', documentosDoVale([], []).length === 0)

console.log('\n--- tiposQuePodemEstarPendentes ---')
const base: ValeParaRecebimento = {
  tipo: 'cliente',
  statusEntrega: 'entregue',
  statusDocumental: 'pendente',
  formasPrevistas: [{ forma: 'convenio' }, { forma: 'dinheiro' }],
  temReceita: true,
  receitaRecebidaEm: null,
}
checa('(6) entregue, convênio pendente e receita aberta', json(tiposQuePodemEstarPendentes(base)) === json(['convenio', 'receita']))
checa('(7) insucesso também oferece', tiposQuePodemEstarPendentes({ ...base, statusEntrega: 'insucesso' }).length === 2)
for (const status of ['pendente', 'em_rota', 'cancelada']) {
  checa(`(8) ${status}: nada antes do retorno`, tiposQuePodemEstarPendentes({ ...base, statusEntrega: status }).length === 0)
}
checa('(9) transferência nunca oferece', tiposQuePodemEstarPendentes({ ...base, tipo: 'transferencia' }).length === 0)
checa('(10) receita já recebida sai', json(tiposQuePodemEstarPendentes({ ...base, receitaRecebidaEm: '2026-09-15T10:00:00Z' })) === json(['convenio']))
checa('(11) status_documental recebido tira convênio/crediário', json(tiposQuePodemEstarPendentes({ ...base, statusDocumental: 'recebido' })) === json(['receita']))
checa(
  '(12) crediário e convênio juntos, na ordem',
  json(tiposQuePodemEstarPendentes({ ...base, temReceita: false, formasPrevistas: [{ forma: 'crediario' }, { forma: 'convenio' }] })) ===
    json(['convenio', 'crediario'])
)
checa('(13) sem forma de papel e sem receita: nada', tiposQuePodemEstarPendentes({ ...base, temReceita: false, formasPrevistas: [{ forma: 'pix' }] }).length === 0)

console.log('\n--- cargoRecebeDocumento ---')
checa('(14) caixa recebe', cargoRecebeDocumento('caixa'))
checa('(14) gerente recebe', cargoRecebeDocumento('gerente'))
checa('(14) admin NÃO recebe', !cargoRecebeDocumento('admin'))
checa('(14) agencia NÃO recebe', !cargoRecebeDocumento('agencia'))

console.log('\n--- classificarResultadoDoRecebimento ---')
checa('(15) recebido é sucesso', json(classificarResultadoDoRecebimento({ resultado: 'recebido', reenvio: true })) === json({ tipo: 'sucesso', jaRecebidoPorOutro: false }))
checa('(16) ja_recebido é sucesso, marcado', json(classificarResultadoDoRecebimento({ resultado: 'ja_recebido' })) === json({ tipo: 'sucesso', jaRecebidoPorOutro: true }))
checa('(17) sem_pendencia é recusa', classificarResultadoDoRecebimento({ resultado: 'sem_pendencia' }).tipo === 'recusa')
checa('(17) tipo_invalido é recusa', classificarResultadoDoRecebimento({ resultado: 'tipo_invalido' }).tipo === 'recusa')
checa('(18) resposta estranha é desconhecido (retenta)', classificarResultadoDoRecebimento({ resultado: 'outra_coisa' }).tipo === 'desconhecido')
checa('(18) nulo é desconhecido', classificarResultadoDoRecebimento(null).tipo === 'desconhecido')
checa('(18) "toString" não passa por recusa conhecida', classificarResultadoDoRecebimento({ resultado: 'toString' }).tipo === 'desconhecido')

console.log(falhas === 0 ? '\ndocumentos do vale ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
