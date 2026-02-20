import { supabase } from '@/lib/supabase';

const PAGE_SIZE = 1000;

// ── Auto-backup settings ──
const AUTO_BACKUP_KEY = 'controle-triar-auto-backup';
const HISTORICO_KEY = 'controle-triar-backup-historico';

export interface AutoBackupSettings {
  ativo: boolean;
  frequenciaDias: number; // 4, 7, 15
}

const DEFAULT_SETTINGS: AutoBackupSettings = { ativo: false, frequenciaDias: 7 };

export function getAutoBackupSettings(): AutoBackupSettings {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setAutoBackupSettings(settings: AutoBackupSettings) {
  localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(settings));
}

export function getUltimoBackupDate(): string | null {
  try {
    const raw = localStorage.getItem(HISTORICO_KEY);
    if (!raw) return null;
    const items = JSON.parse(raw) as Array<{ data: string; tipo: string }>;
    const exports = items.filter((i) => i.tipo === 'export');
    return exports.length > 0 ? exports[0].data : null;
  } catch {
    return null;
  }
}

export function isBackupVencido(): boolean {
  const settings = getAutoBackupSettings();
  if (!settings.ativo) return false;
  const ultimo = getUltimoBackupDate();
  if (!ultimo) return true; // nunca fez backup
  const diff = Date.now() - new Date(ultimo).getTime();
  const dias = diff / (1000 * 60 * 60 * 24);
  return dias >= settings.frequenciaDias;
}

export function calcProximoBackup(): Date | null {
  const settings = getAutoBackupSettings();
  if (!settings.ativo) return null;
  const ultimo = getUltimoBackupDate();
  if (!ultimo) return new Date(); // agora
  const proximoMs = new Date(ultimo).getTime() + settings.frequenciaDias * 24 * 60 * 60 * 1000;
  return new Date(proximoMs);
}

// ── File System Access API: salvar direto numa pasta escolhida ──
const DB_NAME = 'triar-backup-db';
const STORE_NAME = 'dir-handles';
const DIR_KEY = 'backup-dir';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function salvarDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, DIR_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function obterDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(DIR_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function limparDirHandle(): Promise<void> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignora */ }
}

export async function escolherPastaBackup(): Promise<string> {
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await salvarDirHandle(handle);
  return handle.name;
}

export async function getNomePastaSalva(): Promise<string | null> {
  const handle = await obterDirHandle();
  return handle ? handle.name : null;
}

/**
 * Solicita permissão de escrita no dir handle salvo.
 * DEVE ser chamado durante um user gesture (clique) antes de qualquer await longo.
 * Retorna o handle pronto para escrita ou null.
 */
export async function prepararDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await obterDirHandle();
  if (!handle) return null;
  try {
    const perm = await (handle as any).requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;
  } catch (err) {
    console.warn('[Backup] Permissão negada para pasta:', err);
  }
  return null;
}

/**
 * Tenta gravar o arquivo JSON na pasta escolhida.
 * Se dirHandle for passado (já com permissão), grava direto.
 * Retorna true se gravou na pasta, false se fez download normal (fallback).
 */
export async function salvarBackupArquivo(json: string, nomeArquivo: string, dirHandle?: FileSystemDirectoryHandle | null): Promise<boolean> {
  const handle = dirHandle ?? await obterDirHandle();
  if (handle) {
    try {
      if (!dirHandle) {
        // Se não veio pré-autorizado, tenta pedir permissão (pode falhar fora de user gesture)
        const perm = await (handle as any).requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new Error('Permissão negada');
      }
      const fileHandle = await handle.getFileHandle(nomeArquivo, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(json);
      await writable.close();
      return true;
    } catch (err) {
      console.warn('[Backup] Nao conseguiu gravar na pasta, usando download:', err);
    }
  }
  // Fallback: download normal
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
  return false;
}

async function fetchAll<T extends Record<string, unknown>>(table: string): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Erro ao ler tabela "${table}": ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export interface BackupData {
  versao: number;
  criadoEm: string;
  tabelas: {
    departamentos: Record<string, unknown>[];
    usuarios: Record<string, unknown>[];
    servicos: Record<string, unknown>[];
    empresas: Record<string, unknown>[];
    rets: Record<string, unknown>[];
    responsaveis: Record<string, unknown>[];
    documentos: Record<string, unknown>[];
    observacoes: Record<string, unknown>[];
    logs: Record<string, unknown>[];
    lixeira: Record<string, unknown>[];
    notificacoes: Record<string, unknown>[];
  };
  contagem: Record<string, number>;
}

const TABELAS = [
  'departamentos',
  'usuarios',
  'servicos',
  'empresas',
  'rets',
  'responsaveis',
  'documentos',
  'observacoes',
  'logs',
  'lixeira',
  'notificacoes',
] as const;

export async function exportarBackup(
  onProgress?: (msg: string) => void
): Promise<BackupData> {
  const tabelas: Record<string, Record<string, unknown>[]> = {};
  const contagem: Record<string, number> = {};

  for (const tabela of TABELAS) {
    onProgress?.(`Exportando ${tabela}...`);
    try {
      const rows = await fetchAll(tabela);
      tabelas[tabela] = rows;
      contagem[tabela] = rows.length;
    } catch {
      tabelas[tabela] = [];
      contagem[tabela] = 0;
    }
  }

  return {
    versao: 1,
    criadoEm: new Date().toISOString(),
    tabelas: tabelas as BackupData['tabelas'],
    contagem,
  };
}

export function validarBackup(data: unknown): { ok: true; backup: BackupData } | { ok: false; erro: string } {
  if (!data || typeof data !== 'object') return { ok: false, erro: 'Arquivo inválido: não é um objeto JSON.' };
  const obj = data as Record<string, unknown>;
  if (obj.versao !== 1) return { ok: false, erro: `Versão incompatível: esperado 1, recebido ${obj.versao}` };
  if (!obj.tabelas || typeof obj.tabelas !== 'object') return { ok: false, erro: 'Arquivo inválido: campo "tabelas" ausente.' };
  const tabs = obj.tabelas as Record<string, unknown>;
  for (const nome of TABELAS) {
    if (!Array.isArray(tabs[nome])) return { ok: false, erro: `Tabela "${nome}" ausente ou inválida no arquivo.` };
  }
  return { ok: true, backup: obj as unknown as BackupData };
}

// ── Tabelas críticas: empresas e tudo relacionado. Erro = para tudo. ──
const CRITICAS_DELETE = [
  'observacoes',
  'documentos',
  'responsaveis',
  'rets',
  'empresas',
  'servicos',
] as const;

const CRITICAS_INSERT = [
  'servicos',
  'empresas',
  'rets',
  'responsaveis',
  'documentos',
  'observacoes',
] as const;

// ── Tabelas secundárias: logs, lixeira, notificacoes, usuarios, departamentos.
//    Tenta restaurar mas ignora erros de RLS. ──
const SECUNDARIAS_DELETE = ['notificacoes', 'lixeira', 'logs'] as const;
const SECUNDARIAS_INSERT = ['departamentos', 'usuarios', 'logs', 'lixeira', 'notificacoes'] as const;

async function deleteAll(table: string) {
  const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Erro ao limpar tabela "${table}": ${error.message}`);
}

async function deleteAllSafe(table: string) {
  const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) console.warn(`[Backup] Não conseguiu limpar "${table}" (RLS): ${error.message}`);
}

async function insertBatch(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao inserir na tabela "${table}" (lote ${Math.floor(i / BATCH) + 1}): ${error.message}`);
  }
}

async function insertBatchSafe(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // Tenta upsert primeiro
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (error) {
      // Se upsert falhou (RLS), tenta insert ignorando duplicatas
      const { error: insErr } = await supabase.from(table).insert(batch);
      if (insErr) {
        console.warn(`[Backup] Ignorando erro em "${table}": ${insErr.message}`);
      }
    }
  }
}

export async function restaurarBackup(
  backup: BackupData,
  onProgress?: (msg: string) => void
): Promise<void> {
  // 1. Limpar tabelas secundárias (ignora erros de RLS)
  for (const tabela of SECUNDARIAS_DELETE) {
    onProgress?.(`Limpando ${tabela}...`);
    await deleteAllSafe(tabela);
  }

  // 2. Limpar tabelas críticas (erro = para tudo)
  for (const tabela of CRITICAS_DELETE) {
    onProgress?.(`Limpando ${tabela}...`);
    await deleteAll(tabela);
  }

  // 3. Restaurar tabelas críticas (erro = para tudo)
  for (const tabela of CRITICAS_INSERT) {
    const rows = backup.tabelas[tabela];
    onProgress?.(`Restaurando ${tabela} (${rows.length} registros)...`);
    await insertBatch(tabela, rows);
  }

  // 4. Restaurar tabelas secundárias (ignora erros de RLS)
  for (const tabela of SECUNDARIAS_INSERT) {
    const rows = backup.tabelas[tabela];
    if (rows.length > 0) {
      onProgress?.(`Restaurando ${tabela} (${rows.length} registros)...`);
      await insertBatchSafe(tabela, rows);
    }
  }

  onProgress?.('Backup restaurado com sucesso!');
}
