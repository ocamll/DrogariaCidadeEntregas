import { useEffect, useState } from 'react'
import { useRomaneio, quandoAconteceu } from '@/data/romaneios'
import type { RomaneioCompleto } from '@/data/romaneios'
import { BlocoAssinatura } from '@/components/Custodia'
import { baixarArquivo } from '@/lib/credencialDownload'
import { driveConfigurado, prepararDrive } from '@/lib/googleDrive'
import { duracaoDaCorrida } from '@/lib/datas'
import type { ViaDoRomaneio } from '@/lib/romaneioPdf'
import { formatBRL } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// O documento em si. Ele é a fonte da verdade da saída — o PDF, quando
// existir, sai daqui e não o contrário.
//
// Tudo que aparece nesta tela vem do SNAPSHOT gravado no romaneio, nunca
// de uma consulta nova a `entregas`. Se um vale mudar depois (correção
// cadastral, por exemplo), esta tela continua mostrando o que foi
// assinado — que é o ponto inteiro de existir um documento selado.

type ValeDoPayload = {
  entrega_id: string
  numero_vale: string
  tipo: string
  cliente_nome: string
  cliente_endereco: string
  quantidade_vales: number
  valor_compra_cents: number
  valor_entrega_cents: number
  pagamentos_previstos?: Array<{ forma: string; valor_cents: number }>
}

export function Romaneio({
  romaneioId,
  onVoltar,
}: {
  romaneioId: string
  onVoltar: () => void
}) {
  const { data, isLoading, isError, error } = useRomaneio(romaneioId)
  const [ocupado, setOcupado] = useState<ViaDoRomaneio | 'drive' | null>(null)
  const [erroPdf, setErroPdf] = useState<string | null>(null)
  const [enviadoAoDrive, setEnviadoAoDrive] = useState<string | null>(null)

  // Pré-carrega o script do Google ao montar, pra o clique não gastar o
  // gesto do usuário esperando rede — o pop-up de autorização aberto tarde
  // demais é bloqueado pelo navegador. Mesma armadilha já paga no acerto.
  useEffect(() => {
    prepararDrive()
  }, [])

  // O `data` só existe depois dos early returns, então as funções são
  // declaradas aqui e RECEBEM o romaneio de quem já o estreitou. Nada de
  // ler `data?.numero` aqui dentro: este nome é a chave de dedupe no
  // Drive, e um "romaneio-undefined-farmacia.pdf" pousando numa pasta é
  // pior que um erro — ele parece um arquivo.
  //
  // TODO: quando a correção cadastral por evento existir (categoria 1 da
  // regra 7), as correções entram aqui — a seção do PDF já está pronta pra
  // recebê-las.
  const nomeDoArquivo = (romaneio: RomaneioCompleto, via: ViaDoRomaneio) =>
    `romaneio-${romaneio.numero}-${via}.pdf`

  async function gerarPdf(romaneio: RomaneioCompleto, via: ViaDoRomaneio) {
    // Import dinâmico: é ele que puxa o jspdf, e ninguém deve baixar
    // 400 kB só por abrir a página do romaneio.
    const { montarRomaneioPdf } = await import('@/lib/romaneioPdf')
    const bytes = await montarRomaneioPdf(romaneio, via, [])
    return new Blob([bytes], { type: 'application/pdf' })
  }

  async function baixar(via: ViaDoRomaneio) {
    if (!data) return
    setErroPdf(null)
    setEnviadoAoDrive(null)
    setOcupado(via)
    try {
      baixarArquivo(await gerarPdf(data, via), nomeDoArquivo(data, via), 'application/pdf')
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  async function enviarParaDrive() {
    if (!data) return
    setErroPdf(null)
    setEnviadoAoDrive(null)
    setOcupado('drive')
    try {
      // AUTORIZA PRIMEIRO, antes de gerar os PDFs. Gerar leva centenas de
      // milissegundos e o pop-up aberto depois disso deixa de contar como
      // resposta ao clique.
      const {
        autorizarDrive,
        enviarAoDrive,
        caminhoDoRomaneio,
        novoCachePastas,
        NOME_DA_PASTA_ROMANEIOS,
      } = await import('@/lib/googleDrive')
      await autorizarDrive()

      // As DUAS vias, porque a da farmácia é o arquivo e a da agência é o
      // que se compartilha — e as duas saem do mesmo snapshot selado.
      // Cada uma vai pra sua subpasta, então são dois envios; o cache
      // compartilhado evita repetir a busca de filial/mês/dia.
      const aconteceu = quandoAconteceu(data)
      const cache = novoCachePastas()
      const enviados = []
      for (const via of ['farmacia', 'agencia'] as const) {
        enviados.push(
          ...(await enviarAoDrive(
            [{ nome: nomeDoArquivo(data, via), blob: await gerarPdf(data, via) }],
            caminhoDoRomaneio(data.lojaNome, aconteceu, via),
            cache
          ))
        )
      }

      const atualizados = enviados.filter((e) => e.atualizado).length
      const observacao = atualizados > 0 ? ` (${atualizados} já existiam e foram substituídos)` : ''
      const ateODia = caminhoDoRomaneio(data.lojaNome, aconteceu, 'farmacia').slice(1, -1)
      setEnviadoAoDrive(
        `${enviados.length} arquivos em ${NOME_DA_PASTA_ROMANEIOS} › ` +
          `${ateODia.join(' › ')}, um em cada via${observacao}.`
      )
    } catch (e) {
      setErroPdf(`Não consegui enviar ao Drive: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOcupado(null)
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
  if (isError) {
    return <p className="p-4 text-sm text-destructive">Não consegui carregar: {error.message}</p>
  }
  if (!data) {
    return <p className="p-4 text-sm text-muted-foreground">Romaneio não encontrado.</p>
  }

  const payload = data.payload as { vales?: ValeDoPayload[] } | null
  const vales = payload?.vales ?? []
  const totalEntrega = vales.reduce((s, v) => s + v.valor_entrega_cents, 0)
  const totalCompra = vales.reduce((s, v) => s + v.valor_compra_cents, 0)
  const totalVales = vales.reduce((s, v) => s + v.quantidade_vales, 0)

  const caixa = data.assinaturas.find((a) => a.tipoSignatario === 'caixa')
  const motoboy = data.assinaturas.find((a) => a.tipoSignatario === 'motoboy')

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onVoltar}>
          ← Voltar
        </Button>
        {/* Duas vias porque os destinatários são dois: a da agência omite
            o valor da compra, que é dado comercial da farmácia e não
            entra no acerto. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!ocupado} onClick={() => void baixar('farmacia')}>
            {ocupado === 'farmacia' ? 'Gerando…' : 'PDF — via da farmácia'}
          </Button>
          <Button variant="outline" disabled={!!ocupado} onClick={() => void baixar('agencia')}>
            {ocupado === 'agencia' ? 'Gerando…' : 'PDF — via da agência'}
          </Button>
          {/* Sem VITE_GOOGLE_CLIENT_ID o botão não aparece: prometer envio
              num ambiente que não tem como autorizar seria a tela
              afirmando o que não sabe. */}
          {driveConfigurado() && (
            <Button variant="outline" disabled={!!ocupado} onClick={() => void enviarParaDrive()}>
              {ocupado === 'drive' ? 'Enviando…' : 'Enviar ao Drive'}
            </Button>
          )}
        </div>
      </div>
      {erroPdf && <p className="mb-3 text-sm text-destructive">{erroPdf}</p>}
      {enviadoAoDrive && <p className="mb-3 text-sm text-foreground/70">{enviadoAoDrive}</p>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Romaneio {data.numero}</CardTitle>
            {data.status === 'conflito' ? (
              <Badge variant="destructive">Conflito — não selado</Badge>
            ) : (
              <Badge variant="secondary">Selado</Badge>
            )}
            {data.modo === 'offline_sincronizada' && (
              <Badge variant="outline">Registrada offline</Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Campo rotulo="Filial" valor={data.lojaNome} />
            <Campo rotulo="Agência" valor={motoboy?.agenciaNome ?? null} />
            <Campo rotulo="Motoboy" valor={motoboy?.nome ?? null} />
            <Campo rotulo="Caixa" valor={data.criadoPorNome} />
            <Campo
              rotulo="Saída (balcão)"
              valor={
                data.ocorridoEmLocal ? new Date(data.ocorridoEmLocal).toLocaleString('pt-BR') : null
              }
            />
            <Campo
              rotulo="Selado (servidor)"
              valor={data.seladoEm ? new Date(data.seladoEm).toLocaleString('pt-BR') : null}
            />
            {/* Só faz diferença quando os dois horários divergem, que é
                exatamente o caso da saída offline. */}
            {data.modo === 'offline_sincronizada' && (
              <Campo
                rotulo="Recebido pelo servidor"
                valor={new Date(data.recebidoEmServidor).toLocaleString('pt-BR')}
              />
            )}
            {/* O RETORNO, que o PDF já mostrava e a página não. Corrida
                ainda aberta é DITA, nunca omitida: campo ausente e
                "o motoboy não voltou" não podem se parecer, e a diferença
                é o que alguém procura ao abrir este documento.
                A duração usa o relógio do SERVIDOR nos dois lados —
                misturar com o do dispositivo daria um intervalo que não
                aconteceu. */}
            <Campo
              rotulo="Retorno (servidor)"
              valor={
                data.corrida?.retornoEm
                  ? new Date(data.corrida.retornoEm).toLocaleString('pt-BR')
                  : 'corrida ainda aberta'
              }
            />
            {data.corrida?.retornoEmLocal && (
              <Campo
                rotulo="Retorno (balcão)"
                valor={new Date(data.corrida.retornoEmLocal).toLocaleString('pt-BR')}
              />
            )}
            <Campo
              rotulo="Duração"
              valor={duracaoDaCorrida(data.corrida?.saidaEm ?? null, data.corrida?.retornoEm ?? null)}
            />
            <Campo rotulo="IP" valor={data.ip} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wider uppercase text-foreground/70">
              O que saiu
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vale</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-center">Vales</TableHead>
                  <TableHead className="text-center">Compra</TableHead>
                  <TableHead className="text-center">Entrega</TableHead>
                  <TableHead className="text-center">Pagamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vales.map((vale) => (
                  <TableRow key={vale.entrega_id}>
                    <TableCell className="font-medium tabular-nums">{vale.numero_vale}</TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <p className="text-sm font-medium">{vale.cliente_nome}</p>
                      <p className="text-xs text-foreground/70">{vale.cliente_endereco}</p>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {vale.quantidade_vales}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {vale.tipo === 'transferencia' ? '—' : formatBRL(vale.valor_compra_cents)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatBRL(vale.valor_entrega_cents)}
                    </TableCell>
                    <TableCell className="whitespace-normal text-center text-xs">
                      {(vale.pagamentos_previstos ?? []).map((p) => p.forma).join(' + ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-sm">
              <strong>{vales.length}</strong> entrega(s) · <strong>{totalVales}</strong> vale(s) ·{' '}
              <strong>{formatBRL(totalCompra)}</strong> em compras ·{' '}
              <strong>{formatBRL(totalEntrega)}</strong> em teles
            </p>
          </section>

          {data.status === 'conflito' ? (
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="mb-2 font-medium text-destructive">
                Esta saída não pôde ser selada.
              </p>
              <p>
                Os vales já pertenciam a outra corrida quando a sincronização chegou. A retirada
                física aconteceu, então as assinaturas ficaram guardadas neste registro — mas os
                vales continuam com a corrida que selou primeiro. Resolver isso é decisão de gestão.
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-2 text-xs">
                {JSON.stringify(
                  (data.conflito as { motivos?: unknown })?.motivos ?? data.conflito,
                  null,
                  2
                )}
              </pre>
            </section>
          ) : (
            <section>
              <h3 className="mb-3 text-xs font-semibold tracking-wider uppercase text-foreground/70">
                Custódia
              </h3>
              <div className="grid gap-6 sm:grid-cols-2">
                {caixa && <BlocoAssinatura assinatura={caixa} />}
                {motoboy && <BlocoAssinatura assinatura={motoboy} />}
              </div>
            </section>
          )}

          <section className="border-t pt-4">
            <h3 className="mb-2 text-xs font-semibold tracking-wider uppercase text-foreground/70">
              Integridade
            </h3>
            {/* Os hashes por extenso, não abreviados: esta é a tela onde
                alguém confere um contra o outro documento. Abreviar aqui
                tiraria justamente a utilidade. */}
            <div className="flex flex-col gap-1 font-mono text-[11px] break-all">
              <p>
                <span className="text-foreground/60">documento </span>
                {data.documentHash}
              </p>
              {caixa?.signatureHash && (
                <p>
                  <span className="text-foreground/60">assin. caixa </span>
                  {caixa.signatureHash}
                </p>
              )}
              {motoboy?.signatureHash && (
                <p>
                  <span className="text-foreground/60">assin. motoboy </span>
                  {motoboy.signatureHash}
                </p>
              )}
              {data.finalHash && (
                <p className="font-semibold">
                  <span className="font-normal text-foreground/60">envelope </span>
                  {data.finalHash}
                </p>
              )}
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-foreground/60">{rotulo}</span>
      <span className="break-words">{valor ?? '—'}</span>
    </div>
  )
}
