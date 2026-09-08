// npx tsx scripts/contraste.mts "#FFFFFF" "#777777"
// npx tsx scripts/contraste.mts --selftest
//
// CONTRASTE WCAG 2.x — a conta que ninguém deve fazer de cabeça.
//
// Porte do `contrast-check.py` que vem com a skill `antislop-human`. O
// original é Python, e **esta máquina não tem Python** (`python`,
// `python3` e `py` não resolvem) — a própria skill manda não travar por
// causa disso e documenta a fórmula por extenso, então o porte é a
// leitura correta dela, não uma liberdade.
//
// Por que ela existe, na frase da skill: *"o script existe para os
// agentes pararem de alucinar AA"*. O olho superestima contraste em
// cinzas, e "cinza escuro no preto passa" é a alucinação de
// acessibilidade mais comum que existe. `#555555` sobre preto dá 2,82:1
// e reprova nos dois tamanhos.
//
// AQUI IMPORTA MAIS QUE NA MÉDIA DOS PROJETOS: o requisito é **zero
// mouse** (ver "O teste que decide o projeto" no CLAUDE.md). Numa tela
// operada só por teclado, o indicador de foco é a única coisa que diz
// onde a pessoa está — e ele precisa dos mesmos 3:1 de qualquer
// componente.
//
// A tabela do `--selftest` é EMBUTIDA de propósito. O script original lê
// o `SKILL.md` ao lado dele; aqui isso amarraria uma ferramenta do repo
// a um caminho em `~/.claude/skills/`, que nem todo clone vai ter.

type RGB = [number, number, number]

const NOMEADAS: Record<string, RGB> = { black: [0, 0, 0], white: [255, 255, 255] }

function lerHex(valor: string): RGB {
  let v = valor.trim().replace(/^#/, '')
  if (v.length === 3) v = [...v].map((c) => c + c).join('')
  if (!/^[0-9A-Fa-f]{6}$/.test(v)) {
    throw new Error(`esperava uma cor hex como #FFFFFF, veio ${JSON.stringify(valor)}`)
  }
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB
}

// A linearização é por canal, e o joelho em 0.03928 é o da spec — não
// arredondar nem "simplificar" para `c ** 2.2`, que é a aproximação de
// gama e erra perto dos limiares, justamente onde a decisão acontece.
function linearizar(canal: number): number {
  const c = canal / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminancia([r, g, b]: RGB): number {
  return 0.2126 * linearizar(r) + 0.7152 * linearizar(g) + 0.0722 * linearizar(b)
}

export function razaoDeContraste(a: RGB, b: RGB): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}

// Os dois limiares do R-25 da antislop, que são os da WCAG AA: 4,5:1
// para texto normal e 3:1 para texto grande (18px+).
const NORMAL = 4.5
const GRANDE = 3.0

function veredito(razao: number) {
  return { normal: razao >= NORMAL, grande: razao >= GRANDE }
}

// --- selftest ---------------------------------------------------------
//
// Os oito pares vêm da tabela de referência da skill. Ele confere DUAS
// coisas: que a fórmula reproduz a razão publicada, e que os vereditos
// da tabela batem com os limiares. Uma tabela que discorda da própria
// fórmula é pior que tabela nenhuma — quem consulta confia nela.

const REFERENCIA: Array<[string, string, string, number]> = [
  ['Preto sobre branco', '#000000', '#FFFFFF', 21.0],
  ['Branco sobre preto', '#FFFFFF', '#000000', 21.0],
  ['Branco sobre #333333', '#FFFFFF', '#333333', 12.63],
  ['Branco sobre #666666', '#FFFFFF', '#666666', 5.74],
  ['#777777 sobre branco', '#777777', '#FFFFFF', 4.48],
  ['Branco sobre #888888', '#FFFFFF', '#888888', 3.54],
  ['Branco sobre #999999', '#FFFFFF', '#999999', 2.85],
  ['#555555 sobre preto', '#555555', '#000000', 2.82],
]

function selftest(): number {
  let falhas = 0
  for (const [nome, frente, fundo, esperado] of REFERENCIA) {
    const obtido = Number(razaoDeContraste(lerHex(frente), lerHex(fundo)).toFixed(2))
    const ok = obtido === esperado
    if (!ok) {
      falhas++
      console.log(`FALHA  ${nome}: a tabela diz ${esperado}, a fórmula diz ${obtido}`)
    } else {
      const v = veredito(obtido)
      console.log(
        `ok     ${nome.padEnd(24)} ${String(obtido).padStart(5)}:1  ` +
          `normal ${v.normal ? 'passa' : 'reprova'} · grande ${v.grande ? 'passa' : 'reprova'}`
      )
    }
  }
  console.log(falhas === 0 ? `\n${REFERENCIA.length} pares de referência OK\n` : `\n${falhas} FALHA(S)\n`)
  return falhas === 0 ? 0 : 1
}

// --- main -------------------------------------------------------------

const args = process.argv.slice(2)

if (args.length === 1 && args[0] === '--selftest') {
  process.exit(selftest())
}

if (args.length !== 2) {
  console.log('uso: npx tsx scripts/contraste.mts <hex1> <hex2>')
  console.log('     npx tsx scripts/contraste.mts --selftest')
  process.exit(2)
}

try {
  const razao = razaoDeContraste(lerHex(args[0]), lerHex(args[1]))
  const v = veredito(razao)
  console.log(`razão: ${razao.toFixed(2)}:1`)
  console.log(`texto normal (4,5:1): ${v.normal ? 'PASSA' : 'REPROVA'}`)
  console.log(`texto grande (3,0:1): ${v.grande ? 'PASSA' : 'REPROVA'}`)
  process.exit(v.normal && v.grande ? 0 : 1)
} catch (erro) {
  console.log(`erro: ${erro instanceof Error ? erro.message : String(erro)}`)
  process.exit(2)
}
