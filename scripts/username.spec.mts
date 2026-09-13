// npx tsx scripts/username.spec.mts
//
// O GATE DO E5 — o usuário de login e o e-mail técnico.
//
// A asserção que mais importa deste arquivo é a ÚLTIMA, e ela não é
// sobre comportamento: é a comparação dos dois GÊMEOS.
//
//     src/lib/username.ts                    monta o e-mail no LOGIN
//     supabase/functions/criar-usuario       monta o e-mail na CRIAÇÃO
//
// A Edge Function roda em Deno, fora deste bundle, então ela carrega uma
// CÓPIA da normalização — mesmo arranjo de `calcularOfflineEventHashSaidaV2`,
// que também tem cópia na `sync-romaneio`.
//
// Divergindo em um byte, a conta nasce com um endereço e o login tenta
// outro. **O sintoma é "senha inválida", e não há diagnóstico nenhum**:
// nem verificador, nem canônico impresso, só um usuário jurando que a
// senha está certa. É o risco dos canônicos gêmeos reaparecendo na
// autenticação, onde dói mais.
//
// Por isso o spec LÊ OS DOIS ARQUIVOS e compara. Não é "copiei com
// cuidado": é medido.

import {
  DOMINIO_TECNICO,
  USERNAME_MIN,
  USERNAME_MAX,
  normalizarUsername,
  validarUsername,
  emailTecnico,
  usernameDoEmail,
} from '../src/lib/username.ts'
import { readFileSync } from 'node:fs'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  checa(nome, ok, ok ? '' : `veio ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`)
}

// ---------------------------------------------------------------------
console.log('\n--- (1) a normalizacao: trim, minuscula, sem acento ---')
// ---------------------------------------------------------------------
{
  igual('minuscula', normalizarUsername('Camilo'), 'camilo')
  igual('trim', normalizarUsername('  camilo  '), 'camilo')
  igual('as duas juntas', normalizarUsername('  CAMILO '), 'camilo')

  // Acento SAI, ao contrário de `normalizarNome`. Quem digita `josé`
  // precisa alcançar a conta `jose` — o local part de um e-mail não
  // aceita acento, então a conta nunca teve como se chamar `josé`.
  igual('acento agudo', normalizarUsername('José'), 'jose')
  igual('til', normalizarUsername('João'), 'joao')
  igual('cedilha — NFD resolve sem tabela de excecao', normalizarUsername('Açucena'), 'acucena')
  igual('circunflexo', normalizarUsername('Antônio'), 'antonio')
  igual('crase', normalizarUsername('Àgata'), 'agata')

  // IDEMPOTENTE. É o que permite normalizar no login e na criação sem o
  // valor derivar entre os dois.
  for (const amostra of ['Camilo', ' JOSÉ ', 'maria.fatima', 'joao_2']) {
    const uma = normalizarUsername(amostra)
    igual(`idempotente: ${JSON.stringify(amostra)}`, normalizarUsername(uma), uma)
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (2) o que ela NAO faz: apagar caractere ---')
// ---------------------------------------------------------------------
{
  // Apagar em silêncio transformaria `jo se` em `jose` e faria a pessoa
  // entrar numa conta que ela não pediu. Caractere inválido é assunto da
  // VALIDAÇÃO, que recusa em vez de consertar.
  igual('espaco no meio SOBREVIVE', normalizarUsername('jo se'), 'jo se')
  igual('arroba SOBREVIVE', normalizarUsername('jo@se'), 'jo@se')
  igual('barra SOBREVIVE', normalizarUsername('jo/se'), 'jo/se')

  // E o dígito, que uma versão anterior deste arquivo chegou a apagar:
  // o range de combinantes tinha sido escrito sem as barras invertidas
  // (`[0300-036f]`), virando uma classe de DÍGITOS. `joao2` perdia o 2.
  igual('digito sobrevive — o defeito do range sem escape', normalizarUsername('joao2'), 'joao2')
  igual('so digitos sobrevivem', normalizarUsername('123'), '123')
  igual('todos os digitos', normalizarUsername('a0123456789'), 'a0123456789')
}

// ---------------------------------------------------------------------
console.log('\n--- (3) a validacao, que so a CRIACAO usa ---')
// ---------------------------------------------------------------------
{
  igual('nome simples passa', validarUsername('camilo'), null)
  igual('com ponto passa', validarUsername('maria.fatima'), null)
  igual('com sublinhado passa', validarUsername('joao_2'), null)
  igual('com hifen passa', validarUsername('ana-paula'), null)
  igual('acentuado passa, porque normaliza antes', validarUsername('José'), null)

  checa('vazio recusa', validarUsername('') !== null)
  checa('so espaco recusa', validarUsername('   ') !== null)
  checa('curto demais recusa', validarUsername('ab') !== null)
  checa('longo demais recusa', validarUsername('a'.repeat(USERNAME_MAX + 1)) !== null)
  igual('no limite exato passa', validarUsername('a'.repeat(USERNAME_MAX)), null)
  igual('no minimo exato passa', validarUsername('a'.repeat(USERNAME_MIN)), null)

  checa('espaco no meio recusa', validarUsername('jo se') !== null)
  checa('arroba recusa', validarUsername('jo@se') !== null)
  checa('comecando com digito recusa', validarUsername('2joao') !== null)
  checa('comecando com ponto recusa', validarUsername('.joao') !== null)
  checa('comecando com hifen recusa', validarUsername('-joao') !== null)
}

// ---------------------------------------------------------------------
console.log('\n--- (4) o e-mail tecnico ---')
// ---------------------------------------------------------------------
{
  igual('compoe', emailTecnico('camilo'), `camilo@${DOMINIO_TECNICO}`)
  igual('normalizando antes', emailTecnico('  José '), `jose@${DOMINIO_TECNICO}`)
  igual('o dominio e o reservado da RFC 2606', DOMINIO_TECNICO, 'drogariacidade.invalid')

  // A volta, só para exibir.
  igual('extrai o usuario', usernameDoEmail(`camilo@${DOMINIO_TECNICO}`), 'camilo')
  igual('nulo vira travessao', usernameDoEmail(null), '—')

  // Conta de OUTRO domínio sai crua. Durante a conversão das contas
  // antigas as duas formas convivem, e mostrar `adminteste` para uma
  // conta que ainda é `adminteste@drogcidade.sg` afirmaria uma conversão
  // que não aconteceu — o desalinho tem que ficar visível.
  igual(
    'dominio alheio sai cru, e o desalinho fica visivel',
    usernameDoEmail('adminteste@drogcidade.sg'),
    'adminteste@drogcidade.sg'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (5) OS GEMEOS: cliente x Edge Function ---')
// ---------------------------------------------------------------------
{
  const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

  const lib = ler('src/lib/username.ts')
  const edge = ler('supabase/functions/criar-usuario/index.ts')

  /**
   * O CORPO da função, normalizado só no que não é significativo:
   * indentação e comentários. Um espaço a mais não muda bytes de
   * e-mail nenhum; um `.toUpperCase()` a mais muda.
   */
  const corpoDaNormalizacao = (fonte: string) => {
    const i = fonte.indexOf('function normalizarUsername')
    if (i < 0) return null
    const fim = fonte.indexOf('\n}', i)
    if (fim < 0) return null
    return fonte
      .slice(i, fim + 2)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const a = corpoDaNormalizacao(lib)
  const b = corpoDaNormalizacao(edge)

  checa('a lib tem `normalizarUsername`', a !== null)
  checa('a Edge Function tambem tem', b !== null, b === null ? 'nao achei a copia' : '')
  checa(
    'e os DOIS CORPOS SAO IDENTICOS',
    a !== null && a === b,
    a === b ? '' : `lib=${JSON.stringify(a)}  edge=${JSON.stringify(b)}`
  )

  // O domínio também é copiado, e divergir nele quebra igual.
  const dominioDaEdge = edge.match(/DOMINIO_TECNICO\s*=\s*'([^']+)'/)?.[1]
  igual('e o dominio bate nos dois lados', dominioDaEdge, DOMINIO_TECNICO)

  // A Edge Function NÃO pode mais aceitar e-mail cru do corpo do
  // request: quem compõe o endereço é a regra, não o cliente.
  const semComentarios = edge
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  checa(
    'a Edge Function nao le mais `corpo.email`',
    !/corpo\.email/.test(semComentarios),
    'o endereco tem que ser COMPOSTO, nunca aceito do cliente'
  )
  checa('ela le `corpo.username`', /corpo\.username/.test(semComentarios))
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
