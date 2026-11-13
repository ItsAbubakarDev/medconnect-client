// Mirrors the backend's Pydantic response models (medconnect-backend/app/schemas).

export type Role = "doctor" | "patient";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "expired";
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
  completed_at: string | null;
  /** Closed by the server rather than the doctor: completed because a consultation record was written. */
  completed_automatically: boolean;
  expired_at: string | null;
  /** pending: the doctor never accepted it; confirmed: it was never marked completed (null for older rows). */
  expired_from: "pending" | "confirmed" | null;
  /** For a pending/confirmed appointment: when it closes by itself if nobody acts first. */
  closes_at: string | null;
  created_at: string;
  updated_at: string;
  slot: Slot;
  /** An open request to move it (confirmed only): the time it would move to, held until the doctor answers. */
  requested_slot: Slot | null;
  reschedule_requested_at: string | null;
  reschedule_note: string | null;
  /** How many times it has moved to another time. */
  times_moved: number;
}

export interface PatientAppointment extends Appointment {
  sharing: SharingSummary | null;
  review: OwnReview | null;
  /** For a completed visit: until when it can be reviewed (and the review edited). */
  review_open_until: string | null;
  follow_up: FollowUpLink | null; // booked from a doctor's follow-up recommendation
}

export interface DoctorAppointment extends Appointment {
  patient: { id: number; full_name: string | null };
  /** Whether the patient's shared history can be opened from this appointment right now. */
  history_access: AccessState | null;
  has_consultation: boolean;
  follow_up: FollowUpLink | null; // booked from the doctor's follow-up recommendation
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
  city: string | null; // null = set before location existed; the dashboard asks for it
  area: string | null;
  clinic_address: string | null;
  offers_online: boolean;
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
  city: string | null;
  area: string | null;
  clinic_address: string | null;
  offers_online: boolean;
  rating_average: number | null; // one decimal; null = no reviews yet ("New")
  review_count: number;
  /** The earliest free, bookable time; null = none within the booking window. */
  next_available: { date: string; start_time: string } | null;
  booking_window_days: number;
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
  buffer_minutes: number; // break between appointments
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
  /** Bookings now closer to a neighbouring booking than the break. */
  booked_too_close: BookedOutsideHours[];
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
  /** `requested`: held for this appointment's request to move here (it's still on its own time). */
  appointment: { id: number; status: AppointmentStatus; patient_name: string | null; requested: boolean } | null;
  /** The break after this time before the next one in the session (0 for the last). */
  break_minutes: number;
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
  | "consultation_added"
  | "review_received"
  | "review_replied"
  | "follow_up_recommended"
  | "follow_up_due"
  | "follow_up_removed"
  | "follow_up_booked"
  | "appointment_expired"
  | "reschedule_requested"
  | "reschedule_withdrawn"
  | "reschedule_accepted"
  | "reschedule_declined";

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

/** A document shared in an appointment's video-call chat (it's also in the patient's record). */
export interface CallDocument {
  /** The share's id: its files open through /appointments/{appointment_id}/call-documents/{id}/files/… */
  id: number;
  appointment_id: number;
  shared_by: Role;
  shared_by_name: string | null;
  created_at: string;
  document: MedicalDocument;
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
  /** For the patient and the doctor who wrote it only. */
  follow_up_recommendation: FollowUp | null;
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
  reason: "pending" | "cancelled" | "appointment_expired" | "revoked" | "expired" | null;
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
  /** When this appointment is itself a follow-up: the visit it follows up. */
  follow_up_of: FollowUpLink | null;
}

// ---- reviews

export interface StarCount {
  stars: number;
  count: number;
}

export interface RatingSummary {
  average: number | null; // null = no reviews yet
  count: number;
  breakdown: StarCount[]; // 5 stars down to 1
}

export interface PublicReview {
  id: number;
  rating: number;
  comment: string | null;
  reviewer_name: string; // "Ahmed K." or "Anonymous patient"
  visit_date: string;
  verified_visit: boolean;
  created_at: string;
  reply: string | null;
  replied_at: string | null;
}

export interface ReviewPage {
  summary: RatingSummary;
  items: PublicReview[];
  total: number;
  page: number;
  page_size: number;
}

export interface DoctorReview extends PublicReview {
  appointment_id: number;
}

export interface DoctorReviewPage {
  summary: RatingSummary;
  items: DoctorReview[]; // unreplied first
  total: number;
  unreplied: number;
  page: number;
  page_size: number;
}

export interface OwnReview {
  id: number;
  rating: number;
  comment: string | null;
  is_anonymous: boolean;
  reviewer_name: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  editable_until: string;
  can_edit: boolean;
}

// ---- follow-ups

export type FollowUpFlexibility = "exact" | "plus_minus_2_days" | "plus_minus_1_week" | "within_2_weeks_after";
export type ConsultationType = "clinic" | "online";
export type FollowUpFee = "standard" | "free" | "reduced";
export type FollowUpStatus = "recommended" | "booked" | "dismissed" | "expired" | "completed";

export interface FollowUp {
  id: number;
  appointment_id: number; // the original visit
  consultation_id: number;
  doctor_id: number;
  doctor_name: string | null;
  doctor_specialty: string | null;
  patient_id: number;
  patient_name: string | null;
  visit_date: string;
  target_date: string;
  flexibility: FollowUpFlexibility;
  window_start: string;
  window_end: string;
  consultation_type: ConsultationType;
  reason: string;
  fee_type: FollowUpFee;
  fee_amount: string | null;
  fee_label: string;
  status: FollowUpStatus;
  booked: { id: number; status: AppointmentStatus; date: string; start_time: string; in_window: boolean } | null;
  /** The window isn't bookable yet: times appear from this day. */
  bookable_from: string | null;
  can_book: boolean;
  can_edit: boolean;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpBooking {
  follow_up: FollowUp;
  in_window: Slot[]; // nearest the target first
  after_window: Slot[]; // only when nothing is free in the window
  share_exclusions: ShareItemRef[];
  reason_for_visit: string;
}

export interface FollowUpLink {
  follow_up_id: number;
  original_appointment_id: number;
  original_visit_date: string;
  consultation_type: ConsultationType;
  reason: string;
  fee_label: string;
  in_window: boolean;
}

// ---- the patients' AI assistant

export interface AssistantStatus {
  /** False when the server has no AI key: the chat button isn't shown. */
  available: boolean;
  /** The patient let the assistant read their health record (never the private items). */
  history_access: boolean;
  /** Agreed to voice mode's notice (speech goes to the browser's speech service). */
  voice_consent: boolean;
  daily_limit: number;
  used_today: number;
}

export interface AssistantConversationSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantDoctorCard {
  id: number;
  full_name: string | null;
  specialty: string | null;
  consultation_fee: string | null;
  city: string | null;
  area: string | null;
  offers_online: boolean;
  rating_average: number | null;
  review_count: number;
  profile_image_url: string | null;
  next_available: { date: string; start_time: string } | null;
}

export type AssistantCard =
  | { type: "emergency" }
  | { type: "history_access" }
  | { type: "doctors"; items: AssistantDoctorCard[] }
  | {
      type: "times";
      doctor_id: number;
      doctor_name: string | null;
      items: { slot_id: number; date: string; start_time: string; end_time: string }[];
    }
  | { type: "proposal"; proposal_id: number }
  | { type: "voice_confirm"; proposal_id: number };

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  cards: AssistantCard[];
  created_at: string;
}

export type ProposalKind = "book" | "cancel" | "reschedule";
export type ProposalStatus = "pending" | "done" | "failed" | "dismissed";

export interface AssistantProposal {
  id: number;
  kind: ProposalKind;
  status: ProposalStatus;
  /** What the card shows: doctor, time, fee... (written by the server when proposed). */
  details: Record<string, string | number | boolean | null>;
  appointment_id: number | null;
  error: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

export interface AssistantConversation {
  id: number;
  title: string;
  messages: AssistantMessage[];
  proposals: AssistantProposal[];
}
