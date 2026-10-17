// Shared vocabulary and shaping for medical history, used by the patient's own record and
// by the doctor's view of a booked patient (both get the same item shapes from the API).

import { formatDate } from "./format";
import type {
  Consultation,
  DocumentType,
  HealthEntry,
  HealthEntryKind,
  MedicalDocument,
  MedicalHistory,
  ShareItemRef,
  ShareItemType,
} from "./types";

export const KIND_LABELS: Record<HealthEntryKind, { one: string; many: string }> = {
  allergy: { one: "Allergy", many: "Allergies" },
  condition: { one: "Condition", many: "Chronic conditions" },
  medication: { one: "Medication", many: "Medications" },
  diagnosis: { one: "Diagnosis", many: "Past diagnoses" },
  surgery: { one: "Surgery", many: "Surgeries" },
  note: { one: "Note", many: "Notes & symptoms" },
};

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  prescription: "Prescription",
  lab_report: "Lab report",
  xray: "X-ray",
  scan: "Scan",
  other: "Other document",
};

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export function documentLabel(d: MedicalDocument): string {
  // An imaging study says what it is ("CT scan · Chest") rather than just "Scan".
  if (d.modality_name && (d.document_type === "xray" || d.document_type === "scan" || d.document_type === "other")) {
    return [d.modality_name, titleCase(d.body_part)].filter(Boolean).join(" · ");
  }
  return DOCUMENT_LABELS[d.document_type];
}

export function documentTitle(d: MedicalDocument): string {
  return d.title || documentLabel(d);
}

export function titleCase(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The kind-specific line under an entry's title ("500 mg · Twice daily"). */
export function entryDetailLine(e: HealthEntry): string {
  const parts: string[] = [];
  if (e.kind === "allergy") {
    if (e.severity) parts.push(`${titleCase(e.severity)} reaction`);
    if (e.reaction) parts.push(e.reaction);
  }
  if (e.kind === "medication") {
    if (e.dosage) parts.push(e.dosage);
    if (e.frequency) parts.push(e.frequency);
    if (e.status === "stopped") parts.push(e.end_date ? `stopped ${formatDate(e.end_date)}` : "stopped");
  }
  if (e.kind === "condition" && e.status === "resolved") parts.push("resolved");
  return parts.join(" · ");
}

export const refKey = (r: ShareItemRef) => `${r.type}:${r.id}`;

// ---- quick glance (the doctor's header, and the top of the patient's record)

export function quickGlance(history: Pick<MedicalHistory, "entries">) {
  const active = (e: HealthEntry) => e.status !== "stopped" && e.status !== "resolved";
  const severity = { severe: 0, moderate: 1, mild: 2 } as const;
  return {
    allergies: history.entries
      .filter((e) => e.kind === "allergy")
      .sort((a, b) => severity[a.severity ?? "mild"] - severity[b.severity ?? "mild"]),
    conditions: history.entries.filter((e) => e.kind === "condition" && active(e)),
    medications: history.entries.filter((e) => e.kind === "medication" && active(e)),
  };
}

// ---- the timeline: every record in one chronological list

export type TimelineCategory = `entry:${HealthEntryKind}` | `document:${DocumentType}` | "consultation";

export interface TimelineItem {
  key: string;
  ref: ShareItemRef;
  category: TimelineCategory;
  /** The date the record is about (report date, diagnosis date...); else when it was added. */
  date: string;
  dateIsAdded: boolean;
  title: string;
  label: string; // "Lab report", "Allergy", "Consultation"...
  detail: string;
  provider: string | null;
  isPrivate: boolean;
  fromDoctor: boolean;
  entry?: HealthEntry;
  document?: MedicalDocument;
  consultation?: Consultation;
}

const day = (iso: string) => iso.slice(0, 10);

export function timelineItems(history: Pick<MedicalHistory, "entries" | "documents" | "consultations">): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const c of history.consultations) {
    items.push({
      key: `consultation:${c.id}`,
      ref: { type: "consultation", id: c.id },
      category: "consultation",
      date: c.visit_date,
      dateIsAdded: false,
      title: c.diagnosis,
      label: "Consultation",
      detail: [
        c.medications.length ? `${c.medications.length} medicine${c.medications.length > 1 ? "s" : ""} prescribed` : "",
        c.follow_up ?? "",
      ]
        .filter(Boolean)
        .join(" · "),
      provider: c.doctor_name,
      isPrivate: c.is_private,
      fromDoctor: true,
      consultation: c,
    });
  }
  for (const e of history.entries) {
    if (e.consultation_id !== null) continue; // shown with its consultation
    items.push({
      key: `entry:${e.id}`,
      ref: { type: "entry", id: e.id },
      category: `entry:${e.kind}`,
      date: e.entry_date ?? day(e.created_at),
      dateIsAdded: e.entry_date === null,
      title: e.title,
      label: KIND_LABELS[e.kind].one,
      detail: entryDetailLine(e) || (e.details ?? ""),
      provider: e.provider_name,
      isPrivate: e.is_private,
      fromDoctor: e.source === "consultation",
      entry: e,
    });
  }
  for (const d of history.documents) {
    if (d.consultation_id !== null) continue; // shown with its consultation
    items.push({
      key: `document:${d.id}`,
      ref: { type: "document", id: d.id },
      category: `document:${d.document_type}`,
      date: d.report_date,
      dateIsAdded: false,
      title: documentTitle(d),
      label: documentLabel(d),
      detail: `${d.files.length} file${d.files.length > 1 ? "s" : ""}${d.description ? ` · ${d.description}` : ""}`,
      provider: d.provider_name,
      isPrivate: d.is_private,
      fromDoctor: d.source === "consultation",
      document: d,
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
}

export interface TimelineFilter {
  category: "" | TimelineCategory | "entry" | "document";
  provider: string;
  from: string;
  to: string;
}

export const EMPTY_FILTER: TimelineFilter = { category: "", provider: "", from: "", to: "" };

export function applyFilter(items: TimelineItem[], f: TimelineFilter): TimelineItem[] {
  return items.filter(
    (i) =>
      (!f.category || i.category === f.category || i.category.startsWith(`${f.category}:`)) &&
      (!f.provider || (i.provider ?? "").toLowerCase() === f.provider.toLowerCase()) &&
      (!f.from || i.date >= f.from) &&
      (!f.to || i.date <= f.to),
  );
}

export function providersOf(items: TimelineItem[]): string[] {
  const seen = new Map<string, string>();
  for (const i of items) if (i.provider) seen.set(i.provider.toLowerCase(), seen.get(i.provider.toLowerCase()) ?? i.provider);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** "October 2026" headings for the timeline. */
export function monthHeading(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ---- what a share includes (booking step, and the per-appointment sharing page)

export interface ShareableItem {
  ref: ShareItemRef;
  section: string;
  title: string;
  detail: string;
}

/** Everything the patient could share (private items are never offered), by section. */
export function shareableItems(history: MedicalHistory): { items: ShareableItem[]; privateCount: number } {
  const items: ShareableItem[] = [];
  let privateCount = 0;
  const p = history.profile;
  if (p && (p.blood_group || p.height_cm || p.weight_kg)) {
    if (p.is_private) privateCount++;
    else {
      const bits = [
        p.blood_group && `Blood group ${p.blood_group}`,
        p.height_cm && `${Number(p.height_cm)} cm`,
        p.weight_kg && `${Number(p.weight_kg)} kg`,
      ];
      items.push({
        ref: { type: "profile", id: p.id },
        section: "Basic profile",
        title: "Blood group, height and weight",
        detail: bits.filter(Boolean).join(" · "),
      });
    }
  }
  const order: HealthEntryKind[] = ["allergy", "condition", "medication", "diagnosis", "surgery", "note"];
  for (const kind of order) {
    for (const e of history.entries.filter((x) => x.kind === kind && x.consultation_id === null)) {
      if (e.is_private) privateCount++;
      else
        items.push({
          ref: { type: "entry", id: e.id },
          section: KIND_LABELS[kind].many,
          title: e.title,
          detail: entryDetailLine(e),
        });
    }
  }
  for (const d of history.documents.filter((x) => x.consultation_id === null)) {
    if (d.is_private) privateCount++;
    else
      items.push({
        ref: { type: "document", id: d.id },
        section: "Documents",
        title: documentTitle(d),
        detail: `${documentLabel(d)} · ${formatDate(d.report_date)}`,
      });
  }
  for (const c of history.consultations) {
    if (c.is_private) privateCount++;
    else
      items.push({
        ref: { type: "consultation", id: c.id },
        section: "Past consultations",
        title: c.diagnosis,
        detail: `${c.doctor_name ?? "Doctor"} · ${formatDate(c.visit_date)}`,
      });
  }
  return { items, privateCount };
}

export const SHARE_ITEM_TYPES: ShareItemType[] = ["profile", "entry", "document", "consultation"];
