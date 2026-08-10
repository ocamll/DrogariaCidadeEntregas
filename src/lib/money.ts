// Único lugar do código que converte entre o que o caixa digita e
// centavos. Dinheiro é sempre integer _cents — nunca float.
//
// Existia aqui um `toCents(str)` que aceitava texto livre ("1.234,56",
// "25", "1.234"). Foi removido junto com a última tela que digitava
// valor solto: ele tinha um caso genuinamente ambíguo — "1.234" (ponto
// de milhar sem centavos) virava R$ 1,23 em vez de R$ 1.234,00, errando
// por 1000x em silêncio num campo de dinheiro. Em vez de adivinhar a
// intenção do separador, o campo passou a não aceitar separador nenhum
// (ver a máscara abaixo).

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// --- máscara de digitação de dinheiro ---------------------------------
//
// O caixa digita SÓ dígitos e eles preenchem da direita pra esquerda
// (centavos primeiro), igual maquininha de cartão — que é o aparelho que
// ele já usa o dia inteiro. Ninguém digita "," nem "." em lugar nenhum,
// então a ambiguidade entre os dois deixa de existir na origem: não há
// como "1.234" virar R$ 1,23 se o ponto nunca é digitado.
//
// Digitando 1 → 2 → 3 → 4 → 5 o campo mostra:
//   0,01 → 0,12 → 1,23 → 12,34 → 123,45
//
// Todo campo de dinheiro do app usa isso — cadastro de entrega,
// divergência de pagamento e o filtro de valor no histórico —, então o
// caixa digita do mesmo jeito em qualquer tela.

// Teto de dígitos: 13 dá até R$ 99.999.999.999,99, muito além de
// qualquer compra real, e mantém o resultado dentro de Number.MAX_SAFE_INTEGER
// mesmo se alguém segurar uma tecla.
const MAX_DIGITOS = 13

export function apenasDigitos(input: string): string {
  return input.replace(/\D/g, '').slice(0, MAX_DIGITOS)
}

export function centsFromDigits(input: string): number {
  const digits = apenasDigitos(input)
  return digits ? parseInt(digits, 10) : 0
}

// 123456 → "1.234,56" · 2500 → "25,00" · 5 → "0,05"
// Sem prefixo "R$": quem exibe decide (o campo põe o prefixo do lado,
// fora do valor editável, pra não atrapalhar o cursor).
export function formatCentsInput(cents: number): string {
  const abs = Math.abs(cents)
  const inteiro = Math.trunc(abs / 100)
  const centavos = abs % 100
  const sinal = cents < 0 ? '-' : ''
  return `${sinal}${inteiro.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`
}
