import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import {
  useRelatorio,
  FILTRO_RELATORIO_VAZIO,
  type FiltroRelatorio,
  type RelatorioAgencia,
  type RelatorioGrupo,
} from '@/data/relatorios'
import { useLojas } from '@/data/lojas'
import { useCidades, rotuloCidade } from '@/data/cidades'
import { useAgenciasDaCidade } from '@/data/corridas'
import { driveConfigurado, prepararDrive } from '@/lib/googleDrive'
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

// mesmo estilo dos outros selects nativos do app (Fechamento, Histórico)
const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

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

export function Relatorios({ profile }: { profile: AuthProfile }) {
  const hoje = localDateStr(new Date())
  const inicial: FiltroRelatorio = { dataInicio: hoje, dataFim: hoje, ...FILTRO_RELATORIO_VAZIO }
  const [form, setForm] = useState<FiltroRelatorio>(inicial)
  const [filtro, setFiltro] = useState<FiltroRelatorio>(inicial)

  // Só o admin escolhe filial: gerente e caixa já estão presos à própria
  // pela RLS, e um select que devolve sempre a mesma coisa é ruído.
  const podeFiltrarFilial = profile.papel === 'admin'
  const { data: lojas } = useLojas()
  const { data: cidades } = useCidades()
  // agência acompanha a filial escolhida — uma tele de outra cidade não
  // atende esta filial, então não deve nem aparecer como opção.
  const cidadeDaFilial = form.lojaId
    ? (lojas?.find((l) => l.id === form.lojaId)?.cidadeId ?? null)
    : null
  const { data: agencias } = useAgenciasDaCidade(cidadeDaFilial)
  const [agenciasAbertas, setAgenciasAbertas] = useState<Set<string>>(new Set())
  const [motoboysAbertos, setMotoboysAbertos] = useState<Set<string>>(new Set())
  // guarda QUAL formato está sendo gerado, pra só aquele botão mudar de
  // rótulo — com um booleano só, clicar em .xlsx deixava o PDF em
  // "Gerando…" também.
  const [exportando, setExportando] = useState<'xlsx' | 'pdf' | 'drive' | null>(null)
  const [erroExport, setErroExport] = useState<string | null>(null)
  const [enviadoAoDrive, setEnviadoAoDrive] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useRelatorio(filtro)

  // deixa o script do Google baixado de antemão, pra o clique não gastar
  // o gesto do usuário esperando rede (ver prepararDrive)
  useEffect(() => {
    prepararDrive()
  }, [])

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

  // O que o PDF impresso precisa pra se explicar sozinho: quem emitiu e
  // quais filtros valiam. O filtro aplicado é o `filtro`, não o `form` —
  // o formulário pode ter mudado sem ninguém clicar em "Aplicar", e o
  // papel tem que descrever o que está na tela.
  function contextoDoAcerto() {
    return {
      emitidoPor: profile.nome,
      filialNome: filtro.lojaId
        ? (lojas?.find((l) => l.id === filtro.lojaId)?.nome ?? null)
        : null,
      agenciaNome: filtro.agenciaId
        ? (agencias?.find((a) => a.id === filtro.agenciaId)?.nome ?? null)
        : null,
    }
  }

  // os dois formatos saem do MESMO `data` que está na tela — nunca de uma
  // segunda consulta. Duas consultas podem divergir, e aí existem duas
  // versões do acerto sem ninguém pra desempatar.
  async function exportar(formato: 'xlsx' | 'pdf') {
    if (!data) return
    setExportando(formato)
    setErroExport(null)
    try {
      // import dinâmico lá dentro: a biblioteca só desce quando alguém clica
      if (formato === 'xlsx') {
        const { exportarAcertoXlsx } = await import('@/lib/exportarAcerto')
        await exportarAcertoXlsx(data, filtro)
      } else {
        const { exportarAcertoPdf } = await import('@/lib/exportarAcertoPdf')
        await exportarAcertoPdf(data, filtro, contextoDoAcerto())
      }
    } catch (e) {
      const nome = formato === 'xlsx' ? 'a planilha' : 'o PDF'
      setErroExport(`Não consegui gerar ${nome}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportando(null)
    }
  }

  // Manda os DOIS arquivos: quem confere com a agência quer o PDF, quem
  // confere os números quer a planilha, e separar em dois botões só
  // multiplicaria a janela de autorização do Google.
  async function enviarParaDrive() {
    if (!data) return
    setExportando('drive')
    setErroExport(null)
    setEnviadoAoDrive(null)
    try {
      // AUTORIZA PRIMEIRO. Gerar a planilha e o PDF leva centenas de
      // milissegundos, e um pop-up aberto depois disso já não conta como
      // resposta ao clique — o navegador bloqueia. Foi exatamente o que
      // aconteceu quando o token da sessão anterior venceu.
      const { autorizarDrive, enviarAoDrive, NOME_DA_PASTA, nomeDaSubpasta, caminhoDoAcerto } =
        await import('@/lib/googleDrive')
      await autorizarDrive()

      const [{ gerarXlsx }, { gerarPdf }] = await Promise.all([
        import('@/lib/exportarAcerto'),
        import('@/lib/exportarAcertoPdf'),
      ])
      const arquivos = [
        await gerarXlsx(data, filtro),
        await gerarPdf(data, filtro, contextoDoAcerto()),
      ]
      const enviados = await enviarAoDrive(arquivos, caminhoDoAcerto(filtro))
      const subpasta = nomeDaSubpasta(filtro.dataInicio, filtro.dataFim)
      setEnviadoAoDrive(
        `${enviados.length} arquivos enviados para ${NOME_DA_PASTA} › ${subpasta}.`
      )
    } catch (e) {
      setErroExport(`Não consegui enviar ao Drive: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportando(null)
    }
  }

  // os atalhos mexem só no período e preservam filial/agência: quem
  // escolheu uma filial e clica "Este mês" quer o mês daquela filial.
  function aplicarPeriodo(dataInicio: string, dataFim: string) {
    const proximo = { ...form, dataInicio, dataFim }
    setForm(proximo)
    setFiltro(proximo)
  }

  function aplicarHoje() {
    const h = localDateStr(new Date())
    aplicarPeriodo(h, h)
  }

  function aplicarEsteMes() {
    const agora = new Date()
    aplicarPeriodo(localDateStr(new Date(agora.getFullYear(), agora.getMonth(), 1)), localDateStr(agora))
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
        {podeFiltrarFilial && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="r-filial">Filial</Label>
              <select
                id="r-filial"
                className={SELECT_CLASSNAME}
                value={form.lojaId}
                // trocar de filial zera a agência: a que estava escolhida
                // pode ser de outra cidade e não atender a nova.
                onChange={(e) => setForm({ ...form, lojaId: e.target.value, agenciaId: '' })}
              >
                <option value="">Todas as filiais</option>
                {lojas?.map((loja) => (
                  <option key={loja.id} value={loja.id}>
                    {loja.nome}
                    {loja.cidadeId
                      ? ` — ${rotuloCidade(cidades?.find((c) => c.id === loja.cidadeId))}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="r-agencia">Agência</Label>
              <select
                id="r-agencia"
                className={SELECT_CLASSNAME}
                value={form.agenciaId}
                onChange={(e) => setForm({ ...form, agenciaId: e.target.value })}
              >
                <option value="">Todas as agências</option>
                {agencias?.map((agencia) => (
                  <option key={agencia.id} value={agencia.id}>
                    {agencia.nome}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <Button onClick={() => setFiltro(form)}>Aplicar</Button>
        <Button variant="outline" onClick={aplicarHoje}>
          Hoje
        </Button>
        <Button variant="outline" onClick={aplicarEsteMes}>
          Este mês
        </Button>
        {/* Exporta o que está na tela, não uma segunda consulta: o arquivo
            e o relatório precisam contar a mesma história, senão vira duas
            versões do acerto e alguém tem que decidir em qual acreditar. */}
        <Button variant="outline" onClick={() => exportar('xlsx')} disabled={!data || !!exportando}>
          {exportando === 'xlsx' ? 'Gerando…' : 'Exportar .xlsx'}
        </Button>
        <Button variant="outline" onClick={() => exportar('pdf')} disabled={!data || !!exportando}>
          {exportando === 'pdf' ? 'Gerando…' : 'Exportar PDF'}
        </Button>
        {/* só aparece se o ambiente tem o Client ID configurado — sem ele
            o botão existiria só pra dar erro ao ser clicado */}
        {driveConfigurado() && (
          <Button variant="outline" onClick={enviarParaDrive} disabled={!data || !!exportando}>
            {exportando === 'drive' ? 'Enviando…' : 'Enviar ao Drive'}
          </Button>
        )}
      </div>

      {erroExport && <p className="text-sm text-destructive">{erroExport}</p>}
      {enviadoAoDrive && <p className="text-sm text-foreground/70">{enviadoAoDrive}</p>}

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

  // Uma agência só no resultado é o caso das filiais de uma cidade: lá uma
  // única tele faz todas as corridas, então esconder os motoboys atrás de
  // um chevron seria um clique que não separa nada. O nome da agência
  // continua na tela — some o clique, não a informação.
  const agenciaUnica = agencias.length === 1
  if (agenciaUnica) {
    const agencia = agencias[0]
    const prefixo = `${agencia.chave}::`
    const abertosNessaAgencia = new Set(
      [...motoboysAbertos].filter((c) => c.startsWith(prefixo)).map((c) => c.slice(prefixo.length))
    )
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border bg-muted/30 p-3">
          <span className="font-medium">{agencia.nome}</span>
          <span className="text-sm text-foreground/70">
            {agencia.totalVales} vales · {agencia.entregues} entregues · {agencia.insucessos}{' '}
            insucessos · entrega {formatBRL(agencia.valorEntregaCents)} ·{' '}
            <strong className="text-foreground">
              a pagar {formatBRL(agencia.valorFarmaciaDeveCents)}
            </strong>
          </span>
        </div>
        <GrupoTable
          grupos={agencia.porMototaxista}
          nomeColuna="Motoboy"
          vazio="Nenhum motoboy nessa agência no período."
          expandidos={abertosNessaAgencia}
          onToggle={(motoboyChave) => onToggleMotoboy(chaveMotoboy(agencia.chave, motoboyChave))}
        />
      </div>
    )
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
