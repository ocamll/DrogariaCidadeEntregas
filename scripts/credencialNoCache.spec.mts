// Quem entra no cache local de credenciais — 4B.1, 2026-09-11.
//
//   npx tsx scripts/credencialNoCache.spec.mts
//
// Duas metades, pelo mesmo motivo do spec do snapshot da filial: a regra
// pura, e a FIAÇÃO — que quem monta o cache de fato a chama, e passa a
// filial de quem está usando o terminal. A regra certa num arquivo que
// ninguém chama não protege terminal nenhum.

import { readFileSync } from 'node:fs'
import { credencialEntraNoCache } from '../src/lib/credencialNoCache.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const MATRIZ = '0197c000-0000-7000-8000-000000000001'
const FILIAL_02 = '0197c000-0000-7000-8000-000000000002'

// ---------------------------------------------------------------------
// (1) A REGRA
// ---------------------------------------------------------------------

checa('motoboy entra sempre — é ele que o balcão bipa',
  credencialEntraNoCache({ titular: 'motoboy', lojaIdDoTitular: null }, MATRIZ))

checa('motoboy entra até para quem não tem filial no perfil',
  credencialEntraNoCache({ titular: 'motoboy', lojaIdDoTitular: null }, null))

checa('gerente da MESMA filial entra',
  credencialEntraNoCache({ titular: 'gerente', lojaIdDoTitular: MATRIZ }, MATRIZ))

// O caso que a regra existe pra impedir: um gerente de outra filial seria
// identificado no balcão, digitaria o PIN, e o selo recusaria depois —
// com o motoboy esperando.
checa('gerente de OUTRA filial fica de fora',
  !credencialEntraNoCache({ titular: 'gerente', lojaIdDoTitular: FILIAL_02 }, MATRIZ))

checa('gerente sem filial fica de fora',
  !credencialEntraNoCache({ titular: 'gerente', lojaIdDoTitular: null }, MATRIZ))

// Nulo dos dois lados não é "igual": o admin é quem tem filial nula, e
// ele não opera balcão.
checa('nulo dos dois lados NÃO casa',
  !credencialEntraNoCache({ titular: 'gerente', lojaIdDoTitular: null }, null))

checa('usuário sem filial não recebe gerente nenhum no cache',
  !credencialEntraNoCache({ titular: 'gerente', lojaIdDoTitular: MATRIZ }, null))

// ---------------------------------------------------------------------
// (2) A FIAÇÃO
// ---------------------------------------------------------------------

const ler = (caminho: string) => readFileSync(new URL('../' + caminho, import.meta.url), 'utf8')
const credenciais = ler('src/data/credenciais.ts')

checa('(a) quem monta o cache usa a regra, e não um filtro solto',
  /credencialEntraNoCache\(/.test(credenciais))

checa('(b) a sincronização recebe a filial de quem está no terminal',
  /sincronizarCacheDeCredenciais\(\s*lojaIdDoUsuario: string \| null/.test(credenciais))

// O cache guarda nome, não segredo. Se algum dia alguém pedir estas
// colunas, o grant do banco recusa — mas o pedido não deve nem existir no
// código. A checagem olha os `select`, e não o arquivo inteiro: os dois
// nomes aparecem nos COMENTÁRIOS que explicam por que eles ficam de fora,
// e um teste que proibisse falar deles apagaria a explicação.
const selects = credenciais.match(/\.select\([\s\S]*?\)/g) ?? []
checa('(c) nenhum select pede token_hash nem pin_hash',
  selects.length >= 2 && !selects.some((s) => /token_hash|pin_hash/.test(s)),
  `${selects.length} select(s) conferidos`)

// As duas telas do balcão precisam passar a filial; sem isso o gerente
// nunca entraria no cache e a exceção offline não teria como funcionar.
for (const arquivo of ['src/pages/NovaCorrida.tsx', 'src/pages/RetornoCorrida.tsx']) {
  checa(`(d) ${arquivo} sincroniza o cache com a filial do perfil`,
    /sincronizarCacheDeCredenciais\((profile|perfil)[^)]*loja/i.test(ler(arquivo)))
}

console.log(falhas === 0 ? '\ncredencial no cache ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
