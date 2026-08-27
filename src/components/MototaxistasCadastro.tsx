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
import { EmAndamento } from '@/components/EmAndamento'
import { Consulta, AvisoDaConsulta } from '@/components/Consulta'
import { apresentar, derivarEstado, vazioConfirmado } from '@/lib/estadoDeConsulta'
import { normalizarNome } from '@/lib/texto'

// DUAS CONSULTAS, DUAS VERDADES — e este arquivo é o caso de prova.
//
// Ele tinha o defeito mais teimoso do inventário, e o único que falhava
// ATÉ ONLINE: a frase "Cadastra uma agência primeiro" era guardada por
// `!isLoading && !isError`, flags da query de MOTOBOYS, pra decidir
// sobre o `data` da query de AGÊNCIAS.
//
// Bastava a de motoboys responder primeiro — o que acontece a toda hora,
// são requisições independentes — pra a tela mandar o admin cadastrar
// uma agência que já existe. Offline era permanente.
//
// A regra que substitui: cada consulta carrega a própria verdade, e
// nenhuma decide a semântica da outra. Daí os dois `derivarEstado`.
//
// E a distinção que isso preserva é semântica, não cosmética:
//
//     não há agência          ≠   há agência, mas não há motoboy
//     (agências ready, vazio)     (agências ready c/ 1+, motoboys vazio)
//
// A primeira só pode ser dita com `vazioConfirmado(estadoAgencias)`.
export function MototaxistasCadastro({ profile }: { profile: AuthProfile }) {
  const consultaMotoboys = useMototaxistasCadastro()
  const consultaAgencias = useAgenciasCadastro()
  const estadoMotoboys = derivarEstado(consultaMotoboys)
  const estadoAgencias = derivarEstado(consultaAgencias)

  const [editando, setEditando] = useState<MototaxistaCadastro | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const alternarAtivo = useAlternarAtivoMototaxista()

  const agencias = estadoAgencias.estado === 'ready' ? estadoAgencias.dados : undefined

  // NÃO HÁ AGÊNCIA e NÃO SEI QUAL É são coisas diferentes, e o `—` dizia
  // as duas. Um motoboy com agência aparecendo como "—" é a tabela
  // afirmando ausência a partir da ignorância de OUTRA consulta.
  const nomeAgencia = (agenciaId: string | null) => {
    if (agenciaId === null) return '—'
    if (!agencias) return '…'
    return agencias.find((a) => a.id === agenciaId)?.nome ?? '—'
  }

  // Só libera o cadastro quando SABEMOS que há agência. Sem resposta o
  // botão continua travado — mas agora a tela diz por quê, logo abaixo,
  // em vez de deixar um botão morto sem explicação.
  const temAgencia = agencias !== undefined && agencias.length > 0

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
        <Button onClick={abrirNovo} disabled={!temAgencia}>
          Novo motoboy
        </Button>
      </div>

      {/* A AFIRMAÇÃO SOBRE AGÊNCIAS SAI DO ESTADO DE AGÊNCIAS, e de mais
          nada. `vazioConfirmado` só é verdadeiro em `ready` com lista
          vazia — então loading, unavailable e error nunca chegam aqui. */}
      {vazioConfirmado(estadoAgencias) && (
        <p className="text-sm text-muted-foreground">
          Cadastra uma agência primeiro — todo motoboy precisa estar associado a uma.
        </p>
      )}

      {/* E quando a consulta de agências não respondeu, a tela diz ISSO —
          que é outra frase, e a verdadeira. Sem ela o botão acima ficaria
          desabilitado sem motivo visível, trocando a afirmação falsa por
          um estado mudo. */}
      {estadoAgencias.estado !== 'ready' && estadoAgencias.estado !== 'inactive' && (
        <AvisoDaConsulta
          apresentacao={apresentar(estadoAgencias)}
          aoRecarregar={() => void consultaAgencias.refetch()}
        />
      )}

      <Consulta
        estado={estadoMotoboys}
        vazio={<p className="text-sm text-muted-foreground">Nenhum motoboy cadastrado ainda.</p>}
        aoRecarregar={() => void consultaMotoboys.refetch()}
      >
        {(motoboys) => (
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
              {motoboys.map((mototaxista) => (
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
      </Consulta>

      {temAgencia && agencias && (
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
        nome: normalizarNome(nome),
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
            {salvar.isPending ? <EmAndamento>Salvando</EmAndamento> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
