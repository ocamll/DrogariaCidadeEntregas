// Testes do parser do token do cartão (src/lib/tokenCartao.ts).
//
// Roda com:  npx tsx scripts/tokenCartao.spec.mts
//
// POR QUE ESTE ARQUIVO EXISTE SEPARADO
//
// Estes casos moravam em `cartao-pdf.spec.mts`, que foi apagado junto com
// o cartão de 75 × 20mm que a credencial CR80 substituiu. O parser NÃO
// foi apagado: `src/data/credenciais.ts` continua usando, e ele é a peça
// que identifica o cartão bipado — inclusive OFFLINE, onde só o cliente
// responde.
//
// Ele é **gêmeo de `public.public_id_do_token`** (migration
// 20260817130000). Os dois mudam sempre juntos, e divergirem não dá erro
// claro: dá "o cartão novo não é reconhecido offline", meses depois. Sair
// sem cobertura junto de uma limpeza de código morto seria a pior forma
// de perder um teste — por acidente, e sem ninguém notar.
import { publicIdDoToken } from '../src/lib/tokenCartao.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const PUBLIC_ID = '012345'
const TOKEN = '3' + PUBLIC_ID + '678901234567890'

console.log('\n--- o formato v3, o único que se emite hoje ---')
checa('token v3 tem 22 dígitos', TOKEN.length === 22 && /^[0-9]+$/.test(TOKEN), `${TOKEN.length}`)
// Total ÍMPAR jogaria um dígito pra fora do Set C do Code 128, custando
// 11 módulos por 1 dígito em vez de por 2. É metade do motivo de o
// formato ser como é.
checa('total par, pro Set C empacotar tudo', TOKEN.length % 2 === 0)
checa('v3 devolve o public_id', publicIdDoToken(TOKEN) === PUBLIC_ID, String(publicIdDoToken(TOKEN)))

console.log('\n--- v1 e v2: descontinuados, e agora RECUSADOS ---')
//
// Em 2026-08-18 o usuário descontinuou os formatos anteriores: foram
// versões de teste e nenhum cartão delas circulou na farmácia. Estes dois
// casos existem pra provar que o parser de fato parou de aceitá-los — sem
// eles, "tirei o suporte" e "esqueci de tirar" seriam indistinguíveis.
//
// As credenciais antigas continuam no banco como histórico; o que deixa
// de existir é o token daquele formato ser reconhecido.
checa('v2 não é mais lido', publicIdDoToken('2' + '0102030405' + '7'.repeat(31)) === null)
checa('v1 não é mais lido', publicIdDoToken('DCM1.0102030405.' + 'A'.repeat(20)) === null)

console.log('\n--- o que tem que ser recusado ---')
checa('v3 com um dígito a menos', publicIdDoToken('3' + '0'.repeat(20)) === null)
checa('v3 com um dígito a mais', publicIdDoToken('3' + '0'.repeat(22)) === null)
checa('versão desconhecida', publicIdDoToken('4' + '0'.repeat(21)) === null)
checa('letra no meio', publicIdDoToken('3' + '0'.repeat(19) + 'A0') === null)
checa('vazio', publicIdDoToken('') === null)
checa('só espaços', publicIdDoToken('   ') === null)
checa('qualquer coisa com separador', publicIdDoToken('DCM1.123.' + 'A'.repeat(20)) === null)

console.log('\n--- o leitor age como teclado ---')
// Ele costuma mandar Enter no fim, e às vezes o campo chega com espaço.
checa('espaço e quebra de linha em volta', publicIdDoToken('  ' + TOKEN + '\n') === PUBLIC_ID)
checa('tabulação em volta', publicIdDoToken('\t' + TOKEN + '\t') === PUBLIC_ID)

console.log(`\n${falhas === 0 ? 'parser ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
