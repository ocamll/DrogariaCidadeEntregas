import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useDocumentosDoVale } from '@/data/documentos'
import {
  donoDaFila,
  enfileirarOperacao,
  useSituacaoDaOperacao,
  type SituacaoDaOperacao,
} from '@/data/filaOffline'
import { DOCUMENTO_FISICO_LABEL } from '@/lib/documentoDoRetorno'
import {
  tiposQuePodemEstarPendentes,
  type DocumentoDoVale,
  type ValeParaRecebimento,
} from '@/lib/documentosDoVale'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Carregando } from '@/components/EmAndamento'

// "Receber documento" — a chegada posterior do papel, pelo vale.
//
// O que a tela NUNCA faz: dizer "recebido" antes de o servidor aceitar.
// Enquanto a operação está na fila, a linha diz "aguardando sincronização";
// quem troca isso é a situação REAL do item (`useSituacaoDaOperacao`).
//
// Com rede, a lista vem do retorno selado + recebimentos. Sem rede (ou se
// a leitura falhar), vem da linha do vale — é só palpite, e a tela diz
// isso: o servidor confere ao sincronizar e recusa o que não estiver
// pendente.

const TEXTO_DA_SITUACAO: Record<SituacaoDaOperacao, string> = {
  sincronizando: 'Aguardando sincronização',
  sincronizada: 'Recebimento registrado',
  erro: 'Ainda não sincronizou — vai tentar de novo',
  atencao: 'Recusado pelo servidor — veja a fila offline',
  bloqueada: 'Aguardando a conta de quem registrou',
}

function rotulo(tipo: string): string {
  return DOCUMENTO_FISICO_LABEL[tipo] ?? tipo
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function SituacaoDoEnvio({ idFila }: { idFila: string | null }) {
  const situacao = useSituacaoDaOperacao(idFila)
  return (
    <span className="text-xs text-foreground/70">
      {TEXTO_DA_SITUACAO[situacao ?? 'sincronizando']}
    </span>
  )
}

export function ReceberDocumentoDialog({
  entregaId,
  numeroVale,
  clienteNome,
  vale,
  profile,
  open,
  onOpenChange,
}: {
  entregaId: string
  numeroVale: string
  clienteNome: string
  vale: ValeParaRecebimento
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const consulta = useDocumentosDoVale(entregaId, open)
  // tipo → chave da fila. `null` = enfileirando (o `put` ainda não voltou):
  // já trava o botão, e é isso que impede o segundo clique de criar outra
  // operação com outro id.
  const [enviados, setEnviados] = useState<Record<string, string | null>>({})

  function receber(tipo: string) {
    if (tipo in enviados) return
    setEnviados((atual) => ({ ...atual, [tipo]: null }))
    void enfileirarOperacao('receber_documento', donoDaFila(profile), {
      id: uuidv7(),
      entregaId,
      tipoDocumento: tipo,
      ocorridoEmLocal: new Date().toISOString(),
    }).then((idFila) => setEnviados((atual) => ({ ...atual, [tipo]: idFila })))
  }

  function linhaPendente(tipo: string, texto: string) {
    return (
      <li key={tipo} className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">{rotulo(tipo)}</span>
          {tipo in enviados ? (
            <SituacaoDoEnvio idFila={enviados[tipo]} />
          ) : (
            <span className="text-xs text-foreground/70">{texto}</span>
          )}
        </div>
        <Button size="sm" onClick={() => receber(tipo)} disabled={tipo in enviados}>
          Recebi
        </Button>
      </li>
    )
  }

  function linhaDoDocumento(documento: DocumentoDoVale) {
    if (documento.situacao === 'pendente') {
      return linhaPendente(documento.tipo, 'Faltante no retorno')
    }
    const texto =
      documento.situacao === 'recebido_no_retorno'
        ? 'Recebido no retorno'
        : `Recebido depois${
            documento.recebimento?.recebidoPorNome ? ` por ${documento.recebimento.recebidoPorNome}` : ''
          }, ${documento.recebimento ? dataHora(documento.recebimento.registradoEm) : ''}`
    return (
      <li key={documento.tipo} className="flex flex-col">
        <span className="font-medium">{rotulo(documento.tipo)}</span>
        <span className="text-xs text-foreground/70">{texto}</span>
      </li>
    )
  }

  let corpo: React.ReactNode
  if (consulta.isPending) {
    corpo = <Carregando />
  } else if (consulta.isError) {
    const candidatos = tiposQuePodemEstarPendentes(vale)
    corpo = (
      <>
        <p className="text-sm text-foreground/70">
          Não foi possível ler o retorno deste vale agora. Os documentos abaixo podem estar
          pendentes; o recebimento é conferido ao sincronizar.
        </p>
        <ul className="flex flex-col gap-3">
          {candidatos.map((tipo) => linhaPendente(tipo, 'Pode estar pendente'))}
        </ul>
      </>
    )
  } else if (!consulta.data.retornoSelado) {
    corpo = (
      <p className="text-sm text-foreground/70">
        Este vale ainda não tem retorno conferido. O papel pode estar com o motoboy.
      </p>
    )
  } else if (consulta.data.documentos.length === 0) {
    corpo = <p className="text-sm text-foreground/70">O retorno deste vale não tem documento.</p>
  } else {
    corpo = <ul className="flex flex-col gap-3">{consulta.data.documentos.map(linhaDoDocumento)}</ul>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receber documento — {numeroVale}</DialogTitle>
          <DialogDescription>
            Registre só o documento que está em mãos agora. O retorno de {clienteNome} não é
            alterado.
          </DialogDescription>
        </DialogHeader>

        {corpo}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
