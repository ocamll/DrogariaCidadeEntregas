import { useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useHistoricoEntregas,
  FILTROS_HISTORICO_VAZIOS,
  type FiltrosHistorico,
} from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export function HistoricoEntregas({ profile }: { profile: AuthProfile }) {
  const [form, setForm] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)
  const [filtros, setFiltros] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)

  const { data, isLoading, isError, error } = useHistoricoEntregas(filtros)

  function aplicarFiltros() {
    setFiltros(form)
  }

  function limparFiltros() {
    setForm(FILTROS_HISTORICO_VAZIOS)
    setFiltros(FILTROS_HISTORICO_VAZIOS)
  }

  function onEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    aplicarFiltros()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-vale">Número do vale</Label>
          <Input
            id="f-vale"
            value={form.numeroVale}
            onChange={(e) => setForm({ ...form, numeroVale: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-cliente">Cliente</Label>
          <Input
            id="f-cliente"
            value={form.clienteNome}
            onChange={(e) => setForm({ ...form, clienteNome: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-endereco">Endereço</Label>
          <Input
            id="f-endereco"
            value={form.clienteEndereco}
            onChange={(e) => setForm({ ...form, clienteEndereco: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-valor">Valor da compra (R$)</Label>
          <Input
            id="f-valor"
            inputMode="decimal"
            value={form.valorCompra}
            onChange={(e) => setForm({ ...form, valorCompra: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-data-inicio">De</Label>
          <Input
            id="f-data-inicio"
            type="date"
            value={form.dataInicio}
            onChange={(e) => setForm({ ...form, dataInicio: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-data-fim">Até</Label>
          <Input
            id="f-data-fim"
            type="date"
            value={form.dataFim}
            onChange={(e) => setForm({ ...form, dataFim: e.target.value })}
            onKeyDown={onEnter}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={aplicarFiltros}>Filtrar</Button>
        <Button variant="outline" onClick={limparFiltros}>
          Limpar
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {!isLoading && !isError && <EntregasTable entregas={data ?? []} profile={profile} mostrarData />}
    </div>
  )
}
