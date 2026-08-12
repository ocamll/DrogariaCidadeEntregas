import { useState } from 'react'
import { useEventosAuditoria, TIPO_EVENTO_LABEL } from '@/data/auditoria'
import type { AuthProfile } from '@/data/auth'
import { useLojas } from '@/data/lojas'
import type { FiltroPeriodo } from '@/data/relatorios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

function localDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function RegistroAuditoria({ profile }: { profile: AuthProfile }) {
  const soAdmin = profile.papel === 'admin'
  const hoje = localDateStr(new Date())
  const [form, setForm] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [filtro, setFiltro] = useState<FiltroPeriodo>({ dataInicio: hoje, dataFim: hoje })
  const [lojaId, setLojaId] = useState('') // '' = todas as filiais
  // O componente fica sempre montado (é ele que desenha o botão do
  // cabeçalho), então sem esta flag a query pesada rodava em toda carga de
  // página pra quem nunca abre o registro.
  const [aberto, setAberto] = useState(false)

  const { data, isLoading, isError, error } = useEventosAuditoria(filtro, aberto)
  const { data: lojas } = useLojas()

  const eventos = (data ?? []).filter((e) => !lojaId || e.lojaId === lojaId)

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
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          Registro de auditoria
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Registro de auditoria</DialogTitle>
          <DialogDescription>
            Tudo que já foi gravado no sistema — o que aconteceu, quem fez, quando. Separado por
            filial pra não misturar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="aud-inicio">De</Label>
            <Input
              id="aud-inicio"
              type="date"
              value={form.dataInicio}
              onChange={(e) => setForm({ ...form, dataInicio: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="aud-fim">Até</Label>
            <Input
              id="aud-fim"
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
          {/* Só admin: pro gerente a RLS já devolve apenas os eventos da
              filial dele, então o select listaria as 17 lojas pra filtrar
              um conjunto que só tem uma. */}
          {soAdmin && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="aud-filial">Filial</Label>
              <select
                id="aud-filial"
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
          )}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
        {!isLoading && !isError && eventos.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum evento no período.</p>
        )}
        {!isLoading && !isError && eventos.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vale</TableHead>
                  <TableHead>Filial</TableHead>
                  <TableHead>Resumo</TableHead>
                  <TableHead>Autor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((evento) => (
                  <TableRow key={evento.id}>
                    <TableCell>
                      {new Date(evento.ocorridoEm).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>{TIPO_EVENTO_LABEL[evento.tipo] ?? evento.tipo}</TableCell>
                    <TableCell>
                      {evento.numeroVale ?? '—'}
                      {evento.clienteNome ? ` — ${evento.clienteNome}` : ''}
                    </TableCell>
                    <TableCell>{evento.lojaNome ?? '—'}</TableCell>
                    <TableCell>
                      {evento.resumo}
                      {evento.detalhe && (
                        <p className="text-xs text-muted-foreground">"{evento.detalhe}"</p>
                      )}
                    </TableCell>
                    <TableCell>{evento.autorNome}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
