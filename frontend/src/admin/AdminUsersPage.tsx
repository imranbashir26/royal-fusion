import { Edit, Plus, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'
import type { AdminRole, AdminUser } from '../types/admin'

const roles: AdminRole[] = ['Owner/Admin', 'Shop Manager', 'Order Manager', 'Content Editor', 'Blog Writer']

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setUsers(await adminApi.users<AdminUser>())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load users.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const remove = async (user: AdminUser) => {
    if (!window.confirm(`Delete admin user ${user.email}?`)) return
    await adminApi.deleteUser(user.id)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Access Control</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-burgundy">Admin Users</h1>
        </div>
        <Button onClick={() => { setEditingUser(null); setIsFormOpen(true) }}>
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>
      {error && <p className="rounded-lg border border-burgundy/20 bg-burgundy/8 p-4 text-burgundy">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-champagne/25 bg-ivory shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-marble text-xs uppercase tracking-[0.16em] text-oldgold">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-champagne/20">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-4 font-bold text-burgundy">{user.name}</td>
                <td className="px-4 py-4">{user.email}</td>
                <td className="px-4 py-4">{user.role}</td>
                <td className="px-4 py-4">{user.status}</td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditingUser(user); setIsFormOpen(true) }}>
                      <Edit className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(user)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isFormOpen && (
        <UserForm
          initialValue={editingUser}
          onClose={() => setIsFormOpen(false)}
          onSaved={() => {
            setIsFormOpen(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function UserForm({
  initialValue,
  onClose,
  onSaved,
}: {
  initialValue: AdminUser | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: initialValue?.name ?? '',
    email: initialValue?.email ?? '',
    password: '',
    role: initialValue?.role ?? 'Shop Manager',
    status: initialValue?.status ?? 'Active',
  })
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      if (initialValue) {
        await adminApi.updateUser(initialValue.id, form)
      } else {
        await adminApi.createUser(form)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save user.')
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-brownroyal/55 p-4 backdrop-blur-sm">
      <form className="mx-auto mt-10 max-w-xl rounded-lg border border-champagne/30 bg-ivory p-5 shadow-2xl" onSubmit={submit}>
        <h2 className="font-serif text-3xl font-semibold text-burgundy">{initialValue ? 'Edit User' : 'Add User'}</h2>
        <div className="mt-5 grid gap-4">
          <Input label="Name" onChange={(value) => setForm((current) => ({ ...current, name: value }))} value={form.name} />
          <Input label="Email" onChange={(value) => setForm((current) => ({ ...current, email: value }))} type="email" value={form.email} />
          <Input label={initialValue ? 'New password (optional)' : 'Password'} onChange={(value) => setForm((current) => ({ ...current, password: value }))} required={!initialValue} type="password" value={form.password} />
          <label>
            <span className="mb-2 block text-sm font-bold">Role</span>
            <select className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4" onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as AdminRole }))} value={form.role}>
              {roles.map((role) => <option key={role}>{role}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">Status</span>
            <select className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4" onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as 'Active' | 'Inactive' }))} value={form.status}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
        </div>
        {error && <p className="mt-4 rounded-lg border border-burgundy/20 bg-burgundy/8 p-3 text-burgundy">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">Cancel</Button>
          <Button type="submit">Save User</Button>
        </div>
      </form>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-bold">{label}</span>
      <input className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4" onChange={(event) => onChange(event.target.value)} required={required} type={type} value={value} />
    </label>
  )
}
