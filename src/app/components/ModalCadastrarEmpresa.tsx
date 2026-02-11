'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Loader2, Search, X, Plus, Trash2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa, RetItem, UUID } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import { cepSchema, cpfSchema, cnpjSchema, detectTipoInscricao, detectTipoEstabelecimento, formatarDocumento } from '@/app/utils/validation';
import { api } from '@/app/utils/api';

interface ModalCadastrarEmpresaProps {
  onClose: () => void;
  empresa?: Empresa;
}

function newId(): UUID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/** Formata número do RET no padrão XX.XXXXXXXX-XX */
function formatRetNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export default function ModalCadastrarEmpresa({ onClose, empresa }: ModalCadastrarEmpresaProps) {
  const { criarEmpresa, atualizarEmpresa, mostrarAlerta, departamentos, usuarios, servicos: servicosCadastrados, criarServico } = useSistema();

  const [empresaCadastrada, setEmpresaCadastrada] = useState(empresa ? empresa.cadastrada !== false : false);

  const [formData, setFormData] = useState<Partial<Empresa>>({
    cnpj: '',
    codigo: '',
    razao_social: '',
    apelido: '',
    data_abertura: '',
    tipoEstabelecimento: '',
    tipoInscricao: '',

    servicos: [],

    possuiRet: false,
    rets: [],

    inscricao_estadual: '',
    inscricao_municipal: '',
    regime_federal: '',
    regime_estadual: '',
    regime_municipal: '',

    estado: '',
    cidade: '',
    bairro: '',
    logradouro: '',
    numero: '',
    cep: '',

    email: '',
    telefone: '',

    cadastrada: empresaCadastrada,
    responsaveis: {},
  });

  const [servicoNovo, setServicoNovo] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [cnpjLookupError, setCnpjLookupError] = useState<string>('');
  const [cnpjTouched, setCnpjTouched] = useState(false);
  const lastAutoLookupDigitsRef = useRef<string>('');

  const allServicos = useMemo(() => {
    const set = new Set<string>();
    for (const s of servicosCadastrados) set.add(s.nome);
    for (const s of formData.servicos ?? []) set.add(s);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [formData.servicos, servicosCadastrados]);

  const cnpjDigits = useMemo(() => String(formData.cnpj || '').replace(/\D/g, ''), [formData.cnpj]);
  const podeBuscarCnpj = cnpjDigits.length === 14 && !buscandoCnpj;

  const handleBuscarCnpj = async () => {
    const digits = String(formData.cnpj || '').replace(/\D/g, '');
    if (digits.length !== 14) {
      setCnpjLookupError('Digite um CNPJ com 14 dígitos para buscar.');
      return;
    }

    const parsed = cnpjSchema.safeParse(String(formData.cnpj || ''));
    if (!parsed.success) {
      setCnpjLookupError('CNPJ inválido. Verifique e tente novamente.');
      return;
    }

    setBuscandoCnpj(true);
    setCnpjLookupError('');
    try {
      const data = await api.consultarCnpj(digits);

      setFormData((prev) => {
        const cepDigits = String(data?.cep || '').replace(/\D/g, '');
        const cepFormatado = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5, 8)}` : String(data?.cep || '');
        const numeroDigits = String(data?.numero || '').replace(/\D/g, '');

        return {
          ...prev,
          razao_social: String(prev.razao_social || '').trim() ? prev.razao_social : (data?.razao_social || ''),
          apelido: String(prev.apelido || '').trim() ? prev.apelido : (data?.nome_fantasia || ''),
          data_abertura: String(prev.data_abertura || '').trim() ? prev.data_abertura : (data?.data_abertura || ''),
          estado: String(prev.estado || '').trim() ? prev.estado : (data?.estado || ''),
          cidade: String(prev.cidade || '').trim() ? prev.cidade : (data?.cidade || ''),
          bairro: String(prev.bairro || '').trim() ? prev.bairro : (data?.bairro || ''),
          logradouro: String(prev.logradouro || '').trim() ? prev.logradouro : (data?.logradouro || ''),
          numero: String(prev.numero || '').trim() ? prev.numero : (numeroDigits || ''),
          cep: String(prev.cep || '').trim() ? prev.cep : (cepFormatado || ''),
          email: String(prev.email || '').trim() ? prev.email : (data?.email || ''),
          telefone: String(prev.telefone || '').trim() ? prev.telefone : (data?.telefone || ''),
        };
      });

      setEmpresaCadastrada(true);
    } catch (error: any) {
      setCnpjLookupError(error?.message || 'Não foi possível consultar esse CNPJ agora.');
    } finally {
      setBuscandoCnpj(false);
    }
  };

  // Auto-consulta do CNPJ: quando completar 14 dígitos, busca após um pequeno debounce.
  useEffect(() => {
    if (!cnpjTouched) return;
    if (!podeBuscarCnpj) return;
    if (cnpjDigits !== 14 as any) {
      // no-op; só por segurança, já garantido por podeBuscarCnpj
    }
    if (lastAutoLookupDigitsRef.current === cnpjDigits) return;

    const parsed = cnpjSchema.safeParse(String(formData.cnpj || ''));
    if (!parsed.success) return;

    const t = window.setTimeout(() => {
      if (lastAutoLookupDigitsRef.current === cnpjDigits) return;
      lastAutoLookupDigitsRef.current = cnpjDigits;
      void handleBuscarCnpj();
    }, 650);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjDigits, podeBuscarCnpj, cnpjTouched]);

  const handleChange = (field: keyof Empresa, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      cadastrada: empresaCadastrada,
    }));
  }, [empresaCadastrada]);

  useEffect(() => {
    if (empresa) {
      setFormData({
        ...empresa,
        responsaveis: empresa.responsaveis ?? {},
        servicos: empresa.servicos ?? [],
        rets: empresa.rets ?? [],
      });
      setEmpresaCadastrada(empresa.cadastrada !== false);
      setCnpjTouched(false);
      lastAutoLookupDigitsRef.current = String(empresa.cnpj || '').replace(/\D/g, '');
    } else {
      // ao criar, garante responsaveis com todos departamentos
      setFormData((prev) => {
        const next = { ...(prev as any) } as Partial<Empresa>;
        const resp: Record<string, string | null> = { ...(next.responsaveis ?? {}) };
        for (const d of departamentos) if (!(d.id in resp)) resp[d.id] = null;
        next.responsaveis = resp;
        return next;
      });
      setCnpjTouched(false);
      lastAutoLookupDigitsRef.current = '';
    }
  }, [empresa, departamentos]);

  const formatarCPFCNPJ = (valor: string): string => {
    return formatarDocumento(valor, formData.tipoInscricao as any);
  };

  const formatarCEP = (valor: string): string => {
    const apenasNumeros = valor.replace(/\D/g, '');
    if (apenasNumeros.length <= 5) return apenasNumeros;
    return `${apenasNumeros.slice(0, 5)}-${apenasNumeros.slice(5, 8)}`;
  };

  const toggleServico = (servico: string) => {
    setFormData((prev) => {
      const current = prev.servicos ?? [];
      const exists = current.includes(servico);
      return { ...prev, servicos: exists ? current.filter((s) => s !== servico) : [...current, servico] };
    });
  };

  const addServico = async () => {
    const s = servicoNovo.trim();
    if (!s) return;
    setServicoNovo('');
    // Register globally if new
    if (!servicosCadastrados.some((sc) => sc.nome.toLowerCase() === s.toLowerCase())) {
      await criarServico(s);
    }
    setFormData((prev) => ({ ...prev, servicos: Array.from(new Set([...(prev.servicos ?? []), s])) }));
  };

  const setPossuiRet = (value: boolean) => {
    setFormData((prev) => ({
      ...prev,
      possuiRet: value,
      rets: value ? (prev.rets ?? []).length ? prev.rets : [{ id: newId(), numeroPta: '', nome: '', vencimento: '', ultimaRenovacao: '' }] : [],
    }));
  };

  const addRet = () => {
    setFormData((prev) => ({
      ...prev,
      possuiRet: true,
      rets: [...(prev.rets ?? []), { id: newId(), numeroPta: '', nome: '', vencimento: '', ultimaRenovacao: '' }],
    }));
  };

  const updateRet = (id: UUID, patch: Partial<RetItem>) => {
    setFormData((prev) => ({
      ...prev,
      rets: (prev.rets ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const removeRet = (id: UUID) => {
    setFormData((prev) => {
      const next = (prev.rets ?? []).filter((r) => r.id !== id);
      return { ...prev, rets: next, possuiRet: next.length > 0 };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const novosErros: Record<string, string> = {};
    if (!formData.codigo) novosErros.codigo = 'Código é obrigatório';
    if (empresaCadastrada && !formData.razao_social) novosErros.razao_social = 'Razão Social é obrigatória';

    const digits = String(formData.cnpj || '').replace(/\D/g, '');
    if (digits.length === 11) {
      const parsed = cpfSchema.safeParse(String(formData.cnpj || ''));
      if (!parsed.success) novosErros.cnpj = 'CPF inválido';
    } else if (digits.length === 14) {
      const parsed = cnpjSchema.safeParse(String(formData.cnpj || ''));
      if (!parsed.success) novosErros.cnpj = 'CNPJ inválido';
    }
    if (formData.cep) {
      const parsedCep = cepSchema.safeParse(String(formData.cep || ''));
      if (!parsedCep.success) novosErros.cep = 'CEP inválido';
    }

    if ((formData.possuiRet ?? false) && (formData.rets ?? []).length > 0) {
      (formData.rets ?? []).forEach((r, idx) => {
        if (!r.numeroPta?.trim()) novosErros[`ret_${idx}_numeroPta`] = 'Número do PTA é obrigatório';
        if (!r.nome?.trim()) novosErros[`ret_${idx}_nome`] = 'Nome do RET é obrigatório';
        if (!r.vencimento) novosErros[`ret_${idx}_vencimento`] = 'Vencimento é obrigatório';
        if (!r.ultimaRenovacao) novosErros[`ret_${idx}_ultimaRenovacao`] = 'Última renovação é obrigatória';
      });
    }

    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) return;

    if (!formData.codigo || (empresaCadastrada && !formData.razao_social)) {
      void mostrarAlerta('Campos obrigatórios', 'Preencha os campos obrigatórios.', 'aviso');
      return;
    }

    const cnpjDigits2 = String(formData.cnpj || '').replace(/\D/g, '');
    const temCnpjValido = cnpjDigits2.length === 14;
    const cadastrada = empresaCadastrada ? temCnpjValido : temCnpjValido;

    const dadosParaSalvar: Partial<Empresa> = {
      ...formData,
      cnpj: formData.cnpj ? String(formData.cnpj) : undefined,
      cadastrada,
      servicos: (formData.servicos ?? []).filter(Boolean),
      possuiRet: Boolean(formData.possuiRet) && (formData.rets ?? []).length > 0,
      rets: Boolean(formData.possuiRet) ? (formData.rets ?? []) : [],
      responsaveis: formData.responsaveis ?? {},
    };

    if (empresa?.id) {
      await atualizarEmpresa(empresa.id, dadosParaSalvar);
      mostrarAlerta('Empresa atualizada', 'Alterações salvas com sucesso.', 'sucesso');
    } else {
      await criarEmpresa(dadosParaSalvar);
      mostrarAlerta('Empresa cadastrada', 'Empresa cadastrada com sucesso.', 'sucesso');
    }

    onClose();
  };

  return (
    <ModalBase
      isOpen
      onClose={onClose}
      labelledBy="empresa-title"
      dialogClassName="w-full max-w-4xl bg-white rounded-2xl shadow-2xl outline-none max-h-[90vh] overflow-y-auto"
      zIndex={1400}
    >
      <div className="rounded-2xl">
        <div className="bg-gradient-to-r from-green-500 to-green-600 p-6 rounded-t-2xl sticky top-0 z-10">
          <div className="flex justify-between items-center">
            <h3 id="empresa-title" className="text-xl font-bold text-white">
              {empresa ? 'Editar Empresa' : 'Cadastrar Nova Empresa'}
            </h3>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 p-2 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-6"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }
          }}
        >
          {/* Tipo de Empresa */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-4">Tipo de Empresa</h4>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-white p-4 rounded-lg border-2 border-gray-200 hover:border-blue-500 transition-all flex-1">
                <input
                  type="radio"
                  name="tipoCadastro"
                  checked={empresaCadastrada}
                  onChange={() => setEmpresaCadastrada(true)}
                  className="w-5 h-5 text-blue-600"
                />
                <div>
                  <div className="font-semibold text-gray-900">Empresa Cadastrada</div>
                  <div className="text-xs text-gray-600">Já possui CNPJ e Razão Social</div>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-white p-4 rounded-lg border-2 border-gray-200 hover:border-blue-500 transition-all flex-1">
                <input
                  type="radio"
                  name="tipoCadastro"
                  checked={!empresaCadastrada}
                  onChange={() => setEmpresaCadastrada(false)}
                  className="w-5 h-5 text-blue-600"
                />
                <div>
                  <div className="font-semibold text-gray-900">Empresa Nova</div>
                  <div className="text-xs text-gray-600">Ainda não possui CNPJ</div>
                </div>
              </label>
            </div>
          </div>

          {/* Dados Principais */}
          <div className="bg-green-50 rounded-xl p-4 border border-green-200">
            <h4 className="font-semibold text-green-800 mb-4">Dados Principais {empresaCadastrada && '*'}</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  CPF/CNPJ {empresaCadastrada && <span className="text-red-500">*</span>}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={String(formData.cnpj || '')}
                    onChange={(e) => {
                      const valorFormatado = formatarCPFCNPJ(e.target.value);
                      setCnpjTouched(true);
                      handleChange('cnpj', valorFormatado);
                      const digits = valorFormatado.replace(/\D/g, '');
                      if (digits.length === 14) setEmpresaCadastrada(true);
                      // Auto-detectar tipo de inscrição e estabelecimento
                      const autoTipo = detectTipoInscricao(digits, formData.tipoInscricao as any);
                      if (autoTipo) handleChange('tipoInscricao', autoTipo);
                      const autoEstab = detectTipoEstabelecimento(digits);
                      handleChange('tipoEstabelecimento', autoEstab);
                    }}
                    onBlur={() => {
                      if (!cnpjTouched) return;
                      if (!podeBuscarCnpj) return;
                      if (lastAutoLookupDigitsRef.current === cnpjDigits) return;
                      const parsed = cnpjSchema.safeParse(String(formData.cnpj || ''));
                      if (!parsed.success) return;
                      lastAutoLookupDigitsRef.current = cnpjDigits;
                      void handleBuscarCnpj();
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.ctrlKey ||
                        e.metaKey ||
                        ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                        /^[0-9]$/.test(e.key)
                      )
                        return;
                      e.preventDefault();
                    }}
                    className={`w-full px-4 py-3 pr-12 border rounded-xl focus:ring-2 focus:ring-green-500 ${erros.cnpj ? 'border-red-500' : 'border-gray-300'} bg-white text-gray-900`}
                    placeholder={empresaCadastrada ? '000.000.000-00 ou 00.000.000/0000-00' : 'Opcional'}
                    required={false}
                    maxLength={18}
                  />

                  <button
                    type="button"
                    onClick={handleBuscarCnpj}
                    disabled={!podeBuscarCnpj}
                    title={cnpjDigits.length === 14 ? 'Buscar dados do CNPJ' : 'Digite um CNPJ com 14 dígitos'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Buscar dados do CNPJ"
                  >
                    {buscandoCnpj ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                  </button>
                </div>
                {erros.cnpj && <p className="mt-1 text-sm text-red-500">{erros.cnpj}</p>}
                {!erros.cnpj && cnpjLookupError && <p className="mt-1 text-sm text-red-500">{cnpjLookupError}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Código <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={String(formData.codigo || '')}
                  onChange={(e) => handleChange('codigo', e.target.value)}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-green-500 ${erros.codigo ? 'border-red-500' : 'border-gray-300'} bg-white text-gray-900`}
                  placeholder="001"
                  required
                />
                {erros.codigo && <p className="mt-1 text-sm text-red-500">{erros.codigo}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Matriz/Filial</label>
                <select
                  value={formData.tipoEstabelecimento}
                  onChange={(e) => handleChange('tipoEstabelecimento', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 bg-white text-gray-900"
                >
                  <option value="">Selecione...</option>
                  <option value="matriz">Matriz</option>
                  <option value="filial">Filial</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Razão Social {empresaCadastrada && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={String(formData.razao_social || '')}
                  onChange={(e) => handleChange('razao_social', e.target.value)}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-green-500 ${erros.razao_social ? 'border-red-500' : 'border-gray-300'} bg-white text-gray-900`}
                  placeholder={empresaCadastrada ? 'Nome oficial da empresa' : 'Nome provisório (opcional)'}
                  required={empresaCadastrada}
                />
                {erros.razao_social && <p className="mt-1 text-sm text-red-500">{erros.razao_social}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Apelido/Nome Fantasia</label>
                <input
                  type="text"
                  value={String(formData.apelido || '')}
                  onChange={(e) => handleChange('apelido', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 bg-white text-gray-900"
                  placeholder="Apelido"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Tipo de Inscrição</label>
                <select
                  value={formData.tipoInscricao}
                  onChange={(e) => handleChange('tipoInscricao', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 bg-white text-gray-900"
                >
                  <option value="">Selecione...</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="CPF">CPF</option>
                  <option value="MEI">MEI</option>
                  <option value="CAEPF">CAEPF</option>
                  <option value="CNO">CNO</option>
                  <option value="CEI">CEI</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Data de Abertura</label>
                <input
                  type="date"
                  value={String(formData.data_abertura || '')}
                  onChange={(e) => handleChange('data_abertura', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 bg-white text-gray-900"
                />
              </div>
            </div>

            {!empresaCadastrada && (
              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">
                  ⚠️ <strong>Empresa não cadastrada:</strong> Os campos CNPJ e Razão Social são opcionais.
                  Complete estas informações quando a empresa for oficializada.
                </p>
              </div>
            )}
          </div>

          {/* Serviços */}
          <div className="bg-cyan-50 rounded-xl p-4 border border-cyan-200">
            <h4 className="font-semibold text-cyan-800 mb-4">Serviços contratados</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {allServicos.map((s) => (
                <label key={s} className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={(formData.servicos ?? []).includes(s)}
                    onChange={() => toggleServico(s)}
                    className="h-5 w-5"
                  />
                  <span className="font-semibold text-gray-900">{s}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex gap-3">
              <input
                value={servicoNovo}
                onChange={(e) => setServicoNovo(e.target.value)}
                className="flex-1 rounded-xl border px-4 py-3 bg-white"
                placeholder="Adicionar outro serviço (ex.: Abertura, DP, etc)"
              />
              <button
                type="button"
                onClick={addServico}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 text-white px-4 py-3 font-semibold hover:bg-cyan-700"
                disabled={!servicoNovo.trim()}
              >
                <Plus size={18} />
                Adicionar
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-600">Você pode selecionar mais de um serviço.</div>
          </div>

          {/* RET */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-4">Possui RET?</h4>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-white p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                <input type="radio" name="possuiRet" checked={Boolean(formData.possuiRet)} onChange={() => setPossuiRet(true)} />
                <span className="font-semibold">Sim</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer bg-white p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                <input type="radio" name="possuiRet" checked={!formData.possuiRet} onChange={() => setPossuiRet(false)} />
                <span className="font-semibold">Não</span>
              </label>
            </div>

            {formData.possuiRet && (
              <div className="mt-4 space-y-4">
                {(formData.rets ?? []).map((r, idx) => (
                  <div key={r.id} className="rounded-2xl border bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-gray-900">RET {idx + 1}</div>
                      <button type="button" onClick={() => removeRet(r.id)} className="rounded-xl border p-2 hover:bg-gray-50" title="Remover RET">
                        <Trash2 className="text-red-600" size={18} />
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Número do PTA *</label>
                        <input
                          value={formatRetNumber(r.numeroPta)}
                          onChange={(e) => updateRet(r.id, { numeroPta: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                          className={`w-full rounded-xl border px-4 py-3 ${erros[`ret_${idx}_numeroPta`] ? 'border-red-500' : 'border-gray-300'}`}
                          placeholder="Ex.: 01.00012345-67"
                        />
                        {erros[`ret_${idx}_numeroPta`] && <div className="text-sm text-red-500 mt-1">{erros[`ret_${idx}_numeroPta`]}</div>}
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Nome *</label>
                        <input
                          value={r.nome}
                          onChange={(e) => updateRet(r.id, { nome: e.target.value })}
                          className={`w-full rounded-xl border px-4 py-3 ${erros[`ret_${idx}_nome`] ? 'border-red-500' : 'border-gray-300'}`}
                          placeholder="Ex.: RET X"
                        />
                        {erros[`ret_${idx}_nome`] && <div className="text-sm text-red-500 mt-1">{erros[`ret_${idx}_nome`]}</div>}
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Vencimento *</label>
                        <input
                          type="date"
                          value={r.vencimento}
                          onChange={(e) => updateRet(r.id, { vencimento: e.target.value })}
                          className={`w-full rounded-xl border px-4 py-3 ${erros[`ret_${idx}_vencimento`] ? 'border-red-500' : 'border-gray-300'}`}
                        />
                        {erros[`ret_${idx}_vencimento`] && <div className="text-sm text-red-500 mt-1">{erros[`ret_${idx}_vencimento`]}</div>}
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Última data de renovação *</label>
                        <input
                          type="date"
                          value={r.ultimaRenovacao}
                          onChange={(e) => updateRet(r.id, { ultimaRenovacao: e.target.value })}
                          className={`w-full rounded-xl border px-4 py-3 ${erros[`ret_${idx}_ultimaRenovacao`] ? 'border-red-500' : 'border-gray-300'}`}
                        />
                        {erros[`ret_${idx}_ultimaRenovacao`] && <div className="text-sm text-red-500 mt-1">{erros[`ret_${idx}_ultimaRenovacao`]}</div>}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addRet}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 text-white px-4 py-3 font-semibold hover:bg-cyan-700"
                >
                  <Plus size={18} />
                  Adicionar RET
                </button>
              </div>
            )}
          </div>

          {/* Responsáveis */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h4 className="font-semibold text-gray-800 mb-4">Responsáveis por Departamento</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {departamentos.map((d) => {
                const activeUsers = usuarios.filter((u) => u.ativo);
                return (
                  <div key={d.id}>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{d.nome}</label>
                    <select
                      value={(formData.responsaveis as any)?.[d.id] ?? ''}
                      onChange={(e) => {
                        const userId = e.target.value || null;
                        setFormData((prev) => ({
                          ...prev,
                          responsaveis: { ...(prev.responsaveis ?? {}), [d.id]: userId },
                        }));
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white"
                    >
                      <option value="">(Sem responsável)</option>
                      {activeUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome}
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-gray-500 mt-1">Mostra todos os usuários ativos.</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inscrições e Regimes */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-4">Inscrições e Regimes</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Inscrição Estadual</label>
                <input
                  type="text"
                  value={String(formData.inscricao_estadual || '')}
                  onChange={(e) => handleChange('inscricao_estadual', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Inscrição Municipal</label>
                <input
                  type="text"
                  value={String(formData.inscricao_municipal || '')}
                  onChange={(e) => handleChange('inscricao_municipal', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Regime Federal</label>
                <select
                  value={String(formData.regime_federal || '')}
                  onChange={(e) => handleChange('regime_federal', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                >
                  <option value="">Selecione...</option>
                  <option value="MEI">MEI</option>
                  <option value="Simples Nacional">Simples Nacional</option>
                  <option value="Lucro Presumido">Lucro Presumido</option>
                  <option value="Lucro Real">Lucro Real</option>
                </select>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Regime Estadual</label>
                <input
                  type="text"
                  value={String(formData.regime_estadual || '')}
                  onChange={(e) => handleChange('regime_estadual', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Regime Municipal</label>
                <input
                  type="text"
                  value={String(formData.regime_municipal || '')}
                  onChange={(e) => handleChange('regime_municipal', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div className="bg-cyan-50 rounded-xl p-4 border border-cyan-200">
            <h4 className="font-semibold text-cyan-800 mb-4">Endereço</h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CEP</label>
                <input
                  type="text"
                  value={String(formData.cep || '')}
                  onChange={(e) => {
                    const apenasNumeros = e.target.value.replace(/\D/g, '');
                    const valorFormatado = formatarCEP(apenasNumeros);
                    handleChange('cep', valorFormatado);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.ctrlKey ||
                      e.metaKey ||
                      ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                      /^[0-9]$/.test(e.key)
                    )
                      return;
                    e.preventDefault();
                  }}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-cyan-500 ${erros.cep ? 'border-red-500' : 'border-gray-300'} bg-white text-gray-900`}
                  placeholder="00000-000"
                  maxLength={9}
                />
                {erros.cep && <p className="mt-1 text-sm text-red-500">{erros.cep}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Estado</label>
                <select
                  value={String(formData.estado || '')}
                  onChange={(e) => handleChange('estado', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 bg-white text-gray-900"
                >
                  <option value="">Selecione...</option>
                  {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Cidade</label>
                <input
                  type="text"
                  value={String(formData.cidade || '')}
                  onChange={(e) => handleChange('cidade', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 bg-white text-gray-900"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Bairro</label>
                <input
                  type="text"
                  value={String(formData.bairro || '')}
                  onChange={(e) => handleChange('bairro', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Logradouro</label>
                <input
                  type="text"
                  value={String(formData.logradouro || '')}
                  onChange={(e) => handleChange('logradouro', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 bg-white text-gray-900"
                  placeholder="Rua, Avenida..."
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Número</label>
              <input
                type="text"
                value={String(formData.numero || '')}
                onChange={(e) => {
                  const apenasNumeros = e.target.value.replace(/\D/g, '');
                  handleChange('numero', apenasNumeros);
                }}
                onKeyDown={(e) => {
                  if (
                    e.ctrlKey ||
                    e.metaKey ||
                    ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                    /^[0-9]$/.test(e.key)
                  )
                    return;
                  e.preventDefault();
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 bg-white text-gray-900"
              />
            </div>
          </div>

          {/* Botões */}
          <div className="flex gap-4 pt-6 border-t border-gray-200">
            <button type="button" onClick={onClose} className="flex-1 px-6 py-3 text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-100">
              Cancelar
            </button>
            <button type="submit" className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-medium hover:shadow-lg transition-all">
              {empresa ? 'Salvar Alterações' : 'Cadastrar Empresa'}
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  );
}
