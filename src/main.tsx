import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { UiPreferencesProvider } from './contexts/UiPreferencesContext.tsx';
import { isCloudConfigured } from './firebase/client.ts';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <UiPreferencesProvider>
    {isCloudConfigured ? (
      // Shared data in Firestore, Google sign-in restricted to the allowed accounts.
      <AuthGate>{(session) => <App cloud={session} />}</AuthGate>
    ) : (
      // No Firebase config: data stays in this browser only (previous behaviour).
      <App />
    )}
  </UiPreferencesProvider>
);
