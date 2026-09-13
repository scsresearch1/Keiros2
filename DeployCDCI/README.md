# DeployCDCI — Firebase setup automation (Keiros ERP)

Automates Firestore collection seeding from ERP mock data, Auth user creation, security rules, and wiring `ERP_Full` to Firebase.

## What you must provide

Copy `.env.example` → `.env` and fill in values from Firebase Console.

| Field | Where to get it | Required |
|-------|-----------------|----------|
| `FIREBASE_PROJECT_ID` | Project settings → General → **Project ID** | Yes |
| `VITE_FIREBASE_API_KEY` | Project settings → Your apps → Web app → `apiKey` | Yes |
| `VITE_FIREBASE_AUTH_DOMAIN` | Web config → `authDomain` | Yes |
| `VITE_FIREBASE_PROJECT_ID` | Same as project ID | Yes |
| `VITE_FIREBASE_STORAGE_BUCKET` | Web config → `storageBucket` | Yes |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Web config → `messagingSenderId` | Yes |
| `VITE_FIREBASE_APP_ID` | Web config → `appId` | Yes |
| `VITE_FIREBASE_MEASUREMENT_ID` | Web config → `measurementId` (if Analytics on) | No |
| `GOOGLE_APPLICATION_CREDENTIALS` | Project settings → **Service accounts** → Generate new private key → path to the `.json` file | Yes (for seed) |
| `SEED_ADMIN_EMAIL` | Auth admin email (default `admin@keiros.ai`) | Yes |
| `SEED_ADMIN_PASSWORD` | Auth admin password (default `Keiros@1234`) | Yes |
| `SEED_DEFAULT_USER_PASSWORD` | Password for other seeded Auth users | Yes |
| `FIRESTORE_LOCATION` | Region you picked (e.g. `asia-south1`) — informational | No |

### Console checklist before running

1. Firebase project created  
2. **Web app** registered (copy config)  
3. **Authentication → Email/Password** enabled  
4. **Firestore Database** created  
5. **Service account** JSON downloaded (keep private; never commit)

---

## Quick start

```powershell
cd f:\KeirosPhase2All\DeployCDCI
copy .env.example .env
# Edit .env with your values, set GOOGLE_APPLICATION_CREDENTIALS to the JSON path

npm install
npm run setup
```

`npm run setup` runs:

1. Validate env  
2. Export sample data from `ERP_Full/src/data/erpData.ts`  
3. Seed Firestore collections + `_meta/schema`  
4. Create Auth users (admin + ERP users)  
5. Write `ERP_Full/.env.local`  
6. Install `firebase` in ERP_Full  
7. Print next steps  

Optional:

```powershell
npm run deploy:rules   # needs firebase-tools login
npm run seed           # seed only
npm run wire           # write ERP .env.local + ensure firebase package
```

---

## Collections seeded

See `config/collections.json`. Data source: current ERP mock (`erpData.ts`).

---

## Security

- Never commit `.env`, `*.json` service accounts, or `out/`  
- Start with rules in `firestore.rules` (authenticated read/write). Tighten for production.
