import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRelatorio, type FiltroPeriodo, type RelatorioGrupo } from '@/data/relatorios'
import { formatBRL } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}

function localDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function Relatorios() {
  const hoje = localDateStr(new Date())
  const [form, setForm] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [filtro, setFiltro] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const { data, isLoading, isError, error } = useRelatorio(filtro)

  function toggleExpandido(chave: string) {
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })
  }

  function aplicarHoje() {
    const h = localDateStr(new Date())
    setForm({ dataInicio: h, dataFim: h })
    setFiltro({ dataInicio: h, dataFim: h })
  }

  function aplicarEsteMes() {
    const agora = new Date()
    const proximo = {
      dataInicio: localDateStr(new Date(agora.getFullYear(), agora.getMonth(), 1)),
      dataFim: localDateStr(agora),
    }
    setForm(proximo)
    setFiltro(proximo)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="r-inicio">De</Label>
          <Input
            id="r-inicio"
            type="date"
            value={form.dataInicio}
            onChange={(e) => setForm({ ...form, dataInicio: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="r-fim">Até</Label>
          <Input
            id="r-fim"
            type="date"
            value={form.dataFim}
            onChange={(e) => setForm({ ...form, dataFim: e.target.value })}
          />
        </div>
        <Button onClick={() => setFiltro(form)}>Aplicar</Button>
        <Button variant="outline" onClick={aplicarHoje}>
          Hoje
        </Button>
        <Button variant="outline" onClick={aplicarEsteMes}>
          Este mês
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            <StatTile label="Vales no período" valor={String(data.totalVales)} />
            <StatTile label="Entregas de cliente" valor={String(data.totalClientes)} />
            <StatTile label="Transferências" valor={String(data.totalTransferencias)} />
            <StatTile label="Valor de compra" valor={formatBRL(data.valorCompraCents)} />
            <StatTile label="Valor de entrega" valor={formatBRL(data.valorEntregaCents)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por status</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(data.porStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum vale no período.</p>
              ) : (
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {Object.entries(data.porStatus).map(([status, quantidade]) => (
                    <span key={status}>
                      {STATUS_LABEL[status] ?? status}: <strong>{quantidade}</strong>
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por motoboy</CardTitle>
            </CardHeader>
            <CardContent>
              <GrupoTable
                grupos={data.porMototaxista}
                nomeColuna="Motoboy"
                vazio="Nenhuma corrida com motoboy no período."
                expandidos={expandidos}
                onToggle={toggleExpandido}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por agência</CardTitle>
            </CardHeader>
            <CardContent>
              <GrupoTable
                grupos={data.porAgencia}
                nomeColuna="Agência"
                vazio="Nenhuma corrida com agência no período."
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function StatTile({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-medium">{valor}</p>
    </div>
  )
}

function GrupoTable({
  grupos,
  nomeColuna,
  vazio,
  expandidos,
  onToggle,
}: {
  grupos: RelatorioGrupo[]
  nomeColuna: string
  vazio: string
  // opcional — só a tabela "Por motoboy" usa isso hoje. Sem esses dois
  // props, a tabela fica exatamente como antes (sem seta, sem expandir).
  expandidos?: Set<string>
  onToggle?: (chave: string) => void
}) {
  if (grupos.length === 0) {
    return <p className="text-sm text-muted-foreground">{vazio}</p>
  }

  const expansivel = !!onToggle

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {expansivel && <TableHead />}
          <TableHead>{nomeColuna}</TableHead>
          <TableHead>Vales</TableHead>
          <TableHead>Entregues</TableHead>
          <TableHead>Insucessos</TableHead>
          <TableHead>Valor de entrega</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grupos.map((grupo) => {
          const aberto = expandidos?.has(grupo.chave) ?? false
          return (
            <Fragment key={grupo.chave}>
              <TableRow>
                {expansivel && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={aberto ? 'Esconder vales' : 'Mostrar vales'}
                      onClick={() => onToggle!(grupo.chave)}
                    >
                      {aberto ? <ChevronDown /> : <ChevronRight />}
                    </Button>
                  </TableCell>
                )}
                <TableCell>{grupo.nome}</TableCell>
                <TableCell>{grupo.totalVales}</TableCell>
                <TableCell>{grupo.entregues}</TableCell>
                <TableCell>{grupo.insucessos}</TableCell>
                <TableCell>{formatBRL(grupo.valorEntregaCents)}</TableCell>
              </TableRow>
              {expansivel && aberto && (
                <TableRow>
                  <TableCell colSpan={6} className="bg-muted/30 p-3">
                    <ValesGrupoTable vales={grupo.vales} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ValesGrupoTable({ vales }: { vales: RelatorioGrupo['vales'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vale</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Valor de entrega</TableHead>
          <TableHead>Data</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vales.map((vale) => (
          <TableRow key={vale.id}>
            <TableCell>{vale.numeroVale}</TableCell>
            <TableCell>
              {vale.clienteNome}
              {vale.tipo === 'transferencia' && (
                <Badge variant="secondary" className="ml-2">
                  Transferência
                </Badge>
              )}
            </TableCell>
            <TableCell>{STATUS_LABEL[vale.statusEntrega] ?? vale.statusEntrega}</TableCell>
            <TableCell>{formatBRL(vale.valorEntregaCents)}</TableCell>
            <TableCell>
              {new Date(vale.ocorridoEmLocal).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
