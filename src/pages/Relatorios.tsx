import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRelatorio, type FiltroPeriodo, type RelatorioAgencia, type RelatorioGrupo } from '@/data/relatorios'
import { formatBRL } from '@/lib/money'
import { cn } from '@/lib/utils'
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

// chave composta agência+motoboy — um motoboy pode aparecer em mais de uma
// agência no período; expandir ele numa não pode abrir ele nas outras.
function chaveMotoboy(agenciaChave: string, motoboyChave: string): string {
  return `${agenciaChave}::${motoboyChave}`
}

export function Relatorios() {
  const hoje = localDateStr(new Date())
  const [form, setForm] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [filtro, setFiltro] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [agenciasAbertas, setAgenciasAbertas] = useState<Set<string>>(new Set())
  const [motoboysAbertos, setMotoboysAbertos] = useState<Set<string>>(new Set())

  const { data, isLoading, isError, error } = useRelatorio(filtro)

  function toggleAgencia(chave: string) {
    setAgenciasAbertas((prev) => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })
  }

  function toggleMotoboy(chave: string) {
    setMotoboysAbertos((prev) => {
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
            {/* Promovido de dentro de "Por status" a bloco próprio: é número
                que a gerência acompanha (cancelamento demais pode ser sinal
                de treinamento ou de cliente desistindo por demora), e ali
                embaixo ficava escondido no meio dos outros status. */}
            <StatTile
              label="Vales cancelados"
              valor={String(data.totalCancelados)}
              alerta={data.totalCancelados > 0}
            />
            <StatTile label="Valor de compra" valor={formatBRL(data.valorCompraCents)} />
            <StatTile label="Valor de entrega" valor={formatBRL(data.valorEntregaCents)} />
            <StatTile label="A pagar à agência" valor={formatBRL(data.valorFarmaciaDeveCents)} />
          </div>

          {/* O bloco "Por status" saiu a pedido do usuário (2026-08-12): a
              contagem por status de entrega e por eixo financeiro não é o
              que a gerência olha aqui. O que importava dele já tem lugar
              próprio — "Vales cancelados" virou tile lá em cima, e o eixo
              financeiro tem a aba Fechamento inteira. `porStatus` e
              `porStatusFinanceiro` continuam vindo do relatório porque a
              soma dos status é o que prova que nenhum vale se perdeu na
              agregação; só não têm mais superfície na tela. */}

          <Card>
            <CardHeader>
              <CardTitle>Por agência</CardTitle>
            </CardHeader>
            <CardContent>
              <AgenciaTable
                agencias={data.porAgencia}
                agenciasAbertas={agenciasAbertas}
                onToggleAgencia={toggleAgencia}
                motoboysAbertos={motoboysAbertos}
                onToggleMotoboy={toggleMotoboy}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function StatTile({
  label,
  valor,
  // destaque só quando o número pede atenção — cancelamento em zero é
  // notícia boa e não deve gritar na tela.
  alerta = false,
}: {
  label: string
  valor: string
  alerta?: boolean
}) {
  return (
    <div className={cn('rounded-lg border p-3', alerta && 'border-destructive/40 bg-destructive/5')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-medium', alerta && 'text-destructive')}>{valor}</p>
    </div>
  )
}

function AgenciaTable({
  agencias,
  agenciasAbertas,
  onToggleAgencia,
  motoboysAbertos,
  onToggleMotoboy,
}: {
  agencias: RelatorioAgencia[]
  agenciasAbertas: Set<string>
  onToggleAgencia: (chave: string) => void
  motoboysAbertos: Set<string>
  onToggleMotoboy: (chave: string) => void
}) {
  if (agencias.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma corrida com agência no período.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead>Agência</TableHead>
          <TableHead>Vales</TableHead>
          <TableHead>Entregues</TableHead>
          <TableHead>Insucessos</TableHead>
          <TableHead>Valor de entrega</TableHead>
          <TableHead>A pagar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agencias.map((agencia) => {
          const aberta = agenciasAbertas.has(agencia.chave)
          // recorta do conjunto geral só as chaves de motoboy que pertencem
          // a essa agência, pra passar pra GrupoTable como se fosse o dela
          // sozinha (ela só entende chave de motoboy, não a composta).
          const prefixo = `${agencia.chave}::`
          const abertosNessaAgencia = new Set(
            [...motoboysAbertos].filter((c) => c.startsWith(prefixo)).map((c) => c.slice(prefixo.length))
          )

          return (
            <Fragment key={agencia.chave}>
              <TableRow>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={aberta ? 'Esconder motoboys' : 'Mostrar motoboys'}
                    onClick={() => onToggleAgencia(agencia.chave)}
                  >
                    {aberta ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                </TableCell>
                <TableCell>{agencia.nome}</TableCell>
                <TableCell>{agencia.totalVales}</TableCell>
                <TableCell>{agencia.entregues}</TableCell>
                <TableCell>{agencia.insucessos}</TableCell>
                <TableCell>{formatBRL(agencia.valorEntregaCents)}</TableCell>
                <TableCell>{formatBRL(agencia.valorFarmaciaDeveCents)}</TableCell>
              </TableRow>
              {aberta && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-muted/30 p-3">
                    <GrupoTable
                      grupos={agencia.porMototaxista}
                      nomeColuna="Motoboy"
                      vazio="Nenhum motoboy nessa agência no período."
                      expandidos={abertosNessaAgencia}
                      onToggle={(motoboyChave) => onToggleMotoboy(chaveMotoboy(agencia.chave, motoboyChave))}
                    />
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
  expandidos: Set<string>
  onToggle: (chave: string) => void
}) {
  if (grupos.length === 0) {
    return <p className="text-sm text-muted-foreground">{vazio}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead>{nomeColuna}</TableHead>
          <TableHead>Vales</TableHead>
          <TableHead>Entregues</TableHead>
          <TableHead>Insucessos</TableHead>
          <TableHead>Valor de entrega</TableHead>
          <TableHead>A pagar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grupos.map((grupo) => {
          const aberto = expandidos.has(grupo.chave)
          return (
            <Fragment key={grupo.chave}>
              <TableRow>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={aberto ? 'Esconder vales' : 'Mostrar vales'}
                    onClick={() => onToggle(grupo.chave)}
                  >
                    {aberto ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                </TableCell>
                <TableCell>{grupo.nome}</TableCell>
                <TableCell>{grupo.totalVales}</TableCell>
                <TableCell>{grupo.entregues}</TableCell>
                <TableCell>{grupo.insucessos}</TableCell>
                <TableCell>{formatBRL(grupo.valorEntregaCents)}</TableCell>
                <TableCell>{formatBRL(grupo.valorFarmaciaDeveCents)}</TableCell>
              </TableRow>
              {aberto && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-background p-3">
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
