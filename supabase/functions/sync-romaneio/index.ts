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

/**
 * O tipo declarado no CORPO — em claro, e portanto não confiável sozinho.
 * Mesma regra de ausência do envelope, pelo mesmo motivo histórico.
 */
function resolverTipoDoBody(corpo: Record<string, unknown>): 'saida' | 'retorno' | null {
  const tipo = corpo.tipo
  if (tipo === undefined || tipo === 'saida') return 'saida'
  if (tipo === 'retorno') return 'retorno'
  return null
}

/**
 * A MATRIZ DE COMPATIBILIDADE, e ela cabe em uma igualdade.
 *
 * Os dois lados resolvem ausência como `saida` (compatibilidade
 * histórica), e depois **têm que concordar**. Disso decorre tudo:
 *
 *   body      envelope     resultado
 *   ────────────────────────────────────────────────────────────
 *   ausente   ausente      saída legado, o que já rodava
 *   saida     ausente      saída — ver ROLLOUT abaixo
 *   ausente   saida        saída
 *   saida     saida        saída
 *   retorno   retorno      retorno
 *   retorno   ausente      RECUSA  (envelope resolve saida ≠ retorno)
 *   ausente   retorno      RECUSA
 *   saida     retorno      RECUSA
 *   retorno   saida        RECUSA
 *   desconhecido em qualquer lado  RECUSA
 *
 * **"Retorno exige explícito nos dois lados" não é uma regra à parte** —
 * é consequência da igualdade, já que ausência nunca resolve `retorno`.
 * Quem ler procurando por um `if` que exige o valor explícito não vai
 * achar, e não está faltando.
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
  doEnvelope: 'saida' | 'retorno' | null
): { tipo: 'saida' | 'retorno' } | { motivo: string; erro: string } {
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
  const conciliado = conciliarTipos(resolverTipoDoBody(corpo), resolverTipoDoRomaneio(segredos))
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

  // 4b. OS TRAÇOS, e o vocabulário é RÍGIDO por tipo.
  //
  //     saída:   caixaStrokes         (o fio histórico, e assim fica)
  //     retorno: responsavelStrokes   (nome novo, sem fallback)
  //
  // Não existe `romaneio_retorno` antigo em fila nenhuma, então aceitar
  // `caixaStrokes` num retorno seria criar hoje compatibilidade com um
  // formato que nunca existiu — e perpetuar um nome que mente sobre quem
  // assinou, que é a armadilha do `tipo_signatario` de novo.
  //
  // Os dois convergem em `assinaturaInternaStrokes` antes do hash,
  // exatamente como no cliente. A fórmula não sabe de vocabulário.
  const assinaturaInternaStrokes =
    tipo === 'retorno' ? corpo.responsavelStrokes : corpo.caixaStrokes

  if (tipo === 'retorno' && corpo.responsavelStrokes === undefined) {
    return responder(
      { error: 'Retorno exige `responsavelStrokes`.', motivo: 'vocabulario_invalido' },
      400
    )
  }
  // E RECUSA, não ignora. Ler `responsavelStrokes` e deixar um
  // `caixaStrokes` perdido passar seria aceitar em silêncio um corpo que
  // não sabe qual protocolo está falando — e o campo ignorado viraria a
  // pista falsa de quem for depurar por que o hash não fechou.
  if (tipo === 'retorno' && corpo.caixaStrokes !== undefined) {
    return responder(
      { error: '`caixaStrokes` não existe no protocolo do retorno. Use `responsavelStrokes`.',
        motivo: 'vocabulario_invalido' },
      400
    )
  }
  if (tipo === 'saida' && corpo.responsavelStrokes !== undefined) {
    return responder(
      { error: '`responsavelStrokes` não existe no protocolo da saída. Use `caixaStrokes`.',
        motivo: 'vocabulario_invalido' },
      400
    )
  }

  const hashRecalculado = await calcularOfflineEventHash({
    documentHash,
    romaneioId,
    assinaturaInternaStrokes,
    assinaturaMotoboyStrokes: corpo.motoboyStrokes,
    ocorridoEmLocal: String(corpo.ocorridoEmLocal ?? ''),
    geolocalizacao: corpo.geolocalizacao ?? null,
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
          p_responsavel_strokes: corpo.responsavelStrokes,
          p_motoboy_strokes: corpo.motoboyStrokes,
          p_ocorrido_em_local: corpo.ocorridoEmLocal,
          p_ip: ip,
          p_geolocalizacao: corpo.geolocalizacao ?? null,
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
