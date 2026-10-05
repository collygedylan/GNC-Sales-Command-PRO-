import React, { useId } from 'react';
import { createRoot } from 'react-dom/client';
import { crewTags, crewColors, flagColors, operationalTokens, normalizeNote, orderNote, moveEntry, moveLine, freeformLine } from './model.mjs';

export function OperationalText({ value }) {
  return <span className="bn-operational-text">{operationalTokens(value).map((part, i) => part.color
    ? <mark key={i} style={{ background: flagColors[part.color][0], color: flagColors[part.color][1] }}>{part.text}</mark>
    : <React.Fragment key={i}>{part.text}</React.Fragment>)}</span>;
}
export function CrewBadge({ tag }) {
  const index = crewTags.indexOf(String(tag).toUpperCase());
  return tag ? <strong className="bn-crew-badge" style={{ background: crewColors[index] || '#475569' }}>{tag}</strong> : <span className="bn-crew-empty" aria-hidden="true">—</span>;
}
function Input({ label, value, onChange, multiline = false, ...props }) {
  const id = useId();
  const control = { id, value: value ?? '', onChange: event => onChange(event.target.value), ...props };
  return <div className="bn-field"><label htmlFor={id}>{label}</label>{multiline ? <textarea {...control} rows={3} /> : <input {...control} />}</div>;
}
export function StructuredBunchNote({ value, mode, disabled = false, onChange, onDetails, onWork, progress = {} }) {
  const note = normalizeNote(value), editing = mode !== 'read';
  const change = update => onChange(orderNote({ ...note, ...update }));
  const setLine = (id, patch) => change({ actions: note.actions.map(a => a.id === id ? { ...a, ...patch } : a) });
  const setSection = (id, patch) => change({ house_sections: note.house_sections.map(s => s.id === id ? { ...s, ...patch } : s) });
  const addLine = sectionId => change({ actions: [...note.actions, freeformLine(crypto.randomUUID(), sectionId)] });
  if (mode === 'header') return <fieldset className="bn-structured" disabled={disabled}>
    <legend>House and travel instructions</legend>
    <Input label="Default direction" value={note.direction} maxLength={200} onChange={direction => change({ direction })} />
    <Input label="Target houses" value={note.target_houses} maxLength={500} onChange={target_houses => change({ target_houses })} />
  </fieldset>;
  const unassigned = note.actions.filter(a => !a.section_id || !note.house_sections.some(s => s.id === a.section_id));
  const sections = [...(unassigned.length || editing ? [{ id: '', name: 'General tasks', direction: '' }] : []), ...note.house_sections];
  return <fieldset className="bn-structured" disabled={disabled}>
    <legend>{editing ? 'House sections and task lines' : 'Crew worksheet'}</legend>
    {!editing && <header className="bn-worksheet-header">
      <h3>{note.purposes || 'Bunch Notes'} · {note.location || note.location_code}</h3>
      <p><b>Direction:</b> {note.direction || 'Not specified'} · <b>Target houses:</b> {note.target_houses || 'Not specified'}</p>
      <h4>General instructions</h4><OperationalText value={note.instructions || note.general_instructions || 'None written'} />
      {note.prerequisites && <p><b>Prerequisites:</b> <OperationalText value={note.prerequisites} /></p>}
    </header>}
    {editing && <p>Order houses, then tasks within each house. Crew labels do not assign accounts. Quantity constraints are written instructions.</p>}
    <datalist id="bn-crew-presets">{crewTags.map(tag => <option key={tag} value={tag} />)}</datalist>
    {sections.map((section) => {
      const lines = section.id ? note.actions.filter(a => a.section_id === section.id) : unassigned;
      const houseIndex = note.house_sections.findIndex(s => s.id === section.id);
      return <section className="bn-house-section" key={section.id} aria-label={section.name || 'New house'}>
        <header className="bn-house-heading">
          <h3>{section.name || 'New house'}{(section.direction || note.direction) && ` · ${section.direction || note.direction}`}</h3>
          {editing && section.id && <>
            <Input label="House name" value={section.name} maxLength={200} onChange={name => setSection(section.id, { name })} />
            <Input label="House direction override" value={section.direction} maxLength={200} placeholder={note.direction || 'Use default direction'} onChange={direction => setSection(section.id, { direction })} />
            <div className="bn-toolbar">
              <button type="button" aria-label={`Move ${section.name || 'house'} up`} disabled={houseIndex === 0} onClick={() => change({ house_sections: moveEntry(note.house_sections, section.id, -1) })}>Move house up</button>
              <button type="button" aria-label={`Move ${section.name || 'house'} down`} disabled={houseIndex === note.house_sections.length - 1} onClick={() => change({ house_sections: moveEntry(note.house_sections, section.id, 1) })}>Move house down</button>
              <button type="button" disabled={lines.length > 0} onClick={() => change({ house_sections: note.house_sections.filter(s => s.id !== section.id) })}>Remove empty house</button>
            </div>
          </>}
        </header>
        {lines.map((line, i) => <article className="bn-task-line" key={line.id} data-action-id={line.id}>
          <aside><CrewBadge tag={line.margin_tag} /><small>#{line.sequence_order}</small></aside>
          <div className="bn-task-content">
            {editing ? <>
              <div className="bn-line-fields">
                <Input label="Crew tag" list="bn-crew-presets" value={line.margin_tag} maxLength={80} onChange={margin_tag => setLine(line.id, { margin_tag, crew: margin_tag })} />
                <label className="bn-field">House<select value={line.section_id} onChange={e => setLine(line.id, { section_id: e.target.value })}><option value="">General tasks</option>{note.house_sections.map(s => <option key={s.id} value={s.id}>{s.name || 'New house'}</option>)}</select></label>
                <Input label="Item size" value={line.item_size} maxLength={200} readOnly={line.scope === 'rows'} onChange={item_size => setLine(line.id, { item_size })} />
                <Input label="Item description" value={line.item_desc} maxLength={2000} readOnly={line.scope === 'rows'} onChange={item_desc => setLine(line.id, { item_desc })} />
                <Input label="Quantity constraint" value={line.quantity_constraint} maxLength={200} placeholder="< 30, all, etc." onChange={quantity_constraint => setLine(line.id, { quantity_constraint })} />
              </div>
              <Input label="Action / routing instruction" multiline value={line.instructions} maxLength={4000} onChange={instructions => setLine(line.id, { instructions, action_instruction: instructions })} />
              <p className="bn-routing"><OperationalText value={line.instructions} /></p>
              <div className="bn-toolbar">
                <button type="button" aria-label={`Move task ${line.sequence_order} up`} disabled={i === 0} onClick={() => onChange(moveLine(note, line.id, -1))}>Move up</button>
                <button type="button" aria-label={`Move task ${line.sequence_order} down`} disabled={i === lines.length - 1} onClick={() => onChange(moveLine(note, line.id, 1))}>Move down</button>
                {line.freeform ? <button type="button" onClick={() => change({ actions: note.actions.filter(a => a.id !== line.id) })}>Remove task</button>
                  : <button type="button" onClick={() => onDetails(line.id)}>Inventory action details</button>}
              </div>
            </> : <>
              <h4>{[line.item_size, line.item_desc].filter(Boolean).join(' · ') || line.label || 'General task'}</h4>
              {line.quantity_constraint !== '' && <p><b>Quantity:</b> {line.quantity_constraint}</p>}
              <p className="bn-routing"><OperationalText value={line.instructions} /></p>
              {line.destination && <p className="bn-routing"><b>Destination:</b> {line.destination}</p>}
              {line.marking && <p><OperationalText value={line.marking} /></p>}
              <p><b>{progress[line.id]?.status === 'done' ? 'Done' : progress[line.id]?.status === 'not_needed' ? 'Not needed' : 'Pending'}</b>{line.worker_added ? ' · Added by worker' : ''}</p>
              {onWork && <button type="button" onClick={() => onWork(line.id)}>Open work details</button>}
            </>}
          </div>
        </article>)}
        {editing && <button type="button" onClick={() => addLine(section.id)}>Add freeform task{section.id ? ` to ${section.name || 'house'}` : ''}</button>}
      </section>;
    })}
    {editing && <button type="button" onClick={() => change({ house_sections: [...note.house_sections, { id: crypto.randomUUID(), name: 'New house', direction: '' }] })}>Add house section</button>}
  </fieldset>;
}
export function mountStructuredBunchNote(host, props) {
  const root = createRoot(host);
  const update = next => root.render(<StructuredBunchNote {...next} />);
  update(props);
  return { update, destroy: () => root.unmount() };
}
