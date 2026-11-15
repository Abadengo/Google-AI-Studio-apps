/**
 * Public Firebase web configuration (Firebase console → Project settings → Your apps → Web app).
 *
 * These values are PUBLIC BY DESIGN: every Firebase web app ships them to the browser. They only
 * identify the project; they do not grant access. Access to the data is enforced by the Firestore
 * security rules (firestore.rules, generated from ALLOWED_EMAILS and kept out of git).
 *
 * While apiKey/projectId are empty the app runs in "this browser only" mode (localStorage).
 */
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

/** Firestore document shared by the household (households/{HOUSEHOLD_ID}). */
export const HOUSEHOLD_ID = 'hogar';
