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
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'

const SELECT_CLASSNAME =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30'

export function HistoricoEntregas({ profile }: { profile: AuthProfile }) {
  const [form, setForm] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)
  const [filtros, setFiltros] = useState<FiltrosHistorico>(FILTROS_HISTORICO_VAZIOS)
  const [pagina, setPagina] = useState(1)

  const consulta = useHistoricoEntregas(filtros, pagina)
  const estado = derivarEstado(consulta)
  const { data: lojas } = useLojas()

  // Caixa já é preso à própria loja pela RLS — o select só faz sentido pra
  // quem enxerga mais de uma filial.
  // Só admin: desde 2026-08-12 a RLS prende gerente e caixa à própria
  // filial, então pros dois o select mostraria 17 opções que devolvem a
  // mesma coisa (ou nada).
  const podeFiltrarFilial = profile.papel === 'admin'

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

  // `data?.total ?? 0` e `data?.totalPaginas ?? 1` saíram daqui: eram
  // valores INVENTADOS pra quando a consulta não respondeu, e um "0
  // resultados" fabricado é a afirmação que esta tela não pode fazer. Os
  // números reais são lidos dentro do `ready`, onde existem.

  return (
    <div className="flex flex-col gap-4">
      {/* Dois grupos, não um só: em cima o que se digita procurando um vale
          específico; embaixo o período com os botões junto, porque filtrar
          por data é a busca que mais se repete e ter que descer até uma
          fileira separada de botões custava um passo a cada tentativa. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
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

      {/* `items-end` alinha os botões pela base dos campos: como o label
          fica acima do input, sem isso eles subiriam pra altura do rótulo. */}
      <div className="flex flex-wrap items-end gap-3">
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
        <Button onClick={aplicarFiltros}>Filtrar</Button>
        <Button variant="outline" onClick={limparFiltros}>
          Limpar
        </Button>
      </div>

      {/* A BUSCA SÓ PODE CONCLUIR SOBRE DADO CONHECIDO.

          Aqui o filtro roda no SERVIDOR (`like` sobre `cliente_nome_busca`,
          a coluna gerada do E1.1), então `ready` já quer dizer "o servidor
          respondeu PARA ESTA BUSCA" — e é só de dentro dele que
          `EntregasTable` pode dizer "Nenhum vale encontrado".

          Sem isto o E1.1 era desfeito por outra porta: ele existe porque
          "resultado vazio é indistinguível de não existe cadastro, a pior
          forma de errar numa busca" — e offline a tela voltava a dizer
          exatamente isso, agora por falta de resposta em vez de por
          acento. A frase de indisponível não fala da busca, fala da
          consulta, que é a verdade. */}
      <Consulta estado={estado} aoRecarregar={() => void consulta.refetch()}>
        {(resultado) => (
          <>
            <ResumoPagina
              pagina={pagina}
              tamanhoPagina={TAMANHO_PAGINA_HISTORICO}
              total={resultado.total}
              atualizando={consulta.isFetching}
            />
            <EntregasTable entregas={resultado.entregas} profile={profile} mostrarData />
            <Paginacao pagina={pagina} totalPaginas={resultado.totalPaginas} onIr={setPagina} />
          </>
        )}
      </Consulta>
    </div>
  )
}
