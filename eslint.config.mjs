import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Defesa em profundidade: o client com service-role key (supabaseAdmin) NUNCA
  // pode entrar no bundle do browser. Antes era só convenção verbal no CLAUDE.md;
  // agora o lint barra. Server-side (API routes e src/lib) é liberado no override abaixo.
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/supabaseAdmin",
          message: "supabaseAdmin usa service-role key — só pode ser importado em código server-side (src/app/api/** ou src/lib/**). Nunca em componente/página do browser.",
        }],
      }],
    },
  },
  {
    files: ["src/app/api/**", "src/lib/**"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
