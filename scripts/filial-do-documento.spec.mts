// O nome da filial nos romaneios sai do SNAPSHOT — passo 3, 2026-09-11.
//
//   npx tsx scripts/filial-do-documento.spec.mts
//
// Duas metades: a regra pura (`nomeDaFilialDoDocumento`) e a FIAÇÃO — que
// o mapper compartilhado a usa, e que ninguém a jusante volta a ler o
// join vivo. A segunda existe porque a regra certa num arquivo que nada
// chama não protege documento nenhum.

import { readFileSync } from 'node:fs'
import { nomeDaFilialDoDocumento } from '../src/lib/filialDoDocumento.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// ---------------------------------------------------------------------
// (1) A REGRA
// ---------------------------------------------------------------------

// O caso que motivou o passo: selado na "Matriz", renomeada depois.
checa('o snapshot vence o nome de hoje',
  nomeDaFilialDoDocumento({ versao: 'DCR1', loja_nome: 'Matriz', vales: [] }, 'Matriz Centro') === 'Matriz')

checa('o retorno também: mesma chave, outro formato de payload',
  nomeDaFilialDoDocumento({ versao: 'DCRR1', saida_romaneio_id: 'x', loja_nome: 'Filial 02', vales: [] }, 'Filial 2')
    === 'Filial 02')

checa('documento ANTERIOR à migration (sem a chave) cai no nome atual',
  nomeDaFilialDoDocumento({ versao: 'DCR1', vales: [] }, 'Matriz Centro') === 'Matriz Centro')

checa('anterior, e sem nome atual: null',
  nomeDaFilialDoDocumento({ versao: 'DCR1', vales: [] }, null) === null)

// Chave presente com nulo NÃO é "sem snapshot". Cair no nome de hoje
// faria o documento afirmar uma filial que o registro não afirma.
checa('snapshot nulo NÃO cai no nome atual',
  nomeDaFilialDoDocumento({ loja_nome: null }, 'Matriz Centro') === null)

checa('snapshot em branco também não',
  nomeDaFilialDoDocumento({ loja_nome: '   ' }, 'Matriz Centro') === null)

checa('snapshot de tipo estranho também não',
  nomeDaFilialDoDocumento({ loja_nome: 42 }, 'Matriz Centro') === null)

checa('payload ausente cai no nome atual',
  nomeDaFilialDoDocumento(null, 'Matriz') === 'Matriz' &&
    nomeDaFilialDoDocumento(undefined, 'Matriz') === 'Matriz')

checa('payload que não é objeto cai no nome atual',
  nomeDaFilialDoDocumento('DCR1', 'Matriz') === 'Matriz')

checa('o nome não é normalizado na leitura — sai como foi congelado',
  nomeDaFilialDoDocumento({ loja_nome: 'filial 04 ' }, null) === 'filial 04 ')

// ---------------------------------------------------------------------
// (2) A FIAÇÃO — lê CÓDIGO, nunca prosa
// ---------------------------------------------------------------------

const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const ler = (caminho: string) => semComentarios(readFileSync(caminho, 'utf8'))

// Controle negativo do instrumento: sem ele, um `semComentarios` que
// devolvesse o fonte intacto faria a asserção (b) passar por casar com o
// comentário que explica a troca.
checa('o instrumento apaga a leitura antiga escrita num comentário',
  !/lojaNome:\s*r\.lojas/.test(semComentarios('// antes: lojaNome: r.lojas?.nome ?? null')))

const romaneios = ler('src/data/romaneios.ts')

checa('(a) o mapper compartilhado usa a regra do snapshot',
  /lojaNome:\s*nomeDaFilialDoDocumento\(\s*r\.payload\s*,/.test(romaneios))

checa('(b) e não atribui mais o join vivo direto',
  !/lojaNome:\s*r\.lojas\?\.nome/.test(romaneios))

checa('(c) só existe UM mapper de romaneio para página, PDF e sangria',
  (romaneios.match(/function mapRomaneio\(/g) ?? []).length === 1 &&
    (romaneios.match(/mapRomaneio\(/g) ?? []).length >= 3)

// Quem desenha e quem arquiva recebem o nome já resolvido. Se algum deles
// voltasse a ler `lojas` sozinho, o snapshot seria contornado a jusante.
for (const arquivo of [
  'src/lib/romaneioPdf.ts',
  'src/pages/Romaneio.tsx',
  'src/components/SangriaRomaneios.tsx',
]) {
  checa(`(d) ${arquivo} não lê o nome da filial por conta própria`,
    !/lojas\s*\?\.\s*nome|lojas\(nome\)/.test(ler(arquivo)))
}

console.log(falhas === 0 ? '\nfilial do documento ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
