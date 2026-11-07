import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AuthForm from '@/components/auth/auth-form'
const mockSignIn = jest.fn()
const mockSignUp = jest.fn()
const mockPush = jest.fn()
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ signIn: mockSignIn, signUp: mockSignUp }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
beforeEach(() => { jest.clearAllMocks(); mockSignIn.mockResolvedValue({ error: null }); mockSignUp.mockResolvedValue({ error: null, signedIn: true }); global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({needsSetup:false})}) })
function fill(password = 'password-123', username='owner') { fireEvent.change(screen.getByLabelText(/Username/), { target: { value: username } }); fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } }) }
test('signs in with a username without requiring email', async () => { render(<AuthForm />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Sign In' })); await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/')); expect(mockSignIn).toHaveBeenCalledWith('owner', 'password-123'); expect(screen.queryByText(/Google/)).not.toBeInTheDocument(); expect(screen.queryByText(/Forgot your password/)).not.toBeInTheDocument() })
test('existing email addresses remain accepted as sign-in identifiers', async () => { render(<AuthForm />); fill('password-123','owner@example.com'); fireEvent.click(screen.getByRole('button',{name:'Sign In'})); await waitFor(()=>expect(mockSignIn).toHaveBeenCalledWith('owner@example.com','password-123')) })
test('first setup creates an owner without email, hosted terms or verification mail', async () => { global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({needsSetup:true})}); render(<AuthForm initialMode="signup" />); fireEvent.click(await screen.findByRole('button', {name:'Start fresh'})); await screen.findByLabelText('Username'); fill(); fireEvent.click(screen.getByRole('button', { name: 'Create owner account' })); await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup/ingredients')); expect(mockSignUp).toHaveBeenCalledWith('owner', 'password-123'); expect(screen.queryByLabelText(/Email address/)).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.queryByText('Check your email')).not.toBeInTheDocument() })
test('closed registration directs new users to an administrator and has no signup fields', async()=>{render(<AuthForm initialMode="signup"/>); expect(await screen.findByText(/Account registration is closed/)).toBeInTheDocument();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(mockSignUp).not.toHaveBeenCalled()})
test('rejects a short owner password before sending it', async () => { global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({needsSetup:true})}); render(<AuthForm initialMode="signup" />); fireEvent.click(await screen.findByRole('button', {name:'Start fresh'})); await screen.findByLabelText('Username'); fill('short'); fireEvent.submit(screen.getByRole('button', { name: 'Create owner account' }).closest('form')!); expect(await screen.findByRole('alert')).toHaveTextContent('at least 8'); expect(mockSignUp).not.toHaveBeenCalled() })
test('displays a failed sign-in without redirecting', async () => { mockSignIn.mockResolvedValue({ error: new Error('Username or password is incorrect.') }); render(<AuthForm />); fill(); fireEvent.click(screen.getByRole('button', { name: 'Sign In' })); expect(await screen.findByRole('alert')).toHaveTextContent('Username or password'); expect(mockPush).not.toHaveBeenCalled() })

test('an empty installation opens setup choices from the sign-in entry point', async () => {
  global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({needsSetup:true})})
  render(<AuthForm />)
  expect(await screen.findByRole('button', {name:'Start fresh'})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name:'Restore a Brewey backup'}))
  expect(screen.getByLabelText(/Backup file/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
})
