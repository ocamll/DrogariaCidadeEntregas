// npx tsx scripts/situacao-do-vale.spec.mts
//
// Realizado x pendente — a regra que decide o "A pagar à agência" no
// Relatório, na planilha, no PDF e no Fechamento.

import { valeFoiRealizado, valeEstaPendente } from '../src/lib/situacaoDoVale.ts'

let falhas = 0
function checa(nome: string, condicao: boolean) {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}`)
  if (!condicao) falhas++
}

checa('entregue é realizado', valeFoiRealizado('entregue') && !valeEstaPendente('entregue'))
checa('insucesso é realizado', valeFoiRealizado('insucesso') && !valeEstaPendente('insucesso'))
checa('em rota é pendente, não realizado', valeEstaPendente('em_rota') && !valeFoiRealizado('em_rota'))
checa('pendente é pendente', valeEstaPendente('pendente') && !valeFoiRealizado('pendente'))
checa('cancelado não é nem um nem outro', !valeFoiRealizado('cancelada') && !valeEstaPendente('cancelada'))
checa('status desconhecido não conta', !valeFoiRealizado('outra_coisa') && !valeEstaPendente('outra_coisa'))

console.log(falhas === 0 ? '\nsituação do vale ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
