'use client';

import { useSyncExternalStore } from 'react';
import type { Empresa, Usuario, LogEntry } from '@/app/types';

/**
 * MODO DEMONSTRAÇÃO (uso temporário — gravação de vídeo)
 * ------------------------------------------------------
 * Objetivo: permitir apresentar o sistema sem expor nomes reais de
 * funcionários e empresas, CNPJs, e-mails e telefones, e sem o logo da Triar.
 *
 * Importante: NADA aqui altera o banco de dados. A anonimização acontece
 * só na exibição (no SistemaContext, em cima dos dados já carregados). Por
 * segurança, NÃO edite/salve empresas enquanto o modo estiver ligado — o
 * formulário pode acabar gravando o nome fictício.
 *
 * Como ligar/desligar:
 *   • Atalho de teclado:  Ctrl + Shift + D
 *   • Pela URL:           qualquer página interna com ?demo=1 (liga) ou ?demo=0 (desliga)
 *   • Pelo botão "Desativar" na faixa que aparece no topo quando está ligado.
 */

const STORAGE_KEY = 'demo-mode-anon';
const EVENT_NAME = 'demo-mode-change';

export function getDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoMode(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* localStorage bloqueado — ignora */
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: on }));
}

function subscribeDemoMode(cb: () => void): () => void {
  window.addEventListener(EVENT_NAME, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT_NAME, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Hook que reage a mudanças do modo demo (atalho, URL, botão, outras abas). */
export function useDemoMode(): boolean {
  // useSyncExternalStore evita setState-in-effect e é seguro no SSR (false).
  return useSyncExternalStore(subscribeDemoMode, getDemoMode, () => false);
}

// ─────────────────────────────────────────────────────────────────────────
// Geração de nomes fictícios determinísticos (mesmo id → mesmo nome falso)
// ─────────────────────────────────────────────────────────────────────────

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

const EMPRESA_TIPO = ['Comércio', 'Indústria', 'Serviços', 'Logística', 'Tecnologia', 'Consultoria', 'Engenharia', 'Alimentos', 'Transportes', 'Participações'];
const EMPRESA_NOME = ['Aurora', 'Vega', 'Horizonte', 'Prisma', 'Atlas', 'Nova Era', 'Cedro', 'Ipê', 'Âmbar', 'Solaris', 'Vertente', 'Aliança', 'Boreal', 'Lumen', 'Vento Sul', 'Pedra Branca', 'Guará', 'Cristal', 'Montana', 'Primavera'];
const EMPRESA_SUFIXO = ['LTDA', 'ME', 'EIRELI', 'S/A', 'EPP'];

const PRIMEIRO_NOME = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nathan', 'Olívia', 'Paulo', 'Rafaela', 'Sofia', 'Thiago', 'Vitória'];
const SOBRENOME = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Almeida', 'Lima', 'Gomes', 'Ribeiro', 'Martins', 'Carvalho', 'Rocha', 'Dias', 'Teixeira'];

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function fakeEmpresaRazaoSocial(id: string): string {
  const h = hashString(id);
  return `${pick(EMPRESA_TIPO, h)} ${pick(EMPRESA_NOME, Math.floor(h / 7))} ${pick(EMPRESA_SUFIXO, Math.floor(h / 53))}`;
}

export function fakeEmpresaApelido(id: string): string {
  const h = hashString(id);
  return pick(EMPRESA_NOME, h);
}

export function fakeCnpj(id: string): string {
  const h = hashString(id).toString().padStart(8, '0').slice(0, 8);
  const dv = (hashString(id + 'dv') % 100).toString().padStart(2, '0');
  return `${h.slice(0, 2)}.${h.slice(2, 5)}.${h.slice(5, 8)}/0001-${dv}`;
}

export function fakeUserNome(id: string): string {
  const h = hashString(id);
  return `${pick(PRIMEIRO_NOME, h)} ${pick(SOBRENOME, Math.floor(h / 11))}`;
}

export function fakeEmail(id: string): string {
  const h = hashString(id);
  const nome = semAcento(pick(PRIMEIRO_NOME, h)).toLowerCase();
  const sobre = semAcento(pick(SOBRENOME, Math.floor(h / 11))).toLowerCase();
  return `${nome}.${sobre}@exemplo.com.br`;
}

function fakeTelefone(id: string): string {
  const h = hashString(id + 'tel').toString().padStart(9, '0').slice(0, 9);
  return `(00) ${h.slice(0, 5)}-${h.slice(5, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Anonimizadores (clonam o objeto e trocam só os campos sensíveis na tela)
// ─────────────────────────────────────────────────────────────────────────

export function anonimizarEmpresa(e: Empresa): Empresa {
  return {
    ...e,
    razao_social: e.razao_social ? fakeEmpresaRazaoSocial(e.id) : e.razao_social,
    apelido: e.apelido ? fakeEmpresaApelido(e.id) : e.apelido,
    cnpj: e.cnpj ? fakeCnpj(e.id) : e.cnpj,
    email: e.email ? fakeEmail(e.id) : e.email,
    telefone: e.telefone ? fakeTelefone(e.id) : e.telefone,
    observacoes: (e.observacoes ?? []).map((o) => ({
      ...o,
      autorNome: o.autorId ? fakeUserNome(o.autorId) : o.autorNome,
    })),
  };
}

export function anonimizarUsuario(u: Usuario): Usuario {
  return {
    ...u,
    nome: fakeUserNome(u.id),
    email: fakeEmail(u.id),
  };
}

/**
 * Para o usuário logado, troca só o nome exibido — mantém email, role e
 * departamento intactos para não quebrar permissões nem a montagem do menu
 * (itens que dependem do email/departamento do usuário).
 */
export function anonimizarCurrentUser(u: Usuario): Usuario {
  return { ...u, nome: fakeUserNome(u.id) };
}

export function anonimizarLog(log: LogEntry): LogEntry {
  return {
    ...log,
    userNome: log.userId ? fakeUserNome(log.userId) : log.userNome,
    deletedByNome: log.deletedById ? fakeUserNome(log.deletedById) : log.deletedByNome,
    // A mensagem é texto livre e pode conter nomes reais — ocultamos no modo demo.
    message: '(detalhes ocultados no modo demonstração)',
  };
}
