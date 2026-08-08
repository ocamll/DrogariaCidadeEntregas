import { useState } from 'react'
import { useRelatorio, type FiltroPeriodo } from '@/data/relatorios'
import { formatBRL } from '@/lib/money'
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

  const { data, isLoading, isError, error } = useRelatorio(filtro)

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
}: {
  grupos: Array<{ chave: string; nome: string; totalVales: number; entregues: number; insucessos: number; valorEntregaCents: number }>
  nomeColuna: string
  vazio: string
}) {
  if (grupos.length === 0) {
    return <p className="text-sm text-muted-foreground">{vazio}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{nomeColuna}</TableHead>
          <TableHead>Vales</TableHead>
          <TableHead>Entregues</TableHead>
          <TableHead>Insucessos</TableHead>
          <TableHead>Valor de entrega</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grupos.map((grupo) => (
          <TableRow key={grupo.chave}>
            <TableCell>{grupo.nome}</TableCell>
            <TableCell>{grupo.totalVales}</TableCell>
            <TableCell>{grupo.entregues}</TableCell>
            <TableCell>{grupo.insucessos}</TableCell>
            <TableCell>{formatBRL(grupo.valorEntregaCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
