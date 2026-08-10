import { useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useHistoricoEntregas,
  FILTROS_HISTORICO_VAZIOS,
  TAMANHO_PAGINA_HISTORICO,
  type FiltrosHistorico,
} from '@/data/entregas'
import { useLojas } from '@/data/lojas'
import { EntregasTable } from '@/components/EntregasTable'
import { CampoMoeda } from '@/components/CampoMoeda'
import { Paginacao, ResumoPagina } from '@/components/Paginacao'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const SELECT_CLASSNAME =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function HistoricoEntregas({ profile }: { profile: AuthProfile }) {
  const [form, setForm] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)
  const [filtros, setFiltros] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)
  const [pagina, setPagina] = useState(1)

  const { data, isLoading, isError, error, isFetching } = useHistoricoEntregas(filtros, pagina)
  const { data: lojas } = useLojas()

  // Caixa já é preso à própria loja pela RLS — o select só faz sentido pra
  // quem enxerga mais de uma filial.
  const podeFiltrarFilial = profile.papel === 'admin' || profile.papel === 'gerente'

  // Todo filtro novo volta pra página 1: senão dá pra ficar preso numa
  // página 7 que não existe mais no resultado novo.
  function aplicarFiltros() {
    setFiltros(form)
    setPagina(1)
  }

  function limparFiltros() {
    setForm(FILTROS_HISTORICO_VAZIOS)
    setFiltros(FILTROS_HISTORICO_VAZIOS)
    setPagina(1)
  }

  function onEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    aplicarFiltros()
  }

  const total = data?.total ?? 0
  const totalPaginas = data?.totalPaginas ?? 1

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
          <Label htmlFor="f-valor">Valor da compra</Label>
          {/* mesma máscara do cadastro — o caixa busca digitando igual
              lançou, sem ter que lembrar de outro formato aqui. */}
          <CampoMoeda
            id="f-valor"
            digitos={form.valorCompra}
            onDigitos={(valorCompra) => setForm({ ...form, valorCompra })}
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
        {podeFiltrarFilial && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-filial">Filial</Label>
            <select
              id="f-filial"
              className={SELECT_CLASSNAME}
              value={form.lojaId}
              onChange={(e) => setForm({ ...form, lojaId: e.target.value })}
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

      <div className="flex gap-2">
        <Button onClick={aplicarFiltros}>Filtrar</Button>
        <Button variant="outline" onClick={limparFiltros}>
          Limpar
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {!isLoading && !isError && (
        <>
          <ResumoPagina
            pagina={pagina}
            tamanhoPagina={TAMANHO_PAGINA_HISTORICO}
            total={total}
            atualizando={isFetching}
          />
          <EntregasTable entregas={data?.entregas ?? []} profile={profile} mostrarData />
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} onIr={setPagina} />
        </>
      )}
    </div>
  )
}
