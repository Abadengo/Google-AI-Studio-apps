import React, { useEffect, useState } from 'react';
import {
  Check,
  Globe,
  Mail,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import { PROFILE_COLOR_PALETTE } from '../data/defaultState';
import type { FinanceState, UserProfile } from '../types/finance';

interface ProfilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: FinanceState;
  onAddProfile: (profile: Omit<UserProfile, 'id'>) => string;
  onUpdateProfile: (profile: UserProfile) => void;
  onDeleteProfile: (id: string, reassignToId?: string) => void;
  onSelectActiveProfile?: (id: string) => void;
}

interface ProfileFormState {
  name: string;
  role: string;
  email: string;
  phone: string;
  country: string;
  notes: string;
  color: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: '',
  role: '',
  email: '',
  phone: '',
  country: '',
  notes: '',
  color: PROFILE_COLOR_PALETTE[2],
};

export function ProfilesModal({
  isOpen,
  onClose,
  state,
  onAddProfile,
  onUpdateProfile,
  onDeleteProfile,
  onSelectActiveProfile,
}: ProfilesModalProps) {
  const { tr, isDark } = useUiPreferences();

  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  useEffect(() => {
    if (!isOpen) {
      setMode('list');
      setEditingId(null);
      setDeletingId(null);
      setStatusMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const openAdd = () => {
    const nextColor =
      PROFILE_COLOR_PALETTE[state.profiles.length % PROFILE_COLOR_PALETTE.length];
    setForm({ ...EMPTY_FORM, color: nextColor });
    setEditingId(null);
    setDeletingId(null);
    setMode('add');
  };

  const openEdit = (profile: UserProfile) => {
    setForm({
      name: profile.name,
      role: profile.role || '',
      email: profile.email || '',
      phone: profile.phone || '',
      country: profile.country || '',
      notes: profile.notes || '',
      color: profile.color || PROFILE_COLOR_PALETTE[0],
    });
    setEditingId(profile.id);
    setDeletingId(null);
    setMode('edit');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (mode === 'edit' && editingId) {
      onUpdateProfile({
        id: editingId,
        name: form.name.trim(),
        role: form.role.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        country: form.country.trim(),
        notes: form.notes.trim(),
        color: form.color,
      });
      setStatusMsg(
        tr(
          `Perfil "${form.name.trim()}" actualizado.`,
          `Profile "${form.name.trim()}" updated.`
        )
      );
    } else if (mode === 'add') {
      const createdId = onAddProfile({
        name: form.name.trim(),
        role: form.role.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        country: form.country.trim(),
        notes: form.notes.trim(),
        color: form.color,
      });
      setStatusMsg(
        tr(
          `Perfil "${form.name.trim()}" agregado al hogar.`,
          `Profile "${form.name.trim()}" added to household.`
        )
      );
      if (onSelectActiveProfile) {
        onSelectActiveProfile(createdId);
      }
    }

    setMode('list');
    setEditingId(null);
  };

  const startDelete = (profileId: string) => {
    if (state.profiles.length <= 1) return;
    const other = state.profiles.find((p) => p.id !== profileId);
    setReassignTargetId(other?.id || '');
    setDeletingId(profileId);
  };

  const confirmDelete = (profileId: string) => {
    if (state.profiles.length <= 1) return;
    const deletedName = state.profiles.find((p) => p.id === profileId)?.name || profileId;
    onDeleteProfile(profileId, reassignTargetId || undefined);
    setDeletingId(null);
    setStatusMsg(
      tr(`Perfil "${deletedName}" eliminado.`, `Profile "${deletedName}" deleted.`)
    );
  };

  const displaySwatchColor = (hex: string) => {
    if (isDark && (hex.toUpperCase() === '#022E5B' || hex.toUpperCase() === '#031725')) {
      return '#6EB1F5';
    }
    return hex;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#031725]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profiles-modal-title"
    >
      <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#123B66] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D3E3FA] dark:border-[#123B66]">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#499BED]" />
            <div>
              <h2
                id="profiles-modal-title"
                className="text-lg font-semibold text-[#031725] dark:text-[#DAEAFF]"
              >
                {tr('Configuración de Perfiles del Hogar', 'Household Profile Settings')}
              </h2>
              <p className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                {tr(
                  'Agrega, edita o elimina integrantes, cambia sus nombres y administra su información personal.',
                  'Add, edit, or remove members, rename profiles, and update personal details.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#5A7694] dark:text-[#A1C6F6] hover:text-[#031725] dark:hover:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B]"
            aria-label={tr('Cerrar', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {statusMsg && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200">
              <span className="inline-flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                {statusMsg}
              </span>
              <button
                type="button"
                onClick={() => setStatusMsg('')}
                className="text-emerald-700 dark:text-emerald-300 hover:underline"
              >
                OK
              </button>
            </div>
          )}

          {mode === 'list' ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#355170] dark:text-[#A1C6F6]">
                  {state.profiles.length}{' '}
                  {state.profiles.length === 1
                    ? tr('perfil activo', 'active profile')
                    : tr('perfiles activos', 'active profiles')}
                </span>
                <button
                  type="button"
                  onClick={openAdd}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-xs font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5] transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {tr('Agregar perfil', 'Add profile')}
                </button>
              </div>

              <div className="space-y-3">
                {state.profiles.map((profile) => {
                  const accCount = state.accounts.filter((a) => a.owner === profile.id).length;
                  const txCount = state.transactions.filter((t) => t.owner === profile.id).length;
                  const isDeleting = deletingId === profile.id;
                  const canDelete = state.profiles.length > 1;
                  const others = state.profiles.filter((p) => p.id !== profile.id);

                  return (
                    <div
                      key={profile.id}
                      className="border border-[#D3E3FA] dark:border-[#123B66] bg-[#F8FBFF] dark:bg-[#041E32] rounded-xl p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <span
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                            style={{ backgroundColor: profile.color || '#022E5B' }}
                          >
                            {profile.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="text-sm font-bold text-[#031725] dark:text-[#DAEAFF]"
                                style={{ color: isDark ? displaySwatchColor(profile.color) : undefined }}
                              >
                                {profile.name}
                              </span>
                              {profile.role && (
                                <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6]">
                                  · {profile.role}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#355170] dark:text-[#A1C6F6]">
                              {profile.email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-[#499BED]" />
                                  {profile.email}
                                </span>
                              )}
                              {profile.phone && (
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Phone className="w-3 h-3 text-[#499BED]" />
                                  {profile.phone}
                                </span>
                              )}
                              {profile.country && (
                                <span className="inline-flex items-center gap-1">
                                  <Globe className="w-3 h-3 text-[#499BED]" />
                                  {profile.country}
                                </span>
                              )}
                            </div>

                            {profile.notes && (
                              <p className="mt-1 text-xs text-[#5A7694] dark:text-[#7FA6D6]">
                                {profile.notes}
                              </p>
                            )}

                            <div className="mt-1.5 text-[11px] font-mono-num text-[#5A7694] dark:text-[#7FA6D6]">
                              {accCount} {tr('cuentas', 'accounts')} · {txCount}{' '}
                              {tr('movimientos', 'transactions')}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEdit(profile)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#022E5B] dark:text-[#DAEAFF] rounded-lg hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B] transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {tr('Editar', 'Edit')}
                          </button>

                          <button
                            type="button"
                            disabled={!canDelete}
                            onClick={() => startDelete(profile.id)}
                            title={
                              canDelete
                                ? tr('Eliminar perfil', 'Delete profile')
                                : tr(
                                    'Debe existir al menos un perfil activo',
                                    'At least one active profile is required'
                                  )
                            }
                            className="p-1.5 text-[#7FA6D6] hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 disabled:cursor-not-allowed"
                            aria-label={tr(`Eliminar perfil ${profile.name}`, `Delete profile ${profile.name}`)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isDeleting && (
                        <div className="pt-3 border-t border-[#D3E3FA] dark:border-[#123B66] space-y-2.5 text-xs">
                          <p className="font-medium text-red-700 dark:text-red-300">
                            {tr(
                              `¿Eliminar el perfil "${profile.name}"? Elige qué hacer con sus ${accCount} cuenta(s) y ${txCount} movimiento(s):`,
                              `Delete profile "${profile.name}"? Choose what to do with their ${accCount} account(s) and ${txCount} transaction(s):`
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={reassignTargetId}
                              onChange={(e) => setReassignTargetId(e.target.value)}
                              className="flex-1 min-w-[200px] px-2.5 py-1.5 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-xs text-[#031725] dark:text-[#DAEAFF]"
                            >
                              {others.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {tr(`Reasignar todo a ${o.name}`, `Reassign all data to ${o.name}`)}
                                </option>
                              ))}
                              <option value="">
                                {tr(
                                  'Eliminar también sus cuentas y movimientos',
                                  'Also delete their accounts & transactions'
                                )}
                              </option>
                            </select>

                            <button
                              type="button"
                              onClick={() => confirmDelete(profile.id)}
                              className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700"
                            >
                              {tr('Confirmar eliminación', 'Confirm delete')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingId(null)}
                              className="px-3 py-1.5 bg-white dark:bg-[#062035] border border-[#C6DAF7] dark:border-[#1B4A7C] text-[#355170] dark:text-[#A1C6F6] rounded-lg"
                            >
                              {tr('Cancelar', 'Cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#D3E3FA] dark:border-[#123B66]">
                <h3 className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF]">
                  {mode === 'edit'
                    ? tr('Editar información del perfil', 'Edit profile information')
                    : tr('Agregar nuevo perfil', 'Add new profile')}
                </h3>
                <button
                  type="button"
                  onClick={() => setMode('list')}
                  className="text-xs font-medium text-[#5A7694] dark:text-[#A1C6F6] hover:underline"
                >
                  {tr('Volver a la lista', 'Back to list')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('Nombre del perfil *', 'Profile name *')}
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={tr('Ej. Sofía, Cuenta Familiar...', 'e.g. Sofia, Family Joint...')}
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF] focus:outline-none focus:ring-2 focus:ring-[#499BED]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('Rol o relación', 'Role or relation')}
                  </label>
                  <input
                    type="text"
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    placeholder={tr('Ej. Co-titular, Socio, Empresa...', 'e.g. Co-owner, Partner, Business...')}
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('Correo electrónico', 'Email address')}
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="nombre@correo.com"
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('Teléfono', 'Phone number')}
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+61 400 000 000"
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm font-mono-num text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('País / Residencia', 'Country / Residence')}
                  </label>
                  <input
                    type="text"
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                    placeholder="País"
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1.5">
                    {tr('Color identificador en gráficos', 'Chart accent color')}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {PROFILE_COLOR_PALETTE.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, color: hex }))}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${
                          form.color === hex
                            ? 'border-[#031725] dark:border-white scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: hex }}
                        aria-label={hex}
                      />
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#355170] dark:text-[#A1C6F6] mb-1">
                    {tr('Notas personales / objetivos', 'Personal notes / goals')}
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder={tr(
                      'Ej. Meta de ahorro para vivienda, perfil fiscal, ingresos freelance...',
                      'e.g. Home deposit savings goal, tax notes, freelance income...'
                    )}
                    className="w-full px-3 py-2 bg-white dark:bg-[#031725] border border-[#C6DAF7] dark:border-[#1B4A7C] rounded-lg text-sm text-[#031725] dark:text-[#DAEAFF]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMode('list')}
                  className="px-4 py-2 text-sm font-medium text-[#355170] dark:text-[#A1C6F6] hover:bg-[#EAF2FF] dark:hover:bg-[#022E5B] rounded-lg"
                >
                  {tr('Cancelar', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
                >
                  <Plus className="w-4 h-4" />
                  {mode === 'edit'
                    ? tr('Guardar cambios', 'Save changes')
                    : tr('Crear perfil', 'Create profile')}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#D3E3FA] dark:border-[#123B66] bg-[#EAF2FF]/50 dark:bg-[#041E32] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#022E5B] dark:bg-[#499BED] text-white dark:text-[#031725] text-sm font-semibold rounded-lg hover:bg-[#031725] dark:hover:bg-[#6EB1F5]"
          >
            {tr('Listo', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
}
