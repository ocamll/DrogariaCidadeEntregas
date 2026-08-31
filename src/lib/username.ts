// O USUÁRIO DE LOGIN, e o e-mail técnico que ele vira.
//
// Este arquivo NÃO IMPORTA NADA. Mesma disciplina de `texto.ts`,
// `papeis.ts`, `canonico.ts`, `estadoDeConsulta.ts` e
// `formasDePagamento.ts` — e aqui ela vale mais que nas outras, porque
// esta regra tem um GÊMEO fora do bundle (ver abaixo) e precisa ser
// exercitável sob `tsx`, sem `import.meta.env` e sem rede.
//
// ---------------------------------------------------------------------
// A ARQUITETURA A, E POR QUE ELA FORÇA ESTE DESENHO
// ---------------------------------------------------------------------
// A decisão congelada em 2026-08-25 diz: *o username mapeia pra um
// identificador técnico interno do Supabase Auth, invisível ao usuário;
// **sem RPC pública que enumere usernames**, sem autenticação caseira.*
//
// Essa restrição elimina as duas alternativas óbvias:
//
//   - uma RPC `resolver_username(text) → email` É um oráculo de
//     enumeração: dá pra sondar quais usuários existem sem credencial
//     nenhuma;
//   - abrir `profiles` para o anônimo, idem, e ainda pior.
//
// Sobra UMA forma, e é esta:
//
//     digita     camilo
//     compõe     camilo@drogariacidade.invalid
//     chama      signInWithPassword
//
// **Nenhuma consulta antes de autenticar**, logo não há o que enumerar.
// A unicidade global vem de graça — e-mail é único no Auth, e "global"
// é o certo aqui porque antes de autenticar não existe tenant pra
// desempatar.
//
// `auth.uid` continua sendo a identidade. O username é credencial
// humana e PODE MUDAR, então **nunca entra em hash nem em auditoria** —
// quem responde "quem fez" é `profiles.nome` via `user_id`.
//
// ---------------------------------------------------------------------
// O GÊMEO, QUE É A PARTE FRÁGIL
// ---------------------------------------------------------------------
// O e-mail técnico é montado em DOIS lugares:
//
//     aqui                              ao fazer login
//     supabase/functions/criar-usuario  ao criar a conta
//
// A Edge Function roda em Deno, fora deste bundle, então ela carrega uma
// CÓPIA de `normalizarUsername`. É o mesmo arranjo de
// `calcularOfflineEventHash`, que também tem cópia na `sync-romaneio`.
//
// **Se as duas divergirem em um byte, a conta é criada com um endereço e
// o login tenta outro — e o sintoma é "senha inválida", sem pista
// nenhuma.** É o risco nº 1 do projeto (os canônicos gêmeos) reaparecendo
// na autenticação, onde o diagnóstico é pior: não há verificador, não há
// canônico impresso, não há nada além de um usuário que jura que a senha
// está certa.
//
// Por isso `scripts/username.spec.mts` **lê os dois arquivos e compara o
// corpo das duas funções**. Não é "confio que copiei certo": é medido.
//
// ---------------------------------------------------------------------
// POR QUE ESTA NORMALIZAÇÃO NÃO É A DE `texto.ts`
// ---------------------------------------------------------------------
// O CLAUDE.md já listava username entre o que NUNCA passa por
// `lib/texto.ts`, junto de senha, PIN, token e hash: nada disso é
// linguagem humana. As regras são opostas, inclusive:
//
//     normalizarNome      preserva acento — mudar um nome é corromper
//                         documento de identidade
//     normalizarUsername  TIRA acento — o local part de um e-mail não
//                         os aceita, e quem digita `josé` tem que
//                         alcançar a conta `jose`
//
// É o mesmo par de contratos opostos do E1.1 (`normalizarNome` ×
// `normalizarParaBusca`), e vale a mesma regra: **o resultado disto
// nunca volta pra um campo de nome.**

/**
 * O domínio do e-mail técnico. Uma constante, um lugar.
 *
 * `.invalid` é RESERVADO pela RFC 2606 exatamente para este uso:
 * garantidamente não resolve, não pode ser registrado por ninguém, e
 * nunca vai rotear correio de verdade. Escolhido em 2026-08-27, quando o
 * usuário confirmou que a farmácia não tem domínio próprio.
 *
 * Ele também se autodocumenta: quem abrir o painel do Supabase vê
 * `camilo@drogariacidade.invalid` e entende na hora que não é endereço
 * de e-mail de ninguém.
 *
 * **Trocar isto significa atualizar o e-mail de TODA conta existente**,
 * porque o login passa a compor um endereço diferente do que está
 * gravado. É uma linha aqui e uma migração de contas lá — não é uma
 * decisão de estilo.
 */
export const DOMINIO_TECNICO = 'drogariacidade.invalid'

/** Tamanho do username, em caracteres, depois de normalizado. */
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32

/**
 * O que o usuário digitou, reduzido à forma canônica.
 *
 * `trim` → minúscula → sem acento. **E nada além disso.**
 *
 * Ela deliberadamente NÃO apaga caractere inválido. Apagar em silêncio
 * transformaria `jo se` em `jose` e faria a pessoa entrar numa conta que
 * ela não pediu — é a mesma família do defeito que o projeto persegue
 * desde o §39: o sistema afirmando mais do que sabe. Caractere inválido
 * é assunto de `validarUsername`, que RECUSA em vez de consertar.
 *
 * A remoção de acento usa NFD + corte das marcas combinantes, então `ç`
 * vira `c` sem tabela de exceção (`ç` é `c` + cedilha em NFD).
 *
 * IDEMPOTENTE: `f(f(x)) === f(x)`. É o que permite normalizar no login e
 * na criação sem que o valor derive.
 */
export function normalizarUsername(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // As marcas combinantes, escritas com escape e NÃO com os caracteres
    // literais: um range de combinantes no fonte é invisível, colide com
    // a letra anterior no editor, e não sobrevive a um copiar-colar
    // descuidado — num arquivo que tem gêmeo, isso é convite a divergir.
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * O username é aceitável? Devolve a mensagem de erro, ou `null`.
 *
 * Mesma convenção de `validarFormasPrevistas` e de
 * `romaneio_retorno_validar` no SQL: `null` é sucesso.
 *
 * **Só a CRIAÇÃO valida.** O login não — ele compõe o endereço e tenta.
 * Validar no login daria ao atacante um jeito de distinguir "formato
 * ruim" de "credencial errada" sem gastar uma tentativa, e daria ao
 * usuário legítimo duas mensagens diferentes para o mesmo desfecho.
 *
 * Começa por letra de propósito: um local part que começa com `.` ou `-`
 * é recusado por parte dos validadores de e-mail, e essa recusa
 * apareceria lá na frente, no `createUser`, como erro genérico.
 */
export function validarUsername(bruto: string): string | null {
  const u = normalizarUsername(bruto)
  if (!u) return 'Informe o usuário.'
  if (u.length < USERNAME_MIN) return `Usuário precisa de pelo menos ${USERNAME_MIN} caracteres.`
  if (u.length > USERNAME_MAX) return `Usuário passa de ${USERNAME_MAX} caracteres.`
  if (!/^[a-z]/.test(u)) return 'Usuário precisa começar com uma letra.'
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return 'Usuário aceita só letras, números, ponto, hífen e sublinhado.'
  }
  return null
}

/**
 * O endereço que o Supabase Auth vê. **O gêmeo da Edge Function tem que
 * produzir exatamente isto.**
 */
export function emailTecnico(bruto: string): string {
  return `${normalizarUsername(bruto)}@${DOMINIO_TECNICO}`
}

/**
 * O caminho de volta, só para EXIBIR — a lista de usuários mostra
 * `camilo`, não `camilo@drogariacidade.invalid`.
 *
 * Tolera endereço de outro domínio devolvendo o e-mail inteiro: durante
 * a conversão das contas antigas existe um instante em que as duas
 * formas convivem no banco, e mostrar `adminteste` para uma conta que
 * ainda é `adminteste@drogcidade.sg` afirmaria uma conversão que não
 * aconteceu. Melhor mostrar o endereço cru e deixar o desalinho visível.
 */
export function usernameDoEmail(email: string | null): string {
  if (!email) return '—'
  const sufixo = `@${DOMINIO_TECNICO}`
  return email.endsWith(sufixo) ? email.slice(0, -sufixo.length) : email
}
