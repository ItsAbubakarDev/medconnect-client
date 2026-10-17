// Mirrors the backend's Pydantic response models (medconnect-backend/app/schemas).

export type Role = "doctor" | "patient";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type CancellationReason = "busy" | "other";

export interface Slot {
  id: number;
  doctor_id: number;
  date: string; // YYYY-MM-DD, clinic wall-clock
  start_time: string; // HH:MM:SS, clinic wall-clock
  end_time: string;
  is_booked: boolean;
  is_blocked: boolean;
}

export interface Appointment {
  id: number;
  doctor_id: number;
  patient_id: number;
  slot_id: number;
  status: AppointmentStatus;
  notes: string | null;
  cancelled_by: Role | null;
  cancellation_reason: CancellationReason | null;
  cancellation_note: string | null;
  created_at: string;
  updated_at: string;
  slot: Slot;
}

export interface PatientAppointment extends Appointment {
  sharing: SharingSummary | null;
}

export interface DoctorAppointment extends Appointment {
  patient: { id: number; full_name: string | null };
  /** Whether the patient's shared history can be opened from this appointment right now. */
  history_access: AccessState | null;
  has_consultation: boolean;
}

export interface DoctorProfile {
  id: number;
  user_id: number;
  full_name: string | null;
  specialty: string | null;
  qualifications: string | null;
  experience_years: number | null;
  clinic_name: string | null;
  consultation_fee: string | null; // Decimal, serialised as a string
  bio: string | null;
}

export interface DoctorPublic {
  id: number;
  full_name: string | null;
  specialty: string | null;
  qualifications: string | null;
  experience_years: number | null;
  clinic_name: string | null;
  consultation_fee: string | null;
  bio: string | null;
  profile_image_url: string | null;
}

export interface DoctorList {
  items: DoctorPublic[];
  total: number;
  page: number;
  page_size: number;
}

export interface PatientProfile {
  id: number;
  user_id: number;
  full_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  emergency_contact: string | null;
}

export interface Availability {
  id: number;
  doctor_id: number;
  day_of_week: number; // Monday = 0 ... Sunday = 6
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_active: boolean;
}

export interface Schedule {
  slot_duration_minutes: number | null; // the common appointment length; null with no sessions
  booking_window_days: number;
  bookable_until: string; // last day patients can currently book
  sessions: Availability[];
}

export interface BookedOutsideHours {
  appointment_id: number;
  status: AppointmentStatus;
  date: string;
  start_time: string;
  end_time: string;
  patient_name: string | null;
}

/** What a schedule change did to the doctor's bookable times. */
export interface ScheduleChanges {
  opened: number;
  closed: number;
  booked_outside_hours: BookedOutsideHours[];
}

export interface ScheduleSaveResult {
  schedule: Schedule;
  changes: ScheduleChanges;
}

export interface DayOff {
  id: number;
  doctor_id: number;
  date: string;
  reason: string | null;
  is_blocked: boolean;
}

export interface DaysOffResult {
  days: DayOff[];
  changes: ScheduleChanges;
}

export interface MySlot {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  state: "open" | "booked" | "closed";
  started: boolean;
  appointment: { id: number; status: AppointmentStatus; patient_name: string | null } | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface VideoToken {
  token: string;
  url: string;
  room: string;
  identity: string;
  expires_at: string;
}

export type NotificationType =
  | "booking_requested"
  | "appointment_confirmed"
  | "appointment_completed"
  | "request_not_confirmed"
  | "reminder_day_before"
  | "new_booking"
  | "request_needs_attention"
  | "needs_completion"
  | "appointment_cancelled"
  | "reminder_starting_soon"
  | "call_joined"
  | "history_updated"
  | "consultation_added";

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  created_at: string; // ISO timestamp
  read_at: string | null;
  /** The appointment as it is now (live status), not when the notification was written. */
  appointment: { id: number; status: AppointmentStatus; date: string; start_time: string; end_time: string } | null;
}

export interface NotificationState {
  cursor: string;
  unread_count: number;
  latest_id: number;
}

export interface NotificationPage extends NotificationState {
  items: AppNotification[];
  has_more: boolean;
}

// ---- medical history

export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
export type HealthEntryKind = "allergy" | "condition" | "medication" | "diagnosis" | "surgery" | "note";
export type EntryStatus = "active" | "stopped" | "resolved";
export type AllergySeverity = "mild" | "moderate" | "severe";
export type RecordSource = "patient" | "consultation";
export type DocumentType = "prescription" | "lab_report" | "xray" | "scan" | "other";

export interface MedicalProfile {
  id: number;
  blood_group: BloodGroup | null;
  height_cm: string | null; // Decimal, as a string
  weight_kg: string | null;
  is_private: boolean;
  updated_at: string;
}

export interface HealthEntry {
  id: number;
  kind: HealthEntryKind;
  title: string;
  details: string | null;
  entry_date: string | null;
  end_date: string | null;
  status: EntryStatus | null;
  severity: AllergySeverity | null;
  reaction: string | null;
  dosage: string | null;
  frequency: string | null;
  provider_name: string | null;
  is_private: boolean;
  source: RecordSource;
  consultation_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentFile {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  has_preview: boolean;
  is_dicom: boolean;
  series_uid: string | null;
  series_description: string | null;
  instance_number: number | null;
  uploaded_at: string;
}

export interface MedicalDocument {
  id: number;
  patient_id: number;
  appointment_id: number | null;
  document_type: DocumentType;
  title: string | null;
  description: string | null;
  report_date: string;
  provider_name: string | null;
  is_private: boolean;
  source: RecordSource;
  consultation_id: number | null;
  modality: string | null;
  modality_name: string | null;
  body_part: string | null;
  uploaded_at: string;
  updated_at: string;
  files: DocumentFile[];
}

export interface Consultation {
  id: number;
  appointment_id: number;
  doctor_id: number;
  doctor_name: string | null;
  doctor_specialty: string | null;
  visit_date: string;
  diagnosis: string;
  notes: string | null;
  follow_up: string | null;
  is_private: boolean;
  is_own: boolean; // written by the doctor who is viewing
  medications: HealthEntry[];
  prescription: MedicalDocument | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalHistory {
  profile: MedicalProfile | null;
  entries: HealthEntry[];
  documents: MedicalDocument[];
  consultations: Consultation[];
}

export type ShareItemType = "profile" | "entry" | "document" | "consultation";
export interface ShareItemRef {
  type: ShareItemType;
  id: number;
}

export interface AccessState {
  open: boolean;
  /** Why it's closed: pending (opens on accept), cancelled, revoked, expired. */
  reason: "pending" | "cancelled" | "revoked" | "expired" | null;
  ends_on: string;
}

export interface AccessLogEntry {
  action: "viewed_history" | "viewed_document" | "downloaded_document";
  document_id: number | null;
  document_title: string | null;
  times: number;
  first_at: string;
  last_at: string;
}

export interface Sharing {
  appointment_id: number;
  status: "active" | "revoked";
  ended_reason: "patient" | "cancelled" | null;
  ended_at: string | null;
  access: AccessState;
  excluded: ShareItemRef[];
  log: AccessLogEntry[];
}

export interface SharingSummary {
  status: "active" | "revoked";
  access: AccessState;
  excluded_count: number;
  doctor_views: number;
  last_viewed_at: string | null;
}

export interface PatientSummary {
  id: number;
  full_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
}

export interface AppointmentSummary {
  id: number;
  status: AppointmentStatus;
  date: string;
  start_time: string;
  end_time: string;
}

export interface DoctorPatientHistory extends Omit<MedicalHistory, "profile"> {
  patient: PatientSummary;
  appointment: AppointmentSummary;
  access_ends_on: string;
  profile: MedicalProfile | null;
}

export interface OwnConsultation {
  appointment: AppointmentSummary;
  patient: PatientSummary;
  consultation: Consultation | null;
}
