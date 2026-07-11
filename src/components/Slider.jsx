import { useEffect, useRef, useState } from 'react'

// A labelled range input with a live numeric readout you can CLICK to type an
// exact value. Click the value → it turns into a text field; Enter/blur commits
// (clamped to [min,max]), Escape cancels. `format(v)` styles the read-only
// display (units like ° or ×); editing always works on the raw number so the
// slider and the typed value stay in agreement.
export default function Slider({ label, value, min, max, step, disabled, onChange, format }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const fmt = format || ((v) => String(v))

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEdit(e) {
    if (disabled) return
    e.preventDefault() // don't let the wrapping <label> steal focus to the range
    setDraft(String(value))
    setEditing(true)
  }

  function commit() {
    const n = Number(draft)
    if (draft.trim() !== '' && !Number.isNaN(n)) onChange(clamp(n, min, max))
    setEditing(false)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') setEditing(false)
  }

  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          className="slider-value-edit"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <span
          className={'slider-value' + (disabled ? '' : ' editable')}
          onClick={startEdit}
          title={disabled ? undefined : 'Click to type an exact value'}
        >
          {fmt(value)}
        </span>
      )}
    </label>
  )
}

function clamp(n, min, max) {
  if (min != null && n < min) return min
  if (max != null && n > max) return max
  return n
}
