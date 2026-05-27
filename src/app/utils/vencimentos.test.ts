import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  limparTagVencimento,
  normalizarHistoricoVencimento,
  garantirVencimentosFiscais,
  criarHistoricoVencimentoItem,
} from './vencimentos';
import type { HistoricoVencimentoItem, VencimentoFiscal } from '@/app/types';

describe('limparTagVencimento', () => {
  it('retorna a tag sem espaços', () => {
    expect(limparTagVencimento('  azul  ')).toBe('azul');
  });

  it('retorna undefined pra valor vazio/só-espaços', () => {
    expect(limparTagVencimento('')).toBeUndefined();
    expect(limparTagVencimento('   ')).toBeUndefined();
  });

  it('retorna undefined pra null e undefined', () => {
    expect(limparTagVencimento(null)).toBeUndefined();
    expect(limparTagVencimento(undefined)).toBeUndefined();
  });
});

describe('normalizarHistoricoVencimento', () => {
  it('retorna [] pra input não-array', () => {
    expect(normalizarHistoricoVencimento(null)).toEqual([]);
    expect(normalizarHistoricoVencimento(undefined)).toEqual([]);
    // @ts-expect-error — testando input inválido
    expect(normalizarHistoricoVencimento('lixo')).toEqual([]);
  });

  it('filtra itens sem titulo (essencial — titulo é obrigatório)', () => {
    const input = [
      { titulo: 'OK' },
      { titulo: '' },
      { titulo: '   ' },
      { titulo: 'OK 2' },
    ] as HistoricoVencimentoItem[];
    const result = normalizarHistoricoVencimento(input);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.titulo)).toContain('OK');
    expect(result.map((r) => r.titulo)).toContain('OK 2');
  });

  it('preserva id existente; gera novo se faltar', () => {
    const input = [
      { id: 'existing-id', titulo: 'Com id' },
      { titulo: 'Sem id' },
    ] as HistoricoVencimentoItem[];
    const result = normalizarHistoricoVencimento(input);
    expect(result.find((r) => r.titulo === 'Com id')?.id).toBe('existing-id');
    expect(result.find((r) => r.titulo === 'Sem id')?.id).toBeTruthy();
  });

  it('faz trim em titulo, descricao, autorNome', () => {
    const input = [
      { titulo: '  Título  ', descricao: '  Desc  ', autorNome: '  Yasmin  ' },
    ] as HistoricoVencimentoItem[];
    const [item] = normalizarHistoricoVencimento(input);
    expect(item.titulo).toBe('Título');
    expect(item.descricao).toBe('Desc');
    expect(item.autorNome).toBe('Yasmin');
  });

  it('campos vazios viram undefined (não string vazia)', () => {
    const input = [
      { titulo: 'X', descricao: '', dataEvento: '', autorNome: '' },
    ] as HistoricoVencimentoItem[];
    const [item] = normalizarHistoricoVencimento(input);
    expect(item.descricao).toBeUndefined();
    expect(item.dataEvento).toBeUndefined();
    expect(item.autorNome).toBeUndefined();
  });

  it('autorId null é preservado (campo pode ser null no banco)', () => {
    const input = [
      { titulo: 'X', autorId: null },
    ] as HistoricoVencimentoItem[];
    const [item] = normalizarHistoricoVencimento(input);
    expect(item.autorId).toBeNull();
  });

  it('ordena descrescente por dataEvento (ou criadoEm fallback)', () => {
    const input = [
      { titulo: 'meio', dataEvento: '2026-03-15' },
      { titulo: 'antigo', dataEvento: '2026-01-01' },
      { titulo: 'recente', dataEvento: '2026-05-20' },
    ] as HistoricoVencimentoItem[];
    const result = normalizarHistoricoVencimento(input);
    expect(result.map((r) => r.titulo)).toEqual(['recente', 'meio', 'antigo']);
  });

  it('quando dataEvento ausente, ordena por criadoEm', () => {
    const input = [
      { titulo: 'criado-meio', criadoEm: '2026-03-15T10:00:00Z' },
      { titulo: 'criado-antigo', criadoEm: '2026-01-01T10:00:00Z' },
      { titulo: 'criado-recente', criadoEm: '2026-05-20T10:00:00Z' },
    ] as HistoricoVencimentoItem[];
    const result = normalizarHistoricoVencimento(input);
    expect(result.map((r) => r.titulo)).toEqual(['criado-recente', 'criado-meio', 'criado-antigo']);
  });

  it('criadoEm vazio → preenche com isoNow()', () => {
    const input = [{ titulo: 'X' }] as HistoricoVencimentoItem[];
    const [item] = normalizarHistoricoVencimento(input);
    expect(item.criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('garantirVencimentosFiscais', () => {
  it('retorna lista completa quando existentes ausente', () => {
    const result = garantirVencimentosFiscais();
    expect(result.length).toBeGreaterThan(0);
    // Todos têm vencimento vazio
    expect(result.every((v) => v.vencimento === '')).toBe(true);
  });

  it('preserva valores de itens já existentes (casamento por nome)', () => {
    const existentes: VencimentoFiscal[] = [
      { id: 'id-1', nome: 'IPI', vencimento: '2026-05-15', historicoVencimento: [] },
    ];
    const result = garantirVencimentosFiscais(existentes);
    const dctf = result.find((v) => v.nome === 'IPI');
    expect(dctf?.vencimento).toBe('2026-05-15');
    expect(dctf?.id).toBe('id-1');
  });

  it('adiciona itens faltantes com vencimento vazio', () => {
    const existentes: VencimentoFiscal[] = [
      { id: 'id-1', nome: 'IPI', vencimento: '2026-05-15', historicoVencimento: [] },
    ];
    const result = garantirVencimentosFiscais(existentes);
    // Deve ter mais do que só DCTFWeb
    expect(result.length).toBeGreaterThan(1);
    // Itens faltantes têm vencimento vazio
    const sem = result.filter((v) => v.nome !== 'IPI');
    expect(sem.every((v) => v.vencimento === '')).toBe(true);
  });

  it('tributação simples_nacional filtra só obrigações SN', () => {
    const result = garantirVencimentosFiscais(null, 'simples_nacional');
    // SN tem DAS, sem PIS/COFINS/IRPJ etc
    expect(result.some((v) => v.nome === 'EMISSÃO GUIA DAS')).toBe(true);
  });

  it('tributação lucro_real retorna obrigações do regime federal', () => {
    const result = garantirVencimentosFiscais(null, 'lucro_real');
    // Lucro real não tem DAS (que é exclusivo do SN)
    expect(result.some((v) => v.nome === 'EMISSÃO GUIA DAS')).toBe(false);
  });

  it('lucro_presumido idem lucro_real (sem DAS)', () => {
    const result = garantirVencimentosFiscais(null, 'lucro_presumido');
    expect(result.some((v) => v.nome === 'EMISSÃO GUIA DAS')).toBe(false);
  });

  it('tributação null/undefined retorna união completa (todos os nomes)', () => {
    const semTribut = garantirVencimentosFiscais(null);
    const undefTribut = garantirVencimentosFiscais(null, undefined);
    expect(semTribut.length).toBe(undefTribut.length);
    // União inclui tanto SN quanto obrigações federais
    expect(semTribut.some((v) => v.nome === 'EMISSÃO GUIA DAS')).toBe(true);
    expect(semTribut.some((v) => v.nome === 'IPI')).toBe(true);
  });

  it('historicoVencimento corrompido é normalizado', () => {
    const existentes: VencimentoFiscal[] = [
      {
        id: 'id-1',
        nome: 'IPI',
        vencimento: '2026-05-15',
        // @ts-expect-error — testando input inválido
        historicoVencimento: 'não é array',
      },
    ];
    const result = garantirVencimentosFiscais(existentes);
    const dctf = result.find((v) => v.nome === 'IPI');
    expect(dctf?.historicoVencimento).toEqual([]);
  });

  it('tagVencimento vazia/branca vira undefined', () => {
    const existentes: VencimentoFiscal[] = [
      { id: 'id-1', nome: 'IPI', vencimento: '', tagVencimento: '   ', historicoVencimento: [] },
    ];
    const result = garantirVencimentosFiscais(existentes);
    const dctf = result.find((v) => v.nome === 'IPI');
    expect(dctf?.tagVencimento).toBeUndefined();
  });
});

describe('criarHistoricoVencimentoItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cria item com id novo + timestamp atual', () => {
    const item = criarHistoricoVencimentoItem({ titulo: 'Pagou' });
    expect(item.id).toBeTruthy();
    expect(item.titulo).toBe('Pagou');
    expect(item.criadoEm).toBe('2026-05-27T12:00:00.000Z');
  });

  it('faz trim em todos os campos string', () => {
    const item = criarHistoricoVencimentoItem({
      titulo: '  Pagou  ',
      descricao: '  via PIX  ',
      dataEvento: '  2026-05-25  ',
      autorNome: '  Yasmin  ',
    });
    expect(item.titulo).toBe('Pagou');
    expect(item.descricao).toBe('via PIX');
    expect(item.dataEvento).toBe('2026-05-25');
    expect(item.autorNome).toBe('Yasmin');
  });

  it('campos opcionais vazios viram undefined', () => {
    const item = criarHistoricoVencimentoItem({
      titulo: 'X',
      descricao: '',
      dataEvento: '   ',
      autorNome: undefined,
    });
    expect(item.descricao).toBeUndefined();
    expect(item.dataEvento).toBeUndefined();
    expect(item.autorNome).toBeUndefined();
  });

  it('autorId default é null (pra criação sem auth)', () => {
    const item = criarHistoricoVencimentoItem({ titulo: 'X' });
    expect(item.autorId).toBeNull();
  });

  it('autorId é preservado quando passado', () => {
    const item = criarHistoricoVencimentoItem({ titulo: 'X', autorId: 'user-123' });
    expect(item.autorId).toBe('user-123');
  });
});
