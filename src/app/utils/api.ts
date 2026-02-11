export type CnpjLookup = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  data_abertura?: string;
  estado?: string;
  cidade?: string;
  bairro?: string;
  logradouro?: string;
  numero?: string;
  cep?: string;
  email?: string;
  telefone?: string;
  situacao?: string;
  provider?: string;
};

export const api = {
  async consultarCnpj(cnpjDigits: string): Promise<CnpjLookup> {
    const res = await fetch(`/api/cnpj/${cnpjDigits}`);
    if (!res.ok) {
      let msg = 'Falha ao consultar CNPJ';
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        const text = await res.text().catch(() => '');
        if (text) msg = text;
      }
      throw new Error(msg);
    }
    return (await res.json()) as CnpjLookup;
  },
};
