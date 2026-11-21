/**
 * Live-page groups. Driven by each point's unit in points.json so a new
 * id automatically gets a tile. Unknown units land in Other, never hidden.
 */

export interface TileGroupDef {
  id: string;
  label: string;
  units: readonly string[];
}

export const TILE_GROUPS: readonly TileGroupDef[] = [
  { id: "temperatures", label: "Temperatures", units: ["F", "C"] },
  { id: "electrical", label: "Electrical", units: ["A"] },
  { id: "calls", label: "Thermostat calls", units: ["bool"] },
  { id: "board", label: "Board", units: ["code"] },
];

export const OTHER_GROUP: TileGroupDef = { id: "other", label: "Other", units: [] };

export function groupForUnit(unit: string): TileGroupDef {
  const match = TILE_GROUPS.find((group) => group.units.includes(unit));
  return match ?? OTHER_GROUP;
}

export function groupPoints<T extends { unit: string }>(
  points: readonly T[],
): Array<{ id: string; label: string; points: T[] }> {
  const buckets = new Map<string, T[]>();
  const order = [...TILE_GROUPS, OTHER_GROUP];
  for (const group of order) {
    buckets.set(group.id, []);
  }
  for (const point of points) {
    const group = groupForUnit(point.unit);
    buckets.get(group.id)?.push(point);
  }
  return order
    .filter((group) => (buckets.get(group.id) ?? []).length > 0)
    .map((group) => ({
      id: group.id,
      label: group.label,
      points: buckets.get(group.id) ?? [],
    }));
}
