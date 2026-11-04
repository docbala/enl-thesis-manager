import { fmt } from './dates';

// Same Hindi reminder as the current app.
export function reminderText(name: string, date: string | null) {
  return `नमस्ते ${name} जी,\nयह एम.वाई. अस्पताल (M.Y. Hospital), इंदौर के त्वचा रोग विभाग से सूचना है। आपकी नियमित स्वास्थ्य एवं खून की जाँच का समय हो गया है।\nफॉलो अप तिथि: ${date ? fmt(date) : '-'}\nसमय: सुबह 9:00 बजे, Dermatology OPD.\nपुरानी पर्ची एवं जाँच रिपोर्ट साथ लाएँ।`;
}

// Coming Saturday (today if today is Saturday), as YYYY-MM-DD in local time.
export function comingSaturday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
