import { useState } from 'react'
import { LoginPage } from './components/auth/LoginPage'
import { HomePage } from './components/home/HomePage'
import { AppShell } from './app/AppShell'
import { AppDataRoot } from './app/AppDataRoot'
import { ThemeProvider } from './theme/ThemeProvider'
import './styles/tokens.css'
import './App.css'

type View = 'home' | 'login' | 'app'
type LoginNotice = 'session' | null

function App() {
  const [view, setView] = useState<View>('home')
  const [userEmail, setUserEmail] = useState('')
  const [loginNotice, setLoginNotice] = useState<LoginNotice>(null)

  if (view === 'login') {
    return (
      <LoginPage
        initialNotice={loginNotice}
        onBack={() => {
          setLoginNotice(null)
          setView('home')
        }}
        onSuccess={(email) => {
          setUserEmail(email)
          setLoginNotice(null)
          setView('app')
        }}
      />
    )
  }

  if (view === 'app') {
    return (
      <AppDataRoot>
        <AppShell
          email={userEmail}
          onSignOut={() => {
            void (async () => {
              try {
                const { isFirebaseEnabled, firebaseSignOut } = await import('./firebase')
                if (isFirebaseEnabled()) await firebaseSignOut()
              } catch {
                /* ignore */
              }
              setUserEmail('')
              setLoginNotice(null)
              setView('home')
            })()
          }}
          onSessionExpired={() => {
            void (async () => {
              try {
                const { isFirebaseEnabled, firebaseSignOut } = await import('./firebase')
                if (isFirebaseEnabled()) await firebaseSignOut()
              } catch {
                /* ignore */
              }
              setUserEmail('')
              setLoginNotice('session')
              setView('login')
            })()
          }}
        />
      </AppDataRoot>
    )
  }

  return (
    <HomePage
      onEnter={() => {
        setLoginNotice(null)
        setView('login')
      }}
    />
  )
}

export default function AppRoot() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  )
}
