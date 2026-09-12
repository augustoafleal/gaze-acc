export const CONCEPTS = [
  { id: "sim", label: "SIM", speech: "Sim" },
  { id: "nao", label: "NÃO", speech: "Não" },
  { id: "agua", label: "ÁGUA", speech: "Água" },
  { id: "dor", label: "DOR", speech: "Dor" },
] as const;

export type ConceptId = (typeof CONCEPTS)[number]["id"];
