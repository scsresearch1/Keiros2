import {
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth } from './app'

export async function firebaseSignIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim().toLowerCase(), password)
  return cred.user
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(getFirebaseAuth())
}
