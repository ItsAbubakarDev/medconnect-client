import type { RxContent, RxMedicine, RxTemplateContent, TestCategory } from "@/lib/types";

export const CATEGORY_LABELS: Record<TestCategory, string> = {
  pathology: "Pathology",
  radiology: "Radiology",
  clinical: "Clinical investigations",
};

export const TIMING_LABELS: Record<string, string> = {
  before_meal: "Before meal",
  after_meal: "After meal",
  with_meal: "With meal",
  empty_stomach: "Empty stomach",
  bedtime: "At bedtime",
  any: "Any time",
};

const UNIT_FOR_FORM: [RegExp, string][] = [
  [/tablet/i, "tab"],
  [/capsule/i, "cap"],
  [/syrup|suspension|oral solution/i, "tsp"],
  [/drops/i, "drops"],
  [/inhaler/i, "puff"],
  [/sachet|granules|powder/i, "sachet"],
  [/injection|infusion/i, "inj"],
  [/spray/i, "spray"],
  [/cream|ointment|gel|lotion|shampoo|topical|patch/i, "apply"],
];

/** The usual unit for a form ("Syrup" → tsp), to fill a new medicine line in. */
export function unitForForm(form: string | null | undefined): string | null {
  if (!form) return null;
  return UNIT_FOR_FORM.find(([re]) => re.test(form))?.[1] ?? null;
}

const UNIT_WORDS: Record<string, [string, string]> = {
  tab: ["tablet", "tablets"],
  cap: ["capsule", "capsules"],
  tsp: ["teaspoon", "teaspoons"],
  ml: ["ml", "ml"],
  drops: ["drop", "drops"],
  puff: ["puff", "puffs"],
  sachet: ["sachet", "sachets"],
  inj: ["injection", "injections"],
  spray: ["spray", "sprays"],
};
const SLOTS_3 = ["morning", "afternoon", "night"];
const SLOTS_4 = ["morning", "afternoon", "evening", "night"];
const ABBREVIATIONS: Record<string, string> = {
  OD: "Once a day",
  BD: "Twice a day",
  TDS: "Three times a day",
  QID: "Four times a day",
  HS: "At bedtime",
  SOS: "When needed",
  STAT: "Once, right away",
  WEEKLY: "Once a week",
};

/** "1+0+1" + tab → "1 tablet morning, 1 tablet night" (as the PDF says it). */
export function doseWords(dose: string | null | undefined, unit: string | null | undefined): string {
  if (!dose) return "";
  const parts = dose.replace(/\s/g, "").split("+");
  if ((parts.length === 3 || parts.length === 4) && parts.every((p) => /^(\d+(\.\d+)?|½|¼|¾|1½)$/.test(p))) {
    const slots = parts.length === 3 ? SLOTS_3 : SLOTS_4;
    const said = parts
      .map((amount, i) => {
        if (amount === "0") return null;
        if (unit === "apply") return `apply ${slots[i]}`;
        const words = unit ? UNIT_WORDS[unit] : undefined;
        const word = words ? ` ${["1", "½", "¼", "¾"].includes(amount) ? words[0] : words[1]}` : unit ? ` ${unit}` : "";
        return `${amount}${word} ${slots[i]}`;
      })
      .filter(Boolean)
      .join(", ");
    return said ? said[0].toUpperCase() + said.slice(1) : dose;
  }
  return ABBREVIATIONS[dose.trim().toUpperCase()] ?? dose;
}

export function durationWords(m: Pick<RxMedicine, "duration_value" | "duration_unit">): string {
  if (m.duration_unit === "continue") return "Continue";
  if (!m.duration_value) return "";
  const unit = m.duration_unit ?? "days";
  return `${m.duration_value} ${m.duration_value === 1 ? unit.slice(0, -1) : unit}`;
}

/** One line: "1 tablet morning, 1 tablet night · After meal · 5 days". */
export function sigLine(m: RxMedicine): string {
  const timing = m.timing && m.timing !== "any" ? (TIMING_LABELS[m.timing] ?? m.timing) : "";
  return [doseWords(m.dose, m.unit), timing, durationWords(m)].filter(Boolean).join(" · ");
}

export function medicineTitle(m: RxMedicine): string {
  const extra = [m.strength, m.form].filter((x) => x && !m.name.toLowerCase().includes(x.toLowerCase()));
  return [m.name, ...extra].join(" ");
}

export function norm(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^0-9a-z%]+/g, " ").trim();
}

export const EMPTY_CONTENT: RxContent = {
  complaint: null,
  diagnoses: [],
  vitals: {},
  tests: [],
  medicines: [],
  advice: null,
  follow_up: null,
};

/** A template or a previous prescription added onto the current one: lists gain what they
 * don't have yet; the complaint and advice are filled in only where empty / appended. */
export function mergeInto(current: RxContent, extra: Partial<RxTemplateContent & RxContent>): RxContent {
  const has = (list: { name: string }[], name: string) => list.some((x) => norm(x.name) === norm(name));
  const advice = [current.advice, extra.advice]
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .filter((line, i, all) => line.trim() && all.findIndex((l) => norm(l) === norm(line)) === i)
    .join("\n");
  return {
    ...current,
    complaint: current.complaint || extra.complaint || null,
    diagnoses: [...current.diagnoses, ...(extra.diagnoses ?? []).filter((d) => !has(current.diagnoses, d.name))],
    tests: [...current.tests, ...(extra.tests ?? []).filter((t) => !has(current.tests, t.name))],
    medicines: [
      ...current.medicines,
      ...(extra.medicines ?? []).filter(
        (m) => !current.medicines.some((c) => norm(c.name) === norm(m.name) && norm(c.strength) === norm(m.strength)),
      ),
    ],
    advice: advice || null,
  };
}

// Medicine families for the allergy warning: an allergy to the family name (or any member)
// warns on every member. A reminder for the doctor, not a substitute for their judgement.
const FAMILIES: string[][] = [
  ["penicillin", "amoxicillin", "ampicillin", "co amoxiclav", "clavulanic", "cloxacillin", "flucloxacillin", "piperacillin", "benzylpenicillin", "phenoxymethylpenicillin", "augmentin", "amoxil"],
  ["cephalosporin", "cefalexin", "cephalexin", "cefradine", "cephradine", "cefuroxime", "cefixime", "ceftriaxone", "cefaclor", "cefadroxil", "cefotaxime", "cefpodoxime", "cefepime", "ceftazidime"],
  ["sulfa", "sulpha", "sulfonamide", "sulfamethoxazole", "co trimoxazole", "sulfasalazine", "septran"],
  ["nsaid", "aspirin", "ibuprofen", "diclofenac", "naproxen", "mefenamic", "ketorolac", "piroxicam", "celecoxib", "etoricoxib", "brufen", "ponstan", "disprin"],
  ["macrolide", "azithromycin", "clarithromycin", "erythromycin"],
  ["quinolone", "fluoroquinolone", "ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin"],
  ["tetracycline", "doxycycline", "minocycline"],
];

/** The patient's allergies this medicine may touch (by name, composition or family). */
export function allergyMatches(m: RxMedicine, allergies: string[]): string[] {
  const text = ` ${norm(`${m.name} ${m.generic ?? ""}`)} `;
  return allergies.filter((allergy) => {
    const a = norm(allergy);
    if (!a) return false;
    if (a.split(" ").some((w) => w.length >= 4 && text.includes(w))) return true;
    return FAMILIES.some(
      (family) => family.some((f) => a.includes(f)) && family.some((f) => text.includes(` ${f}`) || text.includes(f)),
    );
  });
}
