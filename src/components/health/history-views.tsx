"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { formatDate } from "@/lib/format";
import {
  DOCUMENT_LABELS,
  EMPTY_FILTER,
  KIND_LABELS,
  applyFilter,
  documentLabel,
  documentTitle,
  entryDetailLine,
  monthHeading,
  providersOf,
  quickGlance,
  timelineItems,
} from "@/lib/health";
import type { TimelineFilter, TimelineItem } from "@/lib/health";
import type {
  Consultation,
  DocumentType,
  HealthEntry,
  HealthEntryKind,
  MedicalDocument,
  MedicalHistory,
  MedicalProfile,
} from "@/lib/types";

import { Button, Card, EmptyState, Field, Input, Select } from "../ui";
import { seriesSummary } from "./file-viewer";

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "red" | "amber" | "brand" | "violet";
  children: ReactNode;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    red: "bg-red-50 text-red-800 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const PrivateBadge = () => <Badge>🔒 Private</Badge>;
export const DoctorBadge = ({ name }: { name?: string | null }) => <Badge tone="violet">From {name ?? "your doctor"}</Badge>;

// ---- quick glance

function GlanceBox({ title, empty, children, count }: { title: string; empty: string; count: number; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {count === 0 ? <p className="mt-2 text-sm text-slate-500">{empty}</p> : <ul className="mt-2 space-y-1.5">{children}</ul>}
    </div>
  );
}

/** The one-look summary: allergies (severe first, in red), chronic conditions, current
 * medications, blood group / height / weight. */
export function QuickGlance({ history }: { history: Pick<MedicalHistory, "entries"> & { profile: MedicalProfile | null } }) {
  const { allergies, conditions, medications } = quickGlance(history);
  const p = history.profile;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <GlanceBox title="Allergies" empty="None recorded" count={allergies.length}>
        {allergies.map((a) => (
          <li
            key={a.id}
            className={`rounded-md px-2 py-1 text-sm ${a.severity === "severe" ? "bg-red-50 font-semibold text-red-800 ring-1 ring-red-200" : "text-ink"}`}
          >
            {a.severity === "severe" && <span aria-hidden>⚠ </span>}
            {a.title}
            <span className="font-normal text-slate-600">
              {" "}
              · {a.severity}
              {a.reaction ? ` — ${a.reaction}` : ""}
            </span>
          </li>
        ))}
      </GlanceBox>
      <GlanceBox title="Chronic conditions" empty="None recorded" count={conditions.length}>
        {conditions.map((c) => (
          <li key={c.id} className="text-sm text-ink">
            {c.title}
            {c.entry_date && <span className="text-slate-600"> · since {c.entry_date.slice(0, 4)}</span>}
          </li>
        ))}
      </GlanceBox>
      <GlanceBox title="Current medications" empty="None recorded" count={medications.length}>
        {medications.map((m) => (
          <li key={m.id} className="text-sm text-ink">
            {m.title}
            {(m.dosage || m.frequency) && (
              <span className="text-slate-600"> · {[m.dosage, m.frequency].filter(Boolean).join(", ")}</span>
            )}
          </li>
        ))}
      </GlanceBox>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blood group</p>
        <p className="mt-1 text-2xl font-bold text-ink">{p?.blood_group ?? "—"}</p>
        <p className="mt-1 text-sm text-slate-600">
          {p?.height_cm ? `${Number(p.height_cm)} cm` : "Height —"} · {p?.weight_kg ? `${Number(p.weight_kg)} kg` : "Weight —"}
        </p>
      </div>
    </div>
  );
}

// ---- one record

export function EntryRow({ entry: e, actions }: { entry: HealthEntry; actions?: ReactNode }) {
  const detail = entryDetailLine(e);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${e.kind === "allergy" && e.severity === "severe" ? "text-red-800" : "text-ink"}`}>
            {e.title}
          </p>
          {e.kind === "allergy" && e.severity && (
            <Badge tone={e.severity === "severe" ? "red" : e.severity === "moderate" ? "amber" : "slate"}>{e.severity}</Badge>
          )}
          {e.is_private && <PrivateBadge />}
          {e.source === "consultation" && <DoctorBadge name={e.provider_name} />}
        </div>
        {detail && <p className="text-sm text-slate-600">{detail}</p>}
        <p className="text-sm text-slate-500">
          {[e.entry_date && formatDate(e.entry_date), e.source !== "consultation" && e.provider_name].filter(Boolean).join(" · ")}
        </p>
        {e.details && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{e.details}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </li>
  );
}

export function DocumentCard({
  document: d,
  onOpen,
  actions,
}: {
  document: MedicalDocument;
  onOpen: (fileId?: number) => void;
  actions?: ReactNode;
}) {
  const series = seriesSummary(d.files);
  const shownFiles = d.files.length > 6 && series ? [] : d.files.slice(0, 6);
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onOpen()} className="text-left font-semibold text-ink hover:text-brand-700">
              {documentTitle(d)}
            </button>
            {d.is_private && <PrivateBadge />}
            {d.source === "consultation" && <DoctorBadge name={d.provider_name} />}
          </div>
          <p className="text-sm text-slate-600">
            {documentLabel(d)} · {formatDate(d.report_date)}
            {d.provider_name && d.source !== "consultation" ? ` · ${d.provider_name}` : ""}
          </p>
          {d.description && <p className="mt-1 break-words text-sm text-slate-700">{d.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {series && (
              <button
                type="button"
                onClick={() => onOpen()}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-brand-800 hover:bg-slate-50"
              >
                View {series}
              </button>
            )}
            {shownFiles
              .filter((f) => !series || !f.is_dicom)
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onOpen(f.id)}
                  className="max-w-[14rem] truncate rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-ink hover:bg-slate-50"
                >
                  {f.original_filename}
                </button>
              ))}
            {!series && d.files.length > 6 && (
              <span className="px-1 py-1 text-xs text-slate-500">+{d.files.length - 6} more</span>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </Card>
  );
}

export function ConsultationCard({
  consultation: c,
  onOpenDocument,
  actions,
}: {
  consultation: Consultation;
  onOpenDocument: (d: MedicalDocument, fileId?: number) => void;
  actions?: ReactNode;
}) {
  return (
    <Card className="border-violet-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">Consultation</Badge>
            {c.is_private && <PrivateBadge />}
            {c.is_own && <Badge tone="brand">Your record</Badge>}
          </div>
          <p className="text-sm text-slate-600">
            {c.doctor_name ?? "Doctor"}
            {c.doctor_specialty ? `, ${c.doctor_specialty}` : ""} · {formatDate(c.visit_date)}
          </p>
          <p className="break-words font-semibold text-ink">Diagnosis: {c.diagnosis}</p>
          {c.medications.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink">Prescribed</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {c.medications.map((m) => (
                  <li key={m.id}>
                    {m.title}
                    {[m.dosage, m.frequency].some(Boolean) && ` — ${[m.dosage, m.frequency].filter(Boolean).join(", ")}`}
                    {m.details && <span className="text-slate-500"> ({m.details})</span>}
                    {m.status === "stopped" && <span className="text-slate-500"> · stopped</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.notes && (
            <p className="whitespace-pre-line break-words text-sm text-slate-700">
              <span className="font-medium text-ink">Notes: </span>
              {c.notes}
            </p>
          )}
          {c.follow_up && (
            <p className="whitespace-pre-line break-words text-sm text-slate-700">
              <span className="font-medium text-ink">Follow-up: </span>
              {c.follow_up}
            </p>
          )}
          {c.prescription && (
            <Button variant="secondary" size="sm" onClick={() => onOpenDocument(c.prescription!)}>
              View prescription ({c.prescription.files.length} file{c.prescription.files.length > 1 ? "s" : ""})
            </Button>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </Card>
  );
}

// ---- the timeline

const ENTRY_KINDS = Object.keys(KIND_LABELS) as HealthEntryKind[];
const DOC_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];
const GROUP_HEADINGS: Record<DocumentType, string> = {
  xray: "X-rays",
  scan: "Scans",
  lab_report: "Lab reports",
  prescription: "Prescriptions",
  other: "Other documents",
};

export function TimelineFilters({
  value,
  onChange,
  providers,
}: {
  value: TimelineFilter;
  onChange: (f: TimelineFilter) => void;
  providers: string[];
}) {
  const set = (patch: Partial<TimelineFilter>) => onChange({ ...value, ...patch });
  const active = value.category || value.provider || value.from || value.to;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
      <Field label="Type" htmlFor="tl-type">
        <Select
          id="tl-type"
          value={value.category}
          onChange={(e) => set({ category: e.target.value as TimelineFilter["category"] })}
        >
          <option value="">Everything</option>
          <option value="consultation">Consultations</option>
          <optgroup label="Documents">
            <option value="document">All documents</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={`document:${t}`}>
                {DOCUMENT_LABELS[t]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Health information">
            <option value="entry">All health information</option>
            {ENTRY_KINDS.map((k) => (
              <option key={k} value={`entry:${k}`}>
                {KIND_LABELS[k].many}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Doctor or hospital" htmlFor="tl-provider">
        <Select id="tl-provider" value={value.provider} onChange={(e) => set({ provider: e.target.value })}>
          <option value="">Any</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="From" htmlFor="tl-from">
        <Input id="tl-from" type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
      </Field>
      <Field label="To" htmlFor="tl-to">
        <Input id="tl-to" type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
      </Field>
      <Button variant="ghost" onClick={() => onChange(EMPTY_FILTER)} disabled={!active}>
        Clear
      </Button>
    </div>
  );
}

function TimelineRow({
  item,
  onOpenDocument,
  actions,
}: {
  item: TimelineItem;
  onOpenDocument: (d: MedicalDocument) => void;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tone = item.category === "consultation" ? "violet" : item.category.startsWith("document") ? "brand" : "slate";
  const severe = item.entry?.kind === "allergy" && item.entry.severity === "severe";
  return (
    <li className="relative pl-6">
      <span className={`absolute left-0 top-2 h-2.5 w-2.5 rounded-full ${severe ? "bg-red-600" : "bg-brand-700"}`} aria-hidden />
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severe ? "red" : tone}>{item.label}</Badge>
              <span className="text-sm text-slate-500">
                {formatDate(item.date)}
                {item.dateIsAdded && " (added)"}
              </span>
              {item.isPrivate && <PrivateBadge />}
            </div>
            <button
              type="button"
              onClick={() => (item.document ? onOpenDocument(item.document) : setOpen((o) => !o))}
              aria-expanded={item.document ? undefined : open}
              className={`mt-1 block text-left font-semibold hover:text-brand-700 ${severe ? "text-red-800" : "text-ink"}`}
            >
              {item.title}
            </button>
            <p className="break-words text-sm text-slate-600">{[item.provider, item.detail].filter(Boolean).join(" · ")}</p>
            {open && item.entry?.details && (
              <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">{item.entry.details}</p>
            )}
            {open && item.consultation && (
              <div className="mt-3">
                <ConsultationCard consultation={item.consultation} onOpenDocument={onOpenDocument} />
              </div>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </li>
  );
}

/** Everything in one chronological list, newest first, grouped by month, filterable by
 * type, doctor/hospital and date. */
export function Timeline({
  history,
  onOpenDocument,
  actionsFor,
}: {
  history: Pick<MedicalHistory, "entries" | "documents" | "consultations">;
  onOpenDocument: (d: MedicalDocument) => void;
  actionsFor?: (item: TimelineItem) => ReactNode;
}) {
  const [filter, setFilter] = useState<TimelineFilter>(EMPTY_FILTER);
  const all = useMemo(() => timelineItems(history), [history]);
  const shown = useMemo(() => applyFilter(all, filter), [all, filter]);
  const months: [string, TimelineItem[]][] = [];
  for (const item of shown) {
    const heading = monthHeading(item.date);
    if (months.at(-1)?.[0] === heading) months.at(-1)![1].push(item);
    else months.push([heading, [item]]);
  }

  return (
    <div className="space-y-6">
      <TimelineFilters value={filter} onChange={setFilter} providers={providersOf(all)} />
      {all.length === 0 ? (
        <EmptyState title="Nothing in the history yet" />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing matches these filters" />
      ) : (
        months.map(([heading, items]) => (
          <section key={heading}>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
            <ol className="space-y-3 border-l border-slate-200 pl-0">
              {items.map((item) => (
                <TimelineRow key={item.key} item={item} onOpenDocument={onOpenDocument} actions={actionsFor?.(item)} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

/** Documents grouped by type (imaging studies, lab reports, prescriptions...). */
export function DocumentGroups({
  documents,
  onOpen,
  actionsFor,
  empty,
}: {
  documents: MedicalDocument[];
  onOpen: (d: MedicalDocument, fileId?: number) => void;
  actionsFor?: (d: MedicalDocument) => ReactNode;
  empty: ReactNode;
}) {
  const [type, setType] = useState<"" | DocumentType>("");
  const shown = documents.filter((d) => !type || d.document_type === type);
  const groups = DOC_TYPES.map((t) => [t, shown.filter((d) => d.document_type === t)] as const).filter(([, list]) => list.length);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter documents by type">
        {(["", ...DOC_TYPES] as const).map((t) => {
          const count = t ? documents.filter((d) => d.document_type === t).length : documents.length;
          return (
            <button
              key={t || "all"}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${type === t ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}
            >
              {t ? DOCUMENT_LABELS[t] : "All"} ({count})
            </button>
          );
        })}
      </div>
      {documents.length === 0
        ? empty
        : groups.map(([t, list]) => (
            <section key={t}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{GROUP_HEADINGS[t]}</h3>
              <div className="grid gap-3">
                {list.map((d) => (
                  <DocumentCard key={d.id} document={d} onOpen={(fileId) => onOpen(d, fileId)} actions={actionsFor?.(d)} />
                ))}
              </div>
            </section>
          ))}
    </div>
  );
}
