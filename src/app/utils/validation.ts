import { z } from 'zod';
import type { TipoEstabelecimento, TipoInscricao } from '@/app/types';

const onlyDigits = (v: string) => v.replace(/\D/g, '');

export const cepSchema = z
  .string()
  .transform((v) => onlyDigits(v))
  .refine((v) => v.length === 8, { message: 'CEP inválido' });

export const cpfSchema = z
  .string()
  .transform((v) => onlyDigits(v))
  .refine((v) => v.length === 11, { message: 'CPF inválido' });

export const cnpjSchema = z
  .string()
  .transform((v) => onlyDigits(v))
  .refine((v) => v.length === 14, { message: 'CNPJ inválido' });

/**
 * Detecta o tipo de inscrição com base nos dígitos do documento.
 * - 11 dígitos → CPF
 * - 14 dígitos → CNPJ (ou CAEPF se tipoInscricao já for CAEPF)
 * - 12 dígitos → CNO (ou CEI)
 */
export function detectTipoInscricao(doc: string, currentTipo?: TipoInscricao): TipoInscricao {
  const digits = onlyDigits(doc);
  if (digits.length === 11) return 'CPF';
  if (digits.length === 14) {
    if (currentTipo === 'CAEPF') return 'CAEPF';
    if (currentTipo === 'MEI') return 'MEI';
    return 'CNPJ';
  }
  if (digits.length === 12) {
    if (currentTipo === 'CEI') return 'CEI';
    return 'CNO';
  }
  return currentTipo || '';
}

/**
 * Detecta se é matriz ou filial pelo CNPJ.
 * CNPJ: XX.XXX.XXX/0001-XX → matriz, /0002+ → filial.
 * CPF e outros → '' (não se aplica).
 */
export function detectTipoEstabelecimento(doc: string): TipoEstabelecimento {
  const digits = onlyDigits(doc);
  if (digits.length !== 14) return '';
  const filialPart = digits.slice(8, 12); // posições 8-11 = parte filial
  return filialPart === '0001' ? 'matriz' : 'filial';
}

/**
 * Formata o documento com a máscara correta de acordo com o tipo.
 * CPF:   000.000.000-00
 * CNPJ:  00.000.000/0000-00
 * CAEPF: 000.000.000/000-00
 * CNO:   00.000.000/00-00  (XX.XXX.XXX/XX-XX)
 * CEI:   00.000.00000/00
 */
export function formatarDocumento(doc: string, tipo?: string): string {
  const digits = onlyDigits(doc);
  if (!digits) return '';

  // Se tipo é explícito, usar a máscara correspondente
  if (tipo === 'CAEPF' || (digits.length === 14 && tipo === 'CAEPF')) {
    // 000.000.000/000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  }

  if (tipo === 'CNO') {
    // XX.XXX.XXXXX-XX
    let r = digits;
    if (r.length > 2) r = r.slice(0, 2) + '.' + r.slice(2);
    if (r.length > 6) r = r.slice(0, 6) + '.' + r.slice(6);
    if (r.length > 12) r = r.slice(0, 12) + '-' + r.slice(12);
    return r.slice(0, 15);
  }

  if (tipo === 'CEI' && digits.length <= 12) {
    // 00.000.00000/00
    let r = digits;
    if (r.length > 2) r = r.slice(0, 2) + '.' + r.slice(2);
    if (r.length > 6) r = r.slice(0, 6) + '.' + r.slice(6);
    if (r.length > 12) r = r.slice(0, 12) + '/' + r.slice(12);
    return r.slice(0, 15);
  }

  // Auto-detect por tamanho
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  }

  // CNPJ: 00.000.000/0000-00 (14 dígitos)
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
    .replace(/(-\d{2})\d+?$/, '$1');
}

/**
 * Retorna o tipo de inscrição computado da empresa a partir do CNPJ/CPF.
 */
export function getTipoInscricaoDisplay(doc: string | undefined, tipoInscricao: TipoInscricao): TipoInscricao {
  if (tipoInscricao) return tipoInscricao;
  if (!doc) return '';
  return detectTipoInscricao(doc);
}

/**
 * Retorna o tipo de estabelecimento computado (matriz/filial) a partir do CNPJ.
 */
export function getTipoEstabelecimentoDisplay(doc: string | undefined, tipoEstabelecimento: TipoEstabelecimento): TipoEstabelecimento {
  if (tipoEstabelecimento) return tipoEstabelecimento;
  if (!doc) return '';
  return detectTipoEstabelecimento(doc);
}