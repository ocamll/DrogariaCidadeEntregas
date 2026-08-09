import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useConveniosCadastro,
  useSalvarConvenio,
  useAlternarAtivoConvenio,
  type ConvenioCadastro,
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

export function ConveniosCadastro({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useConveniosCadastro()
  const [editando, setEditando] = useState<ConvenioCadastro | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const alternarAtivo = useAlternarAtivoConvenio()

  function abrirNovo() {
    setEditando(null)
    setDialogAberto(true)
  }

  function abrirEditar(convenio: ConvenioCadastro) {
    setEditando(convenio)
    setDialogAberto(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={abrirNovo}>Novo convênio</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {!isLoading && !isError && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum convênio cadastrado ainda.</p>
      )}
      {!isLoading && !isError && data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Exige assinatura</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((convenio) => (
              <TableRow key={convenio.id}>
                <TableCell>{convenio.nome}</TableCell>
                <TableCell>{convenio.cnpj ?? '—'}</TableCell>
                <TableCell>{convenio.exigeAssinatura ? 'Sim' : 'Não'}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => alternarAtivo.mutate({ id: convenio.id, ativo: !convenio.ativo })}
                    title={convenio.ativo ? 'Clica pra desativar' : 'Clica pra reativar'}
                  >
                    <Badge variant={convenio.ativo ? 'secondary' : 'destructive'}>
                      {convenio.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => abrirEditar(convenio)}>
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConvenioFormDialog
        key={editando?.id ?? 'novo'}
        convenio={editando}
        profile={profile}
        open={dialogAberto}
        onOpenChange={setDialogAberto}
      />
    </div>
  )
}

function ConvenioFormDialog({
  convenio,
  profile,
  open,
  onOpenChange,
}: {
  convenio: ConvenioCadastro | null
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [nome, setNome] = useState(convenio?.nome ?? '')
  const [cnpj, setCnpj] = useState(convenio?.cnpj ?? '')
  const [exigeAssinatura, setExigeAssinatura] = useState(convenio?.exigeAssinatura ?? true)
  const [erro, setErro] = useState<string | null>(null)

  const salvar = useSalvarConvenio()

  function handleSalvar() {
    if (!nome.trim()) {
      setErro('Nome é obrigatório.')
      return
    }
    setErro(null)

    salvar.mutate(
      {
        id: convenio?.id,
        tenantId: profile.tenantId,
        nome: nome.trim(),
        cnpj: cnpj.trim() || null,
        exigeAssinatura,
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
          <DialogTitle>{convenio ? 'Editar convênio' : 'Novo convênio'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="convenio-nome">Nome</Label>
            <Input id="convenio-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="convenio-cnpj">CNPJ</Label>
            <Input id="convenio-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exigeAssinatura}
              onChange={(e) => setExigeAssinatura(e.target.checked)}
            />
            Exige assinatura na entrega
          </label>

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
