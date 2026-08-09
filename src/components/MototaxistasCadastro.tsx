import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useAgenciasCadastro,
  useMototaxistasCadastro,
  useSalvarMototaxista,
  useAlternarAtivoMototaxista,
  type MototaxistaCadastro,
} from '@/data/cadastros'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function MototaxistasCadastro({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useMototaxistasCadastro()
  const { data: agencias } = useAgenciasCadastro()
  const [editando, setEditando] = useState<MototaxistaCadastro | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const alternarAtivo = useAlternarAtivoMototaxista()

  const nomeAgencia = (agenciaId: string | null) =>
    agencias?.find((a) => a.id === agenciaId)?.nome ?? '—'

  function abrirNovo() {
    setEditando(null)
    setDialogAberto(true)
  }

  function abrirEditar(mototaxista: MototaxistaCadastro) {
    setEditando(mototaxista)
    setDialogAberto(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={abrirNovo} disabled={!agencias || agencias.length === 0}>
          Novo motoboy
        </Button>
      </div>

      {!isLoading && !isError && (!agencias || agencias.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Cadastra uma agência primeiro — todo motoboy precisa estar associado a uma.
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {!isLoading && !isError && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum motoboy cadastrado ainda.</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Agência</TableHead>
              <TableHead>CPF</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((mototaxista) => (
              <TableRow key={mototaxista.id}>
                <TableCell>{mototaxista.nome}</TableCell>
                <TableCell>{nomeAgencia(mototaxista.agenciaId)}</TableCell>
                <TableCell>{mototaxista.cpf ?? '—'}</TableCell>
                <TableCell>{mototaxista.telefone ?? '—'}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() =>
                      alternarAtivo.mutate({ id: mototaxista.id, ativo: !mototaxista.ativo })
                    }
                    title={mototaxista.ativo ? 'Clica pra desativar' : 'Clica pra reativar'}
                  >
                    <Badge variant={mototaxista.ativo ? 'secondary' : 'destructive'}>
                      {mototaxista.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => abrirEditar(mototaxista)}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {agencias && agencias.length > 0 && (
        <MototaxistaFormDialog
          key={editando?.id ?? 'novo'}
          mototaxista={editando}
          agencias={agencias}
          profile={profile}
          open={dialogAberto}
          onOpenChange={setDialogAberto}
        />
      )}
    </div>
  )
}

function MototaxistaFormDialog({
  mototaxista,
  agencias,
  profile,
  open,
  onOpenChange,
}: {
  mototaxista: MototaxistaCadastro | null
  agencias: { id: string; nome: string; ativo: boolean }[]
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [nome, setNome] = useState(mototaxista?.nome ?? '')
  const [agenciaId, setAgenciaId] = useState(mototaxista?.agenciaId ?? '')
  const [cpf, setCpf] = useState(mototaxista?.cpf ?? '')
  const [telefone, setTelefone] = useState(mototaxista?.telefone ?? '')
  const [erro, setErro] = useState<string | null>(null)

  const salvar = useSalvarMototaxista()

  function handleSalvar() {
    if (!nome.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    if (!agenciaId) {
      setErro('Escolhe a agência — sem isso o motoboy não aparece na Nova corrida.')
      return
    }
    setErro(null)

    salvar.mutate(
      {
        id: mototaxista?.id,
        tenantId: profile.tenantId,
        nome: nome.trim(),
        agenciaId,
        cpf: cpf.trim() || null,
        telefone: telefone.trim() || null,
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
          <DialogTitle>{mototaxista ? 'Editar motoboy' : 'Novo motoboy'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="moto-nome">Nome</Label>
            <Input id="moto-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Agência</Label>
            <Select value={agenciaId} onValueChange={setAgenciaId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {agencias.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome}
                    {!a.ativo ? ' (inativa)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="moto-cpf">CPF</Label>
            <Input id="moto-cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="moto-telefone">Telefone</Label>
            <Input id="moto-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
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
