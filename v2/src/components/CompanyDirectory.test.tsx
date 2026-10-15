// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  profile: null as null | { id: string; username: string; display_name: string; disabled_at: null; locked_until: null; must_change_password: false },
  authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  profileWait: null as null | Promise<void>,
  profileReads: 0,
  signIn: vi.fn(),
  signOut: vi.fn(),
  readError: null as null | { message: string },
  rows: [] as Array<{ id: string; name: string; location: string }>,
  beds: [] as Array<{ id: string; block_letter: string; bed_identifier: string; capacity: number }>,
  blockNames: [] as Array<{ letter: string; name: string | null }>,
  waitRead: null as null | Promise<void>,
  revision: null as null | (() => void),
  inserts: [] as Array<[string, unknown]>,
  updates: [] as Array<[string, unknown]>,
  deletes: [] as Array<[string, unknown]>
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    channel: () => { const channel = { on: (_event: string, _filter: unknown, callback: () => void) => { harness.revision = callback; return channel; }, subscribe: () => channel }; return channel; },
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: harness.session } })),
      onAuthStateChange: vi.fn((callback: (event: string, session: { user: { id: string } } | null) => void) => { harness.authListener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signInWithPassword: harness.signIn,
      signOut: harness.signOut
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.range = () => builder;
      builder.insert = (values: unknown) => { harness.inserts.push([table, values]); return builder; };
      builder.update = (values: unknown) => { harness.updates.push([table, values]); if (table === 'ph_company_directory_blocks') harness.blockNames = harness.blockNames.map(block => ({ ...block, name: String((values as {name:string}).name) })); return builder; };
      builder.delete = () => { harness.deletes.push([table, null]); return builder; };
      builder.maybeSingle = async () => { if (table === 'profiles') { harness.profileReads += 1; await harness.profileWait; return { data: harness.profile, error: null }; } return { data: null, error: null }; };
      builder.single = async () => ({ data: { id: 'new-contact' }, error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve(harness.waitRead).then(() => ({ data: table === 'ph_company_directory_contacts' ? harness.rows : table === 'ph_company_directory_beds' ? harness.beds : table === 'ph_company_directory_blocks' ? harness.blockNames : [], error: harness.readError })).then(resolve, reject);
      return builder;
    }
  }))
}));

import { CompanyDirectory } from './CompanyDirectory';

function renderDirectory() { return render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><CompanyDirectory /></SWRConfig>); }

beforeEach(() => {
  harness.session = null;
  harness.authListener = null; harness.profileWait = null; harness.profileReads = 0;
  harness.profile = { id: 'dylan-id', username: 'dylan_collyge', display_name: 'Dylan Collyge', disabled_at: null, locked_until: null, must_change_password: false };
  harness.inserts = []; harness.updates = []; harness.deletes = [];
  harness.readError = null;
  harness.rows = []; harness.beds = []; harness.blockNames = []; harness.waitRead = null; harness.revision = null;
  harness.signOut.mockReset().mockImplementation(async () => { harness.session = null; return { error: null }; });
  harness.signIn.mockReset().mockImplementation(async () => { harness.session = { user: { id: 'dylan-id' } }; return { error: null }; });
});

afterEach(() => cleanup());

describe('Company Directory native access', () => {
  it('blocks a non-Dylan username before native authentication', async () => {
    renderDirectory();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone_else' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to directory' }));

    expect((await screen.findByRole('alert')).textContent).toContain('available only to Dylan');
    expect(harness.signIn).not.toHaveBeenCalled();
  });

  it('requires the verified Dylan profile and writes a new contact through Supabase', async () => {
    renderDirectory();
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
    renderDirectory();
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
    renderDirectory();
    expect((await screen.findByRole('alert')).textContent).toContain('available only to Dylan');
    expect(screen.getByRole('button', { name: 'Sign in to directory' })).toBeTruthy();
    expect(harness.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('keeps a bounded directory and edit draft mounted during background refresh', async () => {
    harness.session = { user: { id: 'dylan-id' } };
    harness.rows = Array.from({ length: 120 }, (_, index) => ({ id: `contact-${index}`, name: `Contact ${index}`, location: 'Office' }));
    renderDirectory();
    const first = await screen.findByText('Contact 0');
    expect(screen.getAllByRole('row')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Contact 0' }));
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Unsaved draft' } });
    let release!: () => void;
    harness.waitRead = new Promise<void>(resolve => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(first.isConnected).toBe(true);
    expect(screen.queryByText('Loading directory…')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByLabelText('Name')).toBe(name));
    expect((name as HTMLInputElement).value).toBe('Unsaved draft');
    expect(first.isConnected).toBe(true);
  });

  it('does not restore an authorized profile read after its session signs out', async () => {
    harness.session = { user: { id: 'dylan-id' } };
    let release!: () => void;
    harness.profileWait = new Promise<void>(resolve => { release = resolve; });
    renderDirectory();
    await waitFor(() => expect(harness.profileReads).toBe(1));
    act(() => harness.authListener?.('SIGNED_OUT', null));
    harness.profileWait = null;
    await act(async () => release());
    expect(screen.getByRole('button', { name: 'Sign in to directory' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('drops an acknowledged block-name draft so later canonical refreshes are visible', async () => {
    harness.session = { user: { id: 'dylan-id' } };
    harness.beds = [{ id: 'bed-a', block_letter: 'A', bed_identifier: 'A1', capacity: 1 }];
    harness.blockNames = [{ letter: 'A', name: 'Block A' }];
    renderDirectory();
    fireEvent.change(await screen.findByLabelText('Directory category'), { target: { value: 'blocks' } });
    const input = await screen.findByLabelText('Name for block A') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Block A Updated' } });
    let release!: () => void;
    harness.waitRead = new Promise<void>(resolve => { release = resolve; });
    fireEvent.blur(input);
    await waitFor(() => expect(harness.updates).toContainEqual(['ph_company_directory_blocks', { name: 'Block A Updated' }]));
    await waitFor(() => expect(input.value).toBe('Block A Updated'));

    harness.blockNames = [{ letter: 'A', name: 'New canonical label' }];
    harness.waitRead = null;
    await act(async () => release());
    await waitFor(() => expect((screen.getByLabelText('Name for block A') as HTMLInputElement).value).toBe('New canonical label'));
  });
});
