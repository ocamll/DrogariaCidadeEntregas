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

// Espelho de `calcularOfflineEventHash` em src/lib/envelope.ts. As duas
// são TypeScript, então o risco de divergência é bem menor que o do
// canônico do romaneio (TypeScript contra SQL) — mas mexeu numa, mexe na
// outra. Ordem dos campos e separador fazem parte do contrato.
// OS NOMES DOS PARÂMETROS SÃO NEUTROS DESDE A 2C.5, e a fórmula NÃO
// mudou um byte — ela concatena VALORES, não chaves.
//
//     saída:   caixaStrokes       ┐
//     retorno: responsavelStrokes ┴→ assinaturaInternaStrokes
//
// Renomear no FIO seria quebra (corpos já gravados dizem caixaStrokes);
// renomear aqui dentro não é. E o nome antigo mentiria no retorno, onde
// quem assina é o responsável da loja e pode ser gerente ou admin — a
// armadilha do tipo_signatario outra vez.
//
// O spec do envelope congela três hashes calculados ANTES deste
// refactor e exige que continuem idênticos. A intenção era "só renomeei
// parâmetro"; a asserção é quem prova.
async function calcularOfflineEventHash(entrada: {
  documentHash: string
  romaneioId: string
  assinaturaInternaStrokes: unknown
  assinaturaMotoboyStrokes: unknown
  ocorridoEmLocal: string
  geolocalizacao: unknown | null
}): Promise<string> {
  const partes = [
    entrada.documentHash,
    entrada.romaneioId.toLowerCase(),
    JSON.stringify(entrada.assinaturaInternaStrokes),
    JSON.stringify(entrada.assinaturaMotoboyStrokes),
    entrada.ocorridoEmLocal,
    entrada.geolocalizacao === null ? '-' : JSON.stringify(entrada.geolocalizacao),
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
}

/**
 * Qual documento o envelope autoriza — lido de DENTRO dele, depois de
 * decifrado, e por isso não falsificável pelo cliente.
 *
 * **Ausente = `saida`, e isso é compatibilidade histórica exclusiva.**
 * Todo envelope selado antes da 2C.5 é de saída por construção: o
 * retorno não existia. Sem essa regra, toda saída offline parada numa
 * fila deixaria de sincronizar no dia do deploy.
 *
 * Ela NÃO é permissividade pra operação nova: o retorno exige o valor
 * explícito. Valor desconhecido é recusado em vez de virar saída por
 * omissão — "não reconheço" e "é uma saída" são coisas diferentes, e
 * tratá-las igual é como uma versão futura passaria despercebida por
 * esta aqui.
 */
function resolverTipoDoRomaneio(segredos: Segredos): 'saida' | 'retorno' | null {
  if (segredos.tipo === undefined || segredos.tipo === 'saida') return 'saida'
  if (segredos.tipo === 'retorno') return 'retorno'
  return null
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

  // 3b. QUAL DOCUMENTO ESTE ENVELOPE AUTORIZA
  //
  // Esta versão só sabe executar SAÍDA. Um envelope que diga `retorno` é
  // RECONHECIDO e recusado explicitamente — nunca tratado como saída.
  //
  // Tratá-lo como saída seria o pior desfecho possível: `corpo.entregaIds`
  // viria vazio ou de outro documento, e `selar_romaneio_sincronizado`
  // criaria uma corrida errada ou um conflito, a partir de um envelope
  // que dizia outra coisa. Recusar é o temporário seguro até a 2C.6, que
  // é quem passa a despachar por tipo.
  const tipoDoEnvelope = resolverTipoDoRomaneio(segredos)
  if (tipoDoEnvelope === null) {
    return responder(
      { error: 'Envelope de um tipo de documento que esta versão não conhece.',
        motivo: 'tipo_desconhecido' },
      400
    )
  }
  if (tipoDoEnvelope === 'retorno') {
    return responder(
      { error: 'Romaneio de retorno ainda não é sincronizado por esta versão da função. ' +
          'A operação continua na fila.',
        motivo: 'retorno_nao_suportado' },
      501
    )
  }

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

  const hashRecalculado = await calcularOfflineEventHash({
    documentHash,
    romaneioId,
    // O FIO continua dizendo caixaStrokes — corpos já gravados dizem
    // isso, e renomear no fio seria quebra. O nome NEUTRO é só do
    // parâmetro. Na 2C.6, o retorno manda responsavelStrokes e é aqui
    // que os dois convergem.
    assinaturaInternaStrokes: corpo.caixaStrokes,
    assinaturaMotoboyStrokes: corpo.motoboyStrokes,
    ocorridoEmLocal: String(corpo.ocorridoEmLocal ?? ''),
    geolocalizacao: corpo.geolocalizacao ?? null,
  })
  if (hashRecalculado !== segredos.offlineEventHash) {
    return responder(
      { error: 'O conteúdo da saída mudou depois de assinado.', motivo: 'payload_alterado' },
      400
    )
  }

  // 5. A transação. O IP vem do cabeçalho da requisição, nunca do corpo.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

  const comoServico = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await comoServico.rpc('selar_romaneio_sincronizado', {
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
    p_caixa_strokes: corpo.caixaStrokes,
    p_motoboy_strokes: corpo.motoboyStrokes,
    p_ocorrido_em_local: corpo.ocorridoEmLocal,
    p_ip: ip,
    p_geolocalizacao: corpo.geolocalizacao ?? null,
  })

  if (error) return responder({ error: error.message }, 400)

  // O PIN e o token saem de escopo aqui e nunca foram gravados,
  // registrados nem devolvidos. O que volta é o resultado do selo.
  return responder(data)
})
