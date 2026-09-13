// Segunda (e última) peça de servidor do projeto. Existe por um motivo
// só: a chave privada que abre o envelope do PIN não pode ir pro
// navegador — se fosse, o envelope não protegeria nada.
//
// O que ela faz, nesta ordem:
//   1. confere o JWT de quem está sincronizando
//   2. confere que é o MESMO usuário que registrou a saída offline
//   3. abre o envelope com a chave privada do key_id
//   4. confere que o payload público não mudou desde que foi assinado
//   5. chama a transação atômica com service_role
//
// Nada do corpo do request é confiado pra decidir identidade. O
// `p_caixa_id` que vai pro banco sai do JWT validado aqui, nunca do body
// — mesma regra da função criar-usuario.
//
// Deploy (não há CLI do Supabase configurada neste projeto): dashboard →
// Edge Functions → Deploy a new function → Via Editor, nome
// `sync-romaneio`.
//
// Secret necessário: ROMANEIO_KEYS, um JSON de key_id -> chave privada
// pkcs8 em base64. Gerado por scripts/gerar-chaves-offline.mjs. Ao
// rotacionar, MANTENHA a chave antiga junto da nova enquanto houver saída
// offline pendente — sem ela, o que foi selado antes da troca não abre.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

// GÊMEA de `calcularOfflineEventHashSaidaV2` em src/lib/envelope.ts — o
// hash do evento offline da SAÍDA, versão 2 (4B). Sem traço e sem
// geolocalização; com o modo de validação, o motivo e o motoboy. Os tipos
// são primitivos nos dois arquivos de propósito, pra o spec conseguir
// extrair este texto e compilá-lo sozinho. Mexeu numa, mexe na outra.
//
// A versão 1 (com traços e geolocalização) saiu dos dois lados em
// 2026-09-12, quando o retorno também passou à versão 2.
// `scripts/offline-hash-v2.spec.mts` confere as gêmeas contra digests
// congelados antes de qualquer uma existir.
async function calcularOfflineEventHashSaidaV2(entrada: {
  documentHash: string
  romaneioId: string
  validacao: string
  motivoExcecao: string | null
  motoboyId: string
  ocorridoEmLocal: string
}): Promise<string> {
  const partes = [
    'OEV2',
    entrada.documentHash,
    entrada.romaneioId.toLowerCase(),
    'saida',
    entrada.validacao,
    entrada.motivoExcecao ?? '-',
    entrada.motoboyId.toLowerCase(),
    entrada.ocorridoEmLocal,
  ]
  const bytes = new TextEncoder().encode(partes.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// GÊMEA de `calcularOfflineEventHashRetornoV2` em src/lib/envelope.ts — o
// hash do evento offline do RETORNO, versão 2. A mesma forma da saída, com
// `retorno` no quarto campo; função própria para não reabrir a da saída,
// que já está publicada e congelada.
async function calcularOfflineEventHashRetornoV2(entrada: {
  documentHash: string
  romaneioId: string
  validacao: string
  motivoExcecao: string | null
  motoboyId: string
  ocorridoEmLocal: string
}): Promise<string> {
  const partes = [
    'OEV2',
    entrada.documentHash,
    entrada.romaneioId.toLowerCase(),
    'retorno',
    entrada.validacao,
    entrada.motivoExcecao ?? '-',
    entrada.motoboyId.toLowerCase(),
    entrada.ocorridoEmLocal,
  ]
  const bytes = new TextEncoder().encode(partes.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Envelope = { v: number; keyId: string; k: string; iv: string; ct: string }

type Segredos = {
  pin: string
  credentialToken: string
  operationId: string
  documentHash: string
  offlineEventHash: string
  // Entrou na 2C.5, DENTRO do envelope. Ver `resolverTipoDoRomaneio`.
  tipo?: string
  // Entraram no 4B, também DENTRO do envelope — primeiro na saída, depois
  // no retorno: quem validou (o motoboy ou o gerente no lugar dele) e por
  // quê. O corpo declara os mesmos dois em claro, e a conferência abaixo
  // exige que concordem.
  validacao?: string
  motivoExcecao?: string | null
}

/**
 * Qual documento o envelope autoriza — lido de DENTRO dele, depois de
 * decifrado, e por isso não falsificável pelo cliente.
 *
 * **AUSÊNCIA DEIXOU DE SIGNIFICAR `saida` em 2026-08-25.**
 *
 * Ela significava, e por um bom motivo: todo envelope selado antes da
 * 2C.5 é de saída por construção — o retorno não existia —, e sem a
 * regra toda saída offline parada numa fila deixaria de sincronizar no
 * dia do deploy.
 *
 * O corte para a V1 tirou o objeto dessa regra: o Supabase é zerado e a
 * Dexie v7 apaga a fila local dos terminais, então não existe envelope
 * antigo em lugar nenhum. Mantê-la seria carregar permissividade
 * permanente por causa de dados que nunca vão existir — e permissividade
 * num campo que decide QUAL PORTA de selagem será usada é o tipo de
 * folga que se paga caro uma vez.
 *
 * Agora ausência é recusa, igual a valor desconhecido. As três respostas
 * possíveis viraram duas: **é isto, ou não passa.**
 */
function resolverTipoDoRomaneio(segredos: Segredos): 'saida' | 'retorno' | null {
  if (segredos.tipo === 'saida') return 'saida'
  if (segredos.tipo === 'retorno') return 'retorno'
  return null
}

/**
 * O tipo declarado no CORPO — em claro, e portanto não confiável sozinho.
 * Mesma regra do envelope: desde a V1, ausência é recusa.
 */
function resolverTipoDoBody(corpo: Record<string, unknown>): 'saida' | 'retorno' | null {
  const tipo = corpo.tipo
  if (tipo === 'saida') return 'saida'
  if (tipo === 'retorno') return 'retorno'
  return null
}

/**
 * A MATRIZ, e ela cabe em uma igualdade.
 *
 * Os dois lados resolvem, e depois **têm que concordar**. Disso decorre
 * tudo:
 *
 *   body      envelope     resultado
 *   ────────────────────────────────────────────────────────────
 *   saida     saida        saída
 *   retorno   retorno      retorno
 *   saida     retorno      RECUSA
 *   retorno   saida        RECUSA
 *   ausente em qualquer lado       RECUSA
 *   desconhecido em qualquer lado  RECUSA
 *
 * **A matriz ENCOLHEU em 2026-08-25**, e encolher é o ponto: as quatro
 * linhas que aceitavam ausência sumiram junto com a compatibilidade
 * histórica, porque o corte para a V1 zera banco e fila local. Sobrou o
 * caso simétrico — os dois lados dizem a mesma coisa, explicitamente.
 *
 * **"Exige explícito nos dois lados" não é uma regra à parte** — é
 * consequência da igualdade e de ausência não resolver mais nada. Quem
 * ler procurando por um `if` que exige o valor não vai achar, e não está
 * faltando.
 *
 * ROLLOUT: `body = saida` com `envelope ausente` é REAL, não hipotético.
 * O envelope é selado na captura e guardado na fila; o corpo é montado
 * na hora de DRENAR, pelo código do dia. Um item capturado antes da 2C.5
 * carrega envelope sem tipo e vai ser drenado por um cliente que já
 * manda `tipo: 'saida'`. Recusá-lo travaria saídas reais já assinadas.
 *
 * O que essa frouxidão NÃO abre: nada em direção ao retorno. Ela só
 * permite que os dois lados concordem em `saida` por caminhos
 * diferentes.
 */
function conciliarTipos(
  doBody: 'saida' | 'retorno' | null,
  doEnvelope: 'saida' | 'retorno' | null,
  // Só pra DIAGNÓSTICO: distinguir "não veio" de "veio algo estranho".
  ausente?: { body: boolean; envelope: boolean }
): { tipo: 'saida' | 'retorno' } | { motivo: string; erro: string } {
  // AUSÊNCIA TEM MOTIVO PRÓPRIO, e a distinção paga no go-live.
  //
  // Até 25/08 ausência significava `saida`. Agora recusa — mas recusar
  // com `tipo_desconhecido` faria "cliente com bundle antigo, aba nunca
  // recarregada" parecer "corpo corrompido ou adulterado", e essas duas
  // pedem coisas opostas: a primeira é um F5 no terminal, a segunda é
  // investigar.
  //
  // É o caso mais provável do dia da virada, justamente porque zerar o
  // Supabase não fecha as abas que já estavam abertas.
  if (ausente && (ausente.body || ausente.envelope)) {
    const onde = ausente.body && ausente.envelope
      ? 'no corpo e no envelope'
      : ausente.body
        ? 'no corpo'
        : 'no envelope'
    return {
      motivo: 'tipo_ausente',
      erro:
        `O tipo do documento não veio ${onde}. Desde a V1 ele é obrigatório ` +
        'nos dois lados — provavelmente é um cliente antigo que ainda não ' +
        'recarregou a página.',
    }
  }
  if (doBody === null || doEnvelope === null) {
    return {
      motivo: 'tipo_desconhecido',
      erro: 'Tipo de documento que esta versão da função não conhece.',
    }
  }
  if (doBody !== doEnvelope) {
    return {
      motivo: 'tipo_divergente',
      erro:
        `O corpo diz "${doBody}" e o envelope diz "${doEnvelope}". ` +
        'O envelope é quem manda, e ele não foi selado para esta operação.',
    }
  }
  return { tipo: doBody }
}

async function abrirEnvelope(envelope: Envelope): Promise<Segredos> {
  const chaves = JSON.parse(Deno.env.get('ROMANEIO_KEYS') ?? '{}') as Record<string, string>
  const pkcs8 = chaves[envelope.keyId]
  if (!pkcs8) {
    // Caso clássico de rotação feita sem período de graça: a saída foi
    // selada com uma chave que já saiu do secret. A mensagem precisa
    // dizer isso, porque o conserto é devolver a chave antiga, não
    // mexer no app.
    throw new Error(
      `Nenhuma chave privada para key_id "${envelope.keyId}". Se a chave foi rotacionada, ` +
        `devolva a anterior ao secret ROMANEIO_KEYS enquanto houver saída offline pendente.`
    )
  }

  const privada = await crypto.subtle.importKey(
    'pkcs8',
    deBase64(pkcs8),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt']
  )

  const chaveAesCrua = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privada,
    deBase64(envelope.k)
  )
  const chaveAes = await crypto.subtle.importKey('raw', chaveAesCrua, { name: 'AES-GCM' }, false, [
    'decrypt',
  ])
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deBase64(envelope.iv) },
    chaveAes,
    deBase64(envelope.ct)
  )

  return JSON.parse(new TextDecoder().decode(claro)) as Segredos
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ error: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return responder({ error: 'Sem credencial.' }, 401)

  // 1. Quem está sincronizando?
  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: auth, error: authError } = await comoUsuario.auth.getUser()
  if (authError || !auth.user) return responder({ error: 'Credencial inválida.' }, 401)

  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return responder({ error: 'Corpo inválido.' }, 400)
  }

  // 2. A fila é de quem a criou.
  //
  // Este é o gate do §25, e ele mora AQUI e não na tela: a verificação no
  // cliente evita o acidente, esta evita o resto. O caixa A registra uma
  // saída offline, sai, o caixa B entra no mesmo PC — a saída de A não
  // pode ser selada em nome de B, nem por engano nem de propósito.
  const donoDaOperacao = String(corpo.userId ?? '')
  if (donoDaOperacao !== auth.user.id) {
    return responder(
      {
        error:
          'Esta saída offline foi registrada por outro usuário. Ela só sincroniza quando ' +
          'aquela conta entrar neste computador.',
        motivo: 'outro_usuario',
      },
      403
    )
  }

  // 3. Abre o envelope.
  let segredos: Segredos
  try {
    segredos = await abrirEnvelope(corpo.envelope as Envelope)
  } catch (e) {
    return responder({ error: `Não consegui abrir o envelope: ${e.message}`, motivo: 'envelope' }, 400)
  }

  // 3b. QUAL DOCUMENTO, DECIDIDO PELO ENVELOPE
  //
  // O corpo é em claro e sozinho não vale nada; o envelope o cliente não
  // consegue reabrir nem reescrever. Por isso a decisão é a CONCILIAÇÃO
  // dos dois, e não a leitura de um deles.
  const conciliado = conciliarTipos(
    resolverTipoDoBody(corpo),
    resolverTipoDoRomaneio(segredos),
    { body: corpo.tipo === undefined, envelope: segredos.tipo === undefined }
  )
  if ('motivo' in conciliado) {
    return responder({ error: conciliado.erro, motivo: conciliado.motivo }, 400)
  }
  const tipo = conciliado.tipo

  const romaneioId = String(corpo.romaneioId ?? '')
  const documentHash = String(corpo.documentHash ?? '')

  // 4. O envelope está amarrado a ESTA operação?
  //
  // O cliente não consegue reabrir nem reescrever o envelope, então
  // qualquer divergência aqui significa que o payload público foi
  // alterado depois de assinado — ou que alguém tentou reaproveitar um
  // envelope em outra saída.
  if (segredos.operationId.toLowerCase() !== romaneioId.toLowerCase()) {
    return responder({ error: 'Envelope pertence a outra operação.', motivo: 'envelope_trocado' }, 400)
  }
  if (segredos.documentHash !== documentHash) {
    return responder({ error: 'Envelope não corresponde a este documento.', motivo: 'envelope_trocado' }, 400)
  }

  // 4b. O QUE O CORPO TRAZ ALÉM DO DOCUMENTO — igual nos dois tipos desde
  // que o retorno chegou à versão 2 (4B): NENHUM traço; quem validou e por
  // quê.
  //
  // Traço em qualquer corpo é de um bundle anterior ao 4B. É TERMINAL, e
  // não retentável: o que falta está dentro de um envelope selado por
  // aquele bundle, e nenhuma versão nova consegue reabri-lo. O
  // procedimento de transição do 4B drena as filas antes justamente pra
  // isto não acontecer com operação de verdade.
  if (
    corpo.caixaStrokes !== undefined ||
    corpo.motoboyStrokes !== undefined ||
    corpo.responsavelStrokes !== undefined
  ) {
    return responder(
      { error: 'O romaneio não tem mais assinatura manuscrita. Esta operação é de uma versão anterior do app.',
        motivo: 'vocabulario_invalido' },
      400
    )
  }

  const validacaoDoCorpo = corpo.validacao
  const motivoDoCorpo = corpo.motivoExcecao ?? null

  // O DOMÍNIO, antes de comparar com o envelope: modo desconhecido, ou
  // motivo que não combina com o modo, é defeito de forma do corpo.
  const modoValido = validacaoDoCorpo === 'motoboy' || validacaoDoCorpo === 'gerente'
  const motivoCombina =
    validacaoDoCorpo === 'motoboy'
      ? motivoDoCorpo === null
      : motivoDoCorpo === 'cartao_perdido' || motivoDoCorpo === 'pin_esquecido'
  if (!modoValido || !motivoCombina) {
    return responder(
      { error: 'Modo de validação ou motivo da exceção inválido.', motivo: 'validacao_invalida' },
      400
    )
  }

  // E O ENVELOPE DECIDE. Trocar "motoboy" por "gerente" (ou um motivo
  // pelo outro) no caminho seria editar campo em claro; o que foi selado
  // no balcão não se reescreve.
  if (
    segredos.validacao !== validacaoDoCorpo ||
    (segredos.motivoExcecao ?? null) !== motivoDoCorpo
  ) {
    return responder(
      { error: 'O modo de validação não corresponde ao que foi selado no balcão.',
        motivo: 'validacao_divergente' },
      400
    )
  }

  const hashRecalculado =
    tipo === 'retorno'
      ? await calcularOfflineEventHashRetornoV2({
          documentHash,
          romaneioId,
          validacao: String(validacaoDoCorpo),
          motivoExcecao: motivoDoCorpo as string | null,
          motoboyId: String(corpo.motoboyId ?? ''),
          ocorridoEmLocal: String(corpo.ocorridoEmLocal ?? ''),
        })
      : await calcularOfflineEventHashSaidaV2({
          documentHash,
          romaneioId,
          validacao: String(validacaoDoCorpo),
          motivoExcecao: motivoDoCorpo as string | null,
          motoboyId: String(corpo.motoboyId ?? ''),
          ocorridoEmLocal: String(corpo.ocorridoEmLocal ?? ''),
        })
  if (hashRecalculado !== segredos.offlineEventHash) {
    return responder(
      { error: 'O conteúdo do romaneio mudou depois de assinado.', motivo: 'payload_alterado' },
      400
    )
  }

  // 5. A transação. O IP vem do cabeçalho da requisição, nunca do corpo.
  //
  // O DESPACHO ACONTECE AQUI, e só aqui: depois de o dono ter sido
  // conferido contra o JWT, do envelope ter aberto, do tipo ter sido
  // CONCILIADO entre corpo e envelope, do `operationId` e do
  // `documentHash` baterem, e do `offlineEventHash` ter sido recalculado.
  //
  // Primeiro se prova o envelope, depois se escolhe a porta. O inverso —
  // despachar por `corpo.tipo` e descobrir lá dentro se o envelope
  // concordava — faria a amarração ser diagnóstico posterior em vez de
  // condição de entrada.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

  const comoServico = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } =
    tipo === 'retorno'
      ? await comoServico.rpc('selar_romaneio_retorno_sincronizado', {
          // A identidade sai do JWT, nunca do corpo — é o que torna
          // `papel_no_momento` registro de auditoria e não afirmação do
          // cliente. E não há `p_loja_id`: a loja vem do romaneio de
          // saída selado, então payload nenhum opina.
          p_responsavel_id: auth.user.id,
          p_romaneio_id: romaneioId,
          p_saida_romaneio_id: corpo.saidaRomaneioId,
          p_saida_document_hash: corpo.saidaDocumentHash,
          p_motoboy_id: corpo.motoboyId,
          p_retorno: corpo.retornoJsonb,
          p_document_hash: documentHash,
          p_token: segredos.credentialToken,
          p_pin: segredos.pin,
          p_ocorrido_em_local: corpo.ocorridoEmLocal,
          p_ip: ip,
          p_geolocalizacao: null,
          // Os dois já conferidos contra o envelope, lá em cima. O SQL
          // confere de novo contra o cartão que de fato autenticou, e
          // confere o gerente contra a filial da SAÍDA.
          p_validacao: validacaoDoCorpo,
          p_motivo: motivoDoCorpo,
        })
      : await comoServico.rpc('selar_romaneio_sincronizado', {
          p_caixa_id: auth.user.id,
          p_romaneio_id: romaneioId,
          p_corrida_id: corpo.corridaId,
          p_loja_id: corpo.lojaId,
          p_agencia_id: corpo.agenciaId ?? null,
          p_motoboy_id: corpo.motoboyId,
          p_entrega_ids: corpo.entregaIds,
          p_document_hash: documentHash,
          p_token: segredos.credentialToken,
          p_pin: segredos.pin,
          p_ocorrido_em_local: corpo.ocorridoEmLocal,
          p_ip: ip,
          p_geolocalizacao: null,
          // Os dois já conferidos contra o envelope, lá em cima. O SQL
          // confere de novo contra o cartão que de fato autenticou.
          p_validacao: validacaoDoCorpo,
          p_motivo: motivoDoCorpo,
        })

  if (error) return responder({ error: error.message }, 400)

  // O PIN e o token saem de escopo aqui e nunca foram gravados,
  // registrados nem devolvidos. O que volta é o resultado do selo.
  return responder(data)
})
