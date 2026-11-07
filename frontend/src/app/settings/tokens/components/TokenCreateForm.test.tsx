import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TokenCreateForm } from './TokenCreateForm'
test('new tokens default to read-only recipes/catalog and send capability scopes',async()=>{
 const submit=jest.fn().mockResolvedValue(undefined)
 render(<TokenCreateForm onSubmit={submit}/>)
 fireEvent.change(screen.getByLabelText('Token Name'),{target:{value:'Recipe reader'}})
 expect(screen.getByRole('checkbox',{name:/recipes:read/})).toBeChecked()
 expect(screen.getByRole('checkbox',{name:/recipes:write/})).not.toBeChecked()
 fireEvent.click(screen.getByRole('button',{name:'Create Token'}))
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({name:'Recipe reader',scopes:['recipes:read','catalog:read']})))
 expect(screen.queryByText('API Access')).not.toBeInTheDocument();expect(screen.queryByText('MCP Server')).not.toBeInTheDocument()
})
