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

export interface DoctorAppointment extends Appointment {
  patient: { id: number; full_name: string | null };
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
