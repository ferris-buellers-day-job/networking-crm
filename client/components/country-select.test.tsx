// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CountrySelect } from './country-select.js';

function renderSelect(
  value: string | null = null,
  onChange: (v: string | null) => void = vi.fn()
) {
  return render(<CountrySelect value={value} onChange={onChange} />);
}

describe('CountrySelect', () => {
  it('renders an empty "Select country" option', () => {
    renderSelect();
    expect(screen.getByRole('option', { name: '— Select country —' })).toBeInTheDocument();
  });

  it('contains United States option', () => {
    renderSelect();
    expect(screen.getByRole('option', { name: 'United States' })).toBeInTheDocument();
  });

  it('contains United Kingdom option', () => {
    renderSelect();
    expect(screen.getByRole('option', { name: 'United Kingdom' })).toBeInTheDocument();
  });

  it('shows selected value when value prop is set', () => {
    renderSelect('US');
    const select = screen.getByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('US');
  });

  it('shows empty selection when value is null', () => {
    renderSelect(null);
    const select = screen.getByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('calls onChange with ISO code when an option is selected', () => {
    const onChange = vi.fn();
    renderSelect(null, onChange);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GB' } });
    expect(onChange).toHaveBeenCalledWith('GB');
  });

  it('calls onChange with null when empty option is selected', () => {
    const onChange = vi.fn();
    renderSelect('US', onChange);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('options are sorted alphabetically (Afghanistan appears before United States)', () => {
    renderSelect();
    const options = screen.getAllByRole('option');
    const names = options.map((o) => o.textContent ?? '');
    const afghanistanIdx = names.indexOf('Afghanistan');
    const usIdx = names.indexOf('United States');
    expect(afghanistanIdx).toBeGreaterThan(0); // not the empty option
    expect(afghanistanIdx).toBeLessThan(usIdx);
  });
});
