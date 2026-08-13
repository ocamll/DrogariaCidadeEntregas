import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useAgenciasCadastro,
  useSalvarAgencia,
  useAlternarAtivoAgencia,
  type AgenciaCadastro,
} from '@/data/cadastros'
import { useCidades, rotuloCidade } from '@/data/cidades'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function AgenciasCadastro({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useAgenciasCadastro()
  const { data: cidades } = useCidades()
  const [editando, setEditando] = useState<AgenciaCadastro | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const alternarAtivo = useAlternarAtivoAgencia()

  function abrirNova() {
    setEditando(null)
    setDialogAberto(true)
  }

  function abrirEditar(agencia: AgenciaCadastro) {
    setEditando(agencia)
    setDialogAberto(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={abrirNova}>Nova agência</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {!isLoading && !isError && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma agência cadastrada ainda.</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((agencia) => (
              <TableRow key={agencia.id}>
                <TableCell>{agencia.nome}</TableCell>
                {/* agência sem cidade não aparece pra filial nenhuma na
                    hora da corrida — por isso o aviso, e não um "—" mudo */}
                <TableCell>
                  {agencia.cidadeId ? (
                    rotuloCidade(cidades?.find((c) => c.id === agencia.cidadeId))
                  ) : (
                    <span className="text-destructive">sem cidade</span>
                  )}
                </TableCell>
                <TableCell>{agencia.cnpj ?? '—'}</TableCell>
                <TableCell>{agencia.contato ?? '—'}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => alternarAtivo.mutate({ id: agencia.id, ativo: !agencia.ativo })}
                    title={agencia.ativo ? 'Clica pra desativar' : 'Clica pra reativar'}
                  >
                    <Badge variant={agencia.ativo ? 'secondary' : 'destructive'}>
                      {agencia.ativo ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => abrirEditar(agencia)}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AgenciaFormDialog
        key={editando?.id ?? 'nova'}
        agencia={editando}
        profile={profile}
        open={dialogAberto}
        onOpenChange={setDialogAberto}
      />
    </div>
  )
}

function AgenciaFormDialog({
  agencia,
  profile,
  open,
  onOpenChange,
}: {
  agencia: AgenciaCadastro | null
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [nome, setNome] = useState(agencia?.nome ?? '')
  const [cnpj, setCnpj] = useState(agencia?.cnpj ?? '')
  const [contato, setContato] = useState(agencia?.contato ?? '')
  const [cidadeId, setCidadeId] = useState(agencia?.cidadeId ?? '')
  const [erro, setErro] = useState<string | null>(null)

  const { data: cidades } = useCidades()
  const salvar = useSalvarAgencia()

  function handleSalvar() {
    if (!nome.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    // Cidade é obrigatória mesmo o schema aceitando null: agência sem
    // cidade não aparece no dropdown de "Nova corrida" pra filial nenhuma,
    // ou seja, seria cadastrada e invisível.
    if (!cidadeId) {
      setErro('Escolhe a cidade que a agência atende.')
      return
    }
    setErro(null)

    salvar.mutate(
      {
        id: agencia?.id,
        tenantId: profile.tenantId,
        nome: nome.trim(),
        cnpj: cnpj.trim() || null,
        contato: contato.trim() || null,
        cidadeId,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) => setErro(error.message),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{agencia ? 'Editar agência' : 'Nova agência'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="agencia-nome">Nome</Label>
            <Input id="agencia-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agencia-cidade">Cidade que atende</Label>
            <select
              id="agencia-cidade"
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              value={cidadeId}
              onChange={(e) => setCidadeId(e.target.value)}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {cidades?.map((cidade) => (
                <option key={cidade.id} value={cidade.id}>
                  {rotuloCidade(cidade)}
                </option>
              ))}
            </select>
            <p className="text-xs text-foreground/70">
              Ela só vai aparecer para as filiais desta cidade.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agencia-cnpj">CNPJ</Label>
            <Input id="agencia-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agencia-contato">Contato</Label>
            <Input id="agencia-contato" value={contato} onChange={(e) => setContato(e.target.value)} />
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSalvar} disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
