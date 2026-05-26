import { describe, it, expect } from 'vitest';
import { gerarSenhaSegura } from './password';

describe('gerarSenhaSegura', () => {
  it('retorna senha do tamanho default (16) quando não passa length', () => {
    expect(gerarSenhaSegura()).toHaveLength(16);
  });

  it('respeita length passado', () => {
    expect(gerarSenhaSegura(20)).toHaveLength(20);
    expect(gerarSenhaSegura(32)).toHaveLength(32);
  });

  it('força mínimo de 8 chars mesmo se pedir menos', () => {
    expect(gerarSenhaSegura(4)).toHaveLength(8);
    expect(gerarSenhaSegura(0)).toHaveLength(8);
    expect(gerarSenhaSegura(-5)).toHaveLength(8);
  });

  it('cai pro default quando length não é número finito', () => {
    expect(gerarSenhaSegura(NaN)).toHaveLength(16);
    expect(gerarSenhaSegura(Infinity)).toHaveLength(16);
  });

  it('usa apenas chars do conjunto seguro (sem 0/O/I/1/l ambíguos)', () => {
    const senha = gerarSenhaSegura(200);
    // O conjunto é 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_='
    // Não pode ter: 0, 1, I, O, l (ambíguos visualmente)
    expect(senha).not.toMatch(/[01IOl]/);
  });

  it('é "aleatória" — duas senhas seguidas não são iguais (probabilisticamente)', () => {
    const a = gerarSenhaSegura(16);
    const b = gerarSenhaSegura(16);
    // Chance de colisão em 16 chars de um alfabeto de ~65 = praticamente zero
    expect(a).not.toBe(b);
  });

  it('100 senhas geram pelo menos 99 únicas (smoke test de entropia)', () => {
    const senhas = new Set<string>();
    for (let i = 0; i < 100; i += 1) senhas.add(gerarSenhaSegura(16));
    expect(senhas.size).toBeGreaterThanOrEqual(99);
  });

  it('usa caracteres de várias categorias no agregado', () => {
    // Senha longa pra reduzir chance de teste flaky
    const senha = gerarSenhaSegura(500);
    expect(senha).toMatch(/[A-Z]/); // maiúscula
    expect(senha).toMatch(/[a-z]/); // minúscula
    expect(senha).toMatch(/[2-9]/); // dígito
    expect(senha).toMatch(/[!@#$%*+\-_=]/); // símbolo
  });
});
