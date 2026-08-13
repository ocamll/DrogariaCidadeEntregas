import { useState, type ReactNode } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useDocumentosConvenioPendentes,
  useMarcarDocumentoConvenioRecebido,
  useReceitasPendentes,
  useMarcarReceitaRecebida,
  useNotificarDocumentoConvenio,
  useNotificarFaltaReceita,
  type NotificarDocumentoInput,
} from '@/data/documentos'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// A lista tem teto — se bateu nele, diz na cara em vez de deixar o caixa
// achar que acabou. Aparece só quando realmente há mais pendência.
function AvisoTemMais({ mostrar }: { mostrar: boolean }) {
  if (!mostrar) return null
  return (
    <p className="text-sm text-destructive">
      Há mais pendências do que cabe nesta lista — vai limpando as mais antigas (que aparecem
      primeiro) que o resto aparece.
    </p>
  )
}

// As duas listas (convênio e receita) não têm os mesmos campos, mas têm as
// mesmas PERGUNTAS: qual vale, de quem, desde quando, e o botão de dar
// baixa. Antes eram duas tabelas independentes com contagem de colunas
// diferente, então cada uma calculava as larguras por conta e as colunas
// iguais não se alinhavam entre si.
//
// Aqui as duas usam a mesma grade, e `table-fixed` é o que garante o
// alinhamento: sem ele, o layout automático ainda dimensionaria cada
// tabela pelo próprio conteúdo e o "Cliente" de uma cairia num x
// diferente do "Cliente" da outra. A coluna do meio existe nas duas —
// quando não há convênio, mostra "—" em vez de sumir e desalinhar tudo.
const LARGURAS = ['w-[14%]', 'w-[26%]', 'w-[18%]', 'w-[12%]', 'w-[30%]']

// Notificar que o papel não voltou. A justificativa é obrigatória pelo
// mesmo motivo do cancelamento e da divergência: sem ela a gestão recebe
// "sumiu" e não tem o que fazer com isso.
//
// NÃO tira o item da fila de pendências (decisão do usuário em
// 2026-08-13): convênio e receita costumam aparecer dias depois, e a
// pendência só se encerra com o papel na mão. Isto aqui é o registro.
function NaoVoltouDialog({
  aberto,
  onFechar,
  titulo,
  descricao,
  onConfirmar,
  salvando,
}: {
  aberto: boolean
  onFechar: () => void
  titulo: string
  descricao: string
  onConfirmar: (justificativa: string) => void
  salvando: boolean
}) {
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    const texto = justificativa.trim()
    if (!texto) {
      setErro('Escreve o que aconteceu — é o que a gestão vai ler.')
      return
    }
    setErro(null)
    onConfirmar(texto)
    setJustificativa('')
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) {
          setJustificativa('')
          setErro(null)
          onFechar()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-justificativa">O que aconteceu</Label>
          <Textarea
            id="doc-justificativa"
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Ex: convênio devolveu sem assinatura do titular."
          />
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando ? 'Registrando…' : 'Registrar ocorrência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type LinhaPendencia = {
  id: string
  numeroVale: string
  clienteNome: string
  meio: string
  desde: string
}

function TabelaPendencias({
  linhas,
  rotuloMeio,
  rotuloAcao,
  onAcao,
  onNotificar,
}: {
  linhas: LinhaPendencia[]
  rotuloMeio: string
  rotuloAcao: string
  onAcao: (id: string) => void
  onNotificar: (id: string) => void
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className={LARGURAS[0]}>Vale</TableHead>
          <TableHead className={LARGURAS[1]}>Cliente</TableHead>
          <TableHead className={LARGURAS[2]}>{rotuloMeio}</TableHead>
          <TableHead className={LARGURAS[3]}>Desde</TableHead>
          <TableHead className={LARGURAS[4]} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((linha) => (
          <TableRow key={linha.id}>
            <TableCell className="tabular-nums">{linha.numeroVale}</TableCell>
            <TableCell className="whitespace-normal break-words">{linha.clienteNome}</TableCell>
            <TableCell className="whitespace-normal break-words">{linha.meio}</TableCell>
            <TableCell className="tabular-nums">{formatarData(linha.desde)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onAcao(linha.id)}>
                  {rotuloAcao}
                </Button>
                {/* o caminho infeliz mora ao lado do feliz, na mesma linha:
                    quem descobre que o papel não voltou está exatamente
                    aqui, conferindo a fila. */}
                <Button variant="ghost" size="sm" onClick={() => onNotificar(linha.id)}>
                  Não voltou
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// Estado do dialog de "não voltou", compartilhado pelas duas seções.
// A chave de idempotência nasce ao ABRIR, não ao confirmar: se o insert
// falhar e a pessoa tentar de novo com o dialog aberto, é a mesma
// ocorrência e não pode virar dois eventos.
function useNaoVoltou(
  profile: AuthProfile,
  mutation: { mutate: (input: NotificarDocumentoInput) => void; isPending: boolean }
) {
  const [alvo, setAlvo] = useState<{ id: string; chave: string } | null>(null)

  return {
    alvo,
    abrir: (id: string) => setAlvo({ id, chave: uuidv7() }),
    fechar: () => setAlvo(null),
    salvando: mutation.isPending,
    confirmar: (justificativa: string) => {
      if (!alvo) return
      mutation.mutate({
        tenantId: profile.tenantId,
        entregaId: alvo.id,
        justificativa,
        registradoPor: profile.id,
        autorNome: profile.nome,
        eventoIdempotencyKey: alvo.chave,
        ocorridoEmLocal: new Date().toISOString(),
      })
      setAlvo(null)
    },
  }
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{titulo}</h3>
      {children}
    </div>
  )
}

function DocumentosConvenio({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useDocumentosConvenioPendentes()
  const marcarRecebido = useMarcarDocumentoConvenioRecebido()
  const naoVoltou = useNaoVoltou(profile, useNotificarDocumentoConvenio())

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum documento de convênio pendente.</p>
  }

  return (
    <>
      <AvisoTemMais mostrar={data.temMais} />
      <TabelaPendencias
        rotuloMeio="Convênio"
        rotuloAcao="Marcar recebido"
        linhas={data.itens.map((doc) => ({
          id: doc.id,
          numeroVale: doc.numeroVale,
          clienteNome: doc.clienteNome,
          meio: doc.convenioNome ?? '—',
          desde: doc.ocorridoEmLocal,
        }))}
        onAcao={(id) =>
          marcarRecebido.mutate({
            entregaId: id,
            recebidoPor: profile.id,
            ocorridoEmLocal: new Date().toISOString(),
          })
        }
        onNotificar={naoVoltou.abrir}
      />
      <NaoVoltouDialog
        aberto={naoVoltou.alvo !== null}
        onFechar={naoVoltou.fechar}
        salvando={naoVoltou.salvando}
        onConfirmar={naoVoltou.confirmar}
        titulo="Documento de convênio não voltou"
        descricao="Registra a ocorrência pra gestão. O vale continua na lista de pendências — se o documento aparecer depois, é só marcar como recebido."
      />
    </>
  )
}

function ReceitasPendentes({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useReceitasPendentes()
  const marcarRecebida = useMarcarReceitaRecebida()
  const naoVoltou = useNaoVoltou(profile, useNotificarFaltaReceita())

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma receita pendente de devolução.</p>
  }

  return (
    <>
      <AvisoTemMais mostrar={data.temMais} />
      <TabelaPendencias
        rotuloMeio="Documento"
        rotuloAcao="Marcar devolvida"
        linhas={data.itens.map((receita) => ({
          id: receita.id,
          numeroVale: receita.numeroVale,
          clienteNome: receita.clienteNome,
          // receita não tem convênio: a coluna do meio existe só pra as
          // duas tabelas continuarem alinhadas coluna a coluna.
          meio: 'Receita',
          desde: receita.ocorridoEmLocal,
        }))}
        onAcao={(id) =>
          marcarRecebida.mutate({
            entregaId: id,
            recebidoPor: profile.id,
            ocorridoEmLocal: new Date().toISOString(),
          })
        }
        onNotificar={naoVoltou.abrir}
      />
      <NaoVoltouDialog
        aberto={naoVoltou.alvo !== null}
        onFechar={naoVoltou.fechar}
        salvando={naoVoltou.salvando}
        onConfirmar={naoVoltou.confirmar}
        titulo="Receita não voltou"
        descricao="Registra a ocorrência pra gestão. O vale continua na lista de pendências — se a receita aparecer depois, é só marcar como devolvida."
      />
    </>
  )
}

export function DocumentosPendentes({ profile }: { profile: AuthProfile }) {
  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Documentos de convênio">
        <DocumentosConvenio profile={profile} />
      </Secao>
      <Secao titulo="Receitas">
        <ReceitasPendentes profile={profile} />
      </Secao>
    </div>
  )
}
