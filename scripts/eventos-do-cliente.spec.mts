// npx tsx scripts/eventos-do-cliente.spec.mts
//
// A POLICY DE EVENTOS E O CÓDIGO DO CLIENTE PRECISAM DIZER A MESMA COISA.
//
// A migration 20260913120000 limita `eventos_insert` aos tipos que o
// cliente PRODUZ e recusa os marcadores de origem do servidor. São duas
// listas que moram em lugares diferentes — o SQL e o fonte — e divergem
// em silêncio:
//
//   tipo novo no cliente, policy esquecida   o insert é recusado em uso
//                                            real, com a ocorrência já
//                                            digitada no balcão
//   tipo novo na policy, sem cliente         a porta fica maior que o uso
//   payload do cliente com `origem`          recusado pela policy — e, se
//                                            passasse, se faria passar
//                                            pelo selo do retorno
//
// Este spec lê os dois lados e compara. Não precisa de banco: o que ele
// prova é a concordância do texto, e a conferência (c) da migration prova
// o comportamento no banco.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const ler = (caminho: string) => readFileSync(caminho, 'utf8')

// ---------------------------------------------------------------------
console.log('\n--- a migration ---')
// ---------------------------------------------------------------------
const MIGRATION = 'supabase/migrations/20260913120000_eventos_e_assinaturas_so_do_servidor.sql'
// Sem as linhas de comentário: o cabeçalho e as conferências citam tipos
// e marcadores, e o que vale é só o SQL executável.
const sql = ler(MIGRATION)
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n')

const policy = sql.match(/create policy eventos_insert on public\.eventos[\s\S]*?\);/)?.[0] ?? ''
checa('a policy eventos_insert existe no SQL executável', policy.length > 0)
checa('a policy antiga é removida antes', /drop policy eventos_insert on public\.eventos;/.test(sql))

const listaDaPolicy = policy.match(/tipo in \(([^)]*)\)/)?.[1] ?? ''
const tiposDaPolicy = new Set([...listaDaPolicy.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
checa('a policy lista tipos', tiposDaPolicy.size > 0, [...tiposDaPolicy].join(', '))

checa('recusa a CHAVE origem', /not \(payload \? 'origem'\)/.test(policy))
checa('recusa a CHAVE romaneio_retorno_id', /not \(payload \? 'romaneio_retorno_id'\)/.test(policy))
checa('NÃO recusa origem_referencia, que é do cliente', !policy.includes('origem_referencia'))
checa('revoga update em eventos', /revoke update on public\.eventos from anon, authenticated;/.test(sql))
checa('remove a policy de insert de assinaturas', /drop policy assinaturas_insert on public\.assinaturas;/.test(sql))
checa('revoga insert e update em assinaturas',
  /revoke insert, update on public\.assinaturas from anon, authenticated;/.test(sql))

// ---------------------------------------------------------------------
console.log('\n--- o cliente ---')
// ---------------------------------------------------------------------
function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) return arquivosDe(caminho)
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : []
  })
}

// O bloco `{ ... }` passado a `inserirEventoIdempotente`, com as chaves
// balanceadas — o payload tem objetos aninhados e spreads condicionais, e
// cortar no primeiro `})` pegaria só metade.
function blocosDaChamada(texto: string): string[] {
  const blocos: string[] = []
  const marca = 'inserirEventoIdempotente({'
  let de = texto.indexOf(marca)
  while (de !== -1) {
    const inicio = de + marca.length - 1
    let nivel = 0
    let fim = inicio
    for (; fim < texto.length; fim++) {
      if (texto[fim] === '{') nivel++
      else if (texto[fim] === '}') {
        nivel--
        if (nivel === 0) break
      }
    }
    blocos.push(texto.slice(inicio, fim + 1))
    de = texto.indexOf(marca, fim)
  }
  return blocos
}

const chamadas = arquivosDe('src')
  .filter((arquivo) => !arquivo.replace(/\\/g, '/').endsWith('src/data/eventos.ts'))
  .flatMap((arquivo) => blocosDaChamada(ler(arquivo)).map((bloco) => ({ arquivo, bloco })))

checa('há chamadas do cliente para conferir', chamadas.length > 0, `${chamadas.length} chamada(s)`)

const tiposDoCliente = new Set<string>()
for (const { arquivo, bloco } of chamadas) {
  const tipo = bloco.match(/\btipo:\s*'([a-z_]+)'/)?.[1]
  checa(`o tipo é literal em ${arquivo}`, !!tipo)
  if (tipo) tiposDoCliente.add(tipo)
  // `origem:` sozinho, não `origem_referencia:` nem `origemX:`.
  checa(`sem a chave origem em ${arquivo} (${tipo})`, !/(^|[^\w])origem\s*:/m.test(bloco))
  checa(`sem romaneio_retorno_id em ${arquivo} (${tipo})`, !bloco.includes('romaneio_retorno_id'))
}

const soNoCliente = [...tiposDoCliente].filter((t) => !tiposDaPolicy.has(t))
const soNaPolicy = [...tiposDaPolicy].filter((t) => !tiposDoCliente.has(t))
checa('todo tipo que o cliente grava está na policy', soNoCliente.length === 0, soNoCliente.join(', '))
checa('a policy não aceita tipo que o cliente não grava', soNaPolicy.length === 0, soNaPolicy.join(', '))

// O único caminho do cliente até `eventos` é `inserirEventoIdempotente`:
// um `.from('eventos').insert` solto escaparia desta conferência inteira.
const insertsSoltos = arquivosDe('src')
  .filter((arquivo) => !arquivo.replace(/\\/g, '/').endsWith('src/data/eventos.ts'))
  .filter((arquivo) => /from\(['"]eventos['"]\)\s*\.\s*(insert|upsert)/.test(ler(arquivo)))
checa('nenhum insert em eventos fora de inserirEventoIdempotente', insertsSoltos.length === 0, insertsSoltos.join(', '))

// E ninguém no cliente grava assinatura: a policy saiu.
const assinaturasEscritas = arquivosDe('src').filter((arquivo) =>
  /from\(['"]assinaturas['"]\)\s*\.\s*(insert|upsert|update)/.test(ler(arquivo))
)
checa('nenhuma escrita em assinaturas no cliente', assinaturasEscritas.length === 0, assinaturasEscritas.join(', '))

console.log(falhas === 0 ? '\neventos do cliente ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
