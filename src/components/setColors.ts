/** Shared per-set color palette so the trace chart and activation bars agree visually. */
export const SET_COLORS = ['#2A9D8F', '#E9C46A', '#E63946', '#9B5DE5'];

export function setColor(setNumber: number): string {
  return SET_COLORS[(setNumber - 1) % SET_COLORS.length];
}
