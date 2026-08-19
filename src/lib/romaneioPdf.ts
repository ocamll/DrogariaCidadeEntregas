// O romaneio de saída em PDF.
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
// DUAS VIAS
//
// `farmacia` leva tudo. `agencia` omite o **valor da compra**, que é dado
// comercial da farmácia e não entra no acerto — a agência precisa do
// valor da entrega, não do que o cliente comprou. Decidido em 2026-08-18.
//
// O PDF NUNCA É FONTE DA VERDADE
//
// Ele é uma renderização do que está no banco. O `final_hash` impresso é
// o que permite conferir o documento contra o registro; o PDF em si não
// prova nada sozinho, e não deve ser tratado como se provasse.

import type { RomaneioCompleto } from '@/data/romaneios'
import { formatBRL } from '@/lib/money'
import { textoGeo } from '@/lib/geolocalizacao'

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
export function duracaoDaCorrida(saidaEm: string | null, retornoEm: string | null): string | null {
  if (!saidaEm || !retornoEm) return null
  const ms = new Date(retornoEm).getTime() - new Date(saidaEm).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

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
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const M = 15
  const largura = doc.internal.pageSize.getWidth()
  let y = M

  const caixa = romaneio.assinaturas.find((a) => a.tipoSignatario === 'caixa')
  const motoboy = romaneio.assinaturas.find((a) => a.tipoSignatario === 'motoboy')
  const vales = valesDoSnapshot(romaneio.payload)
  const mostrarCompra = via === 'farmacia'

  // ---------------- cabeçalho ----------------
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Romaneio de saída', M, y)
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
  y += 7

  // ---------------- quem e quando ----------------
  const linhas: [string, string | null][] = [
    ['Motoboy', motoboy?.nome ?? null],
    ['Agência', motoboy?.agenciaNome ?? null],
    ['Caixa', caixa?.nome ?? romaneio.criadoPorNome],
    ['Retirada', dataHora(romaneio.corrida?.saidaEm) ?? dataHora(romaneio.ocorridoEmLocal)],
    ['Retorno', dataHora(romaneio.corrida?.retornoEm)],
    [
      'Duração',
      duracaoDaCorrida(romaneio.corrida?.saidaEm ?? null, romaneio.corrida?.retornoEm ?? null),
    ],
    ['Selado em', dataHora(romaneio.seladoEm)],
  ]

  doc.setFontSize(9)
  for (const [rotulo, valor] of linhas) {
    if (!valor) continue
    doc.setTextColor(110)
    doc.text(rotulo, M, y)
    doc.setTextColor(0)
    doc.text(valor, M + 26, y)
    y += 4.6
  }

  // A corrida ainda aberta é um fato do documento, não uma omissão.
  if (!romaneio.corrida?.retornoEm) {
    doc.setTextColor(110)
    doc.text('Retorno', M, y)
    doc.setTextColor(0)
    doc.text('corrida ainda aberta', M + 26, y)
    y += 4.6
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

  autoTable(doc, {
    startY: y,
    head: [cabecalho],
    body: corpo,
    foot: [rodape],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, textColor: 20 },
    headStyles: { fillColor: [201, 20, 26], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold' },
    margin: { left: M, right: M },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 7

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
    doc.text(
      'O documento acima não muda. O que segue aconteceu depois de assinado.',
      M,
      y
    )
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 7
  }

  // ---------------- assinaturas ----------------
  const alturaAssinatura = 26
  if (y + alturaAssinatura + 40 > doc.internal.pageSize.getHeight()) {
    doc.addPage()
    y = M
  }

  const larguraBloco = (largura - M * 2 - 8) / 2
  for (const [i, assinatura] of [caixa, motoboy].entries()) {
    if (!assinatura) continue
    const x = M + i * (larguraBloco + 8)

    desenharAssinatura(doc, assinatura.strokes, x, y, larguraBloco, alturaAssinatura)

    let yb = y + alturaAssinatura + 4
    doc.setDrawColor(180)
    doc.line(x, yb - 2, x + larguraBloco, yb - 2)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(assinatura.nome ?? '—', x, yb)
    yb += 4

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(90)
    const detalhes = [
      i === 0 ? 'Caixa' : 'Motoboy',
      assinatura.agenciaNome,
      dataHora(assinatura.assinadoEm),
      assinatura.credencialPublicId ? `credencial ••••${assinatura.credencialPublicId.slice(-4)}` : null,
      textoGeo(assinatura.geolocalizacao),
    ].filter(Boolean) as string[]
    for (const d of detalhes) {
      doc.text(doc.splitTextToSize(d, larguraBloco), x, yb)
      yb += 3.2
    }
    doc.setTextColor(0)
  }
  y += alturaAssinatura + 32

  // ---------------- rodapé: o que prova o documento ----------------
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
    textoGeo(romaneio.geolocalizacao) ? `Local da selagem: ${textoGeo(romaneio.geolocalizacao)}` : null,
    `Emitido em ${new Date().toLocaleString('pt-BR')} · este PDF é uma renderização do registro, não a fonte da verdade`,
  ].filter(Boolean) as string[]
  for (const linha of provas) {
    doc.text(doc.splitTextToSize(linha, largura - M * 2), M, y)
    y += 3
  }
  doc.setTextColor(0)

  return doc.output('arraybuffer')
}

// Desenha os traços como VETOR, do mesmo jeito que a tela: o banco guarda
// pontos, não imagem. Escala e centraliza no espaço dado — a assinatura
// foi capturada num canvas de outro tamanho, então redesenhar em
// coordenadas absolutas a cortaria.
function desenharAssinatura(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
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
