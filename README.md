# ENL Thesis Manager (Phase 1)

Android app for the MD thesis "Clinical, Haematological, and Biochemical Profile of Leprosy Patients as Predictors of Erythema Nodosum Leprosum".
Data lives in Supabase (project "ENL Thesis Manager", Mumbai region). Your Google Sheet and the old Apps Script app are not touched.

## What Phase 1 does
- Sign in with email and password. Only invited emails see data (enforced in the database).
- Dashboard: enrolment out of 100, adherence, visits due in the next 7 days, patients with 2+ missed visits, patients without a baseline, records to check.
- Patients: search by HD number, name, UHID or phone (never by lab values).
- Patient screen: 12-month slot strip anchored to the MDT start date, visits, call and Hindi WhatsApp reminder, confirm a SUS case to get the next HD number.
- Visit form: full lab panel (CBC, LFT, RFT, CRP, ESR, Vit D3, Vit B12, HbA1c), NLR/PLR/AGR calculated live, warnings for unusual values, the visit is put in the right month automatically (window opens 7 days early).
- Review tab: the imported records that need checking against the reports.
- Study numbers only go up; a deleted HD number is never reused.

Not yet in Phase 1: copy-back to the Google Sheet and the weekly backup (need a Google service account), item-by-item ESS, photos, OCR, graphs.

## Run it on your phone (fastest: Expo Go)
Needs Node 20+ on your computer and the Expo Go app on your Android phone, on the same Wi-Fi.

```
cd enl-thesis-manager
npm install
npx expo start
```
Scan the QR code with Expo Go.

## Install as a real app (APK)
```
npm install -g eas-cli
eas login
eas build:configure      # accept the defaults
eas build -p android --profile preview
```
When the build finishes, open the link on your phone and install the APK.

## First sign-in
1. Open the app, tap "First time? Create account", use happyneemtree@gmail.com (already set as owner) and a password of 8+ characters.
2. Open the confirmation email and tap the link. If the page after the link does not load, that is fine: the account is confirmed.
3. Back in the app, sign in.

## Inviting co-residents and guides
For now, tell Claude the names, emails and roles (editor or viewer). An invite screen comes in Phase 2.
