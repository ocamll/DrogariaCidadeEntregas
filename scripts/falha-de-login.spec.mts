// npx tsx scripts/falha-de-login.spec.mts
//
// O E2 NA DÉCIMA TELA — a que ele não cobriu.
//
// O E2 caçou, em nove telas, a cadeia que AFIRMA vazio sobre uma
// consulta que nunca respondeu. O login escapou por ser escrita, e
// carregava a mesma família de defeito na forma mais direta possível:
//
//     {mutation.isError && <p>E-mail ou senha inválidos.</p>}
//
// Qualquer erro virava "credencial inválida", inclusive não ter rede.
// Offline, o app dizia que a senha estava errada sem ter tido a quem
// perguntar — e mandava a pessoa trocar uma senha que estava certa.

import {
  classificarFalhaDeLogin,
  TEXTO_DA_FALHA,
  FalhaDeLoginError,
} from '../src/lib/falhaDeLogin.ts'
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
console.log('\n--- (1) offline NUNCA vira "senha errada" ---')
// ---------------------------------------------------------------------
{
  igual('sem rede, sem mais nada', classificarFalhaDeLogin({ online: false }), 'indisponivel')

  // E O CASO QUE MOTIVA A ORDEM DAS CHECAGENS: sem rede, um status
  // residual não pode virar veredito. `online: false` vem primeiro de
  // propósito — não havendo resposta autoritativa, nada mais importa.
  igual(
    'sem rede, mas com um 400 residual, continua indisponivel',
    classificarFalhaDeLogin({ online: false, status: 400 }),
    'indisponivel'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (2) as formas de "nao saiu da maquina" ---')
// ---------------------------------------------------------------------
{
  // O supabase-js levanta isto quando o fetch não completou.
  igual(
    'AuthRetryableFetchError',
    classificarFalhaDeLogin({ online: true, nome: 'AuthRetryableFetchError' }),
    'indisponivel'
  )
  // E o próprio `fetch` levanta TypeError quando o navegador não sai.
  // Este é o que `navigator.onLine` NÃO pega: online pode estar `true`
  // com a rede morta (captive portal, DNS caído, servidor fora).
  igual(
    'TypeError do fetch, mesmo com onLine=true',
    classificarFalhaDeLogin({ online: true, nome: 'TypeError' }),
    'indisponivel'
  )
  igual(
    'status 0 é o carimbo de "sem resposta HTTP"',
    classificarFalhaDeLogin({ online: true, status: 0 }),
    'indisponivel'
  )
}

// ---------------------------------------------------------------------
console.log('\n--- (3) o servidor respondeu, e disse nao ---')
// ---------------------------------------------------------------------
{
  igual('400', classificarFalhaDeLogin({ online: true, status: 400 }), 'recusado')
  igual('401', classificarFalhaDeLogin({ online: true, status: 401 }), 'recusado')
  igual(
    'AuthApiError com 400 é recusa de verdade',
    classificarFalhaDeLogin({ online: true, status: 400, nome: 'AuthApiError' }),
    'recusado'
  )

  // 5xx é defeito do servidor. Mandar redigitar a senha seria perda de
  // tempo, então ganha texto próprio.
  igual('500', classificarFalhaDeLogin({ online: true, status: 500 }), 'erro')
  igual('503', classificarFalhaDeLogin({ online: true, status: 503 }), 'erro')

  // O default é `recusado` porque é o caso esmagadoramente comum e o
  // único acionável para quem está no balcão.
  igual('sem pista nenhuma, online', classificarFalhaDeLogin({ online: true }), 'recusado')
}

// ---------------------------------------------------------------------
console.log('\n--- (4) o que cada texto AFIRMA ---')
// ---------------------------------------------------------------------
{
  // A asserção que importa: a mensagem de indisponível não pode dizer
  // nada sobre a senha. A tela não sabe se ela está certa.
  const indisponivel = TEXTO_DA_FALHA.indisponivel.toLowerCase()
  checa('indisponivel NAO fala em senha', !indisponivel.includes('senha'))
  checa('indisponivel NAO fala em invalido', !indisponivel.includes('inválid'))
  checa('mas diz que faltou conexao', indisponivel.includes('conexão'))

  checa('recusado fala em usuario e senha', TEXTO_DA_FALHA.recusado.toLowerCase().includes('senha'))

  // Os três textos são distintos: dois iguais apagariam a distinção que
  // o resto do arquivo existe pra fazer.
  const textos = Object.values(TEXTO_DA_FALHA)
  igual('os tres textos sao distintos', new Set(textos).size, 3)
}

// ---------------------------------------------------------------------
console.log('\n--- (5) o erro carrega a classificacao ate a tela ---')
// ---------------------------------------------------------------------
{
  const e = new FalhaDeLoginError('indisponivel')
  igual('guarda a falha', e.falha, 'indisponivel')
  igual('e a mensagem sai da tabela', e.message, TEXTO_DA_FALHA.indisponivel)
  checa('continua sendo um Error', e instanceof Error)
  igual('com nome proprio, pra o instanceof sobreviver ao bundle', e.name, 'FalhaDeLoginError')
}

// ---------------------------------------------------------------------
console.log('\n--- (6) fiacao: a tela nao decide mais por `isError` ---')
// ---------------------------------------------------------------------
{
  const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  // Asserção de fiação lê CÓDIGO, nunca prosa — a lição do E4.
  const semComentarios = (f: string) =>
    f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  const login = semComentarios(ler('src/pages/Login.tsx'))
  const auth = semComentarios(ler('src/data/auth.tsx'))

  checa('a tela olha a classificacao', /FalhaDeLoginError/.test(login))
  checa('e entra por usuario, nao por e-mail', /signInComUsuario/.test(auth))
  checa(
    'a decisao le `navigator.onLine` NO INSTANTE DA ACAO',
    /const online = navigator\.onLine/.test(auth),
    'entre o render e o clique a rede muda; vale o instante em que se tentou'
  )
  checa(
    'e o `signInWithPassword` cru nao e mais exportado',
    !/export async function signInWithPassword/.test(auth)
  )
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
