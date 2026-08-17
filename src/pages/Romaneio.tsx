import { useRomaneio } from '@/data/romaneios'
import { BlocoAssinatura } from '@/components/Custodia'
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
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar
      </Button>

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
