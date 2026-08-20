// O canônico do retorno em TypeScript, conferido contra os GOLDEN
// VECTORS congelados.
//
// Roda com:  npx tsx scripts/canonico-retorno.spec.mts
//
// A DIREÇÃO DA PROVA IMPORTA: os vetores foram escritos à mão a partir
// da especificação ANTES desta implementação existir. Se a função
// discordar de um vetor, **o vetor ganha** até se demonstrar erro na
// especificação. Este teste não pergunta "a função é consistente
// consigo mesma", pergunta "a função obedece o contrato".
//
// TRÊS CRITÉRIOS, e não só o hash: texto, bytes e sha256. Um hash
// diferente só diz "algo mudou"; o texto diz ONDE, e a contagem de bytes
// separa "mudou um caractere" de "mudou a codificação" — que é
// exatamente o que o V003, fora do BMP, existe pra revelar.
import { createHash } from 'node:crypto'
import { VETORES, VETORES_INVALIDOS } from './dcrr1-vetores.mts'
import {
  montarCanonicoRetorno,
  normalizarRetorno,
  serializarRetorno,
  validarRetorno,
  paraJsonbRetorno,
  RetornoInvalido,
  type EntradaRetorno,
} from '../src/lib/canonicoRetorno.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// Mostra a primeira diferença em vez de dois blocos de texto: com TAB
// invisível, "esperado X recebido Y" não ajuda ninguém.
function primeiraDiferenca(a: string, b: string): string {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const ver = (s: string) =>
        JSON.stringify(s.slice(Math.max(0, i - 20), i + 20))
      return `pos ${i}: esperado ${ver(a)} recebido ${ver(b)}`
    }
  }
  return a.length === b.length ? 'iguais' : `comprimento: ${a.length} vs ${b.length}`
}

console.log('--- os oito vetores válidos ---')
for (const vetor of VETORES) {
  const rotulo = vetor.nome.split(' —')[0]
  const produzido = montarCanonicoRetorno(vetor.entrada as EntradaRetorno)

  checa(
    `${rotulo} texto`,
    produzido === vetor.canonico,
    produzido === vetor.canonico ? '' : primeiraDiferenca(vetor.canonico, produzido)
  )
  checa(
    `${rotulo} bytes UTF-8`,
    Buffer.byteLength(produzido, 'utf8') === vetor.bytes,
    `${Buffer.byteLength(produzido, 'utf8')} esperado ${vetor.bytes}`
  )
  checa(
    `${rotulo} sha256`,
    createHash('sha256').update(produzido, 'utf8').digest('hex') === vetor.sha256
  )
}

console.log('\n--- os doze vetores de rejeição ---')
for (const vetor of VETORES_INVALIDOS) {
  const rotulo = vetor.nome.split(' —')[0]
  const motivo = validarRetorno(vetor.entrada as EntradaRetorno)
  checa(
    `${rotulo} recusado por "${vetor.motivo}"`,
    motivo === vetor.motivo,
    motivo === vetor.motivo ? '' : `recusou por "${motivo}"`
  )

  // E o caminho completo tem que levantar, não devolver bytes: uma
  // entrada inválida que produzisse canônico viraria documento assinado.
  let levantou: unknown = null
  try {
    montarCanonicoRetorno(vetor.entrada as EntradaRetorno)
  } catch (e) {
    levantou = e
  }
  checa(
    `${rotulo} montar levanta RetornoInvalido`,
    levantou instanceof RetornoInvalido && levantou.motivo === vetor.motivo
  )
}

console.log('\n--- propriedades que vetor nenhum cobre sozinho ---')

// DETERMINISMO: a mesma entrada, duas vezes, os mesmos bytes.
checa(
  'determinístico',
  VETORES.every(
    (v) =>
      montarCanonicoRetorno(v.entrada as EntradaRetorno) ===
      montarCanonicoRetorno(v.entrada as EntradaRetorno)
  )
)

// ORDEM DA ENTRADA NÃO IMPORTA. O V006 já testa uma permutação; aqui a
// propriedade é exercitada sobre todos: inverter vales e pagamentos tem
// que dar exatamente os mesmos bytes.
for (const vetor of VETORES) {
  const entrada = vetor.entrada as EntradaRetorno
  const invertida: EntradaRetorno = {
    ...entrada,
    vales: [...entrada.vales]
      .reverse()
      .map((v) => ({ ...v, pagamentosRealizados: [...v.pagamentosRealizados].reverse() })),
  }
  checa(
    `${vetor.nome.split(' —')[0]} invariante à ordem da entrada`,
    montarCanonicoRetorno(invertida) === vetor.canonico
  )
}

// A ARMADILHA DO `||`: string vazia não pode virar '-'. O V007 cobre no
// detalhe; aqui a propriedade fica explícita, porque é o erro que uma
// reescrita distraída reintroduz.
{
  const comVazio: EntradaRetorno = {
    saidaRomaneioId: '019fe83f-1d58-70e9-8dd8-0000000000a1',
    saidaDocumentHash: 'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
    motoboyId: '019fe83f-1d58-70e9-8dd8-0000000000b1',
    responsavelId: '019fe83f-1d58-70e9-8dd8-0000000000c1',
    vales: [
      {
        entregaId: '019fe83f-1d58-70e9-8dd8-0000000000e1',
        desfecho: 'insucesso',
        motivo: 'ausente',
        detalhe: '',
        pagamentosRealizados: [],
      },
    ],
  }
  const linha = montarCanonicoRetorno(comVazio).split('\n').at(-1)!
  checa('string vazia termina a linha em TAB, não vira "-"', linha.endsWith('\tausente\t'), linha.slice(-20))
}

// NORMALIZAR presume entrada válida, mas não pode ser onde a validação
// mora: chamá-lo direto com o lixo do V004 tem que dar o mesmo resultado
// que o caminho completo. Se a normalização vivesse dentro do validador,
// isto quebraria.
{
  const v004 = VETORES.find((v) => v.nome.startsWith('V004'))!
  checa(
    'normalizar+serializar sozinhos dão o mesmo que montar',
    serializarRetorno(normalizarRetorno(v004.entrada as EntradaRetorno)) === v004.canonico
  )
}

// UUID EM MAIÚSCULA é normalizado, não recusado — `uuid::text` do
// Postgres sai minúsculo, então o lado TS tem que baixar a caixa pra os
// dois baterem.
{
  const v001 = VETORES.find((v) => v.nome.startsWith('V001'))!
  const entrada = v001.entrada as EntradaRetorno
  const maiuscula: EntradaRetorno = {
    ...entrada,
    saidaRomaneioId: entrada.saidaRomaneioId.toUpperCase(),
    motoboyId: entrada.motoboyId.toUpperCase(),
    vales: entrada.vales.map((v) => ({
      ...v,
      entregaId: v.entregaId.toUpperCase(),
      pagamentosRealizados: v.pagamentosRealizados.map((p) => ({
        ...p,
        pagamentoId: p.pagamentoId.toUpperCase(),
      })),
    })),
  }
  checa('uuid em maiúscula é normalizado pra minúscula', montarCanonicoRetorno(maiuscula) === v001.canonico)
}

// =====================================================================
// O PAYLOAD LEVA TUDO QUE O CANÔNICO ASSINA
//
// Esta seção existe por causa de um defeito real, em 2026-08-20:
// `paraJsonbRetorno` ficou sem o campo `documentos` depois de o bloco
// `d` entrar no canônico. O TypeScript compilava, os 102 casos deste
// spec passavam, e mesmo assim a tela teria ASSINADO UMA COISA E
// MANDADO OUTRA — o servidor reconstrói o DCRR1 do que recebe, chega
// noutro hash e recusa `documento_alterado` depois das duas assinaturas.
//
// Quem pegou foi a conferência contra o banco. Isto aqui é pra o
// próximo campo novo não precisar do banco pra ser pego.
//
// A checagem é de CONTAGEM e não de forma: cada linha assinada tem que
// ter um item correspondente no payload enviado. Comparar objeto com
// objeto exigiria uma segunda tradução — e duas traduções da mesma
// coisa é o defeito que este projeto persegue desde o canônico.
// =====================================================================
console.log('\n--- paraJsonbRetorno leva tudo que o canônico assina ---')
for (const vetor of VETORES) {
  const enviado = paraJsonbRetorno(vetor.entrada) as Array<Record<string, unknown>>
  const linhas = vetor.canonico.split('\n')
  const conta = (prefixo: string) => linhas.filter((l) => l.startsWith(prefixo + '\t')).length
  const somar = (campo: string) =>
    enviado.reduce((n, v) => n + ((v[campo] as unknown[]) ?? []).length, 0)

  const nome = vetor.nome.split(' —')[0]
  checa(`${nome}: um vale enviado por linha v`, enviado.length === conta('v'))
  checa(`${nome}: um pagamento enviado por linha pr`, somar('pagamentos_realizados') === conta('pr'))
  checa(`${nome}: um documento enviado por linha d`, somar('documentos') === conta('d'))
}
// E a recíproca, que é o que teria pego o defeito na hora: nenhum vale
// do payload pode sair sem uma chave que o canônico lê. Contagem sozinha
// passaria se AMBOS os lados estivessem vazios.
{
  const comTudo = VETORES.find((v) =>
    v.entrada.vales.some((x) => x.documentos.length > 0 && x.pagamentosRealizados.length > 0)
  )
  const vale = (paraJsonbRetorno(comTudo!.entrada) as Array<Record<string, unknown>>)[0]
  for (const chave of ['entrega_id', 'desfecho', 'motivo', 'detalhe', 'pagamentos_realizados', 'documentos']) {
    checa(`payload tem a chave "${chave}"`, chave in vale)
  }
}

console.log(`\n${falhas === 0 ? 'canônico do retorno ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
