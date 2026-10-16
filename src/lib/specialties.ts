// Shortcuts for the home page and search. The backend matches specialty with a
// case-insensitive "contains", so `query` is a stem that catches both forms
// (e.g. "Cardio" matches "Cardiology" and "Cardiologist").
export const SPECIALTIES = [
  { label: "General Physician", query: "General" },
  { label: "Gynecologist", query: "Gyn" },
  { label: "Pediatrician", query: "Pediatric" },
  { label: "Dermatologist", query: "Dermat" },
  { label: "Cardiologist", query: "Cardio" },
  { label: "Orthopedic Surgeon", query: "Ortho" },
  { label: "ENT Specialist", query: "ENT" },
  { label: "Psychiatrist", query: "Psychiat" },
  { label: "Neurologist", query: "Neuro" },
  { label: "Dentist", query: "Dent" },
  { label: "Eye Specialist", query: "Eye" },
  { label: "Urologist", query: "Urolog" },
] as const;

// Offered as suggestions on the doctor profile form (free text is still allowed).
export const SPECIALTY_SUGGESTIONS = [
  "General Physician",
  "Gynecologist",
  "Pediatrician",
  "Dermatologist",
  "Cardiologist",
  "Orthopedic Surgeon",
  "ENT Specialist",
  "Psychiatrist",
  "Neurologist",
  "Dentist",
  "Eye Specialist",
  "Urologist",
  "Gastroenterologist",
  "Pulmonologist",
  "Endocrinologist",
  "Nephrologist",
];
