// Os romaneios em PDF — o de saída e o de retorno.
//
// A REGRA QUE GOVERNA ESTE ARQUIVO INTEIRO
//
// **Ele é montado do SNAPSHOT, nunca do dado vigente.** Os vales saem de
// `romaneios.payload`, que é o que foi congelado no instante da selagem —
// não da tabela `entregas`, que pode ter mudado desde então.
//
// Isso é a regra 7 do CLAUDE.md aplicada: o documento assinado não muda.
// Se um endereço foi corrigido depois, o PDF continua mostrando o que o
// motoboy assinou, e a correção aparece como EVENTO POSTERIOR — nunca
// reescrevendo o corpo do documento. Gerar do dado vivo pareceria
// funcionar perfeitamente e destruiria o sentido do romaneio: um relatório
// afirmaria que o motoboy recebeu um endereço que ele nunca recebeu.
//
// Por isso o `payload` é a fonte, e o único uso de dado atual é para
// coisas que NÃO estavam no documento — nomes de exibição e os relógios
// da corrida, que descrevem o que aconteceu depois.
//
// DOIS DOCUMENTOS (desde 2026-09-13)
//
// `montarRomaneioPdf` escolhe o layout pelo `tipo`. O retorno não tem
// endereço nem valores de compra e entrega — o DCRR1 assina só o que
// ACRESCENTA —, e desenhá-lo com o layout da saída imprimia `R$ NaN`. O que é
// comum aos dois (faixa da marca, evidências e rodapé) mora em funções
// próprias, para os dois não contarem histórias diferentes.
//
// DUAS VIAS
//
// `farmacia` leva tudo. `agencia` omite o que é dado comercial da farmácia:
// na saída, o **valor da compra** (decidido em 2026-08-18); no retorno, pela
// mesma razão, **como o cliente pagou**. A agência precisa saber o que foi
// entregue e que papel voltou, não quanto o cliente pagou nem em que forma.
//
// O PDF NUNCA É FONTE DA VERDADE
//
// Ele é uma renderização do que está no banco. O `final_hash` impresso é
// o que permite conferir o documento contra o registro; o PDF em si não
// prova nada sozinho, e não deve ser tratado como se provasse.

import type { AssinaturaDoRomaneio, RomaneioCompleto } from '@/data/romaneios'
import { formatBRL } from '@/lib/money'
import { carregarImagemDaMarca, LOGO_DOCUMENTO_URL, LOGO_PROPORCAO, COR_MARCA } from '@/lib/marca'
import { duracaoDaCorrida } from '@/lib/datas'
import { rotuloDoPapelNoMomento } from '@/lib/papeis'
import { MOTIVO_EXCECAO_LABEL } from './excecaoDoGerente'
import {
  lerRetorno,
  textoDoDesfecho,
  textoDoDocumento,
  textoDoPagamentoRealizado,
} from './documentoDoRetorno'

export type ViaDoRomaneio = 'farmacia' | 'agencia'

// O que foi congelado no selo. Espelha `romaneio_payload` no SQL.
type ValeDoSnapshot = {
  entrega_id: string
  numero_vale: string
  tipo: 'cliente' | 'transferencia'
  cliente_nome: string
  cliente_endereco: string
  quantidade_vales: number
  valor_compra_cents: number
  valor_entrega_cents: number
  entrega_paga_cliente_cents: number
}

export type CorrecaoPosterior = {
  quando: string
  autor: string | null
  resumo: string
}

function valesDoSnapshot(payload: unknown): ValeDoSnapshot[] {
  if (!payload || typeof payload !== 'object') return []
  const vales = (payload as { vales?: unknown }).vales
  return Array.isArray(vales) ? (vales as ValeDoSnapshot[]) : []
}

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR') : null

// Diferença entre retirada e retorno, que é o insumo do relatório de
// tempo médio. Sai do relógio do SERVIDOR nos dois lados: misturar
// servidor com dispositivo daria uma duração que não aconteceu.
// `duracaoDaCorrida` mudou de casa para `lib/datas.ts` quando a PÁGINA do
// romaneio passou a mostrar os relógios: importar ESTE módulo só pela
// duração puxaria o gerador de PDF pro bundle principal.
//
// Reexportada daqui pra nenhum call site nem o spec precisarem mudar — e
// importada logo acima, porque o PDF também a usa e reexportar não traz o
// nome pro escopo local.
export { duracaoDaCorrida }

const M = 15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AutoTable = (doc: Doc, opcoes: any) => void

const ESTILO_TABELA = {
  theme: 'grid',
  styles: { fontSize: 8, cellPadding: 1.6, textColor: 20 },
  headStyles: { fillColor: [201, 20, 26], textColor: 255, fontStyle: 'bold' },
  footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold' },
  margin: { left: M, right: M },
} as const

export async function montarRomaneioPdf(
  romaneio: RomaneioCompleto,
  via: ViaDoRomaneio,
  correcoes: CorrecaoPosterior[] = []
): Promise<ArrayBuffer> {
  // Import dinâmico + optimizeDeps, como manda a convenção.
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default as unknown as AutoTable
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })

  if (romaneio.tipo === 'retorno') {
    await desenharRetorno(doc, autoTable, romaneio, via)
  } else {
    await desenharSaida(doc, autoTable, romaneio, via, correcoes)
  }
  return doc.output('arraybuffer')
}

// =====================================================================
// A SAÍDA
// =====================================================================

async function desenharSaida(
  doc: Doc,
  autoTable: AutoTable,
  romaneio: RomaneioCompleto,
  via: ViaDoRomaneio,
  correcoes: CorrecaoPosterior[]
): Promise<void> {
  const farmacia = romaneio.assinaturas.find((a) => a.tipoSignatario !== 'motoboy')
  const motoboy = romaneio.assinaturas.find((a) => a.tipoSignatario === 'motoboy')
  const vales = valesDoSnapshot(romaneio.payload)
  const mostrarCompra = via === 'farmacia'

  let y = await desenharCabecalho(doc, 'Romaneio de saída', romaneio, via)

  // ---------------- quem e quando ----------------
  y = desenharCampos(doc, y, [
    ['Motoboy', motoboy?.nome ?? null],
    ['Agência', motoboy?.agenciaNome ?? null],
    // "Pela farmácia", não "Caixa": `tipo_signatario = 'caixa'` é o nome
    // do SLOT (o lado da farmácia) e está dentro do hash — o sistema não
    // impõe que quem sela a saída seja um caixa, e um admin selando
    // aparecia aqui como "Caixa". O cargo real vai no bloco da
    // assinatura, vindo de `papel_no_momento`.
    ['Pela farmácia', farmacia?.nome ?? romaneio.criadoPorNome],
    ['Retirada', dataHora(romaneio.corrida?.saidaEm) ?? dataHora(romaneio.ocorridoEmLocal)],
    ['Retorno', dataHora(romaneio.corrida?.retornoEm)],
    [
      'Duração',
      duracaoDaCorrida(romaneio.corrida?.saidaEm ?? null, romaneio.corrida?.retornoEm ?? null),
    ],
    ['Selado em', dataHora(romaneio.seladoEm)],
  ])

  // A corrida ainda aberta é um fato do documento, não uma omissão.
  if (!romaneio.corrida?.retornoEm) {
    y = desenharCampos(doc, y, [['Retorno', 'corrida ainda aberta']])
  }
  y += 3

  // ---------------- os vales, como foram assinados ----------------
  const cabecalho = mostrarCompra
    ? ['Vale', 'Cliente / endereço', 'Vales', 'Compra', 'Entrega']
    : ['Vale', 'Cliente / endereço', 'Vales', 'Entrega']

  const corpo = vales.map((v) => {
    const quem =
      v.tipo === 'transferencia'
        ? `Transferência — ${v.cliente_endereco}`
        : `${v.cliente_nome}\n${v.cliente_endereco}`
    const base = [v.numero_vale, quem, String(v.quantidade_vales)]
    return mostrarCompra
      ? [...base, formatBRL(v.valor_compra_cents), formatBRL(v.valor_entrega_cents)]
      : [...base, formatBRL(v.valor_entrega_cents)]
  })

  const totalEntrega = vales.reduce((s, v) => s + v.valor_entrega_cents, 0)
  const totalVales = vales.reduce((s, v) => s + v.quantidade_vales, 0)
  const rodape = mostrarCompra
    ? [
        '',
        `${vales.length} vale(s)`,
        String(totalVales),
        formatBRL(vales.reduce((s, v) => s + v.valor_compra_cents, 0)),
        formatBRL(totalEntrega),
      ]
    : ['', `${vales.length} vale(s)`, String(totalVales), formatBRL(totalEntrega)]

  autoTable(doc, { ...ESTILO_TABELA, startY: y, head: [cabecalho], body: corpo, foot: [rodape] })
  y = doc.lastAutoTable.finalY + 7

  // ---------------- correções posteriores ----------------
  //
  // Aparecem SEPARADAS do corpo, e é o ponto todo: o documento continua
  // dizendo o que foi assinado, e o que mudou depois fica visível sem
  // reescrevê-lo.
  if (correcoes.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Correções posteriores à assinatura', M, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text('O documento acima não muda. O que segue aconteceu depois de assinado.', M, y)
    doc.setTextColor(0)
    y += 5

    autoTable(doc, {
      startY: y,
      head: [['Quando', 'Quem', 'O que mudou']],
      body: correcoes.map((c) => [dataHora(c.quando) ?? '', c.autor ?? '—', c.resumo]),
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fontStyle: 'bold', textColor: 90 },
      margin: { left: M, right: M },
    })
    y = doc.lastAutoTable.finalY + 7
  }

  y = desenharEvidencias(doc, y, farmacia, motoboy)
  desenharRodape(doc, y, romaneio)
}

// =====================================================================
// O RETORNO
//
// Sai de `lerRetorno`, a MESMA leitura da página: desfecho e pagamentos do
// payload, documentos das linhas `d` do canônico assinado.
// =====================================================================

async function desenharRetorno(
  doc: Doc,
  autoTable: AutoTable,
  romaneio: RomaneioCompleto,
  via: ViaDoRomaneio
): Promise<void> {
  const farmacia = romaneio.assinaturas.find((a) => a.tipoSignatario !== 'motoboy')
  const motoboy = romaneio.assinaturas.find((a) => a.tipoSignatario === 'motoboy')
  const leitura = lerRetorno(romaneio.payload, romaneio.canonico)
  const mostrarPagamento = via === 'farmacia'

  let y = await desenharCabecalho(doc, 'Romaneio de retorno', romaneio, via)

  // O número da saída é rótulo para quem procura o papel irmão. Quem amarra
  // os dois documentos é o `saida_hash` dentro do DCRR1.
  doc.setFontSize(9)
  doc.text(`Referente à saída ${romaneio.saidaNumero ?? '(número não disponível)'}`, M, y)
  y += 6

  y = desenharCampos(doc, y, [
    ['Motoboy', motoboy?.nome ?? null],
    ['Agência', motoboy?.agenciaNome ?? null],
    ['Recebido por', farmacia?.nome ?? romaneio.criadoPorNome],
    ['Retirada', dataHora(romaneio.corrida?.saidaEm)],
    ['Retorno', dataHora(romaneio.ocorridoEmLocal)],
    [
      'Duração',
      duracaoDaCorrida(romaneio.corrida?.saidaEm ?? null, romaneio.corrida?.retornoEm ?? null),
    ],
    ['Selado em', dataHora(romaneio.seladoEm)],
  ])

  if (leitura.declarado) {
    doc.setFontSize(8)
    doc.setTextColor(150, 20, 26)
    doc.text(
      'Retorno em conflito: o que segue foi declarado no balcão e não foi aplicado aos vales.',
      M,
      y
    )
    doc.setTextColor(0)
    y += 5
  }
  y += 3

  const cabecalho = mostrarPagamento
    ? ['Vale', 'Cliente', 'Desfecho', 'Pagamento', 'Documentos']
    : ['Vale', 'Cliente', 'Desfecho', 'Documentos']

  const corpo = leitura.vales.map((v) => {
    const vale = v.numeroVale ?? `${v.entregaId.slice(0, 8)}…`
    const cliente =
      v.tipo === 'transferencia' ? `Transferência\n${v.clienteNome ?? ''}` : (v.clienteNome ?? '—')
    const desfecho = [textoDoDesfecho(v), v.detalhe].filter(Boolean).join('\n')
    const documentos = v.documentos.map(textoDoDocumento).join('\n') || '—'
    if (!mostrarPagamento) return [vale, cliente, desfecho, documentos]
    const pagamento =
      [
        ...v.realizados.map(textoDoPagamentoRealizado),
        v.situacaoPagamento === 'divergiu' ? '(diverge do previsto)' : null,
      ]
        .filter(Boolean)
        .join('\n') || '—'
    return [vale, cliente, desfecho, pagamento, documentos]
  })

  const resumoDocumentos =
    leitura.documentosRecebidos + leitura.documentosFaltantes > 0
      ? `${leitura.documentosRecebidos} recebido(s)\n${leitura.documentosFaltantes} faltante(s)`
      : ''
  const resumoDesfechos = `${leitura.entregues} entregue(s)\n${leitura.insucessos} insucesso(s)`
  const rodape = mostrarPagamento
    ? [
        '',
        `${leitura.vales.length} vale(s)`,
        resumoDesfechos,
        leitura.pagamentosDivergentes > 0 ? `${leitura.pagamentosDivergentes} divergente(s)` : '',
        resumoDocumentos,
      ]
    : ['', `${leitura.vales.length} vale(s)`, resumoDesfechos, resumoDocumentos]

  autoTable(doc, { ...ESTILO_TABELA, startY: y, head: [cabecalho], body: corpo, foot: [rodape] })
  y = doc.lastAutoTable.finalY + 7

  y = desenharEvidencias(doc, y, farmacia, motoboy)
  desenharRodape(doc, y, romaneio)
}

// =====================================================================
// O QUE OS DOIS DOCUMENTOS TÊM EM COMUM
// =====================================================================

async function desenharCabecalho(
  doc: Doc,
  titulo: string,
  romaneio: RomaneioCompleto,
  via: ViaDoRomaneio
): Promise<number> {
  const largura = doc.internal.pageSize.getWidth()
  let y = M

  // A logo vem do módulo da marca (`lib/marca.ts`), um lugar só, com
  // cache por sessão. Aqui é a versão de DOCUMENTO (502 × 80): a de tela
  // daria ~900 dpi nestes 56mm e custava 130 kB por arquivo, num PDF que
  // sobe pro Drive nas duas vias a cada saída. Documento sem logo ainda é
  // um documento: uma falha de rede aqui não pode derrubar a emissão
  // inteira de um comprovante de custódia.
  let logo: string | null = null
  try {
    logo = await carregarImagemDaMarca(LOGO_DOCUMENTO_URL)
  } catch {
    logo = null
  }

  if (logo) {
    const alturaLogo = 9
    // A FAIXA NÃO É DECORAÇÃO. O letreiro "Drogaria Cidade" da arte é
    // BRANCO — desenhado direto no papel branco, sumia, e o romaneio saía
    // com a cruz solta e sem o nome da farmácia. O PDF do acerto sempre
    // teve a faixa e por isso nunca mostrou o problema; este ganhou logo
    // depois e herdou o desenho sem ela.
    const alturaFaixa = alturaLogo + 8
    doc.setFillColor(COR_MARCA[0], COR_MARCA[1], COR_MARCA[2])
    doc.rect(0, 0, largura, alturaFaixa, 'F')
    // Proporção constante e conhecida (2008 × 320, igual à de tela); não
    // precisa medir.
    doc.addImage(
      logo,
      'PNG',
      M,
      (alturaFaixa - alturaLogo) / 2,
      LOGO_PROPORCAO * alturaLogo,
      alturaLogo,
      undefined,
      // 'FAST' liga a compressão: sem ele o jsPDF grava o bitmap cru.
      'FAST'
    )
    y = alturaFaixa + M
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(titulo, M, y)
  doc.setFontSize(13)
  doc.text(romaneio.numero, largura - M, y, { align: 'right' })
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(
    [
      romaneio.lojaNome ?? 'Filial não identificada',
      via === 'agencia' ? 'Via da agência' : 'Via da farmácia',
      romaneio.status === 'conflito' ? 'CONFLITO — não selado' : 'Selado',
      romaneio.modo === 'offline_sincronizada' ? 'registrado offline' : 'validado na hora',
    ].join('  ·  '),
    M,
    y
  )
  doc.setTextColor(0)
  return y + 7
}

function desenharCampos(doc: Doc, y: number, linhas: [string, string | null][]): number {
  doc.setFontSize(9)
  for (const [rotulo, valor] of linhas) {
    if (!valor) continue
    doc.setTextColor(110)
    doc.text(rotulo, M, y)
    doc.setTextColor(0)
    doc.text(valor, M + 26, y)
    y += 4.6
  }
  return y
}

// As evidências das duas partes, lado a lado. O bloco da esquerda é a
// farmácia — `caixa` na saída, `responsavel_loja` no retorno —, e a pergunta
// é sempre "não é motoboy", nunca o literal de um slot.
function desenharEvidencias(
  doc: Doc,
  y: number,
  farmacia: AssinaturaDoRomaneio | undefined,
  motoboy: AssinaturaDoRomaneio | undefined
): number {
  const largura = doc.internal.pageSize.getWidth()
  const alturaAssinatura = 26
  if (y + alturaAssinatura + 40 > doc.internal.pageSize.getHeight()) {
    doc.addPage()
    y = M
  }

  const larguraBloco = (largura - M * 2 - 8) / 2
  for (const [i, assinatura] of [farmacia, motoboy].entries()) {
    if (!assinatura) continue
    const x = M + i * (larguraBloco + 8)

    // VERSÃO 2 (4B): sem traço — e SEM a linha de assinatura também. Uma
    // linha em branco no papel diria "falta assinar", que é a afirmação
    // errada sobre um documento que nunca teve assinatura manuscrita.
    const comTraco = assinatura.versaoEvidencia !== 2
    if (comTraco) {
      desenharAssinatura(doc, assinatura.strokes, x, y, larguraBloco, alturaAssinatura)
    }

    let yb = y + alturaAssinatura + 4
    if (comTraco) {
      doc.setDrawColor(180)
      doc.line(x, yb - 2, x + larguraBloco, yb - 2)
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(assinatura.nome ?? '—', x, yb)
    yb += 4

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(90)
    const detalhes = [
      // O slot ("Farmácia") e o cargo de quem de fato assinou são coisas
      // separadas — a tela já fazia essa distinção e o PDF não, então o
      // mesmo documento contava duas histórias. `papel_no_momento` é nulo
      // nas assinaturas anteriores a 2026-08-19, e aí sobra só o slot:
      // derivar de `profiles.papel` mostraria o cargo de HOJE.
      i === 0
        ? ['Farmácia', rotuloDoPapelNoMomento(assinatura.papelNoMomento)]
            .filter(Boolean)
            .join(' · ')
        : 'Motoboy',
      // 4B: na exceção quem AUTENTICOU foi o gerente, com cartão e PIN
      // próprios — e o papel precisa dizer isso, porque o nome logo acima
      // continua sendo o do motoboy responsável pelos vales.
      assinatura.validadorNome
        ? `${assinatura.motivoExcecao ? MOTIVO_EXCECAO_LABEL[assinatura.motivoExcecao] + ' · ' : ''}autorizado por ${assinatura.validadorNome}, gerente`
        : null,
      !comTraco && i === 0 ? 'confirmação na sessão' : null,
      assinatura.agenciaNome,
      dataHora(assinatura.assinadoEm),
      assinatura.credencialPublicId
        ? `${assinatura.validadorNome ? 'cartão do gerente' : 'credencial'} ••••${assinatura.credencialPublicId.slice(-4)}`
        : null,
    ].filter(Boolean) as string[]
    for (const d of detalhes) {
      doc.text(doc.splitTextToSize(d, larguraBloco), x, yb)
      yb += 3.2
    }
    doc.setTextColor(0)
  }
  return y + alturaAssinatura + 32
}

// ---------------- rodapé: o que prova o documento ----------------
function desenharRodape(doc: Doc, y: number, romaneio: RomaneioCompleto): void {
  const largura = doc.internal.pageSize.getWidth()
  if (y > doc.internal.pageSize.getHeight() - 22) {
    doc.addPage()
    y = M
  }
  doc.setDrawColor(200)
  doc.line(M, y, largura - M, y)
  y += 4

  doc.setFontSize(7)
  doc.setTextColor(110)
  const provas = [
    romaneio.finalHash ? `Hash final: ${romaneio.finalHash}` : null,
    `Documento: ${romaneio.documentHash}`,
    romaneio.ip ? `IP da selagem: ${romaneio.ip}` : null,
    `Emitido em ${new Date().toLocaleString('pt-BR')} · este PDF é uma renderização do registro, não a fonte da verdade`,
  ].filter(Boolean) as string[]
  for (const linha of provas) {
    doc.text(doc.splitTextToSize(linha, largura - M * 2), M, y)
    y += 3
  }
  doc.setTextColor(0)
}

// Desenha os traços como VETOR, do mesmo jeito que a tela: o banco guarda
// pontos, não imagem. Escala e centraliza no espaço dado — a assinatura
// foi capturada num canvas de outro tamanho, então redesenhar em
// coordenadas absolutas a cortaria.
function desenharAssinatura(
  doc: Doc,
  strokes: unknown,
  x: number,
  y: number,
  largura: number,
  altura: number
): void {
  const tracos = (Array.isArray(strokes) ? strokes : []) as { points?: { x: number; y: number }[] }[]
  const pontos = tracos.flatMap((t) => t.points ?? [])
  if (pontos.length === 0) return

  const minX = Math.min(...pontos.map((p) => p.x))
  const maxX = Math.max(...pontos.map((p) => p.x))
  const minY = Math.min(...pontos.map((p) => p.y))
  const maxY = Math.max(...pontos.map((p) => p.y))

  const margem = 2
  // `|| 1` cobre a assinatura de um traço só na horizontal ou vertical,
  // onde o retângulo tem lado zero e a escala viraria infinito.
  const escala = Math.min(
    (largura - margem * 2) / (maxX - minX || 1),
    (altura - margem * 2) / (maxY - minY || 1)
  )
  const dx = x + margem + (largura - margem * 2 - (maxX - minX) * escala) / 2
  const dy = y + margem + (altura - margem * 2 - (maxY - minY) * escala) / 2

  doc.setDrawColor(0)
  doc.setLineWidth(0.35)
  doc.setLineCap('round')
  doc.setLineJoin('round')

  for (const traco of tracos) {
    const pts = traco.points ?? []
    for (let i = 1; i < pts.length; i++) {
      doc.line(
        dx + (pts[i - 1].x - minX) * escala,
        dy + (pts[i - 1].y - minY) * escala,
        dx + (pts[i].x - minX) * escala,
        dy + (pts[i].y - minY) * escala
      )
    }
    // Um toque só não desenha linha nenhuma; o ponto garante que ele
    // apareça em vez de sumir.
    if (pts.length === 1) {
      doc.circle(dx + (pts[0].x - minX) * escala, dy + (pts[0].y - minY) * escala, 0.3, 'F')
    }
  }
}
