export type CommunicationCard = {
  id: string;
  label: string;
  speech: string;
};

export const DEFAULT_COMMUNICATION_CARDS = [
  { id: "sim", label: "SIM", speech: "Sim" },
  { id: "nao", label: "NÃO", speech: "Não" },
  { id: "virar", label: "VIRAR", speech: "Virar" },
  { id: "dor", label: "DOR", speech: "Dor" },
] as const satisfies readonly CommunicationCard[];

/** Preserved for the legacy gaze interface, whose four experimental targets stay fixed. */
export const CONCEPTS = DEFAULT_COMMUNICATION_CARDS;

export type ConceptId = (typeof CONCEPTS)[number]["id"];

export function defaultCommunicationCards(): CommunicationCard[] {
  return DEFAULT_COMMUNICATION_CARDS.map((card) => ({ ...card }));
}
