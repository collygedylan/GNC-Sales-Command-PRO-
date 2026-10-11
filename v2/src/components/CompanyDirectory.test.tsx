// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  profile: null as null | { id: string; username: string; display_name: string; disabled_at: null; locked_until: null; must_change_password: false },
  signIn: vi.fn(),
  signOut: vi.fn(),
  readError: null as null | { message: string },
  inserts: [] as Array<[string, unknown]>,
  updates: [] as Array<[string, unknown]>,
  deletes: [] as Array<[string, unknown]>
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: harness.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: harness.signIn,
      signOut: harness.signOut
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.insert = (values: unknown) => { harness.inserts.push([table, values]); return builder; };
      builder.update = (values: unknown) => { harness.updates.push([table, values]); return builder; };
      builder.delete = () => { harness.deletes.push([table, null]); return builder; };
      builder.maybeSingle = async () => ({ data: table === 'profiles' ? harness.profile : null, error: null });
      builder.single = async () => ({ data: { id: 'new-contact' }, error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve({ data: [], error: harness.readError }).then(resolve, reject);
      return builder;
    }
  }))
}));

import { CompanyDirectory } from './CompanyDirectory';

beforeEach(() => {
  harness.session = null;
  harness.profile = { id: 'dylan-id', username: 'dylan_collyge', display_name: 'Dylan Collyge', disabled_at: null, locked_until: null, must_change_password: false };
  harness.inserts = []; harness.updates = []; harness.deletes = [];
  harness.readError = null;
  harness.signOut.mockReset().mockImplementation(async () => { harness.session = null; return { error: null }; });
  harness.signIn.mockReset().mockImplementation(async () => { harness.session = { user: { id: 'dylan-id' } }; return { error: null }; });
});

afterEach(() => cleanup());

describe('Company Directory native access', () => {
  it('blocks a non-Dylan username before native authentication', async () => {
    render(<CompanyDirectory />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone_else' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to directory' }));

    expect((await screen.findByRole('alert')).textContent).toContain('available only to Dylan');
    expect(harness.signIn).not.toHaveBeenCalled();
  });

  it('requires the verified Dylan profile and writes a new contact through Supabase', async () => {
    render(<CompanyDirectory />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Dylan Collyge' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'local-test-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to directory' }));

    await screen.findByRole('button', { name: 'Sign out' });
    expect(harness.signIn).toHaveBeenCalledWith({ email: 'dylan_collyge@greenleafnursery.com', password: 'local-test-secret' });
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    const form = screen.getByRole('form', { name: 'Add Employee contacts' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Test Contact' } });
    fireEvent.change(within(form).getByLabelText('Department'), { target: { value: 'IT' } });
    fireEvent.change(within(form).getByLabelText('Extension'), { target: { value: '2299' } });
    fireEvent.change(within(form).getByLabelText('Location'), { target: { value: 'Main Office' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }));

    await waitFor(() => expect(harness.inserts).toContainEqual(['ph_company_directory_contacts', {
      name: 'Test Contact', department: 'IT', extension: '2299', cell_number: null, home_number: null, location: 'Main Office'
    }]));
  });

  it('refreshes on demand and displays Supabase plain-object errors', async () => {
    render(<CompanyDirectory />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Dylan Collyge' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'local-test-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to directory' }));
    await screen.findByRole('button', { name: 'Refresh' });

    harness.readError = { message: 'permission denied for company directory' };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect((await screen.findByRole('alert')).textContent).toBe('permission denied for company directory');
  });

  it('rejects a signed-in profile whose username is not Dylan', async () => {
    harness.profile = {
      id: 'someone-else',
      username: 'another_user',
      display_name: 'Other User',
      disabled_at: null,
      locked_until: null,
      must_change_password: false,
    };
    harness.session = { user: { id: 'someone-else' } };
    render(<CompanyDirectory />);
    expect((await screen.findByRole('alert')).textContent).toContain('available only to Dylan');
    expect(screen.getByRole('button', { name: 'Sign in to directory' })).toBeTruthy();
    expect(harness.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
