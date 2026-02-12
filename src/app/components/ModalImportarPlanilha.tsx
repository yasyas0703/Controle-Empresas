'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import { api } from '@/app/utils/api';

/**
 * Colunas fixas do export Domínio (0-indexed):
 *  0: Id (skip)
 *  1: Código
 *  2: Nome
 *  3: CNPJ / CPF
 *  4: Inscrição estadual
 *  5: Ativo/Inativo (skip)
 *  6: Regime federal
 *  7: Regime estadual
 *  8: Regime municipal
 *  9: CCM (skip)
 * 10+: Departamentos/responsáveis — detectados dinamicamente pelo cabeçalho
 */

/** Apenas esses departamentos serão importados (comparação case-insensitive) */
const ALLOWED_DEPT_COLUMNS = new Set([
  'cadastro',
  'contábil',
  'declarações',
  'financeiro',
  'fiscal',
  'parcelamentos',
  'pessoal',
]);

/** Normaliza o Regime Federal vindo de CSV (ALL CAPS) para Title Case que o dropdown espera */
function normalizeRegimeFederal(raw: string): string {
  const val = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    'SIMPLES NACIONAL': 'Simples Nacional',
    'LUCRO PRESUMIDO': 'Lucro Presumido',
    'LUCRO REAL': 'Lucro Real',
    'MEI': 'MEI',
  };
  return map[val] ?? raw.trim();
}

interface ParsedRow {
  codigo: string;
  razao_social: string;
  cnpj: string;
  inscricao_estadual: string;
  regime_federal: string;
  regime_estadual: string;
  regime_municipal: string;
  responsaveis: Record<string, string>; // dept name -> person name
}

function cleanQuotes(val: string): string {
  return val.replace(/^["']|["']$/g, '').trim();
}

function formatCnpjCpf(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return raw;
}

function parseFile(text: string): ParsedRow[] {
  // Detect separator: tab or semicolon or comma
  const firstLine = text.split(/\r?\n/)[0] || '';
  let separator = '\t';
  if (!firstLine.includes('\t')) {
    separator = firstLine.includes(';') ? ';' : ',';
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Detectar colunas de departamento/responsáveis dinamicamente pelo cabeçalho
  const headerCols = lines[0].split(separator).map(cleanQuotes);
  const deptColumns: { col: number; dept: string }[] = [];
  for (let i = 10; i < headerCols.length; i++) {
    const name = headerCols[i].trim();
    // Somente importar colunas de departamentos permitidos
    if (name && ALLOWED_DEPT_COLUMNS.has(name.toLowerCase())) {
      deptColumns.push({ col: i, dept: name });
    }
  }

  const dataLines = lines.slice(1);

  return dataLines
    .map((line) => {
      const cols = line.split(separator).map(cleanQuotes);
      const codigo = cols[1] || '';
      const nome = cols[2] || '';
      const cnpj = cols[3] || '';

      if (!codigo && !nome && !cnpj) return null;

      const responsaveis: Record<string, string> = {};
      for (const { col, dept } of deptColumns) {
        const val = (cols[col] || '').trim();
        if (val) responsaveis[dept] = val;
      }

      return {
        codigo: codigo.trim(),
        razao_social: nome.trim(),
        cnpj: formatCnpjCpf(cnpj),
        inscricao_estadual: (cols[4] || '').trim(),
        regime_federal: normalizeRegimeFederal(cols[6] || ''),
        regime_estadual: (cols[7] || '').trim(),
        regime_municipal: (cols[8] || '').trim(),
        responsaveis,
      } satisfies ParsedRow;
    })
    .filter(Boolean) as ParsedRow[];
}

interface ModalImportarPlanilhaProps {
  onClose: () => void;
}

export default function ModalImportarPlanilha({ onClose }: ModalImportarPlanilhaProps) {
  const { empresas, criarEmpresa, departamentos, criarDepartamento, usuarios, criarUsuario, mostrarAlerta } = useSistema();

  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; deptCreated: string[] } | null>(null);

  const existingCodigos = new Set(empresas.map((e) => e.codigo));

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseFile(text);
      setParsed(rows);
    };
    // Try UTF-8 first; Domínio exports may use latin1
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleImport = async () => {
    setImporting(true);
    const newRows = parsed.filter((r) => !existingCodigos.has(r.codigo));
    const deptCreated: string[] = [];

    const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const slug = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');

    const randomPassword = () => {
      const a = Math.random().toString(36).slice(2, 10);
      const b = Math.random().toString(36).slice(2, 10);
      return `${a}${b}`;
    };

    const onlyDigits = (s: string) => String(s || '').replace(/\D/g, '');

    // Ensure all departments from responsáveis exist (and keep a local name -> id map)
    const deptIdByName = new Map(departamentos.map((d) => [norm(d.nome), d.id]));
    const allDeptNames = new Set<string>();
    for (const row of newRows) {
      for (const deptName of Object.keys(row.responsaveis)) {
        allDeptNames.add(deptName);
      }
    }
    for (const deptName of allDeptNames) {
      const key = norm(deptName);
      if (!deptIdByName.has(key)) {
        const id = await criarDepartamento(deptName);
        if (id) deptIdByName.set(key, id);
        deptCreated.push(deptName);
      }
    }

    // Build a map: person name -> which department they appear in most (to auto-assign departamentoId)
    const personDeptCount = new Map<string, Map<string, number>>(); // norm(person) -> Map(norm(dept) -> count)
    for (const row of newRows) {
      for (const [deptName, personName] of Object.entries(row.responsaveis)) {
        const p = String(personName || '').trim();
        if (!p) continue;
        const pKey = norm(p);
        if (!personDeptCount.has(pKey)) personDeptCount.set(pKey, new Map());
        const dKey = norm(deptName);
        const counts = personDeptCount.get(pKey)!;
        counts.set(dKey, (counts.get(dKey) || 0) + 1);
      }
    }

    // For each person, find the department they appear in most
    const personBestDept = new Map<string, string>(); // norm(person) -> deptId
    for (const [pKey, deptCounts] of personDeptCount) {
      let best = '';
      let bestCount = 0;
      for (const [dKey, count] of deptCounts) {
        if (count > bestCount) { best = dKey; bestCount = count; }
      }
      const deptId = deptIdByName.get(best);
      if (deptId) personBestDept.set(pKey, deptId);
    }

    // Ensure all users referenced in responsáveis exist (local name -> id map)
    const userIdByName = new Map(usuarios.map((u) => [norm(u.nome), u.id]));
    const usedEmails = new Set(usuarios.map((u) => u.email.toLowerCase().trim()));
    const allPeople = new Set<string>();
    for (const row of newRows) {
      for (const personName of Object.values(row.responsaveis)) {
        const p = String(personName || '').trim();
        if (p) allPeople.add(p);
      }
    }
    const peopleArray = Array.from(allPeople);
    for (let pi = 0; pi < peopleArray.length; pi++) {
      const personName = peopleArray[pi];
      const key = norm(personName);
      if (userIdByName.has(key)) continue;

      const base = slug(personName) || 'usuario';
      let email = `${base}@importado.local`;
      let i = 2;
      while (usedEmails.has(email.toLowerCase())) {
        email = `${base}.${i}@importado.local`;
        i++;
      }
      usedEmails.add(email.toLowerCase());

      // Auto-vincular o usuário ao departamento onde mais aparece
      const autoDeptId = personBestDept.get(key) ?? null;

      // Delay entre criações para evitar rate-limit do Supabase Auth
      if (pi > 0) await new Promise((r) => setTimeout(r, 250));

      const id = await criarUsuario({
        nome: personName,
        email,
        senha: randomPassword(),
        role: 'usuario',
        departamentoId: autoDeptId,
        ativo: true,
      });
      if (id) userIdByName.set(key, id);
    }

    let created = 0;
    let enriched = 0;
    for (const row of newRows) {
      const responsaveis: Record<string, string | null> = {};

      // Map department names → dept IDs, and person names → user IDs
      for (const [deptName, personName] of Object.entries(row.responsaveis)) {
        const deptId = deptIdByName.get(norm(deptName));
        if (!deptId) continue;
        const userId = userIdByName.get(norm(personName));
        responsaveis[deptId] = userId ?? null;
      }

      // Buscar dados do CNPJ ANTES de criar a empresa, para já criar com endereço preenchido
      let cnpjData: Partial<{
        razao_social: string;
        nome_fantasia: string;
        data_abertura: string;
        estado: string;
        cidade: string;
        bairro: string;
        logradouro: string;
        numero: string;
        cep: string;
        email: string;
        telefone: string;
      }> = {};

      const cnpjDigits = onlyDigits(row.cnpj);
      if (cnpjDigits.length === 14) {
        try {
          const data = await api.consultarCnpj(cnpjDigits);
          cnpjData = data ?? {};
          enriched++;
        } catch {
          // silencioso: API indisponível ou rate-limited
        }
      }

      const payload: Partial<Empresa> = {
        cadastrada: true,
        codigo: row.codigo,
        razao_social: row.razao_social || cnpjData.razao_social || undefined,
        apelido: cnpjData.nome_fantasia || undefined,
        cnpj: row.cnpj || undefined,
        inscricao_estadual: row.inscricao_estadual || undefined,
        regime_federal: row.regime_federal || undefined,
        regime_estadual: row.regime_estadual || undefined,
        regime_municipal: row.regime_municipal || undefined,
        data_abertura: cnpjData.data_abertura || undefined,
        estado: cnpjData.estado || undefined,
        cidade: cnpjData.cidade || undefined,
        bairro: cnpjData.bairro || undefined,
        logradouro: cnpjData.logradouro || undefined,
        numero: cnpjData.numero || undefined,
        cep: cnpjData.cep || undefined,
        email: cnpjData.email || undefined,
        telefone: cnpjData.telefone || undefined,
        responsaveis,
        tipoInscricao: row.regime_federal === 'MEI' ? 'MEI' : cnpjDigits.length === 14 ? 'CNPJ' : cnpjDigits.length === 11 ? 'CPF' : '',
        tipoEstabelecimento: '',
        servicos: [],
        documentos: [],
        possuiRet: false,
        rets: [],
      };

      await criarEmpresa(payload);
      created++;
    }

    const skipped = parsed.length - created;
    setResult({ created, skipped, deptCreated });
    setImporting(false);

    if (created > 0) {
      const extra = enriched > 0 ? ` • ${enriched} com endereço via CNPJ` : '';
      mostrarAlerta('Importação concluída', `${created} empresa(s) importada(s) com sucesso.${extra}`, 'sucesso');
    }
  };

  const newCount = parsed.filter((r) => !existingCodigos.has(r.codigo)).length;
  const skipCount = parsed.length - newCount;

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="w-full max-w-3xl rounded-2xl bg-white shadow-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Importar Planilha do Domínio</h2>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <X size={20} className="text-gray-500" />
        </button>
      </div>
      {/* Drop zone */}
      {parsed.length === 0 && !result && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-cyan-400 hover:bg-cyan-50/50 transition cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.tsv,.txt,.xls,.xlsx';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          <Upload className="mx-auto text-gray-400 mb-4" size={48} />
          <div className="text-lg font-bold text-gray-700">Arraste o arquivo aqui ou clique para selecionar</div>
          <div className="text-sm text-gray-500 mt-2">Aceita arquivos .csv, .tsv ou .txt exportados do Domínio</div>
        </div>
      )}

      {/* Preview */}
      {parsed.length > 0 && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
            <FileSpreadsheet className="text-cyan-600" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{fileName}</div>
              <div className="text-sm text-gray-500">
                {parsed.length} empresa(s) encontrada(s)
                {skipCount > 0 && (
                  <span className="text-amber-600 ml-2">
                    • {skipCount} já cadastrada(s) (mesmo código) — serão ignoradas
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => { setParsed([]); setFileName(''); }} className="p-2 rounded-lg hover:bg-gray-200 transition">
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Table preview */}
          <div className="max-h-80 overflow-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Código</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Nome</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">CNPJ/CPF</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Regime Federal</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Responsáveis</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((row, i) => {
                  const exists = existingCodigos.has(row.codigo);
                  const respCount = Object.keys(row.responsaveis).length;
                  return (
                    <tr key={i} className={`border-t ${exists ? 'bg-amber-50/50 text-gray-400' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2">
                        {exists ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <AlertTriangle size={14} /> Existente
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <Check size={14} /> Nova
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{row.codigo}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{row.razao_social}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.cnpj}</td>
                      <td className="px-3 py-2 text-xs">{row.regime_federal || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{respCount > 0 ? `${respCount} dept(s)` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-600">
              <span className="font-bold text-green-600">{newCount}</span> nova(s) •{' '}
              <span className="font-bold text-amber-600">{skipCount}</span> ignorada(s)
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setParsed([]); setFileName(''); }}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={newCount === 0 || importing}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                Importar {newCount} empresa(s)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 p-6 text-center">
            <Check className="mx-auto text-green-600 mb-3" size={48} />
            <div className="text-xl font-bold text-green-900">Importação concluída!</div>
            <div className="text-sm text-green-700 mt-2">
              {result.created} empresa(s) criada(s)
              {result.skipped > 0 && ` • ${result.skipped} ignorada(s) (já existiam)`}
            </div>
            {result.deptCreated.length > 0 && (
              <div className="text-sm text-green-700 mt-1">
                Departamentos criados automaticamente: {result.deptCreated.join(', ')}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </ModalBase>
  );
}
