import { useMemo, useState } from 'react';
import { ArrowRight, GraduationCap, Info, User, Users } from 'lucide-react';
import { DISCIPLINES, ageFrom, firstName } from '../lib/family';

const RELATIONS = [
  ['self', 'Myself', 'I will train at the academy', User],
  ['child', 'My child', 'I am registering my son or daughter', GraduationCap],
  ['other', 'Another family member', 'Spouse, sibling or relative', Users],
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const digits = (s) => (s || '').replace(/\D/g, '');

/**
 * One form for every way a person joins an account:
 *  mode 'first'     – first person on a brand-new login ("who is joining?")
 *  mode 'add'       – another member on an existing login (child, parent, sibling)
 *  mode 'resubmit'  – correct and resubmit a rejected application
 * onSubmit(payload) must return an error message string, or '' on success.
 */
export default function MemberForm({ mode = 'first', members = [], initial, email, onSubmit, onCancel }) {
  const hasSelf = members.some((m) => m.relationship === 'self' && m.id !== initial?.id);
  const selfMember = members.find((m) => m.relationship === 'self');
  const guardianSeed = useMemo(() => {
    const withGuardian = members.find((m) => m.guardian_name);
    return {
      name: selfMember?.full_name || withGuardian?.guardian_name || '',
      phone: selfMember?.phone || withGuardian?.guardian_phone || '',
    };
  }, [members, selfMember]);

  // Adding to an existing login: most often another child, so start there unless nobody is "self" yet and no child exists.
  const startRel = initial?.relationship || (mode === 'add' && (hasSelf || members.some((m) => m.relationship === 'child')) ? 'child' : 'self');
  const [form, setForm] = useState(() => ({
    relationship: startRel,
    full_name: initial?.full_name || '',
    date_of_birth: initial?.date_of_birth || '',
    phone: initial?.phone || '',
    discipline: initial?.discipline || '10m Air Rifle',
    guardian_name: initial?.guardian_name || (mode === 'add' && startRel === 'child' ? guardianSeed.name : ''),
    guardian_phone: initial?.guardian_phone || (mode === 'add' && startRel === 'child' ? guardianSeed.phone : ''),
  }));
  const [touchedGuardian, setTouchedGuardian] = useState(Boolean(initial?.guardian_name));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const age = ageFrom(form.date_of_birth);
  const isChild = form.relationship === 'child';
  const needsGuardian = isChild || (age !== null && age < 18);

  function pickRelation(rel) {
    setForm((f) => {
      const next = { ...f, relationship: rel };
      // Save the parent re-typing their own details for each child.
      if (rel === 'child' && !touchedGuardian) { next.guardian_name = guardianSeed.name; next.guardian_phone = guardianSeed.phone; }
      // A parent adding THEMSELVES after a child: reuse the name and phone already given as guardian.
      if (rel === 'self' && mode === 'add' && !f.full_name.trim()) { next.full_name = guardianSeed.name; if (!f.phone.trim()) next.phone = guardianSeed.phone; }
      return next;
    });
    setErrors({});
  }
  const set = (k) => (e) => {
    const v = e.target.value;
    if (k === 'guardian_name' || k === 'guardian_phone') setTouchedGuardian(true);
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: '' }));
  };

  function validate() {
    const x = {};
    if (!form.full_name.trim()) x.full_name = isChild ? "Enter your child's full name." : 'Enter the full name.';
    if (isChild && !form.date_of_birth) x.date_of_birth = 'Date of birth is needed for a child.';
    if (form.date_of_birth && form.date_of_birth > todayISO()) x.date_of_birth = 'Date of birth cannot be in the future.';
    if (form.phone && digits(form.phone).length < 10) x.phone = 'Enter a 10-digit phone number.';
    if (needsGuardian) {
      if (!form.guardian_name.trim()) x.guardian_name = 'Enter the parent or guardian name.';
      if (digits(form.guardian_phone).length < 10) x.guardian_phone = 'Enter a 10-digit phone number the academy can call.';
    }
    return x;
  }

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const x = validate();
    setErrors(x);
    const firstBad = Object.keys(x)[0];
    if (firstBad) { document.getElementById(`mf-${firstBad}`)?.focus(); return; }
    setBusy(true);
    const msg = await onSubmit({
      p_full_name: form.full_name.trim(),
      p_phone: form.phone.trim() || null,
      p_date_of_birth: form.date_of_birth || null,
      p_guardian_name: needsGuardian ? form.guardian_name.trim() : null,
      p_guardian_phone: needsGuardian ? form.guardian_phone.trim() : null,
      p_discipline: form.discipline,
      p_relationship: form.relationship,
      p_shooter_id: mode === 'resubmit' ? initial?.id : null,
    });
    if (msg) setFormError(msg);
    setBusy(false);
  }

  const nameLabel = isChild ? "Child's full name" : form.relationship === 'self' ? 'Your full name' : 'Full name';
  const who = form.full_name.trim() ? firstName(form.full_name) : '';
  const submitText = busy ? 'Submitting…' : mode === 'resubmit' ? 'Update and resubmit' : who ? `Submit ${who} for approval` : 'Submit for approval';

  return <form className="fam-form" onSubmit={submit} noValidate>
    {mode !== 'resubmit' && <fieldset className="fam-rel">
      <legend>Who is joining?</legend>
      <div className="fam-rel-grid">
        {RELATIONS.map(([key, title, sub, Icon]) => {
          const off = key === 'self' && hasSelf;
          return <label key={key} className={`fam-rel-card${form.relationship === key ? ' on' : ''}${off ? ' off' : ''}`}>
            <input type="radio" name="relationship" value={key} checked={form.relationship === key} disabled={off} onChange={() => pickRelation(key)} />
            <span className="fam-rel-ico"><Icon size={20} /></span>
            <span><b>{title}</b><small>{off ? 'You are already on this account' : sub}</small></span>
          </label>;
        })}
      </div>
    </fieldset>}

    <div className="fam-grid">
      <div className="fam-field span-2">
        <label htmlFor="mf-full_name">{nameLabel} <i>*</i></label>
        <input id="mf-full_name" value={form.full_name} onChange={set('full_name')} autoComplete="off" aria-invalid={!!errors.full_name} placeholder="As it should appear on the membership card" />
        {errors.full_name && <p className="fam-err" role="alert">{errors.full_name}</p>}
      </div>
      <div className="fam-field">
        <label htmlFor="mf-date_of_birth">Date of birth{isChild && <> <i>*</i></>}</label>
        <input id="mf-date_of_birth" type="date" max={todayISO()} value={form.date_of_birth} onChange={set('date_of_birth')} aria-invalid={!!errors.date_of_birth} />
        {errors.date_of_birth && <p className="fam-err" role="alert">{errors.date_of_birth}</p>}
      </div>
      <div className="fam-field">
        <label htmlFor="mf-discipline">Discipline</label>
        <select id="mf-discipline" value={form.discipline} onChange={set('discipline')}>{DISCIPLINES.map((d) => <option key={d}>{d}</option>)}</select>
      </div>
      <div className="fam-field span-2">
        <label htmlFor="mf-phone">{isChild ? "Child's phone (optional)" : 'Phone number'}</label>
        <input id="mf-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} aria-invalid={!!errors.phone} placeholder="10-digit mobile number" />
        {errors.phone && <p className="fam-err" role="alert">{errors.phone}</p>}
      </div>
    </div>

    {needsGuardian && <div className="fam-guardian">
      <p className="fam-guardian-title">Parent / guardian</p>
      <p className="fam-guardian-sub">{isChild ? 'The academy uses this to reach you about your child.' : 'Required for members under 18.'}</p>
      <div className="fam-grid">
        <div className="fam-field">
          <label htmlFor="mf-guardian_name">Parent / guardian name <i>*</i></label>
          <input id="mf-guardian_name" value={form.guardian_name} onChange={set('guardian_name')} autoComplete="name" aria-invalid={!!errors.guardian_name} />
          {errors.guardian_name && <p className="fam-err" role="alert">{errors.guardian_name}</p>}
        </div>
        <div className="fam-field">
          <label htmlFor="mf-guardian_phone">Parent / guardian phone <i>*</i></label>
          <input id="mf-guardian_phone" type="tel" inputMode="tel" value={form.guardian_phone} onChange={set('guardian_phone')} aria-invalid={!!errors.guardian_phone} />
          {errors.guardian_phone && <p className="fam-err" role="alert">{errors.guardian_phone}</p>}
        </div>
      </div>
    </div>}

    {mode !== 'resubmit' && <p className="fam-note"><Info size={16} /><span>
      {email ? <>Signed in as <b>{email}</b>. </> : null}Everyone on this login keeps their <b>own</b> membership ID, QR pass, scores and fees. The academy approves each person separately.
    </span></p>}

    {formError && <p className="fam-msg error" role="alert">{formError}</p>}

    <div className="fam-actions">
      {onCancel && <button type="button" className="fam-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
      <button className="fam-btn primary" disabled={busy}>{submitText}{!busy && <ArrowRight size={17} />}</button>
    </div>
  </form>;
}
