import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useFechamento,
  useMarcarDiaConferido,
  type ValeFechamento,
} from '@/data/fechamento'
import { useLojas } from '@/data/lojas'
import { FORMA_PAGAMENTO_LABEL } from '@/data/pagamentos'
import { SangriaRomaneios } from '@/components/SangriaRomaneios'
import { formatBRL } from '@/lib/money'
import { dataLocal } from '@/lib/datas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const SELECT_CLASSNAME =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function Fechamento({ profile }: { profile: AuthProfile }) {
  // `dataLocal` morava aqui como `localDateStr`. Foi pra `lib/datas.ts`
  // quando o Drive passou a ter pasta por dia e precisou da mesma
  // definição de "o dia" — duas cópias discordarem faria a sangria
  // arquivar num dia e a tela mostrar outro.
  const hoje = dataLocal(new Date())
  const [data, setData] = useState(hoje)
  const [lojaId, setLojaId] = useState(profile.papel === 'admin' ? '' : (profile.lojaId ?? ''))
  const [aviso, setAviso] = useState<string | null>(null)

  const { data: fechamento, isLoading, isError, error } = useFechamento({ data, lojaId })
  const { data: lojas } = useLojas()
  const conferir = useMarcarDiaConferido()

  function handleConferir() {
    setAviso(null)
    conferir.mutate(
      { data, lojaId },
      {
        onSuccess: (r) =>
          setAviso(
            r.conferidos === 0
              ? 'Nenhum vale pendente de conferência nesse dia.'
              : `${r.conferidos} vale(s) marcados como conferidos.`
          ),
        onError: (e) => setAviso(e.message),
      }
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="fech-data">Dia</Label>
          <Input
            id="fech-data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        {/* Só o admin escolhe filial. Pro gerente o campo virava uma
            promessa falsa: desde 2026-08-12 a RLS não devolve vale de
            outra loja, então "Todas as filiais" traria só a dele e
            escolher outra traria vazio — parecendo dia sem movimento em
            vez de acesso negado. */}
        {profile.papel === 'admin' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="fech-loja">Filial</Label>
            <select
              id="fech-loja"
              className={SELECT_CLASSNAME}
              value={lojaId}
              onChange={(e) => setLojaId(e.target.value)}
            >
              <option value="">Todas as filiais</option>
              {lojas?.map((loja) => (
                <option key={loja.id} value={loja.id}>
                  {loja.nome}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label>Filial</Label>
            <p className="py-1 text-sm">{profile.lojaNome ?? '—'}</p>
          </div>
        )}
        <Button variant="outline" onClick={() => setData(hoje)}>
          Hoje
        </Button>
      </div>

      {/* O sistema só conhece tele. Dizer isso na tela evita alguém somar
          esses números achando que é o caixa inteiro. */}
      <p className="text-sm text-muted-foreground">
        Só o lado da tele-entrega. Venda de balcão não passa por aqui — o total do caixa continua
        vindo do Trier. O que esta tela responde é <strong>o que, da tele, explica uma diferença</strong>.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}

      {fechamento && (
        <>
          {fechamento.truncado && (
            <p className="text-sm text-destructive">
              Esse dia tem mais vales do que cabe na tela — filtra por filial pra ver tudo.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <Tile label="Vales de cliente" valor={String(fechamento.totalVales)} />
            <Tile label="Valor de compra" valor={formatBRL(fechamento.valorCompraCents)} />
            <Tile label="A pagar à agência" valor={formatBRL(fechamento.valorFarmaciaDeveCents)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Conferência</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                  Conferidos: <strong>{fechamento.conferidos}</strong>
                </span>
                <span>
                  A conferir: <strong>{fechamento.pendentes}</strong>
                </span>
                <span className={fechamento.divergentes > 0 ? 'text-destructive' : undefined}>
                  Divergentes: <strong>{fechamento.divergentes}</strong>
                </span>
              </div>

              {/* A lista existe porque conferir é olhar vale a vale. Sem ela
                  a tela mostrava só a contagem e um botão — dava pra marcar
                  o dia inteiro sem ter conferido nada. */}
              {fechamento.aConferir.length > 0 && (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vale</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Compra</TableHead>
                        <TableHead>Forma prevista</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fechamento.aConferir.map((vale) => (
                        <TableRow key={vale.id}>
                          <TableCell className="tabular-nums">{vale.numeroVale}</TableCell>
                          <TableCell className="whitespace-normal break-words">
                            {vale.clienteNome}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatBRL(vale.valorCompraCents)}
                          </TableCell>
                          <TableCell>
                            {vale.formaPrevista ? FORMA_PAGAMENTO_LABEL[vale.formaPrevista] : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Marcar o dia conferido mexe só nos que estão "a conferir". O divergente continua
                divergente de propósito: o dia inteiro vai pra administração de qualquer jeito,
                mas é essa marca que diz <strong>quais precisam de solução lá</strong> — o gestor
                não resolve divergência sozinho. Apagar a marca aqui faria o problema chegar na
                administração sem sinalização nenhuma.
              </p>

              <div className="flex items-center gap-3">
                <Button onClick={handleConferir} disabled={conferir.isPending || fechamento.pendentes === 0}>
                  {conferir.isPending ? 'Marcando…' : 'Marcar dia como conferido'}
                </Button>
                {aviso && <span className="text-sm text-muted-foreground">{aviso}</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ocorrências</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Bloco
                titulo="Divergências de pagamento"
                vazio="Nenhuma divergência registrada nesse dia."
                vales={fechamento.divergencias}
                render={(v) => (
                  <>
                    Era <strong>{v.formaPrevista ? FORMA_PAGAMENTO_LABEL[v.formaPrevista] : '—'}</strong>,
                    virou{' '}
                    <strong>
                      {v.formasRealizadas
                        .map((f) => `${FORMA_PAGAMENTO_LABEL[f.forma]} (${formatBRL(f.valorCents)})`)
                        .join(' + ')}
                    </strong>
                    {v.justificativa && <em className="block text-muted-foreground">"{v.justificativa}"</em>}
                  </>
                )}
              />
              <Bloco
                titulo="Vales cancelados"
                vazio="Nenhum cancelamento nesse dia."
                vales={fechamento.cancelados}
                render={(v) => (
                  <>
                    Compra de <strong>{formatBRL(v.valorCompraCents)}</strong> que não aconteceu
                    {/* gestão precisa dos dois: o motivo diz o quê, o autor
                        diz com quem falar sobre ele */}
                    <span className="block text-foreground/70">
                      Cancelado por <strong>{v.canceladoPorNome ?? '—'}</strong>
                      {v.motivoCancelamento && <> — "{v.motivoCancelamento}"</>}
                    </span>
                  </>
                )}
              />
              <Bloco
                titulo="Insucessos"
                vazio="Nenhum insucesso nesse dia."
                vales={fechamento.insucessos}
                render={(v) => (
                  <>
                    Compra de <strong>{formatBRL(v.valorCompraCents)}</strong> que voltou
                    {v.observacoes && <em className="block text-muted-foreground">"{v.observacoes}"</em>}
                  </>
                )}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Fora do `fechamento &&` de propósito: a sangria não depende dos
          vales terem carregado. Se a consulta do fechamento falhar, ainda
          dá pra arquivar os romaneios do dia — são coisas independentes
          que só compartilham a data e a filial. */}
      <SangriaRomaneios data={data} lojaId={lojaId} />
    </div>
  )
}

function Tile({ label, valor, alerta = false }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={alerta ? 'text-lg font-medium text-destructive' : 'text-lg font-medium'}>{valor}</p>
    </div>
  )
}

function Bloco({
  titulo,
  vazio,
  vales,
  render,
}: {
  titulo: string
  vazio: string
  vales: ValeFechamento[]
  render: (v: ValeFechamento) => React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium">
        {titulo}
        {vales.length > 0 && <span className="ml-1 text-muted-foreground">({vales.length})</span>}
      </h4>
      {vales.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {vales.map((v) => (
            <li key={v.id} className="rounded-lg border p-2 text-sm">
              <span className="font-medium">{v.numeroVale}</span> — {v.clienteNome}
              <div className="text-sm">{render(v)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
