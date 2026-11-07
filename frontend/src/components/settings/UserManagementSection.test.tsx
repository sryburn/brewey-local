import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UserManagementSection from './UserManagementSection'
let mockUser:{id:string,is_admin:boolean}|null
jest.mock('@/lib/auth-context',()=>({useAuth:()=>({user:mockUser})}))
beforeEach(()=>{mockUser={id:'owner',is_admin:true};global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({users:[]})})})
test('only administrators see account creation controls',()=>{mockUser={id:'member',is_admin:false};render(<UserManagementSection/>);expect(screen.queryByText('Create account')).not.toBeInTheDocument();expect(fetch).not.toHaveBeenCalled()})
test('an administrator creates a username account without email or changing their own session',async()=>{
 render(<UserManagementSection/>);await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/admin/users',expect.objectContaining({credentials:'same-origin'})))
 jest.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({user:{id:'new-user',username:'member',email:'',is_admin:false}})} as Response)
 fireEvent.change(screen.getByLabelText('Username'),{target:{value:'member'}});fireEvent.change(screen.getByLabelText('Initial password'),{target:{value:'Initial-password'}})
 fireEvent.click(screen.getByRole('button',{name:'Create account'}))
 expect(await screen.findByRole('status')).toHaveTextContent('No email is sent')
 expect(fetch).toHaveBeenLastCalledWith('/api/admin/users',expect.objectContaining({body:JSON.stringify({username:'member',password:'Initial-password',is_admin:false})}))
 expect(screen.getByLabelText('Initial password')).toHaveValue('')
 expect(screen.getByText('member')).toBeInTheDocument()
})
